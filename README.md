<div align="center">

# 🫥 agent-residue

**The secrets your coding agent has seen, and kept.**

Everything an agent prints is written to disk in plaintext, and was sent to the model provider when it was printed. agent-residue finds the secrets already sitting in your Claude Code and Codex session logs and in claude-mem memory, tells you which tool call put each one there, scrubs the local copy safely, and hands the list to [apikeys-handler](https://github.com/codegobrrrr9/apikeys-handler) so those rotate first. It never prints, stores or sends a value.

[![test](https://github.com/codegobrrrr9/agent-residue/actions/workflows/test.yml/badge.svg)](https://github.com/codegobrrrr9/agent-residue/actions/workflows/test.yml)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
![zero deps](https://img.shields.io/badge/dependencies-0-brightgreen)

</div>

Run `cat .env` once, or let an agent `printenv`, and the output is in a session log under `~/.claude/projects/` (Claude Code keeps them 30 days by default, [per its settings docs](https://docs.anthropic.com/en/docs/claude-code/settings)) and in the model provider's request. Memory plugins that capture "everything your agent does" keep another copy: [claude-mem](https://github.com/thedotmack/claude-mem)'s secret redaction is opt-in and covers data captured after you turn it on. Nothing looked at what was already on disk. This does.

**Scrubbing is not rotation.** It removes the local copy. The provider already received what the agent printed, so the secrets still have to be rotated: that is what the hand-off to apikeys-handler is for.

## For your coding agent

Paste this into Claude Code, Codex, Cursor or Gemini CLI:

```
Install the agent-residue skill from https://github.com/codegobrrrr9/agent-residue, refer to the repo's AGENTS.md.
```

The skill tells the agent **not to read your logs itself** (that would put the secrets into the conversation) and to run the tool, which prints types, keyed fingerprints and counts.

No install:

```bash
npx --yes --allow-git=all github:codegobrrrr9/agent-residue scan
```

## What it prints

```
$ agent-residue scan
agent-residue scan  ·  3 high · 1 medium · 2 low distinct secrets  ·  5 sessions affected  ·  4 placeholders set aside  ·  values are never printed
  claude-code  595 files, 1.2 GB, 41,204 lines  (2026-10-02 to 2026-11-01)
  codex        51 files, 6 MB, 1,980 lines

high   stripe_key             fp 4f1a9c0e27b3  len 34  14 places in 6 sessions  2026-10-12 → 2026-10-30
       how it got there: output of Read .env (9), you pasted it (3), typed into curl (2)

Where they came from, all secrets together:
    9  output of Read .env
    5  output of printenv
    3  you pasted it

Suggestion, not applied: ... "permissions": { "deny": ["Read(./.env*)", "Read(./**/.env*)"] }
Retention: Claude Code keeps session logs 30 days; the oldest affected file is 19 days old.
Scrubbing a log removes the local copy only. Rotate the secrets (apikeys-handler), then scrub.
```

(Illustrative layout with made-up numbers: your run prints your own.) A finding is a **keyed hash, a type, a length and counts**. Never a value, never a project path.

```bash
agent-residue sources                     # what is on this machine (names and counts only)
agent-residue scan  [--source claude-code,codex,claude-mem,path] [--since 30] [--json]
agent-residue seen  --out seen.json       # fingerprints for apikeys-handler (no values)
apikeys-handler scan --seen seen.json     # secrets your agent saw are marked and rotated first
agent-residue scrub                       # dry run; add --apply to replace secrets with [residue:type:fingerprint]
```

## How it works

- **Sources:** Claude Code session logs (including subagents), prompt history, shell snapshots and file snapshots; Codex rollouts (`.jsonl` and `.jsonl.zst`); claude-mem's SQLite database (read only); any folder of exports with `--path`. Credential stores (Codex `auth.json`, Claude Code's credentials file) are never read.
- **Detection runs on decoded strings.** Each JSONL line is parsed and every string walked, so an escaped copy cannot hide a value, and the fingerprint matches the one apikeys-handler makes.
- **Three tiers, reported separately:** high (provider-prefixed keys), medium (credentialed URLs, private keys, JWTs, Bearer tokens), low (`NAME=value` with a secret-looking name). Placeholders and test values are set aside and counted separately.
- **Cause:** which tool call put it there (`Read .env`, `printenv`, a paste), never with the command's arguments. That is what tells you what to change.
- **Safe scrub:** every changed line is re-parsed and re-checked; if a safe replacement cannot be proven the original line is kept. Written to a temp file and renamed only if the file did not change meanwhile; a file another process holds is skipped; files touched in the last 15 minutes are skipped; original modification time restored; no backup by default (a backup keeps the secret).

## Does it work

**Detector benchmark** (pre-registered; [`benchmarks/`](benchmarks/)). Positives are generated at run time from a seed, so nothing key-shaped is committed; negatives are generated hard cases plus 12 pinned public files (lockfiles, minified bundles, READMEs full of example keys), 2.3 MB.

| First run | Result |
|---|---|
| Recall, provider-prefixed keys (high) | 92.7% (89 of 96) |
| Recall, credentialed URL, PEM, JWT, Bearer (medium) | 100% (24 of 24) |
| Recall, `NAME=value` (low) | 80% (24 of 30) |
| Recall, all tiers | **91.3%** (137 of 150) |
| Recall counting what it is not designed to see | 81.5% (137 of 168) |
| False positives in 60 hard negatives and 2.3 MB of public files | **0** |

The misses were a pattern bug (Telegram tokens after `bot` in a URL), a real key demoted to "placeholder" because its random body contained the letters "test", and bare `password:` lines in YAML. I fixed those; the second run scores 100%, which is a regression check, not evidence, because the fixes were written against exactly those misses. The first run is the number. The runner also double-counted a value printed twice; that was a bug in the benchmark, fixed and noted in [`results.md`](benchmarks/results.md).

**Tests.** The suite never touches your real home: a guard throws if anything resolves under it, and a test proves it. They cover: no planted value in any output, JSON, report or `seen` file, including a corrupted line that contains a key (the parse error is replaced with a generic message); scrub round trips (valid JSON, idempotent, untouched bytes identical, mtime kept, a file changed mid-scrub left alone, a refused rename skipped, unusual escaping left unchanged and reported); zstd Codex files; a claude-mem fixture database; the hand-off to apikeys-handler end to end; and a test that fails the build if any tracked file contains a string the detector would call a secret, so GitHub's push protection never has to.

## Honest limits

- **It cannot unsend what was printed.** The provider received it at the time. Rotate.
- **Recall is measured on templates I wrote.** An outsider's corpus would score lower. A secret printed with no name and no known prefix (a bare hex token in prose, a base64 value in a Kubernetes Secret, a short password) is not found, by design, and the benchmark says so (0 of 18).
- **Only the sources listed are read.** Cursor's and Gemini's native stores, an IDE's own history, terminal scrollback and screenshots are outside it.
- **claude-mem support is unverified:** built from its published database schema and tested on a fixture, not on a real install. **Codex** support was learned from one real install's key paths and is scan-only for compressed files.
- Scrub does not rewrite claude-mem databases or `.zst` files in v0.1.
- `cleanupPeriodDays` set to `0` is reported as it is: its behaviour is not confirmed by Claude Code's official documentation.
- Low-confidence findings are the least reliable tier. Treat the high and medium counts as the headline.

## Install by agent

| Agent | How |
|---|---|
| **Claude Code** | `/plugin marketplace add codegobrrrr9/agent-residue` then `/plugin install agent-residue@agent-residue`. Adds `/agent-residue`. |
| **Codex** | Copy `skills/agent-residue/` to `~/.codex/skills/agent-residue/` and append the Rules from [`AGENTS.md`](AGENTS.md). |
| **Cursor** | Copy [`.cursor/rules/agent-residue.mdc`](.cursor/rules/agent-residue.mdc) and the folder `skills/agent-residue/scripts/` into the project. |
| **Gemini CLI** | `gemini extensions install https://github.com/codegobrrrr9/agent-residue` |
| **GitHub Copilot** | Copy [`.github/copilot-instructions.md`](.github/copilot-instructions.md). |
| **No agent** | `npx --yes --allow-git=all github:codegobrrrr9/agent-residue scan` |

Needs Node 18+. zstd-compressed Codex logs need Node 22.15+; the claude-mem adapter needs 22.13+.

## Credits

Same family as [seatbelt](https://github.com/codegobrrrr9/seatbelt), [cheapskate](https://github.com/codegobrrrr9/cheapskate), [alibi](https://github.com/codegobrrrr9/alibi), [shortlist](https://github.com/codegobrrrr9/shortlist), [grudge](https://github.com/codegobrrrr9/grudge), [tollgate](https://github.com/codegobrrrr9/tollgate) and [apikeys-handler](https://github.com/codegobrrrr9/apikeys-handler). claude-mem's redaction docs are the reason the "already on disk" gap is visible: its patterns and name-key rules were a useful reference for what to look for.

## License

MIT. Star ⭐ if it found something you did not know your agent had kept.
