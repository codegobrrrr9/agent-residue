---
name: agent-residue
description: Finds the secrets your coding agent has seen and kept. Scans Claude Code session logs, prompt history, shell and file snapshots, Codex rollouts, claude-mem memory or any folder of exports for API keys, tokens, database passwords and private keys; says which tool call put each one there (Read .env, printenv, a paste); scrubs them from the logs safely; and hands a list of what the agent has seen to apikeys-handler so those rotate first. Never prints or stores a value. Use when the user asks what secrets their agent has seen, whether keys leaked into session logs or memory, after a breach or credential exposure, before sharing a transcript, or says /agent-residue.
license: MIT
metadata:
  author: codegobrrrr9
  version: "0.1.0"
  homepage: https://github.com/codegobrrrr9/agent-residue
---

# agent-residue

Everything an agent prints is written to disk in plaintext (Claude Code keeps session logs for 30 days by default) and was sent to the model
provider when it was printed. `cat .env`, `printenv` and a pasted key all end up there. agent-residue finds them, says what put them there,
scrubs the local copy, and tells apikeys-handler which secrets to rotate first. **It never prints, stores or sends a value, and neither may you.**

## Rules

1. **Never read the logs yourself.** Do not `grep`, `cat` or open anything under `~/.claude/projects`, `~/.codex`, `history.jsonl` or a claude-mem
   database: that would put the secrets into this conversation. Run the tool; it prints types, fingerprints and counts only.
2. **Report what the tool prints, no more.** Quote counts, types, causes and retention exactly. Never reconstruct, guess or paraphrase a value, and
   never print a fingerprint next to a name you inferred.
3. **Scan first, scrub only on a yes.** `scrub` is a dry run by default. Ask before `--apply`, and say what it does and does not do: it removes the
   local copy only. The provider already received what the agent printed, so the secrets still have to be rotated.
4. **Rotate before you scrub.** Hand the list to apikeys-handler (`agent-residue seen --out seen.json`, then `apikeys-handler scan --seen seen.json`).
5. **Do not scrub live sessions.** The tool skips files modified in the last 15 minutes; do not pass `--force` unless the user asks.
6. **Say what was not looked at.** Only the sources listed in the output were read. claude-mem and Codex support are marked unverified until run on a real install.
7. If the cause report says secrets came from `Read .env` or `cat .env`, show the suggested deny rule and ask before editing any settings file.

## Commands

```
agent-residue sources                         what is on this machine (names and counts only)
agent-residue scan   [--source claude-code,codex,claude-mem,path] [--path dir] [--since days] [--no-low] [--json]
agent-residue report [--out file.md]
agent-residue seen   [--out seen.json]        fingerprints for `apikeys-handler scan --seen`
agent-residue scrub  [--apply] [--force] [--include-low] [--backup-dir dir]
```

Tiers: **high** a provider-prefixed key; **medium** a credentialed URL, private key, JWT or Bearer token; **low** a `NAME=value` with a secret-looking name.
Placeholders and test values are set aside and counted separately. Method and the detector benchmark: [`references/method.md`](references/method.md).

## Final message shape

```
agent-residue · 3 high, 1 medium distinct secrets in 5 sessions · top cause: output of Read .env (9)
Still yours: rotate them (apikeys-handler scan --seen), then scrub; scrubbing does not unsend what the provider received.
```
