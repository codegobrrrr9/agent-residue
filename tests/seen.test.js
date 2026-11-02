import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isolate, K, userText, toolUse, toolResult, writeTranscript } from './helpers.js';

const iso = isolate(); iso.apply();
const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, '..', 'skills', 'agent-residue', 'scripts', 'agent-residue.js');
const AKH = process.env.APIKEYS_HANDLER_DIR || join(HERE, '..', '..', 'apikeys-handler');
const AKH_CLI = join(AKH, 'skills', 'apikeys-handler', 'scripts', 'apikeys-handler.js');

const run = (script, args, cwd, env = {}) => new Promise((resolve) => {
  const p = spawn(process.execPath, [script, ...args], { cwd, env: { ...process.env, ...iso.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let o = ''; p.stdout.on('data', d => o += d); p.stderr.on('data', d => o += d);
  p.on('close', (status) => resolve({ status, all: o }));
});

const stripe = K.stripe(201), dbpw = K.password(202), url = K.url(202), untouched = K.stripe(203);

test('seen: the file holds keyed fingerprints and name hints, never a value, and placeholders are left out', async () => {
  writeTranscript(iso, 'p', 's', [userText('use ' + stripe), toolUse('a', 'Read', { file_path: '/x/.env' }), toolResult('a', `DATABASE_URL=${url}\nSTRIPE_SECRET_KEY=${stripe}\nDEMO=sk_live_${'x'.repeat(30)}`)]);
  const file = join(iso.root, 'seen.json');
  const r = await run(CLI, ['seen', '--out', file], iso.root);
  assert.equal(r.status, 0, r.all);
  const text = readFileSync(file, 'utf8'), j = JSON.parse(text);
  for (const v of [stripe, dbpw, url]) assert.ok(!text.includes(v) && !r.all.includes(v));
  assert.equal(j.version, 1); assert.ok(j.items.length >= 2);
  assert.ok(j.items.every(i => /^[0-9a-f]{12}$/.test(i.fp) && i.tier !== 'low'));
});

test('hand-off: apikeys-handler marks the variable whose value the agent has seen, and only that one (needs the sibling repo; skipped in CI)', { skip: !existsSync(AKH_CLI) }, async () => {
  writeTranscript(iso, 'p2', 's2', [toolUse('b', 'Bash', { command: 'cat .env' }), toolResult('b', `STRIPE_SECRET_KEY=${stripe}\nDATABASE_URL=${url}`)]);
  const seen = join(iso.root, 'seen2.json');
  assert.equal((await run(CLI, ['seen', '--out', seen], iso.root)).status, 0);
  const proj = join(iso.root, 'project'); mkdirSync(proj, { recursive: true });
  spawn('git', ['init', '-q'], { cwd: proj });
  writeFileSync(join(proj, '.env'), `STRIPE_SECRET_KEY=${stripe}\nDATABASE_URL=${url}\nOTHER_SECRET_KEY=${untouched}\n`);
  const r = await run(AKH_CLI, ['plan', '--platform', 'dotenv', '--seen', seen], proj);
  assert.equal(r.status, 0, r.all);
  assert.match(r.all, /seen: 2 variables match/);
  assert.match(r.all, /STRIPE_SECRET_KEY.*SEEN BY AGENT/); assert.match(r.all, /DATABASE_URL.*SEEN BY AGENT/);
  assert.ok(!/OTHER_SECRET_KEY.*SEEN BY AGENT/.test(r.all), 'a secret the agent never saw is not marked');
  for (const v of [stripe, dbpw, untouched]) assert.ok(!r.all.includes(v));
});

test('localDay reports the machine\'s calendar day, not UTC', async () => {
  const { localDay } = await import('../skills/agent-residue/scripts/shared.js');
  const d = new Date(2026, 10, 1, 21, 30);                                              // 9:30 pm local, whatever the zone
  assert.equal(localDay(d.toISOString()), '2026-11-01');
  assert.equal(localDay(d.getTime()), '2026-11-01');
  assert.equal(localDay(''), ''); assert.equal(localDay('not a date'), '');
});
