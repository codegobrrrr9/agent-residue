# agent-residue — instructions for coding agents

You are reading this because a user pasted something like:

> Install the agent-residue skill from https://github.com/codegobrrrr9/agent-residue, refer to the repo's AGENTS.md.

Do the install for the agent you are, confirm in one line, then follow the rules below for the rest of the session.
Do not explain what agent-residue is unless asked.

## Install

`<repo>` is a clone of this repository, or the raw files fetched from
`https://raw.githubusercontent.com/codegobrrrr9/agent-residue/main/`. The tool is a folder of zero-dependency Node files
(`skills/agent-residue/scripts/`), not one file: copy the whole folder.

| Agent | Do this |
|-------|---------|
| Claude Code | Run `/plugin marketplace add codegobrrrr9/agent-residue` then `/plugin install agent-residue@agent-residue`. Adds `/agent-residue`. If plugins are unavailable, copy `<repo>/skills/agent-residue/` to `~/.claude/skills/agent-residue/`. |
| Codex | Copy `<repo>/skills/agent-residue/` to `~/.codex/skills/agent-residue/`, or run `npx skills add codegobrrrr9/agent-residue`. Append the **Rules** below to the project's `AGENTS.md`. |
| Cursor | Copy `<repo>/.cursor/rules/agent-residue.mdc` to `.cursor/rules/`, and the folder `<repo>/skills/agent-residue/scripts/` to `scripts/agent-residue/`. |
| Gemini CLI | Run `gemini extensions install https://github.com/codegobrrrr9/agent-residue`. |
| GitHub Copilot | Copy `<repo>/.github/copilot-instructions.md` into the project's `.github/`, and the scripts folder as for Cursor. |
| Anything else | Append the **Rules** below to the agent's instruction file and keep the scripts folder in the project. |

No install needed to run it: `npx --yes --allow-git=all github:codegobrrrr9/agent-residue scan`.

After installing, say: `agent-residue on. I will not read your session logs myself; I will run the tool, which prints types and counts, never values.`

## Rules

1. **Never read the logs yourself.** Do not grep, cat or open `~/.claude/projects`, `~/.codex`, `history.jsonl` or a claude-mem database: that puts
   the secrets into this conversation. Run `agent-residue scan`; it prints types, keyed fingerprints and counts only.
2. **Quote exactly what the tool prints.** Never reconstruct or guess a value.
3. **Scan first, scrub only on a yes.** `scrub` is a dry run by default. Say that scrubbing removes the local copy only: the provider already received
   what the agent printed, so the secrets still need rotating.
4. **Rotate before you scrub:** `agent-residue seen --out seen.json`, then `apikeys-handler scan --seen seen.json`.
5. **Do not scrub live sessions** (the tool skips files changed in the last 15 minutes; do not add `--force` unless asked).
6. If secrets came from `Read .env` / `cat .env`, show the suggested deny rule and ask before editing any settings file.
7. Say which sources were read. claude-mem and Codex support are unverified until run on a real install.

## Commands

```
agent-residue sources | scan | report [--out f] | seen [--out f] | scrub [--apply]
scan flags: --source claude-code,codex,claude-mem,path  --path <dir>  --since <days>  --no-low  --top N  --json
```
