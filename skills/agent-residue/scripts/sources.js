// Sources: where an agent leaves what it saw. Each source lists its files and turns a file into "entries" (a decoded string, the role
// it played, and the cause that put it there). Entries are decoded text, never raw JSON, so detection and fingerprinting see the real
// value, and a JSON-escaped copy cannot hide one.
//
//   claude-code   <claude>/projects/**/*.jsonl (includes subagent transcripts), history.jsonl, shell-snapshots/*, file-history/**
//   codex         <codex>/sessions/**/rollout-*.jsonl. Generic JSON walk: the schema was learned from key paths only.
//   path          any folder of .jsonl .json .md .txt .log
//   claude-mem    <claude-mem>/claude-mem.db (read only, node:sqlite). See memdb.js.
//
// Credential stores are never read: Codex auth.json, Claude Code's credentials file.

import { createReadStream, readdirSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import zlib from 'node:zlib';
import { join, basename, extname } from 'node:path';
import { createInterface } from 'node:readline';
import { roots, guard } from './paths.js';
import { detect } from './detect.js';

const MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024;     // a transcript can be large; it is streamed
const MAX_SNAPSHOT_BYTES = 2 * 1024 * 1024;        // file-history snapshots are read whole-line by line but capped
const NEVER = /(?:^|[\\/])(?:auth\.json|\.credentials\.json|credentials\.json|\.netrc)$/i;

// Codex 0.x writes rollouts as .jsonl.zst (zstd). Node 22.15+ and 23.8+ can read them; older Node reports the file as skipped.
export async function* readLines(file) {
  guard(file);
  let input = createReadStream(file);
  if (file.endsWith('.zst')) { if (typeof zlib.createZstdDecompress !== 'function') throw new Error('zstd needs Node 22.15 or newer'); input = input.pipe(zlib.createZstdDecompress()); }
  input.setEncoding('utf8');
  const rl = createInterface({ input, crlfDelay: Infinity });
  let n = 0;
  for await (const text of rl) { n++; yield { n, text }; }
}

function walk(dir, { depth = 8, filter = () => true } = {}) {
  const out = [];
  const go = (d, left) => {
    let names; try { names = readdirSync(guard(d)); } catch { return; }
    for (const name of names) {
      const p = join(d, name);
      let st; try { st = statSync(p); } catch { continue; }
      if (st.isDirectory()) { if (left > 0) go(p, left - 1); continue; }
      if (NEVER.test(p)) continue;
      if (filter(p, st)) out.push({ file: p, size: st.size, mtime: st.mtimeMs });
    }
  };
  go(dir, depth);
  return out;
}

function looksBinary(file) {
  let fd; try { fd = openSync(guard(file), 'r'); } catch { return true; }
  try { const b = Buffer.alloc(4096); const n = readSync(fd, b, 0, 4096, 0); for (let i = 0; i < n; i++) if (b[i] === 0) return true; return false; }
  catch { return true; } finally { closeSync(fd); }
}

// ---- cause: which tool call put a value in front of the agent. Never contains a value. ----
export function commandHead(cmd) {
  if (typeof cmd !== 'string') return 'command';
  let c = cmd.trim().replace(/^(?:cd\s+[^;&|]{1,200}?(?:&&|;)\s*)+/, '').replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)+/, '');
  const toks = c.split(/\s+/);
  const first = (toks[0] || '').split(/[\\/]/).pop();
  if (!/^[A-Za-z][A-Za-z0-9._-]{0,24}$/.test(first)) return 'command';
  let out = first;
  const second = (toks[1] || '').split(/[\\/]/).pop();
  if (/^(?:\.env[A-Za-z0-9._-]{0,12}|[a-z][a-z-]{1,15})$/.test(second) && detect(second).length === 0) out += ' ' + second;
  return out;
}
function fileClass(p) {
  const b = basename(String(p || '')).toLowerCase();
  if (/^\.env/.test(b) || /\.env$/.test(b)) return '.env';
  if (/credential|secret|token|\.pem$|\.key$|id_rsa|\.p12$|\.pfx$|kubeconfig|\.npmrc|\.netrc/.test(b)) return 'credentials file';
  return 'file';
}
export function causeOf(name, input) {
  const i = input && typeof input === 'object' ? input : {};
  if (name === 'Bash' || name === 'PowerShell') return commandHead(i.command);
  if (name === 'Read') return 'Read ' + fileClass(i.file_path);
  if (name === 'Write' || name === 'Edit' || name === 'MultiEdit' || name === 'NotebookEdit') return 'Write ' + fileClass(i.file_path || i.notebook_path);
  if (name === 'Grep' || name === 'Glob') return name;
  if (name === 'Task' || name === 'Agent') return 'Agent';
  return String(name || 'tool').slice(0, 60);
}

export function* strings(value, depth = 0) {
  if (typeof value === 'string') { yield value; return; }
  if (depth > 8 || value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) { for (const v of value) yield* strings(v, depth + 1); return; }
  for (const [k, v] of Object.entries(value)) { if (k === 'encrypted_content') continue; yield* strings(v, depth + 1); }
}

// One Claude Code transcript line -> entries.
export function claudeEntries(o, toolById) {
  const out = [];
  const m = o && o.message;
  if (o && o.type === 'summary' && typeof o.summary === 'string') out.push({ role: 'summary', cause: 'summary', text: o.summary });
  if (!m) return out;
  const isUser = (m.role || o.type) === 'user';
  if (typeof m.content === 'string') { out.push({ role: isUser ? 'user prompt' : 'assistant text', cause: isUser ? 'user paste' : 'assistant', text: m.content }); return out; }
  for (const b of Array.isArray(m.content) ? m.content : []) {
    if (!b || typeof b !== 'object') continue;
    if (b.type === 'text' && typeof b.text === 'string') out.push({ role: isUser ? 'user prompt' : 'assistant text', cause: isUser ? 'user paste' : 'assistant', text: b.text });
    else if (b.type === 'thinking' && typeof b.thinking === 'string') out.push({ role: 'assistant thinking', cause: 'assistant', text: b.thinking });
    else if (b.type === 'tool_use') {
      const cause = causeOf(b.name, b.input);
      if (b.id) toolById.set(b.id, cause);
      for (const s of strings(b.input)) out.push({ role: 'tool input', cause, text: s });
    } else if (b.type === 'tool_result') {
      const cause = toolById.get(b.tool_use_id) || 'unknown tool';
      if (typeof b.content === 'string') out.push({ role: 'tool result', cause, text: b.content });
      else for (const c of Array.isArray(b.content) ? b.content : []) if (c && typeof c.text === 'string') out.push({ role: 'tool result', cause, text: c.text });
    }
  }
  return out;
}

async function* jsonlRecords(file, source, mapEntries, mtime) {
  const toolById = new Map();
  const session = basename(file).replace(/\.jsonl(?:\.zst)?$/, '');
  for await (const { n, text } of readLines(file)) {
    if (!text) continue;
    let o;
    try { o = JSON.parse(text); } catch { yield { source, file, session, lineNo: n, bad: true }; continue; }
    yield { source, file, session: (o && o.sessionId) || session, lineNo: n, date: (o && o.timestamp) || new Date(mtime).toISOString(), entries: mapEntries(o, toolById) };
  }
}
async function* textRecords(file, source, role, cause, mtime) {
  const session = basename(file);
  for await (const { n, text } of readLines(file)) yield { source, file, session, lineNo: n, date: new Date(mtime).toISOString(), entries: text ? [{ role, cause, text }] : [] };
}

export const SOURCES = {
  'claude-code': {
    label: 'Claude Code session logs, prompt history, shell snapshots, file snapshots',
    where: (env) => roots(env).claude,
    files(env) {
      const base = roots(env).claude, out = [];
      for (const f of walk(join(base, 'projects'), { filter: (p) => p.endsWith('.jsonl') })) out.push({ ...f, kind: 'transcript' });
      for (const f of walk(base, { depth: 0, filter: (p) => basename(p) === 'history.jsonl' })) out.push({ ...f, kind: 'history' });
      for (const f of walk(join(base, 'shell-snapshots'), { depth: 1 })) out.push({ ...f, kind: 'shell' });
      for (const f of walk(join(base, 'file-history'), { depth: 6, filter: (p, st) => st.size <= MAX_SNAPSHOT_BYTES })) out.push({ ...f, kind: 'snapshot' });
      return out;
    },
    records(f) {
      if (f.kind === 'transcript') return jsonlRecords(f.file, 'claude-code', claudeEntries, f.mtime);
      if (f.kind === 'history') return jsonlRecords(f.file, 'claude-code', (o) => [...strings(o)].map(text => ({ role: 'prompt history', cause: 'user paste', text })), f.mtime);
      if (f.kind === 'shell') return textRecords(f.file, 'claude-code', 'shell snapshot', 'shell snapshot', f.mtime);
      return textRecords(f.file, 'claude-code', 'file snapshot', 'edited-file snapshot', f.mtime);
    },
    skipFile: (f) => (f.kind === 'snapshot' && looksBinary(f.file)) ? 'binary' : null,
  },
  codex: {
    label: 'Codex session rollouts',
    where: (env) => roots(env).codex,
    files(env) {
      return walk(join(roots(env).codex, 'sessions'), { filter: (p) => p.endsWith('.jsonl') || p.endsWith('.jsonl.zst') }).map(f => ({ ...f, kind: 'rollout' }));
    },
    records(f) { return jsonlRecords(f.file, 'codex', (o) => [...strings(o)].map(text => ({ role: 'codex log', cause: 'codex', text })), f.mtime); },
  },
};

// A folder of exports or logs: --path <dir>.
export function pathSource(dir) {
  return {
    label: 'files under ' + basename(dir),
    where: () => dir,
    files() { return walk(dir, { depth: 8, filter: (p, st) => /\.(?:jsonl|json|md|txt|log)$/i.test(p) && st.size <= MAX_FILE_BYTES }).map(f => ({ ...f, kind: extname(f.file).toLowerCase() === '.jsonl' ? 'jsonl' : 'text' })); },
    records(f) {
      if (f.kind === 'jsonl') return jsonlRecords(f.file, 'path', (o) => [...strings(o)].map(text => ({ role: 'file', cause: 'file', text })), f.mtime);
      return textRecords(f.file, 'path', 'file', 'file', f.mtime);
    },
  };
}
