// Fingerprints, output redaction and small helpers. Same algorithm and key location as apikeys-handler, so a fingerprint made
// here matches one made there (the end-to-end test in tests/seen.test.js proves it).

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHmac, randomBytes } from 'node:crypto';
import { roots, guard } from './paths.js';

// ---- redaction: every secret value this process holds is registered and scrubbed from anything it prints ----
const known = new Set();
export function registerSecret(v) { if (typeof v === 'string' && v.length >= 6) known.add(v); }
export function redact(text) {
  let s = String(text ?? '');
  for (const v of known) if (s.includes(v)) s = s.split(v).join('[redacted]');
  return s;
}
export function clearSecrets() { known.clear(); }

// ---- fingerprints ----
let keyCache = null;
export function resetKeyCache() { keyCache = null; }
export function localKey(env = process.env) {
  if (keyCache) return keyCache;
  const dir = roots(env).keyDir;
  const p = guard(join(dir, 'key'), env);
  try { if (existsSync(p)) return (keyCache = readFileSync(p, 'utf8').trim()); } catch { /* fall through */ }
  const k = randomBytes(32).toString('hex');
  try { mkdirSync(dir, { recursive: true }); writeFileSync(p, k, { mode: 0o600 }); } catch { /* an unwritable home still works for this run */ }
  return (keyCache = k);
}
export function fingerprint(value) {
  if (typeof value !== 'string' || value === '') return null;
  return createHmac('sha256', localKey()).update(value).digest('hex').slice(0, 12);
}

// The password inside a connection URL (redis://:pw@host, postgres://user:pw@host/db), or null. Same rule as apikeys-handler.
export function credentialOf(value) {
  if (typeof value !== 'string') return null;
  const m = /^[a-z][a-z0-9+.-]*:\/\/[^/\s:@]*:([^@\s]+)@/i.exec(value);
  return m ? m[1] : null;
}

// A JSON.parse error message can quote part of the input. Never let one reach output: say where, not what.
export function safeParse(text, where) {
  try { return { ok: true, value: JSON.parse(text) }; }
  catch { return { ok: false, error: `unparseable JSON at ${where}` }; }
}

// Calendar day in the machine's own time zone (not UTC), so a log written at 8 pm Eastern is not reported as tomorrow.
export function localDay(v) {
  if (v === null || v === undefined || v === '') return '';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
