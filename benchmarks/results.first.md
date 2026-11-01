# Detector benchmark (first)

Pre-registered in [PREREGISTRATION.md](PREREGISTRATION.md). 114 generated positive cases, 60 generated hard negatives, 12 public files (2.3 MB).

| Metric | Result |
|---|---|
| Recall, high tier | **92.7%** (89 of 96) |
| Recall, medium tier | **100%** (24 of 24) |
| Recall, low tier | **80%** (24 of 30) |
| Recall, all tiers | **91.3%** (137 of 150) |
| Recall counting the secrets it is not designed to see | 81.5% (137 of 168) |
| Extra findings in positive cases | 6 (0.05 per case) |
| False positives, generated hard negatives (high / medium / low) | 0 / 0 / 0 |
| False positives, public files, high + medium | 0 (0 per MB) |
| False positives, public files, all tiers | 0 (0 per MB) |
| Throughput | 55.4 MB/s |

Secrets not designed to be found (bare hex in prose, base64 in a Kubernetes Secret, a 7-letter password): 0 of 18 found.

## Missed planted secrets

| Tier | Case | Kind | Type |
|---|---|---|---|
| high | p14-3 | url query | google_api_key |
| high | p15-0 | telegram | telegram_bot_token |
| high | p15-1 | telegram | telegram_bot_token |
| high | p15-2 | telegram | telegram_bot_token |
| high | p15-3 | telegram | telegram_bot_token |
| high | p15-4 | telegram | telegram_bot_token |
| high | p15-5 | telegram | telegram_bot_token |
| low | p10-0 | yaml | named_secret |
| low | p10-1 | yaml | named_secret |
| low | p10-2 | yaml | named_secret |
| low | p10-3 | yaml | named_secret |
| low | p10-4 | yaml | named_secret |
| low | p10-5 | yaml | named_secret |

## Extra findings in positives

- git remote -v: 6
