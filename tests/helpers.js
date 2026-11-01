// Test helpers. Two rules:
//  1. No test ever touches the real home: the real home is recorded as FORBIDDEN before HOME/USERPROFILE and every agent
//     directory are pointed at a temp dir, and the tool's guard() throws if anything resolves under it.
//  2. No fake key is written as a literal. GitHub push protection scans for key shapes, and a made-up key that matches one blocks
//     the push. Every key here is assembled at run time from a seed, so no tracked file contains a key-shaped string.

import { mkdtempSync, mkdirSync, writeFileSync, cpSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir, homedir } from 'node:os';

const REAL_HOME = homedir();

export function isolate() {
  const root = mkdtempSync(join(tmpdir(), 'residue-t-'));
  const dirs = { root, home: join(root, 'home'), claude: join(root, 'home', '.claude'), codex: join(root, 'home', '.codex'), mem: join(root, 'home', '.claude-mem'), keys: join(root, 'home', '.apikeys-handler') };
  for (const d of Object.values(dirs)) mkdirSync(d, { recursive: true });
  const env = { HOME: dirs.home, USERPROFILE: dirs.home, CLAUDE_CONFIG_DIR: dirs.claude, CODEX_HOME: dirs.codex, CLAUDE_MEM_DATA_DIR: dirs.mem, APIKEYS_HANDLER_HOME: dirs.keys, AGENT_RESIDUE_FORBID_PREFIX: REAL_HOME };
  return { ...dirs, env, apply() { Object.assign(process.env, env); } };
}

function mulberry32(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const B62 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const UP = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
function pick(alphabet, n, seed) { const r = mulberry32(seed); let s = ''; for (let i = 0; i < n; i++) s += alphabet[Math.floor(r() * alphabet.length)]; return s; }
// guarantee mixed case and a digit so the body looks like a real key
export const body = (n, seed) => { let s = pick(B62, n, seed); return 'aB3' + s.slice(3); };

export const K = {
  stripe: (seed = 1) => ['sk', 'live', body(26, seed)].join('_'),
  stripeTest: (seed = 1) => ['sk', 'test', body(26, seed)].join('_'),
  whsec: (seed = 1) => ['whsec', body(32, seed)].join('_'),
  aws: (seed = 1) => 'AK' + 'IA' + pick(UP, 16, seed),
  github: (seed = 1) => 'gh' + 'p_' + body(36, seed),
  openai: (seed = 1) => 'sk' + '-proj-' + body(44, seed),
  anthropic: (seed = 1) => 'sk' + '-ant-api03-' + body(48, seed),
  slack: (seed = 1) => 'xo' + 'xb-' + pick('0123456789', 10, seed) + '-' + body(24, seed + 1),
  google: (seed = 1) => 'AI' + 'za' + body(35, seed),
  npm: (seed = 1) => 'npm' + '_' + body(36, seed),
  url: (seed = 1, user = 'app') => 'postgres' + '://' + user + ':' + body(20, seed) + '@db.internal:5432/app',
  password: (seed = 1) => body(20, seed),
  pem: (seed = 1) => ['-----BEGIN ' + 'RSA PRIVATE KEY-----', pick(B62 + '+/', 64, seed), pick(B62 + '+/', 64, seed + 1), pick(B62 + '+/', 40, seed + 2) + '==', '-----END ' + 'RSA PRIVATE KEY-----'].join('\n'),
  jwt: (seed = 1) => ['eyJ' + body(20, seed), 'eyJ' + body(30, seed + 1), body(40, seed + 2)].join('.'),
};

export const placeholder = { stripe: () => ['sk', 'live', 'x'.repeat(30)].join('_'), aws: () => 'AK' + 'IA' + 'X'.repeat(16), demo: () => 'demo-secret-' + '0'.repeat(12) };

// ---- Claude Code transcript fixtures ----
export function line(o) { return JSON.stringify(o) + '\n'; }
export const userText = (text, extra = {}) => line({ type: 'user', timestamp: '2026-10-30T12:00:00.000Z', message: { role: 'user', content: text }, ...extra });
export const assistantText = (text) => line({ type: 'assistant', timestamp: '2026-10-30T12:00:01.000Z', message: { role: 'assistant', content: [{ type: 'text', text }] } });
export const toolUse = (id, name, input) => line({ type: 'assistant', timestamp: '2026-10-30T12:00:02.000Z', message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } });
export const toolResult = (id, text) => line({ type: 'user', timestamp: '2026-10-30T12:00:03.000Z', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: text }] } });

export function writeTranscript(iso, project, session, lines, mtime) {
  const dir = join(iso.claude, 'projects', project);
  mkdirSync(dir, { recursive: true });
  const f = join(dir, session + '.jsonl');
  writeFileSync(f, lines.join(''));
  if (mtime) { const t = new Date(mtime); utimesSync(f, t, t); }
  return f;
}
export { cpSync };
