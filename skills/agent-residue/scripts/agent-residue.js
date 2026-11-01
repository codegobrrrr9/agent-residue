#!/usr/bin/env node
// agent-residue: find the secrets your coding agent has seen and kept, and say how they got there.
//   agent-residue sources                         what is on this machine, and where (no contents)
//   agent-residue scan   [--source claude-code,codex,claude-mem,path] [--path dir] [--since days] [--no-low] [--json]
//   agent-residue report [--out file.md]          the same, as a file
//   agent-residue seen   [--json] [--out file]    fingerprints and name hints for `apikeys-handler scan --seen`
//   agent-residue scrub  [--apply] [--force]      replace secrets in session logs (dry run by default)
// A finding is a keyed hash, a type, a length and counts. A value is never printed, never stored, never sent anywhere.

import { realpathSync, writeFileSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { redact } from './shared.js';
import { roots } from './paths.js';
import { SOURCES } from './sources.js';
import { scan, summarize, pickSources } from './scan.js';

const out = (s = '') => process.stdout.write(redact(s) + '\n');
const err = (s = '') => process.stderr.write(redact(s) + '\n');

export function parseArgs(argv) {
  const a = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t.startsWith('--')) { const k = t.slice(2); const n = argv[i + 1]; if (n === undefined || n.startsWith('--')) a.flags[k] = true; else { a.flags[k] = n; i++; } }
    else a._.push(t);
  }
  return a;
}
const list = (v) => (typeof v === 'string' ? v.split(',').map(s => s.trim()).filter(Boolean) : null);
const mb = (n) => n >= 1e9 ? (n / 1e9).toFixed(1) + ' GB' : n >= 1e6 ? (n / 1e6).toFixed(1) + ' MB' : Math.ceil(n / 1e3) + ' KB';
const day = (ms) => (ms ? new Date(ms).toISOString().slice(0, 10) : 'n/a');

export function sourceIds(flags) {
  const ids = list(flags.source) || (flags.path ? ['path'] : ['claude-code', 'codex', 'claude-mem']);
  return ids;
}

function printScan(r, flags) {
  const s = summarize(r);
  out(`agent-residue scan  ·  ${s.distinct.high} high · ${s.distinct.medium} medium${r.low ? ` · ${s.distinct.low} low` : ''} distinct secrets  ·  ${s.sessionsAffected} sessions affected  ·  ${s.distinct.placeholders} placeholders set aside  ·  values are never printed`);
  for (const [id, st] of Object.entries(r.stats)) {
    out(`  ${id.padEnd(12)} ${st.files} files, ${mb(st.bytes)}, ${st.lines} lines${st.badLines ? `, ${st.badLines} unreadable lines` : ''}${st.skipped ? `, ${st.skipped} skipped` : ''}${st.oldest ? `  (${day(st.oldest)} to ${day(st.newest)})` : ''}${st.unverified ? '  [adapter unverified: see references/platforms.md]' : ''}${st.note ? '  ' + st.note : ''}`);
  }
  const real = r.findings.filter(f => !f.placeholder);
  for (const f of real.slice(0, Number(flags.top) || 25)) {
    out(`\n${f.tier.padEnd(6)} ${f.type.padEnd(22)} fp ${f.fp}  len ${f.length}  ${f.places} place${f.places === 1 ? '' : 's'} in ${f.sessions} session${f.sessions === 1 ? '' : 's'}  ${f.first ? f.first.slice(0, 10) : ''} → ${f.last ? f.last.slice(0, 10) : ''}${f.names.length ? '  names: ' + f.names.join(', ') : ''}`);
    out('       how it got there: ' + Object.entries(f.causes).slice(0, 4).map(([k, n]) => `${k} (${n})`).join(', '));
  }
  if (real.length > (Number(flags.top) || 25)) out(`\n… ${real.length - (Number(flags.top) || 25)} more (use --top N, or --json)`);
  if (s.topCauses.length) { out('\nWhere they came from, all secrets together:'); for (const [k, n] of s.topCauses) out(`  ${String(n).padStart(5)}  ${k}`); }
  const denies = [];
  const causeText = s.topCauses.map(c => c[0]).join(' | ');
  if (/Read \.env|\benv\b|cat \.env|printenv/.test(causeText)) denies.push('"Read(./.env*)"', '"Read(./**/.env*)"');
  if (/credentials file/.test(causeText)) denies.push('"Read(./**/credentials*)"', '"Read(./**/*.pem)"');
  if (denies.length) out(`\nSuggestion, not applied: in .claude/settings.json add  "permissions": { "deny": [${denies.join(', ')}] }  so the agent cannot read these files. (cat and printenv still work: they need a hook or a habit.)`);
  const rt = r.retention;
  if (rt.oldestAffectedDate) out(`\nRetention: Claude Code keeps session logs ${rt.cleanupPeriodDays} days (${rt.source}); the oldest affected file is ${rt.oldestAffectedAgeDays} days old (${rt.oldestAffectedDate}).${rt.zeroUnverified ? ' A value of 0 is not documented officially: check before relying on it.' : ''}`);
  out('\nScrubbing a log removes the local copy only. Whatever the agent printed was sent to your model provider when it printed it: rotate the secrets (apikeys-handler), then scrub.');
  if (!real.length) out('\nNo secrets found in these sources.');
}

export async function main(argv) {
  const a = parseArgs(argv), f = a.flags, cmd = a._[0];
  if (!cmd || cmd === 'help' || f.help) { out(readHelp()); return 0; }
  const env = process.env;

  if (cmd === 'sources') {
    for (const [id, def] of Object.entries(SOURCES)) {
      const files = def.files(env);
      out(`${id.padEnd(12)} ${files.length ? 'found' : 'not found'}  ${files.length} files  ${mb(files.reduce((n, x) => n + x.size, 0))}  ${def.where(env).replace(roots(env).home, '~')}`);
    }
    let mem = '~/.claude-mem/claude-mem.db'; try { statSync(join(roots(env).claudeMem, 'claude-mem.db')); mem += '  found'; } catch { mem += '  not found'; }
    out(`${'claude-mem'.padEnd(12)} ${mem}  (adapter unverified)`);
    return 0;
  }
  if (!['scan', 'report', 'seen', 'scrub'].includes(cmd)) { err(`unknown command "${cmd}". Run agent-residue help.`); return 2; }

  if (cmd === 'scrub') {
    const { runScrub } = await import('./scrub.js');
    return runScrub({ flags: f, env, out, err });
  }

  const sources = pickSources(sourceIds(f), f.path ? resolve(f.path) : null);
  const r = await scan({ sources, since: f.since ? Number(f.since) : null, low: !f['no-low'], env });

  if (cmd === 'seen') {
    const { buildSeen } = await import('./seen.js');
    const seen = buildSeen(r, { includeLow: !!f['include-low'] });
    const text = JSON.stringify(seen, null, 2);
    if (f.out) { writeFileSync(resolve(f.out), text + '\n'); out(`${seen.items.length} fingerprints written to ${f.out} (no values)`); } else out(text);
    return 0;
  }
  if (cmd === 'report') {
    const { reportMarkdown } = await import('./report.js');
    const md = reportMarkdown(r);
    if (f.out) { writeFileSync(resolve(f.out), md); out(`report written to ${f.out}`); } else process.stdout.write(redact(md));
    return 0;
  }
  if (f.json) { out(JSON.stringify({ summary: summarize(r), ...r }, null, 2)); return 0; }
  printScan(r, f);
  return 0;
}

function readHelp() {
  return `agent-residue: find the secrets your coding agent has seen and kept.

  sources   what is on this machine (names and counts only)
  scan      secrets in Claude Code and Codex logs, claude-mem memory, or a folder: where, how many, what put them there
  report    the same as a markdown file                 seen   fingerprints for apikeys-handler (no values)
  scrub     replace secrets in session logs, atomically (dry run unless --apply)

flags: --source claude-code,codex,claude-mem,path  --path <dir>  --since <days>  --no-low  --top N  --json  --out file
A finding is a keyed hash, a type, a length and counts. A value is never printed, stored or sent anywhere.`;
}

const samePath = (a, b) => { try { return realpathSync(a) === realpathSync(b); } catch { return a === b; } };
const isMain = process.argv[1] && samePath(fileURLToPath(import.meta.url), resolve(process.argv[1]));
if (isMain) main(process.argv.slice(2)).then(c => { if (c !== undefined) process.exitCode = c; }).catch(e => { err('agent-residue: ' + (e && e.message ? e.message : e)); process.exitCode = 1; });
