import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isolate, K, placeholder, userText, assistantText, toolUse, toolResult, writeTranscript, line } from './helpers.js';

const iso = isolate(); iso.apply();
const { scan, summarize, pickSources, causeKey } = await import('../skills/agent-residue/scripts/scan.js');
const { guard } = await import('../skills/agent-residue/scripts/paths.js');
const { commandHead } = await import('../skills/agent-residue/scripts/sources.js');

const CLI = fileURLToPath(new URL('../skills/agent-residue/scripts/agent-residue.js', import.meta.url));
const runCli = (args, env = {}) => new Promise((resolve) => {
  const p = spawn(process.execPath, [CLI, ...args], { env: { ...process.env, ...iso.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let o = ''; p.stdout.on('data', d => o += d); p.stderr.on('data', d => o += d);
  p.on('close', (status) => resolve({ status, all: o }));
});
const cc = () => pickSources(['claude-code']);

const stripe = K.stripe(11), github = K.github(12), dburl = K.url(13), aws = K.aws(14), pw = K.password(15);
const ALL = [stripe, github, dburl, aws, pw, K.url(13).split(':')[2].split('@')[0]];

test('guard: the real home is forbidden under test, and every path the tool resolves is inside the temp home', async () => {
  const real = process.env.AGENT_RESIDUE_FORBID_PREFIX;
  assert.ok(real && iso.home.toLowerCase().startsWith(tmpdir().toLowerCase()), 'the temp home is under the temp dir');
  assert.throws(() => guard(join(real, '.claude', 'projects')), /refusing to touch the real home/);
  assert.doesNotThrow(() => guard(join(iso.home, '.claude')));
  // a run with only HOME/USERPROFILE overridden (no CLAUDE_CONFIG_DIR) must still resolve under the temp home
  const r = await runCli(['sources'], { CLAUDE_CONFIG_DIR: '', CODEX_HOME: '', CLAUDE_MEM_DATA_DIR: '' });
  assert.equal(r.status, 0, r.all);
  assert.ok(!r.all.includes(real), 'no real-home path appears in the output');
});

test('transcript: a secret read from .env, pasted by you, and typed into curl is one finding with three causes, across sessions', async () => {
  writeTranscript(iso, 'proj-a', 'session-1', [
    userText('here is my key ' + stripe),
    toolUse('t1', 'Read', { file_path: '/work/app/.env' }),
    toolResult('t1', `STRIPE_SECRET_KEY=${stripe}\nDATABASE_URL=${dburl}\nPORT=3000`),
    toolUse('t2', 'Bash', { command: `curl -s -H "Authorization: Bearer ${github}" https://api.example.com` }),
    toolResult('t2', '{"ok":true}'),
    assistantText('done'),
  ], '2026-10-28T12:00:00Z');
  writeTranscript(iso, 'proj-b', 'session-2', [
    toolUse('t3', 'Bash', { command: 'cd app && printenv' }),
    toolResult('t3', `PATH=/usr/bin\nSTRIPE_SECRET_KEY=${stripe}\nAWS_ACCESS_KEY_ID=${aws}`),
  ], '2026-10-29T12:00:00Z');
  const r = await scan({ sources: cc() });
  const s = r.findings.find(f => f.type === 'stripe_key');
  assert.equal(s.places, 3); assert.equal(s.sessions, 2);
  assert.deepEqual(Object.keys(s.causes).sort(), ['output of Read .env', 'output of printenv', 'you pasted it'].sort());
  assert.ok(s.names.includes('STRIPE_SECRET_KEY') || s.tier === 'high');
  assert.ok(r.findings.some(f => f.type === 'github_token' && f.causes['typed into curl'] === 1));
  const db = r.findings.find(f => f.type === 'url_credential');
  assert.ok(db && db.causes['output of Read .env'] === 1, 'the password inside a database URL is a finding by itself');
  assert.equal(summarize(r).distinct.high >= 3, true);
});

test('leaks: no planted value appears in the scan result, the CLI output, the JSON, the report or the seen file', async () => {
  const out = [];
  for (const args of [['scan'], ['scan', '--json'], ['report'], ['seen'], ['sources']]) out.push((await runCli(args)).all);
  const r = JSON.stringify(await scan({ sources: cc() }));
  for (const text of [...out, r]) for (const v of ALL) assert.ok(!text.includes(v), 'a planted value leaked: ' + v.slice(0, 8));
  assert.ok(out[0].includes('stripe_key'), 'the finding is reported by type');
});

test('a broken line holding a secret is counted, and the parse error never quotes it', async () => {
  const bad = K.stripe(31);
  writeTranscript(iso, 'proj-c', 'session-bad', [userText('fine line'), '{"type":"user","message":{"content":"' + bad + '"\n', '{not json ' + bad + '\n']);
  const r = await scan({ sources: cc() });
  assert.ok(r.stats['claude-code'].badLines >= 2);
  const cli = await runCli(['scan', '--json']);
  assert.ok(!cli.all.includes(bad) && !JSON.stringify(r).includes(bad));
});

test('placeholders and test values are set aside, not reported as secrets', async () => {
  writeTranscript(iso, 'proj-d', 'session-ph', [userText(`example: ${placeholder.stripe()} and ${placeholder.aws()}`), userText('TOKEN_X=' + placeholder.demo())]);
  const r = await scan({ sources: cc() });
  const ph = r.findings.filter(f => f.placeholder);
  assert.ok(ph.length >= 2);
  assert.ok(!r.findings.filter(f => !f.placeholder).some(f => f.length === placeholder.stripe().length));
});

test('other locations: prompt history, shell snapshots, file snapshots; binary snapshots and credential stores are never read', async () => {
  const hs = K.slack(41), sh = K.google(42), fh = K.npm(43), auth = K.openai(44);
  writeFileSync(join(iso.claude, 'history.jsonl'), line({ display: 'use ' + hs, timestamp: 1 }));
  mkdirSync(join(iso.claude, 'shell-snapshots'), { recursive: true });
  writeFileSync(join(iso.claude, 'shell-snapshots', 'snapshot-bash-1.sh'), `export GOOGLE_API_KEY=${sh}\n`);
  mkdirSync(join(iso.claude, 'file-history', 'abc'), { recursive: true });
  writeFileSync(join(iso.claude, 'file-history', 'abc', 'deadbeef@v1'), `NPM_TOKEN=${fh}\n`);
  writeFileSync(join(iso.claude, 'file-history', 'abc', 'image@v1'), Buffer.concat([Buffer.from([0, 1, 2, 0]), Buffer.from(K.stripe(45))]));
  mkdirSync(join(iso.codex, 'sessions', '2026'), { recursive: true });
  writeFileSync(join(iso.codex, 'sessions', 'auth.json'), JSON.stringify({ OPENAI_API_KEY: auth }));
  writeFileSync(join(iso.claude, '.credentials.json'), JSON.stringify({ token: K.anthropic(46) }));
  const r = await scan({ sources: pickSources(['claude-code', 'codex']) });
  const types = new Set(r.findings.map(f => f.type));
  for (const t of ['slack_token', 'google_api_key', 'npm_token']) assert.ok(types.has(t), t + ' found');
  const roles = JSON.stringify(r.findings.map(f => f.causes));
  assert.match(roles, /you pasted it/); assert.match(roles, /shell snapshot/); assert.match(roles, /file snapshot/);
  const fps = new Set(r.findings.map(f => f.length));
  assert.ok(!r.findings.some(f => f.type === 'anthropic_key'), 'the credentials file is not read');
  assert.ok(!r.findings.some(f => f.type === 'openai_key' && f.sources.includes('codex')), 'Codex auth.json is not read');
  assert.equal(r.stats['claude-code'].skipped >= 1, true, 'the binary snapshot is skipped and counted');
  assert.ok(fps.size > 0);
});

test('codex rollouts are walked generically and attributed to codex', async () => {
  const k = K.github(51);
  mkdirSync(join(iso.codex, 'sessions', '2026', '10'), { recursive: true });
  writeFileSync(join(iso.codex, 'sessions', '2026', '10', 'rollout-1.jsonl'), line({ type: 'event_msg', payload: { type: 'exec_command_output', output: 'TOKEN=' + k } }));
  const r = await scan({ sources: pickSources(['codex']) });
  assert.ok(r.findings.some(f => f.type === 'github_token' && f.sources.includes('codex')));
});

test('--since keeps only recent files; retention reports the oldest affected file against cleanupPeriodDays', async () => {
  const recent = (await scan({ sources: cc(), since: 1 })), all = await scan({ sources: cc() });
  assert.ok(recent.findings.length < all.findings.length);
  assert.equal(all.retention.cleanupPeriodDays, 30);
  writeFileSync(join(iso.claude, 'settings.json'), JSON.stringify({ cleanupPeriodDays: 7, env: { SOME_TOKEN: K.password(61) } }));
  const r = await scan({ sources: cc() });
  assert.equal(r.retention.cleanupPeriodDays, 7); assert.equal(r.retention.source, 'settings.json');
  assert.ok(!JSON.stringify(r).includes(K.password(61)), 'other settings content is never copied');
});

test('commandHead drops values and keeps only the command and a safe argument', () => {
  assert.equal(commandHead('cd app && cat .env'), 'cat .env');
  assert.equal(commandHead('FOO=' + K.password(7) + ' node server.js'), 'node');
  assert.equal(commandHead('curl -s https://x'), 'curl');
  assert.equal(commandHead(`export KEY=${K.stripe(9)}`), 'export');
  assert.equal(causeKey({ role: 'tool result', cause: 'printenv' }), 'output of printenv');
});

test('claude-mem: a fixture database built from the published schema is scanned read-only', async () => {
  let sqlite; try { sqlite = await import('node:sqlite'); } catch { return; }
  const k = K.openai(71);
  const db = new sqlite.DatabaseSync(join(iso.mem, 'claude-mem.db'));
  db.exec(`CREATE TABLE sdk_sessions (id INTEGER PRIMARY KEY, sdk_session_id TEXT, claude_session_id TEXT, project TEXT);
           CREATE TABLE observations (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT, sdk_session_id TEXT, claude_session_id TEXT, project TEXT, tool_name TEXT, title TEXT, subtitle TEXT, narrative TEXT, text TEXT, facts TEXT, concepts TEXT, files_read TEXT, files_modified TEXT, created_at TEXT, created_at_epoch INTEGER);`);
  db.prepare('INSERT INTO observations (session_id, sdk_session_id, claude_session_id, project, tool_name, title, narrative, created_at, created_at_epoch) VALUES (?,?,?,?,?,?,?,?,?)').run('s', 'sdk', 'mem-session-1', 'p', 'Bash', 'Set key', 'The agent exported OPENAI key ' + k + ' and ran the tests', '2026-10-30T10:00:00Z', 1);
  db.close();
  const r = await scan({ sources: [{ id: 'claude-mem', def: null }] });
  const f = r.findings.find(x => x.type === 'openai_key');
  assert.ok(f && f.sources.includes('claude-mem') && f.causes['output of claude-mem observations'] === undefined);
  assert.ok(r.stats['claude-mem'].unverified);
  assert.ok(!JSON.stringify(r).includes(k));
});

test('codex rollouts compressed with zstd (.jsonl.zst) are read; scrub reports them as scan-only', async () => {
  const zlib = (await import('node:zlib')).default;
  if (typeof zlib.zstdCompressSync !== 'function') return;                       // older Node: the adapter reports the file as skipped
  const k = K.openai(81);
  const dir = join(iso.codex, 'sessions', '2026', '11', '01'); mkdirSync(dir, { recursive: true });
  const f = join(dir, 'rollout-2026-11-01T10-00-00-abc.jsonl.zst');
  writeFileSync(f, zlib.zstdCompressSync(Buffer.from(line({ ordinal: 1, payload: { content: [{ type: 'text', text: 'export KEY=' + k }], encrypted_content: K.stripe(82) } }))));
  const r = await scan({ sources: pickSources(['codex']) });
  const hit = r.findings.find(x => x.type === 'openai_key' && x.sources.includes('codex'));
  assert.ok(hit, 'found inside the compressed file');
  assert.ok(!r.findings.some(x => x.type === 'stripe_key' && x.sources.includes('codex')), 'opaque encrypted_content is not scanned');
  const { scrubFile } = await import('../skills/agent-residue/scripts/scrub.js');
  const s = await scrubFile({ file: f, kind: 'rollout', mtime: 1 }, { apply: true, low: false });
  assert.match(s.skipped, /compressed/);
});

test('a secret seen only in test files the agent wrote or read is a fixture: counted on its own line, never in the headline, left out of the seen file', async () => {
  const fixture = K.stripe(91), real = K.github(92);
  writeTranscript(iso, 'proj-fx', 'session-fx', [
    toolUse('w1', 'Write', { file_path: '/work/app/tests/billing.test.js', content: `const KEY = '${fixture}'` }),
    toolResult('w1', 'File created'),
    toolUse('r1', 'Read', { file_path: '/work/app/tests/billing.test.js' }),
    toolResult('r1', `const KEY = '${fixture}'`),
    toolUse('b1', 'Bash', { command: 'printenv' }), toolResult('b1', `GITHUB_TOKEN=${real}`),
  ], '2026-10-29T12:00:00Z');
  const r = await scan({ sources: cc() });
  const fx = r.findings.find(f => f.type === 'stripe_key' && f.causes['typed into Write test file'] === 1 && f.causes['output of Read test file'] === 1);
  assert.ok(fx && fx.fixtureOnly === true, 'the fixture is attributed to the test file');
  assert.equal(r.findings.find(f => f.type === 'github_token' && f.causes['output of printenv']).fixtureOnly, false);
  const s = summarize(r);
  assert.ok(s.fixtureOnly.high >= 1);
  const { buildSeen } = await import('../skills/agent-residue/scripts/seen.js');
  assert.ok(!buildSeen(r).items.some(i => i.fp === fx.fp), 'a fixture is not handed to apikeys-handler');
  assert.ok(buildSeen(r, { includeFixtures: true }).items.some(i => i.fp === fx.fp));
  const cli = await runCli(['scan']);
  assert.match(cli.all, /seen only in test files the agent wrote or read/);
  assert.ok(!cli.all.includes(fixture) && !cli.all.includes(real));
});

test('a secret with a very large number of places does not throw (running minimum, no spread over a huge array)', async () => {
  const k = K.openai(95);
  const lines = []; for (let i = 0; i < 150000; i++) lines.push(JSON.stringify({ type: 'user', message: { role: 'user', content: 'x ' + k } }) + '\n');
  const { mkdtempSync } = await import('node:fs');
  const dir = mkdtempSync(join(iso.root, 'big-')); writeFileSync(join(dir, 'many.jsonl'), lines.join(''));
  const r = await scan({ sources: pickSources(['path'], dir) });
  const f = r.findings.find(x => x.type === 'openai_key');
  assert.equal(f.places, 150000); assert.ok(f.oldestOther > 0, "the running minimum is kept for sources other than Claude Code");
});

test('fixtures written through the shell (cat > tests/x.test.js) are attributed; a snapshot copy neither makes a finding a fixture nor stops it being one; a lone snapshot is not a fixture', async () => {
  const fx = K.stripe(97), lone = K.github(98);
  writeTranscript(iso, 'proj-fx2', 'session-fx2', [toolUse('c1', 'Bash', { command: `cat > tests/pay.test.js <<'EOF'\nconst k = '${fx}'\nEOF` }), toolResult('c1', '')], '2026-10-29T12:00:00Z');
  mkdirSync(join(iso.claude, 'file-history', 'qq'), { recursive: true });
  writeFileSync(join(iso.claude, 'file-history', 'qq', 'aaaa@v1'), `const k = '${fx}'\n`);
  writeFileSync(join(iso.claude, 'file-history', 'qq', 'bbbb@v1'), `TOKEN=${lone}\n`);
  const r = await scan({ sources: cc() });
  const a = r.findings.find(f => f.type === 'stripe_key' && f.causes['typed into cat on a test file'] === 1);
  assert.ok(a, 'attributed to a test file'); assert.equal(a.fixtureOnly, true, 'the snapshot copy does not stop it being a fixture');
  const b = r.findings.find(f => f.type === 'github_token' && f.causes['file snapshot'] === 1);
  assert.ok(b); assert.equal(b.fixtureOnly, false, 'a secret seen only in a snapshot is never assumed to be a fixture');
});
