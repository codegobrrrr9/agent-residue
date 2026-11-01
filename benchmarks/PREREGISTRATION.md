# Detector benchmark: pre-registration

Written and committed **before** the detector was run on this corpus. The order is visible in git history.

**Question.** On text an agent session really contains, how many planted secrets does the detector find, how many things it reports
are not what was planted, and how many findings does it make in text that has no secret in it?

**Positives (generated at run time, seed 20261101).** `benchmarks/corpus.js`: 18 templates of realistic agent-session text (`cat .env`,
`printenv`, `curl -v`, `docker inspect`, `git remote -v`, `.npmrc`, an AWS credentials file, source code, JSON, YAML, a PEM block, a
cookie header, an error message, a URL query, a Telegram call), 6 seeds each, 108 cases. Every planted value is built from the seed, so none
is committed. Three templates plant a secret the detector is **not designed** to find (a bare 40-hex string in prose, a base64 value in a
Kubernetes Secret, a 7-letter password): they are reported separately as `designMiss`.

**Hard negatives (generated).** 10 templates of text that looks secret-like and is not (git SHAs, sha256 digests, lockfile integrity
hashes, UUIDs, base64 image data, a hyphenated word starting `sk-`, shell variable references, `max_tokens=4096`), 6 seeds each, 60 cases.

**Public negatives (fetched, not committed).** `benchmarks/negatives.json` lists pinned URLs: package-manager lockfiles, minified bundles
and READMEs of widely used projects. `fetch.js` downloads them to `benchmarks/work/` and records a SHA-256 in `negatives.lock.json`.
Public files can contain a real leaked key, so a hit is reviewed (type and line number only, never the value) and, if real, the file is
dropped and the drop is listed in the results.

**Metrics, fixed now.**
1. **Recall**, by tier: of planted secrets that are not `designMiss`, the share for which the detector returns a non-placeholder finding
   whose span equals the planted value exactly. Reported for high, medium and low tier separately, and combined.
2. **Recall including design misses**: the same, over all planted secrets. This is the honest number about what the tool does not see.
3. **Extra findings in positives**: non-placeholder findings that do not equal a planted value, per case.
4. **False positives in negatives**: non-placeholder findings in the generated hard negatives, and findings per megabyte in the public
   negatives. Reported for high and medium tier (the headline) and for all tiers including low.
5. Throughput: megabytes per second on the public negatives.

**Not claimed.** That these templates cover how every agent prints a secret; that planted secrets have the same distribution as real
ones; recall on providers the detector has no pattern for. The templates were written by the author of the detector, so recall here is an
upper bound on what an outsider's corpus would give. The real-world check is a count-only run on the author's own logs, reported separately.

**Tuning.** Changes made to the detector after seeing these results are listed in `results.md` under "After the first run", and the headline
numbers stay the first run's.
