// scrub: replace secrets in session logs with [residue:<type>:<fingerprint>]. Dry run unless --apply.
//
// Safety rules, each with a test:
//  - Detection runs on DECODED strings; replacement runs on the raw line using the JSON-escaped form of the value. Every changed line is
//    re-parsed and re-checked: if it is not valid JSON, or the value is still decodable from it (an escape form we did not match), the
//    ORIGINAL line is kept and counted as unsafe. A line is never half-scrubbed.
//  - The file is rewritten to a temp file and renamed over the original, only if its size and mtime are unchanged since it was read
//    (the agent may still append to a resumed session). A rename the OS refuses (Windows keeps a lock on a file another process has
//    open) skips that file instead of crashing.
//  - Files modified in the last 15 minutes are skipped unless --force: they are probably live.
//  - No backup copy by default: a backup keeps the secret and defeats the point. --backup-dir is opt-in and says so.
//  - Original mtime is restored, so Claude Code's retention clock is unchanged.

import { createReadStream, createWriteStream, statSync, renameSync, unlinkSync, utimesSync, copyFileSync, mkdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { detect } from './detect.js';
import { fingerprint, registerSecret, redact } from './shared.js';
import { guard } from './paths.js';
import { SOURCES, pathSource, strings } from './sources.js';
import { pickSources } from './scan.js';

const LIVE_MS = 15 * 60 * 1000;
const JSONL_KINDS = new Set(['transcript', 'history', 'rollout', 'jsonl']);

// Raw lines, keeping the exact line ending: { text, eol }.
export async function* rawLines(file) {
  guard(file);
  const rs = createReadStream(file, { encoding: 'utf8' });
  let buf = '';
  for await (const chunk of rs) {
    buf += chunk;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) { const raw = buf.slice(0, i); buf = buf.slice(i + 1); yield raw.endsWith('\r') ? { text: raw.slice(0, -1), eol: '\r\n' } : { text: raw, eol: '\n' }; }
  }
  if (buf.length) yield { text: buf, eol: '' };
}

// The secrets in one line: { value, type, fp }. Placeholders are left alone.
export function secretsInLine(text, kind, { low }) {
  const found = new Map();
  const consider = (s) => { for (const d of detect(s, { low })) { if (d.placeholder) continue; const v = s.slice(d.start, d.end); if (!found.has(v)) found.set(v, { value: v, type: d.type, fp: fingerprint(v) }); } };
  if (JSONL_KINDS.has(kind)) {
    let o; try { o = JSON.parse(text); } catch { return { found: [], bad: true }; }
    for (const s of strings(o)) consider(s);
  } else consider(text);
  return { found: [...found.values()].filter(f => f.fp), bad: false };
}

const token = (f) => `[residue:${f.type}:${f.fp}]`;
const esc = (v) => JSON.stringify(v).slice(1, -1);

// Replace every secret in a line. Returns { text, changed, unsafe, secrets }.
export function scrubLine(text, kind, opts) {
  const { found, bad } = secretsInLine(text, kind, opts);
  if (bad || !found.length) return { text, changed: false, unsafe: false, secrets: [] };
  for (const f of found) registerSecret(f.value);
  let out = text;
  // longest first, so a value that contains another is replaced whole
  for (const f of [...found].sort((a, b) => b.value.length - a.value.length)) {
    const forms = JSONL_KINDS.has(kind) ? [esc(f.value), f.value] : [f.value];
    for (const form of forms) if (form && out.includes(form)) out = out.split(form).join(token(f));
  }
  // post-condition: valid JSON (when it was JSON), and no secret value still decodable from the line
  const again = secretsInLine(out, kind, opts);
  if (again.bad || again.found.length) return { text, changed: false, unsafe: true, secrets: [] };
  return { text: out, changed: true, unsafe: false, secrets: found.map(f => ({ type: f.type, fp: f.fp })) };
}

export async function scrubFile(f, { apply, low, backupDir, rename = renameSync, beforeRename = null }) {
  const res = { file: f.file, changedLines: 0, unsafeLines: 0, secrets: new Map(), skipped: null };
  if (f.file.endsWith('.zst')) return { ...res, skipped: 'compressed (.zst): scan only in v0.1' };
  const before = statSync(guard(f.file));
  // pass 1: is there anything to do?
  let any = false;
  for await (const { text } of rawLines(f.file)) { const r = scrubLine(text, f.kind, { low }); if (r.unsafe) res.unsafeLines++; if (r.changed) { any = true; res.changedLines++; for (const s of r.secrets) res.secrets.set(s.fp, s.type); } }
  if (!any || !apply) return res;
  // pass 2: write a temp file
  const tmp = f.file + '.residue-tmp';
  const ws = createWriteStream(guard(tmp), { encoding: 'utf8' });
  try {
    for await (const { text, eol } of rawLines(f.file)) { const r = scrubLine(text, f.kind, { low }); if (!ws.write(r.text + eol)) await once(ws, 'drain'); }
    ws.end(); await once(ws, 'finish');
    if (beforeRename) beforeRename(f.file);
    const now = statSync(f.file);
    if (now.size !== before.size || now.mtimeMs !== before.mtimeMs) { unlinkSync(tmp); return { ...res, changedLines: 0, secrets: new Map(), skipped: 'changed while scrubbing' }; }
    if (backupDir) { mkdirSync(backupDir, { recursive: true }); copyFileSync(f.file, join(backupDir, createHash('sha1').update(f.file).digest('hex').slice(0, 8) + '-' + basename(f.file))); }
    try { rename(tmp, f.file); } catch { try { unlinkSync(tmp); } catch { /* gone */ } return { ...res, changedLines: 0, secrets: new Map(), skipped: 'in use (the OS refused the rename)' }; }
    utimesSync(f.file, before.atime, before.mtime);
  } catch (e) { try { unlinkSync(tmp); } catch { /* gone */ } return { ...res, changedLines: 0, secrets: new Map(), skipped: 'could not rewrite' }; }
  return res;
}

export async function runScrub({ flags, env, out, err }) {
  const ids = typeof flags.source === 'string' ? flags.source.split(',').map(s => s.trim()) : flags.path ? ['path'] : ['claude-code', 'codex'];
  if (ids.includes('claude-mem')) { err('scrub does not rewrite claude-mem databases in v0.1: scan only. Remove it from --source.'); return 2; }
  const sources = pickSources(ids, flags.path || null);
  const apply = !!flags.apply, low = !!flags['include-low'];
  const cutoff = flags.since ? Date.now() - Number(flags.since) * 86400000 : 0;
  const total = { files: 0, changedFiles: 0, lines: 0, unsafe: 0, skippedLive: 0, skipped: [], secrets: new Map() };
  for (const { def } of sources) {
    for (const f of def.files(env).filter(x => !cutoff || x.mtime >= cutoff)) {
      if (def.skipFile && def.skipFile(f)) continue;
      total.files++;
      if (Date.now() - f.mtime < LIVE_MS && !flags.force) { total.skippedLive++; continue; }
      const r = await scrubFile(f, { apply, low, backupDir: flags['backup-dir'] || null });
      total.unsafe += r.unsafeLines;
      if (r.skipped) { total.skipped.push(r.skipped); continue; }
      if (r.changedLines) { total.changedFiles++; total.lines += r.changedLines; for (const [fp, t] of r.secrets) total.secrets.set(fp, t); }
    }
  }
  const byType = [...total.secrets.values()].reduce((m, t) => (m[t] = (m[t] || 0) + 1, m), {});
  out(`agent-residue scrub ${apply ? '' : '(dry run) '} ·  ${total.secrets.size} distinct secrets on ${total.lines} lines in ${total.changedFiles} of ${total.files} files${apply ? ' replaced' : ' would be replaced'}  ·  values are never printed`);
  if (Object.keys(byType).length) out('  ' + Object.entries(byType).map(([t, n]) => `${t} ${n}`).join(' · '));
  if (total.skippedLive) out(`  ${total.skippedLive} files modified in the last 15 minutes were skipped (probably live). --force includes them.`);
  if (total.skipped.length) out(`  ${total.skipped.length} files skipped: ${[...new Set(total.skipped)].join('; ')}`);
  if (total.unsafe) out(`  ${total.unsafe} lines were left unchanged because a safe replacement could not be proven (unusual escaping).`);
  if (flags['backup-dir'] && apply) out(`  Backups in ${flags['backup-dir']} still contain the secrets: delete them when you are sure.`);
  if (!apply) out('Dry run: nothing was written. Add --apply to scrub. Scrubbing removes the local copy only: the provider already received what the agent printed, so rotate too.');
  else out('Scrubbed. This removes the local copy only: the provider already received what the agent printed, so rotate the secrets (apikeys-handler).');
  return 0;
}

export { redact };
