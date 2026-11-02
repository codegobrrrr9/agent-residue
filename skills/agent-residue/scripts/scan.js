// Scan: stream every file of every source, detect on decoded strings, fingerprint, and aggregate by fingerprint.
// The result contains no value: a finding is a keyed hash, a type, a length, counts and the causes that put it there.

import { readFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { detect, MAX_SCAN } from './detect.js';
import { fingerprint, registerSecret, safeParse, localDay } from './shared.js';
import { roots, guard } from './paths.js';
import { SOURCES, pathSource } from './sources.js';

export function causeKey(entry) {
  switch (entry.role) {
    case 'user prompt': case 'prompt history': return 'you pasted it';
    case 'assistant text': case 'assistant thinking': return 'the assistant wrote it';
    case 'tool result': return 'output of ' + entry.cause;
    case 'tool input': return 'typed into ' + entry.cause;
    default: return entry.role;
  }
}

export function pickSources(ids, extraPath = null) {
  const out = [];
  for (const id of ids) {
    if (id === 'path') { if (!extraPath) throw new Error('--source path needs --path <folder>'); out.push({ id: 'path', def: pathSource(extraPath) }); }
    else if (SOURCES[id]) out.push({ id, def: SOURCES[id] });
    else if (id === 'claude-mem') out.push({ id, def: null });
    else throw new Error(`unknown source "${id}". Try claude-code, codex, claude-mem or path.`);
  }
  return out;
}

export async function scan({ sources, since = null, low = true, env = process.env, memory = null } = {}) {
  const agg = new Map();
  const stats = {};
  const sessionsAll = new Set(), sessionsReal = new Set();
  const cutoff = since ? Date.now() - since * 86400000 : 0;
  let registered = 0;

  const take = (st, f, rec, entry) => {
    const text = entry.text;
    if (typeof text !== 'string') return;
    if (text.length > MAX_SCAN) st.oversize++;
    for (const d of detect(text, { low })) {
      const value = text.slice(d.start, d.end);
      const fp = fingerprint(value);
      if (!fp) continue;
      if (!d.placeholder && d.tier !== 'low' && registered < 5000) { registerSecret(value); registered++; }
      let a = agg.get(fp);
      if (!a) { a = { fp, type: d.type, tier: d.tier, placeholder: d.placeholder, length: value.length, places: 0, sessions: new Set(), files: new Set(), first: null, last: null, causes: new Map(), names: new Set(), sourceIds: new Set(), oldest: null, outsideTests: 0, testPlaces: 0 }; agg.set(fp, a); }
      a.places++; a.sessions.add(rec.session); a.files.add(f.file); a.sourceIds.add(rec.source);
      const when = rec.date || null;
      if (when && (!a.first || when < a.first)) a.first = when;
      if (when && (!a.last || when > a.last)) a.last = when;
      const ck = causeKey(entry);
      a.causes.set(ck, (a.causes.get(ck) || 0) + 1);
      if (d.name) a.names.add(d.name);
      // A file snapshot is a copy of a file the agent edited, so it says nothing about where the value came from: it neither makes a finding a
      // fixture nor stops one being a fixture. A finding is a fixture only if it appears in test files and nowhere else.
      const isTest = /test file/.test(entry.cause), isSnap = entry.role === 'file snapshot';
      if (isTest) a.testPlaces++; else if (!isSnap) a.outsideTests++;
      if (!d.placeholder && !/test file/.test(entry.cause)) sessionsReal.add(rec.session);
      if (!d.placeholder) { sessionsAll.add(rec.session); if (rec.source === 'claude-code') a.oldest = a.oldest === null ? f.mtime : Math.min(a.oldest, f.mtime); else a.oldestOther = a.oldestOther === undefined ? f.mtime : Math.min(a.oldestOther, f.mtime); }   // a running minimum: a spread over a huge array throws
    }
  };

  for (const { id, def } of sources) {
    const st = stats[id] = { files: 0, bytes: 0, lines: 0, badLines: 0, skipped: 0, oversize: 0, oldest: null, newest: null, where: null, unverified: false };
    if (id === 'claude-mem') {
      st.where = roots(env).claudeMem; st.unverified = true;
      const mem = memory || (await import('./memdb.js'));
      const r = await mem.scanMemory({ env, take: (rec, entry) => take(st, { file: rec.file, mtime: Date.now() }, rec, entry), stats: st });
      st.note = r.note;
      continue;
    }
    st.where = def.where(env);
    const files = def.files(env).filter(f => !cutoff || f.mtime >= cutoff).sort((a, b) => a.mtime - b.mtime);
    for (const f of files) {
      const skip = def.skipFile ? def.skipFile(f) : null;
      if (skip) { st.skipped++; continue; }
      st.files++; st.bytes += f.size;
      st.oldest = st.oldest === null ? f.mtime : Math.min(st.oldest, f.mtime);
      st.newest = st.newest === null ? f.mtime : Math.max(st.newest, f.mtime);
      try {
        for await (const rec of def.records(f)) {
          st.lines++;
          if (rec.bad) { st.badLines++; continue; }
          for (const entry of rec.entries) take(st, f, rec, entry);
        }
      } catch (e) { st.skipped++; }                    // an unreadable file is counted, never quoted
    }
  }

  const findings = [...agg.values()].map(a => ({
    fp: a.fp, type: a.type, tier: a.tier, placeholder: a.placeholder, length: a.length, places: a.places, sessions: a.sessions.size, files: a.files.size,
    first: a.first, last: a.last, causes: Object.fromEntries([...a.causes.entries()].sort((x, y) => y[1] - x[1])), names: [...a.names].slice(0, 8), sources: [...a.sourceIds],
    oldestFile: a.oldest, oldestOther: a.oldestOther ?? null, fixtureOnly: a.testPlaces > 0 && a.outsideTests === 0,
  })).sort((a, b) => (a.placeholder - b.placeholder) || ({ high: 0, medium: 1, low: 2 }[a.tier] - { high: 0, medium: 1, low: 2 }[b.tier]) || b.places - a.places);

  return { generatedAt: new Date().toISOString(), since, low, stats, findings, sessionsAffected: sessionsAll.size, sessionsOutsideTests: sessionsReal.size, retention: retention(env, findings) };
}

// Claude Code deletes transcripts older than cleanupPeriodDays (30 by default per its docs) at startup. The value `0` is not confirmed
// from official docs, so it is reported as it is and not interpreted.
export function retention(env, findings) {
  let days = null, source = 'default';
  try {
    const p = guard(join(roots(env).claude, 'settings.json'), env);
    const r = safeParse(readFileSync(p, 'utf8'), 'settings.json');
    if (r.ok && r.value && typeof r.value.cleanupPeriodDays === 'number') { days = r.value.cleanupPeriodDays; source = 'settings.json'; }
  } catch { /* no settings file */ }
  if (days === null) days = 30;
  const real = findings.filter(f => !f.placeholder && f.oldestFile);
  const oldest = real.length ? Math.min(...real.map(f => f.oldestFile)) : null;
  // Claude Code's cleanup does not apply to other agents' files: report their oldest affected file separately, with no retention claim
  const others = findings.filter(f => !f.placeholder && f.oldestOther);
  const oldestOther = others.length ? Math.min(...others.map(f => f.oldestOther)) : null;
  return { oldestOtherDate: oldestOther ? localDay(oldestOther) : null, oldestOtherAgeDays: oldestOther ? Math.floor((Date.now() - oldestOther) / 86400000) : null, cleanupPeriodDays: days, source, zeroUnverified: days === 0, oldestAffectedDate: oldest ? localDay(oldest) : null, oldestAffectedAgeDays: oldest ? Math.floor((Date.now() - oldest) / 86400000) : null };
}

// A secret seen only in test files the agent wrote or read is probably a fixture the agent made up, not a credential. It is counted on its own line,
// never in the headline, so the split is visible before any number is quoted.
export function summarize(result) {
  const nonPlaceholder = result.findings.filter(f => !f.placeholder);
  const real = nonPlaceholder.filter(f => !f.fixtureOnly);
  const fixtures = nonPlaceholder.filter(f => f.fixtureOnly);
  const by = (tier) => real.filter(f => f.tier === tier);
  const causes = new Map();
  for (const f of real) for (const [k, n] of Object.entries(f.causes)) causes.set(k, (causes.get(k) || 0) + n);
  return {
    distinct: { high: by('high').length, medium: by('medium').length, low: by('low').length, placeholders: result.findings.filter(f => f.placeholder).length },
    fixtureOnly: { high: fixtures.filter(f => f.tier === 'high').length, medium: fixtures.filter(f => f.tier === 'medium').length, low: fixtures.filter(f => f.tier === 'low').length },
    places: { high: by('high').reduce((n, f) => n + f.places, 0), medium: by('medium').reduce((n, f) => n + f.places, 0), low: by('low').reduce((n, f) => n + f.places, 0) },
    sessionsAffected: result.sessionsOutsideTests ?? result.sessionsAffected,
    topCauses: [...causes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8),
    types: Object.entries(real.reduce((m, f) => (m[f.type] = (m[f.type] || 0) + 1, m), {})).sort((a, b) => b[1] - a[1]),
  };
}

export { basename };
