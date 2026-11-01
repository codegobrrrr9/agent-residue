import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, statSync, existsSync, utimesSync, readdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isolate, K, userText, assistantText, toolUse, toolResult, writeTranscript, line } from './helpers.js';

const iso = isolate(); iso.apply();
const { scrubFile, scrubLine, rawLines } = await import('../skills/agent-residue/scripts/scrub.js');
const { scan, pickSources } = await import('../skills/agent-residue/scripts/scan.js');

const CLI = fileURLToPath(new URL('../skills/agent-residue/scripts/agent-residue.js', import.meta.url));
const runCli = (args) => new Promise((resolve) => {
  const p = spawn(process.execPath, [CLI, ...args], { env: { ...process.env, ...iso.env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let o = ''; p.stdout.on('data', d => o += d); p.stderr.on('data', d => o += d);
  p.on('close', (status) => resolve({ status, all: o }));
});
const OLD = Date.now() - 3 * 86400000;

function fixture(name, secrets) {
  const [stripe, url] = secrets;
  const lines = [
    userText('plain line one'),
    toolUse('t1', 'Read', { file_path: '/app/.env' }),
    toolResult('t1', `STRIPE_SECRET_KEY=${stripe}\nDATABASE_URL=${url}\nsay "hi"\tand a unicode snowman ☃`),
    line({ type: 'user', timestamp: '2026-10-30T12:00:04.000Z', message: { role: 'user', content: [{ type: 'text', text: 'again ' + stripe }] }, toolUseResult: { stdout: `STRIPE_SECRET_KEY=${stripe}` } }),
    assistantText('nothing secret here'),
  ];
  return writeTranscript(iso, 'proj-' + name, 'sess-' + name, lines, OLD);
}
const decodedText = (file) => readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));

test('dry run reports and changes nothing; apply removes every copy, keeps every line valid JSON, preserves mtime and non-secret bytes', async () => {
  const stripe = K.stripe(101), url = K.url(102), pw = url.split(':')[2].split('@')[0];
  const file = fixture('a', [stripe, url]);
  const before = readFileSync(file, 'utf8'), st = statSync(file);
  const f = { file, kind: 'transcript', mtime: st.mtimeMs };

  const dry = await scrubFile(f, { apply: false, low: false });
  assert.equal(dry.changedLines, 2); assert.equal(readFileSync(file, 'utf8'), before, 'a dry run does not write');
  assert.ok(!existsSync(file + '.residue-tmp'));

  const r = await scrubFile(f, { apply: true, low: false });
  assert.equal(r.changedLines, 2); assert.equal(r.skipped, null);
  const after = readFileSync(file, 'utf8');
  for (const v of [stripe, pw]) assert.ok(!after.includes(v) && !after.includes(JSON.stringify(v).slice(1, -1)), 'the value is gone from every copy');
  assert.match(after, /\[residue:stripe_key:[0-9a-f]{12}\]/);
  assert.equal(decodedText(file).length, 5, 'every line is still valid JSON');
  const b = before.split('\n'), a = after.split('\n');
  assert.equal(a[0], b[0]); assert.equal(a[4], b[4]);                       // untouched lines are byte-identical
  assert.ok(a[2].includes('say \\"hi\\"\\tand a unicode snowman'), 'escapes in the same line survive');
  assert.equal(statSync(file).mtimeMs, st.mtimeMs, 'the retention clock is unchanged');
  assert.ok(existsSync(file) && !existsSync(file + '.residue-tmp'));

  const again = await scrubFile({ ...f, mtime: statSync(file).mtimeMs }, { apply: true, low: false });
  assert.equal(again.changedLines, 0, 'idempotent');
  const rescan = await scan({ sources: pickSources(['claude-code']) });
  assert.ok(!rescan.findings.some(x => x.type === 'stripe_key' && !x.placeholder), 'a scan no longer finds it');
});

test('a value written with unusual escaping is left alone and reported unsafe, never half-scrubbed', async () => {
  const k = K.stripe(111);
  const escapedKey = [...k].map(c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')).join('');   // every character as a \\uXXXX escape
  const raw = `{"type":"user","message":{"role":"user","content":"token ${escapedKey} end"}}`;
  const r = scrubLine(raw, 'transcript', { low: false });
  assert.equal(r.changed, false); assert.equal(r.unsafe, true); assert.equal(r.text, raw, 'the original line is kept byte for byte');
});

test('live files are skipped without --force; a file that changes while scrubbing is left untouched; a refused rename is skipped, not a crash', async () => {
  const stripe = K.stripe(121), url = K.url(122);
  const file = fixture('b', [stripe, url]);
  const st = statSync(file), f = { file, kind: 'transcript', mtime: st.mtimeMs };
  const before = readFileSync(file, 'utf8');

  const raced = await scrubFile(f, { apply: true, low: false, beforeRename: (p) => appendFileSync(p, userText('the agent kept writing')) });
  assert.equal(raced.skipped, 'changed while scrubbing');
  assert.ok(readFileSync(file, 'utf8').startsWith(before), 'the original is intact, including what was appended');
  assert.ok(!existsSync(file + '.residue-tmp'), 'the temp file is removed');
  writeFileSync(file, before); utimesSync(file, st.atime, st.mtime);

  const locked = await scrubFile(f, { apply: true, low: false, rename: () => { throw Object.assign(new Error('EPERM'), { code: 'EPERM' }); } });
  assert.match(locked.skipped, /in use/); assert.equal(readFileSync(file, 'utf8'), before); assert.ok(!existsSync(file + '.residue-tmp'));

  // the CLI skips a file modified a minute ago
  const now = new Date(); utimesSync(file, now, now);
  const dry = await runCli(['scrub', '--apply']);
  assert.match(dry.all, /files modified in the last 15 minutes were skipped/);
  assert.equal(readFileSync(file, 'utf8'), before);
  const forced = await runCli(['scrub', '--apply', '--force']);
  assert.match(forced.all, /replaced/); assert.ok(!readFileSync(file, 'utf8').includes(stripe));
});

test('the CLI never prints a value, warns that rotation is still needed, and --backup-dir is opt-in and says what it keeps', async () => {
  const s1 = K.github(131), s2 = K.slack(132);
  const file = fixture('c', [s1, K.url(133)]);
  writeFileSync(file, readFileSync(file, 'utf8') + userText('also ' + s2)); utimesSync(file, new Date(OLD), new Date(OLD));
  const dry = await runCli(['scrub']);
  assert.match(dry.all, /Dry run: nothing was written/); assert.match(dry.all, /rotate/i);
  const bdir = join(iso.root, 'backups');
  const real = await runCli(['scrub', '--apply', '--backup-dir', bdir]);
  for (const v of [s1, s2]) assert.ok(!dry.all.includes(v) && !real.all.includes(v));
  assert.match(real.all, /Backups in .* still contain the secrets/);
  assert.ok(readdirSync(bdir).length >= 1);
  assert.ok(!existsSync(join(iso.root, 'nothing-else')), 'no backup exists unless asked for');
});

test('text files (shell snapshots) are scrubbed too, byte for byte outside the secret; claude-mem scrub is refused', async () => {
  const k = K.google(141);
  const f = join(iso.claude, 'shell-snapshots'); const file = join(f, 'snapshot-x.sh');
  const { mkdirSync } = await import('node:fs'); mkdirSync(f, { recursive: true });
  writeFileSync(file, `# header\r\nexport GOOGLE_API_KEY=${k}\r\nexport OTHER=1\r\n`); utimesSync(file, new Date(OLD), new Date(OLD));
  const r = await scrubFile({ file, kind: 'shell', mtime: OLD }, { apply: true, low: true });
  assert.equal(r.changedLines, 1);
  assert.equal(readFileSync(file, 'utf8').replace(/\[residue:google_api_key:[0-9a-f]{12}\]/, 'TOKEN'), '# header\r\nexport GOOGLE_API_KEY=TOKEN\r\nexport OTHER=1\r\n', 'CRLF and surrounding text unchanged');
  const refused = await runCli(['scrub', '--source', 'claude-mem']);
  assert.equal(refused.status, 2); assert.match(refused.all, /does not rewrite claude-mem/);
});

test('rawLines keeps line endings and a final line with no newline', async () => {
  const file = join(iso.root, 'lines.txt'); writeFileSync(file, 'a\nb\r\nc');
  const got = []; for await (const l of rawLines(file)) got.push(l);
  assert.deepEqual(got, [{ text: 'a', eol: '\n' }, { text: 'b', eol: '\r\n' }, { text: 'c', eol: '' }]);
});

test('by default scrub leaves shell snapshots and file-history checkpoints alone (a running shell and a rewind depend on them); --include-snapshots rewrites them and says what that costs', async () => {
  const k = K.google(151), k2 = K.npm(152);
  const { mkdirSync } = await import('node:fs');
  const sh = join(iso.claude, 'shell-snapshots', 'snapshot-live.sh'), fh = join(iso.claude, 'file-history', 'zz', 'chk@v1');
  mkdirSync(join(iso.claude, 'shell-snapshots'), { recursive: true }); mkdirSync(join(iso.claude, 'file-history', 'zz'), { recursive: true });
  writeFileSync(sh, `export GOOGLE_API_KEY=${k}\n`); writeFileSync(fh, `NPM_TOKEN=${k2}\n`);
  for (const f of [sh, fh]) utimesSync(f, new Date(OLD), new Date(OLD));
  const shBefore = readFileSync(sh), fhBefore = readFileSync(fh);
  const def = await runCli(['scrub', '--apply']);
  assert.deepEqual(readFileSync(sh), shBefore); assert.deepEqual(readFileSync(fh), fhBefore);
  assert.match(def.all, /snapshot files left alone/); assert.match(def.all, /placeholder instead of a credential/);
  const inc = await runCli(['scrub', '--apply', '--include-snapshots']);
  assert.ok(!readFileSync(sh, 'utf8').includes(k) && !readFileSync(fh, 'utf8').includes(k2));
  assert.match(inc.all, /restart any session that is still using a scrubbed shell snapshot/);
  for (const v of [k, k2]) assert.ok(!def.all.includes(v) && !inc.all.includes(v));
});
