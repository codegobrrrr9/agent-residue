// claude-mem adapter: ~/.claude-mem/claude-mem.db, opened READ ONLY through node:sqlite (Node 22.13+), loaded only here so the rest of the
// tool runs on older Node. Tables follow claude-mem's published schema (docs/public/architecture/database.mdx). Scan only: no scrub in v0.1.
// STATUS: not installed on the author's machine, so tested against a fixture database built from that schema. Unverified on a real install.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { roots, guard } from './paths.js';

const TABLES = { observations: ['title', 'subtitle', 'narrative', 'text', 'facts', 'concepts', 'files_read', 'files_modified'], session_summaries: null, user_prompts: null };

export async function scanMemory({ env = process.env, take, stats }) {
  const file = join(roots(env).claudeMem, 'claude-mem.db');
  guard(file, env);
  if (!existsSync(file)) return { note: 'not found' };
  let sqlite;
  try { sqlite = await import('node:sqlite'); } catch { return { note: 'needs Node 22.13 or newer (node:sqlite)' }; }
  let db;
  try { db = new sqlite.DatabaseSync(file, { readOnly: true }); } catch { return { note: 'could not open read-only' }; }
  stats.files = 1;
  try {
    const have = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name));
    for (const [table, fixed] of Object.entries(TABLES)) {
      if (!have.has(table)) continue;
      const cols = db.prepare(`PRAGMA table_info(${table})`).all().filter(c => /TEXT|CHAR|CLOB|^$/i.test(c.type || '')).map(c => c.name);
      const use = fixed ? fixed.filter(c => cols.includes(c)) : cols.filter(c => !/^(id|project|status|type|sdk_session_id|claude_session_id|created_at|.*_at|.*_epoch)$/.test(c));
      if (!use.length) continue;
      const sel = ['id', cols.includes('claude_session_id') ? 'claude_session_id' : 'NULL AS claude_session_id', cols.includes('created_at') ? 'created_at' : 'NULL AS created_at', ...use].join(', ');
      for (const row of db.prepare(`SELECT ${sel} FROM ${table}`).iterate()) {
        stats.lines++;
        const rec = { source: 'claude-mem', file, session: row.claude_session_id || `${table}#${row.id}`, lineNo: row.id, date: row.created_at || null };
        for (const c of use) if (typeof row[c] === 'string' && row[c]) take(rec, { role: 'memory', cause: 'claude-mem ' + table, text: row[c] });
      }
    }
  } catch { stats.badLines++; } finally { try { db.close(); } catch { /* closed */ } }
  return { note: '' };
}
