#!/usr/bin/env node
// Run the detector on the pre-registered corpus. First run's numbers are the headline.
//   node benchmarks/run.js [label]     writes results.<label>.json and results.<label>.md (default label: first)
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { detect } from '../skills/agent-residue/scripts/detect.js';
import { generate } from './corpus.js';

const here = dirname(fileURLToPath(import.meta.url));
const label = process.argv[2] || 'first';
const pct = (a, b) => (b ? Math.round(1000 * a / b) / 10 : null);

const { cases, negatives } = generate();
const TIERS = ['high', 'medium', 'low'];
const rec = Object.fromEntries(TIERS.map(t => [t, { planted: 0, found: 0, misses: [] }]));
const design = { planted: 0, found: 0 };
let extraTotal = 0; const extraByKind = {};

for (const c of cases) {
  const found = detect(c.text, { low: true }).filter(f => !f.placeholder).map(f => ({ ...f, value: c.text.slice(f.start, f.end) }));
  // a planted value that appears twice in the text (git remote -v prints a URL for fetch and push) is one secret found, not one plus an extra
  const plantedValues = new Set(c.planted.map(p => p.value));
  for (const p of c.planted) {
    const hit = found.some(f => f.value === p.value);
    if (p.designMiss) { design.planted++; if (hit) design.found++; continue; }
    rec[p.tier].planted++;
    if (hit) rec[p.tier].found++; else rec[p.tier].misses.push({ case: c.id, kind: c.kind, type: p.type });
  }
  for (const f of found) if (!plantedValues.has(f.value)) { extraTotal++; extraByKind[c.kind] = (extraByKind[c.kind] || 0) + 1; }
}

let negHits = { high: 0, medium: 0, low: 0 }; const negList = [];
for (const c of negatives) for (const f of detect(c.text, { low: true }).filter(f => !f.placeholder)) { negHits[f.tier]++; negList.push({ case: c.id, type: f.type, tier: f.tier }); }

const manifest = JSON.parse(readFileSync(join(here, 'negatives.json'), 'utf8'));
const pub = []; let pubBytes = 0, pubMs = 0;
for (const f of manifest.files) {
  const p = join(here, 'work', f.id + '.txt');
  if (!existsSync(p)) continue;
  const text = readFileSync(p, 'utf8'); pubBytes += text.length;
  const lines = text.split('\n'); const hits = [];
  const t0 = performance.now();
  lines.forEach((l, i) => { for (const d of detect(l, { low: true })) if (!d.placeholder) hits.push({ line: i + 1, type: d.type, tier: d.tier }); });
  pubMs += performance.now() - t0;
  pub.push({ id: f.id, kind: f.kind, bytes: text.length, hits });
}
const pubMB = pubBytes / 1e6;
const pubHits = (tiers) => pub.reduce((n, f) => n + f.hits.filter(h => tiers.includes(h.tier)).length, 0);

const all = TIERS.reduce((a, t) => ({ planted: a.planted + rec[t].planted, found: a.found + rec[t].found }), { planted: 0, found: 0 });
const out = {
  label, cases: cases.length, negatives: negatives.length,
  recall: { ...Object.fromEntries(TIERS.map(t => [t, { planted: rec[t].planted, found: rec[t].found, pct: pct(rec[t].found, rec[t].planted), misses: rec[t].misses }])), combined: { ...all, pct: pct(all.found, all.planted) }, withDesignMisses: { planted: all.planted + design.planted, found: all.found + design.found, pct: pct(all.found + design.found, all.planted + design.planted) }, designMisses: design },
  extraFindingsInPositives: { total: extraTotal, perCase: Math.round(100 * extraTotal / cases.length) / 100, byKind: extraByKind },
  falsePositives: { generatedNegatives: negHits, generatedNegativesList: negList, publicNegatives: pub.map(f => ({ id: f.id, kind: f.kind, bytes: f.bytes, hits: f.hits })), publicHitsHighMedium: pubHits(['high', 'medium']), publicHitsAll: pubHits(TIERS), publicPerMBHighMedium: Math.round(100 * pubHits(['high', 'medium']) / (pubMB || 1)) / 100, publicPerMBAll: Math.round(100 * pubHits(TIERS) / (pubMB || 1)) / 100, publicMB: Math.round(pubMB * 100) / 100 },
  throughputMBps: pubMs ? Math.round(10 * pubMB / (pubMs / 1000)) / 10 : null,
};
writeFileSync(join(here, `results.${label}.json`), JSON.stringify(out, null, 1) + '\n');

const L = [`# Detector benchmark (${label})`, '', `Pre-registered in [PREREGISTRATION.md](PREREGISTRATION.md). ${cases.length} generated positive cases, ${negatives.length} generated hard negatives, ${pub.length} public files (${out.falsePositives.publicMB} MB).`, ''];
L.push('| Metric | Result |', '|---|---|');
for (const t of TIERS) L.push(`| Recall, ${t} tier | **${out.recall[t].pct}%** (${out.recall[t].found} of ${out.recall[t].planted}) |`);
L.push(`| Recall, all tiers | **${out.recall.combined.pct}%** (${out.recall.combined.found} of ${out.recall.combined.planted}) |`);
L.push(`| Recall counting the secrets it is not designed to see | ${out.recall.withDesignMisses.pct}% (${out.recall.withDesignMisses.found} of ${out.recall.withDesignMisses.planted}) |`);
L.push(`| Extra findings in positive cases | ${extraTotal} (${out.extraFindingsInPositives.perCase} per case) |`);
L.push(`| False positives, generated hard negatives (high / medium / low) | ${negHits.high} / ${negHits.medium} / ${negHits.low} |`);
L.push(`| False positives, public files, high + medium | ${out.falsePositives.publicHitsHighMedium} (${out.falsePositives.publicPerMBHighMedium} per MB) |`);
L.push(`| False positives, public files, all tiers | ${out.falsePositives.publicHitsAll} (${out.falsePositives.publicPerMBAll} per MB) |`);
L.push(`| Throughput | ${out.throughputMBps} MB/s |`, '');
if (design.planted) L.push(`Secrets not designed to be found (bare hex in prose, base64 in a Kubernetes Secret, a 7-letter password): ${design.found} of ${design.planted} found.`, '');
const miss = TIERS.flatMap(t => rec[t].misses.map(m => ({ tier: t, ...m })));
if (miss.length) { L.push('## Missed planted secrets', '', '| Tier | Case | Kind | Type |', '|---|---|---|---|'); for (const m of miss) L.push(`| ${m.tier} | ${m.case} | ${m.kind} | ${m.type} |`); L.push(''); }
if (extraTotal) { L.push('## Extra findings in positives', '', Object.entries(extraByKind).map(([k, n]) => `- ${k}: ${n}`).join('\n'), ''); }
if (negList.length) { L.push('## Findings in generated negatives', '', ...negList.map(n => `- ${n.case}: ${n.type} (${n.tier})`), ''); }
const hitFiles = pub.filter(f => f.hits.length);
if (hitFiles.length) { L.push('## Findings in public files (type and line only; reviewed by hand)', '', ...hitFiles.flatMap(f => f.hits.map(h => `- ${f.id}:${h.line} ${h.type} (${h.tier})`)), ''); }
writeFileSync(join(here, `results.${label}.md`), L.join('\n'));
console.log(L.slice(0, 18).join('\n'));
