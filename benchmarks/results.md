# Detector benchmark results

Method and metrics were fixed before the run: [PREREGISTRATION.md](PREREGISTRATION.md). Raw numbers: `results.first.json`, `results.second.json`.
Positives are generated at run time from a seed (nothing key-shaped is committed); public negatives are pinned URLs fetched into `work/` (`negatives.json`, `negatives.lock.json`).

## First run (the headline)

| Metric | Result |
|---|---|
| Recall, high tier (provider-prefixed keys) | **92.7%** (89 of 96) |
| Recall, medium tier (credentialed URL, PEM, JWT, Bearer) | **100%** (24 of 24) |
| Recall, low tier (NAME=value) | **80%** (24 of 30) |
| Recall, all tiers | **91.3%** (137 of 150) |
| Recall counting the secrets it is not designed to see | 81.5% (137 of 168) |
| False positives, 60 generated hard negatives (SHAs, hashes, UUIDs, integrity strings, base64 images, `sk-` words, variable references) | 0 |
| False positives, 12 public files, 2.3 MB (lockfiles, minified bundles, READMEs with example keys), all tiers | 0 |
| Throughput | about 55 MB/s |

**What it missed, and why.** Six Telegram bot tokens (all of them: the token sits right after `bot` in a URL and the pattern required a word
boundary before the digits); one Google key whose random body happened to contain the letters "test" and was classed as a placeholder; and six YAML
`password: ...` lines (a bare key name with no prefix did not match). **What it is not designed to see:** a bare 40-character hex token in prose, a
base64 value in a Kubernetes Secret, a seven-letter password: 0 of 18, as intended (shown separately so the headline is not flattered).

**A harness error in the first run.** The 6 "extra findings in positives" were the runner counting a value printed twice (`git remote -v` shows the URL
for fetch and for push) as one found plus one extra. That is a bug in the benchmark, not in the detector.

## After the first run

Fixed because of those misses: the Telegram pattern (no word boundary needed after `bot`), weak placeholder words (`test`, `secret`, `token`, ...) no
longer demote a provider-prefixed key, a bare `password:` / `token:` key now counts in the low tier, and code-looking values (a call such as
`getToken(session)`, an identifier chain) are rejected there. The runner now counts a repeated planted value once.

| Second run (not evidence) | Result |
|---|---|
| Recall, all tiers | 100% (150 of 150) |
| Extra findings in positives | 0 |
| False positives, generated and public negatives | 0 |

The second run scores perfectly because the fixes were written against exactly these misses. It is a regression check, not a measurement. Treat the first
run as the number.

## Limits

- Recall is measured on templates the author wrote for how agents print secrets. An outsider's corpus would score lower. The honest real-world check is a
  count-only run on a real machine's logs, reported separately.
- Zero false positives in 2.3 MB of public files is a small sample of text with no secrets in it. It says the high and medium tiers are quiet on lockfiles and
  bundles; it does not say there are none in your logs.
- Placeholder and test values are set aside rather than counted. A real key that looks like a placeholder (a run of one character, the word "demo") is missed by design.
