# agent-residue: what it reads, how it decides, what it cannot see

## Sources (and how sure each one is)

| Source | Reads | Status |
|---|---|---|
| `claude-code` | `<claude>/projects/**/*.jsonl` (including subagent transcripts), `history.jsonl`, `shell-snapshots/*`, `file-history/**` (text only, 2 MB cap, binary skipped) | Format verified on a real install (1.2 GB, about 600 transcript files). `CLAUDE_CONFIG_DIR` is honoured. |
| `codex` | `<codex>/sessions/**/rollout-*.jsonl` and `.jsonl.zst` (zstd, read with Node 22.15+) | Schema learned from key paths and value types on a real install; every string in a line is scanned except `encrypted_content`. `auth.json` is never read. Scan only: compressed files are not rewritten. |
| `claude-mem` | `<claude-mem>/claude-mem.db`, read only through `node:sqlite` (Node 22.13+): `observations`, `session_summaries`, `user_prompts` | **Unverified**: built from claude-mem's published schema and tested on a fixture database, not on a real install. Scan only. |
| `path` | any folder of `.jsonl`, `.json`, `.md`, `.txt`, `.log` | Generic. Use it for exports from Cursor, Gemini CLI or Copilot. Their native stores are not parsed. |

Never read: Codex `auth.json`, Claude Code's `.credentials.json`, `.netrc`. They are meant to hold a credential, and a finding there would only report the login.

## Detection

Run on **decoded** strings: each JSONL line is parsed and every string value is walked, so a JSON-escaped copy cannot hide a value and the fingerprint is
made from the same bytes apikeys-handler fingerprints. Three tiers, reported separately:

- **high**: a provider-prefixed key (Stripe, AWS access key id, GitHub, GitLab, npm, OpenAI, Anthropic, Slack, Google, SendGrid, Hugging Face, Telegram).
- **medium**: the password in a connection URL, a PEM private key, a JWT, a `Bearer` token.
- **low**: `NAME=value` or `"name": "value"` where the name ends in SECRET, TOKEN, PASSWORD, API_KEY, ACCESS_KEY, PRIVATE_KEY or CREDENTIALS, the value is 12+
  characters with at least 3 bits of entropy per character, and does not look like code (a call, an identifier chain) or a variable reference.

**Placeholders** (a run of one character, demo/example/changeme, low entropy, plain words) are marked and counted separately, never in the headline. A provider
prefix vouches for a key: weak words such as "test" do not demote a prefixed key.

Not designed to be found, and reported as such: a bare hex token in prose, a base64 value in a Kubernetes Secret, a short password. A secret printed with no name
and no known prefix is invisible to a pattern detector.

Every regex uses bounded quantifiers and a string over 2 MB is cut, so one minified line cannot stall a scan.

## Findings carry no value

`{fp, type, tier, placeholder, length, places, sessions, files, first, last, causes, names, sources}`. `fp` is a 12-character HMAC-SHA256 under the machine key
shared with apikeys-handler (`~/.apikeys-handler/key`), so the same secret has the same fingerprint in both tools. For a database URL the password is the
finding; apikeys-handler also matches through the password inside a URL.

## Cause

Which tool call put the value in front of the agent: `output of Read .env`, `output of printenv`, `typed into curl`, `you pasted it`, `the assistant wrote it`,
`shell snapshot`, `file snapshot`. The command head is kept (`cat .env`, `docker inspect`), never its arguments, so a value inside a command cannot reach the
report. This is the part that tells you what to change.

## Scrub

Dry run by default. `--apply` replaces each secret with `[residue:<type>:<fingerprint>]` on the raw line using the JSON-escaped form of the value, then re-parses
the line and re-runs detection: if the line is not valid JSON, or a value is still decodable from it, the **original line is kept** and counted as unsafe. The file
is written to a temp file and renamed only if its size and modification time are unchanged since it was read; a refused rename (Windows locks open files) skips the
file. Files modified in the last 15 minutes are skipped without `--force`. No backup by default, because a backup keeps the secret. The original modification time
is restored, so Claude Code's retention clock is unchanged. Scrub does not rewrite claude-mem databases or `.zst` files in v0.1.

## Retention

Claude Code deletes session logs older than `cleanupPeriodDays` (30 by default per its documentation) at startup. The tool reads that one number from
`settings.json` and nothing else. The behaviour of `0` is not confirmed by official documentation, so it is reported as it is.

## What this cannot do

- It cannot unsend what was printed: the model provider received it at the time. Rotate.
- It sees only the sources it lists. Cursor and Gemini native stores, an IDE's own history, a terminal's scrollback and screenshots are outside it.
- A pattern detector has a ceiling. See `benchmarks/results.md` for the first-run recall and what it is not designed to find.

## Benchmark

Pre-registered in `benchmarks/PREREGISTRATION.md`: generated positives (seeded, nothing key-shaped committed), generated hard negatives, and pinned public files
(lockfiles, minified bundles, READMEs with example keys). First run: recall 92.7% high, 100% medium, 80% low, 91.3% overall (81.5% counting what it is not
designed to see); 0 false positives in 60 hard negatives and 2.3 MB of public files. The fixes made after that run, and why the second run's 100% is not evidence,
are in `benchmarks/results.md`.
