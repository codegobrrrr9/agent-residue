import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { detect } from '../skills/agent-residue/scripts/detect.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// GitHub push protection blocks a push that contains something shaped like a real key, even a made-up one. This repo's own detector
// reads every tracked text file and fails the build first, so the problem shows up in CI and never as a rejected push.
test('no tracked file contains a string the detector would call a secret (fixtures are built at run time)', () => {
  const ls = spawnSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' });
  if (ls.status !== 0) return;                                              // not a git checkout (an npx copy): nothing to check
  const bad = [];
  for (const f of ls.stdout.split('\0').filter(Boolean)) {
    if (!/\.(?:js|cjs|mjs|json|jsonl|md|txt|yml|yaml|html|sh|mdc)$/i.test(f)) continue;
    const p = join(ROOT, f);
    if (!existsSync(p) || statSync(p).size > 2_000_000) continue;
    const text = readFileSync(p, 'utf8');
    for (const [i, l] of text.split('\n').entries()) for (const d of detect(l, { low: false })) if (!d.placeholder) bad.push(`${f}:${i + 1} ${d.type}`);
  }
  assert.deepEqual(bad, [], 'a key-shaped string is committed: build it at run time instead');
});
