# agent-residue

Rules from https://github.com/codegobrrrr9/agent-residue. Copy the folder `skills/agent-residue/scripts/` from the repo to `scripts/agent-residue/`.

1. Never open, grep or cat session logs, `history.jsonl`, Codex rollouts or a claude-mem database: that puts secrets in the conversation. Run `node scripts/agent-residue/agent-residue.js scan`; it prints types, fingerprints and counts, never values.
2. Quote what it prints. Never reconstruct or guess a value.
3. `scrub` is a dry run by default; ask before `--apply`. It removes the local copy only: the provider already received what the agent printed, so rotate the secrets too.
4. Rotate first: `agent-residue seen --out seen.json`, then `apikeys-handler scan --seen seen.json`.
5. Do not scrub files modified in the last 15 minutes; do not use `--force` unless asked.
