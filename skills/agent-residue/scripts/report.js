// A markdown report of a scan. Types, counts, causes and fingerprints: never a value.

import { summarize } from './scan.js';

const day = (ms) => (ms ? new Date(ms).toISOString().slice(0, 10) : 'n/a');

export function reportMarkdown(r) {
  const s = summarize(r), real = r.findings.filter(f => !f.placeholder);
  const L = ['# agent-residue report', '', `Generated ${r.generatedAt}. Types, counts, causes and keyed fingerprints only: this file never contains a secret value.`, ''];
  L.push(`**${s.distinct.high} high-confidence, ${s.distinct.medium} medium${r.low ? `, ${s.distinct.low} low` : ''}** distinct secrets, in ${s.sessionsAffected} sessions. ${s.distinct.placeholders} placeholder or test values set aside.`, '');
  L.push('## Sources', '', '| Source | Files | Lines | Unreadable lines | Date range |', '|---|---|---|---|---|');
  for (const [id, st] of Object.entries(r.stats)) L.push(`| ${id}${st.unverified ? ' (unverified adapter)' : ''} | ${st.files} | ${st.lines} | ${st.badLines} | ${day(st.oldest)} to ${day(st.newest)} |`);
  L.push('', '## Findings', '', '| Tier | Type | Fingerprint | Length | Places | Sessions | First | Last | How it got there |', '|---|---|---|---|---|---|---|---|---|');
  for (const f of real) L.push(`| ${f.tier} | ${f.type} | ${f.fp} | ${f.length} | ${f.places} | ${f.sessions} | ${(f.first || '').slice(0, 10)} | ${(f.last || '').slice(0, 10)} | ${Object.entries(f.causes).slice(0, 3).map(([k, n]) => `${k} (${n})`).join('; ').replace(/\|/g, '/')} |`);
  if (!real.length) L.push('| none | | | | | | | | |');
  L.push('', '## Where they came from', '');
  for (const [k, n] of s.topCauses) L.push(`- ${n} × ${k}`);
  const rt = r.retention;
  L.push('', '## Retention', '', `Claude Code keeps session logs ${rt.cleanupPeriodDays} days (${rt.source}). ${rt.oldestAffectedDate ? `The oldest affected file is ${rt.oldestAffectedAgeDays} days old (${rt.oldestAffectedDate}).` : 'No affected file.'}`);
  L.push('', '## What this does not change', '', '- Scrubbing a log removes the local copy only. Anything the agent printed was already sent to your model provider: rotate the secrets (apikeys-handler), then scrub.', '- Low-confidence findings (a secret-looking name with a high-entropy value) are the least reliable tier.', '- Only the sources listed above were read.');
  return L.join('\n') + '\n';
}
