// The hand-off to apikeys-handler: keyed fingerprints of secrets the agent has seen, plus name hints. No values.
// Fingerprints use the machine key shared with apikeys-handler (~/.apikeys-handler/key), so `apikeys-handler scan --seen <file>` can match them.

export function buildSeen(result, { includeLow = false, includeFixtures = false } = {}) {
  const items = result.findings
    .filter(f => !f.placeholder && (includeLow || f.tier !== 'low') && (includeFixtures || !f.fixtureOnly))
    .map(f => ({ fp: f.fp, type: f.type, tier: f.tier, names: f.names, firstSeen: f.first, lastSeen: f.last, sessions: f.sessions, places: f.places }));
  return {
    version: 1,
    generatedAt: result.generatedAt,
    note: 'Keyed hashes only. Match with `apikeys-handler scan --seen <this file>`. Contains no secret value.',
    items,
  };
}
