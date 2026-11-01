// Where agents keep their logs. Every location comes from here, so a test can prove that no run touched the real home.
//
//   CLAUDE_CONFIG_DIR            Claude Code's config dir (default ~/.claude)
//   CODEX_HOME                   Codex's home (default ~/.codex)
//   CLAUDE_MEM_DATA_DIR          claude-mem's data dir (default ~/.claude-mem)
//   AGENT_RESIDUE_FORBID_PREFIX  tests set this to the REAL home: opening anything under it throws

import { homedir, tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { realpathSync } from 'node:fs';

export function home(env = process.env) { return env.USERPROFILE && process.platform === 'win32' ? env.USERPROFILE : env.HOME || homedir(); }

export function roots(env = process.env) {
  const h = home(env);
  return {
    home: h,
    claude: resolve(env.CLAUDE_CONFIG_DIR || join(h, '.claude')),
    codex: resolve(env.CODEX_HOME || join(h, '.codex')),
    claudeMem: resolve(env.CLAUDE_MEM_DATA_DIR || join(h, '.claude-mem')),
    keyDir: resolve(env.APIKEYS_HANDLER_HOME || join(h, '.apikeys-handler')),
  };
}

const norm = (p) => { let r; try { r = realpathSync(p); } catch { r = resolve(p); } return process.platform === 'win32' ? r.toLowerCase() : r; };

// Call before opening anything. A test that falls back to the real home would scan the user's actual logs and could print a
// finding into a transcript, so under test the real home is off limits.
export function guard(p, env = process.env) {
  const forbid = env.AGENT_RESIDUE_FORBID_PREFIX;
  if (!forbid) return p;
  const f = norm(forbid), t = norm(p), tmp = norm(tmpdir());
  const under = (x, base) => x === base || x.startsWith(base.endsWith(sep) ? base : base + sep);
  if (under(t, tmp)) return p;                      // on Windows the temp dir lives inside the home: a test's temp dir is fine
  if (under(t, f)) throw new Error('agent-residue test guard: refusing to touch the real home (' + p.slice(0, 40) + '…)');
  return p;
}
