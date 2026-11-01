#!/usr/bin/env node
// Fetch the pinned public negatives into benchmarks/work/ (gitignored) and record SHA-256 in negatives.lock.json.
//   node benchmarks/fetch.js
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const here = dirname(fileURLToPath(import.meta.url));
const work = join(here, 'work');
mkdirSync(work, { recursive: true });
const manifest = JSON.parse(readFileSync(join(here, 'negatives.json'), 'utf8'));
const lockFile = join(here, 'negatives.lock.json');
const lock = existsSync(lockFile) ? JSON.parse(readFileSync(lockFile, 'utf8')) : {};
let changed = false;
for (const f of manifest.files) {
  const dest = join(work, f.id + '.txt');
  let buf;
  if (existsSync(dest) && lock[f.id]) buf = readFileSync(dest);
  else { const r = await fetch(f.url); if (!r.ok) throw new Error(`${f.id}: HTTP ${r.status}`); buf = Buffer.from(await r.arrayBuffer()); writeFileSync(dest, buf); }
  const sha = createHash('sha256').update(buf).digest('hex');
  if (lock[f.id] && lock[f.id].sha256 !== sha) throw new Error(`${f.id}: content changed since it was locked`);
  if (!lock[f.id]) { lock[f.id] = { sha256: sha, bytes: buf.length }; changed = true; }
  console.log(f.id.padEnd(24), String(buf.length).padStart(9), 'bytes');
}
if (changed) writeFileSync(lockFile, JSON.stringify(lock, null, 1) + '\n');
