---
description: Find the secrets your agent has seen and kept in its session logs and memory. Prints types, fingerprints and counts, never values.
allowed-tools: Bash(node:*)
---

1. Run `node ${CLAUDE_PLUGIN_ROOT}/skills/agent-residue/scripts/agent-residue.js scan $ARGUMENTS` and quote the output exactly as printed.
2. Do not open, grep or cat any session log, `history.jsonl`, Codex rollout or claude-mem database yourself: that would put the secrets in this conversation.
3. Never run `scrub --apply` from this command. Offer the dry run (`scrub`), explain that it removes the local copy only and that the secrets must still be rotated, and ask first.
4. For rotation, suggest `agent-residue seen --out seen.json` then `apikeys-handler scan --seen seen.json`.
