# Detector benchmark (second)

Pre-registered in [PREREGISTRATION.md](PREREGISTRATION.md). 114 generated positive cases, 60 generated hard negatives, 12 public files (2.3 MB).

| Metric | Result |
|---|---|
| Recall, high tier | **100%** (96 of 96) |
| Recall, medium tier | **100%** (24 of 24) |
| Recall, low tier | **100%** (30 of 30) |
| Recall, all tiers | **100%** (150 of 150) |
| Recall counting the secrets it is not designed to see | 89.3% (150 of 168) |
| Extra findings in positive cases | 0 (0 per case) |
| False positives, generated hard negatives (high / medium / low) | 0 / 0 / 0 |
| False positives, public files, high + medium | 0 (0 per MB) |
| False positives, public files, all tiers | 0 (0 per MB) |
| Throughput | 60.5 MB/s |

Secrets not designed to be found (bare hex in prose, base64 in a Kubernetes Secret, a 7-letter password): 0 of 18 found.
