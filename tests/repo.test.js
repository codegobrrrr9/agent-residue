import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { detect } from '../skills/agent-residue/scripts/detect.js';
import { placeholder, K } from './helpers.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// GitHub push protection blocks a push that contains anything SHAPED like a real key, and it does not care that the key looks fake:
// apikeys-handler's first push was refused over demo-style Stripe literals that this very detector calls placeholders. So this test counts every
// match in a tracked file, placeholder or not. Fixtures are built at run time, so no tracked file contains one.
const matches = (text) => text.split('\n').flatMap((l, i) => detect(l, { low: false }).map(d => `line ${i + 1}: ${d.type}${d.placeholder ? ' (looks like a placeholder)' : ''}`));

test('the check itself works: a demo-style literal built at run time is caught even though the detector calls it a placeholder', () => {
  assert.ok(matches(`const k = '${placeholder.stripe()}'`).some(m => /stripe_key \(looks like a placeholder\)/.test(m)));
  assert.ok(matches(`const k = '${['sk', 'live', 'demo' + '0'.repeat(20)].join('_')}'`).length >= 1);
  assert.ok(matches(`const k = '${K.stripe(1)}'`).length >= 1);
});

test('no tracked file contains a key-shaped string, placeholder or not (fixtures are built at run time)', () => {
  const ls = spawnSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' });
  if (ls.status !== 0) return;                                              // not a git checkout (an npx copy): nothing to check
  const bad = [];
  for (const f of ls.stdout.split('\0').filter(Boolean)) {
    if (!/\.(?:js|cjs|mjs|json|jsonl|md|txt|yml|yaml|html|sh|mdc)$/i.test(f)) continue;
    const p = join(ROOT, f);
    if (!existsSync(p) || statSync(p).size > 2_000_000) continue;
    for (const m of matches(readFileSync(p, 'utf8'))) bad.push(`${f} ${m}`);
  }
  assert.deepEqual(bad, [], 'a key-shaped string is committed: build it at run time instead');
});
