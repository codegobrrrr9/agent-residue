// Secret detection on DECODED strings. Returns offsets, never copies: the caller slices the text, fingerprints the value
// and drops it. Three tiers, reported separately (precision first):
//   high    a provider-prefixed key (Stripe, AWS, GitHub, OpenAI, Anthropic, Slack, ...)
//   medium  a credentialed URL, a PEM private key, a JWT, a Bearer token
//   low     NAME=value where the NAME looks like a secret and the value has enough entropy
// Anything that looks like a placeholder or a test value (a run of one character, demo/example/changeme, low entropy) is marked
// `placeholder`: counted, but never in the headline.
//
// Regexes use bounded quantifiers only, and a string over MAX_SCAN is cut, so one minified line cannot stall a scan.

export const MAX_SCAN = 2_000_000;
export const TIER_RANK = { high: 0, medium: 1, low: 2 };

const HINT = /sk[_-]|gh[pousr]_|github_pat_|glpat-|npm_|AKIA|ASIA|xox[baprs]-|AIza|SG\.|hf_|whsec_|PRIVATE KEY|:\/\/|eyJ|Bearer|[0-9]{8,10}:AA|secret|token|passw|pwd|api[_-]?key|access[_-]?key|private[_-]?key|credential/i;

// the d flag gives exact offsets for the secret part (a capture group), not the whole match
const P = (type, tier, re, group = 0) => ({ type, tier, re: new RegExp(re.source, re.flags.includes('d') ? re.flags : re.flags + 'd'), group });
const PATTERNS = [
  P('stripe_key', 'high', /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,99}\b/g),
  P('stripe_webhook_secret', 'high', /\bwhsec_[A-Za-z0-9]{24,99}\b/g),
  P('anthropic_key', 'high', /\bsk-ant-[A-Za-z0-9_-]{20,200}/g),
  P('openai_key', 'high', /\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{32,200}/g),
  P('github_token', 'high', /\bgh[pousr]_[A-Za-z0-9]{36,255}\b/g),
  P('github_token', 'high', /\bgithub_pat_[A-Za-z0-9_]{50,255}/g),
  P('gitlab_token', 'high', /\bglpat-[A-Za-z0-9_-]{20,100}/g),
  P('npm_token', 'high', /\bnpm_[A-Za-z0-9]{36}\b/g),
  P('aws_access_key_id', 'high', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g),
  P('slack_token', 'high', /\bxox[baprs]-[A-Za-z0-9-]{10,200}/g),
  P('google_api_key', 'high', /\bAIza[0-9A-Za-z_-]{35}\b/g),
  P('sendgrid_key', 'high', /\bSG\.[A-Za-z0-9_-]{16,100}\.[A-Za-z0-9_-]{16,100}/g),
  P('huggingface_token', 'high', /\bhf_[A-Za-z0-9]{30,100}\b/g),
  P('telegram_bot_token', 'high', /\b[0-9]{8,10}:AA[A-Za-z0-9_-]{33}\b/g),
  P('private_key', 'medium', /-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----[A-Za-z0-9+/=\s]{40,8192}?(?:-----END (?:[A-Z]+ )*PRIVATE KEY-----|$)/g),
  P('url_credential', 'medium', /\b[a-z][a-z0-9+.-]{1,20}:\/\/[^/\s:@'"]{0,64}:([^@\s'"/]{4,128})@[^\s'"/:]{1,100}/gi, 1),
  P('jwt', 'medium', /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g),
  P('bearer_token', 'medium', /\bBearer\s+([A-Za-z0-9._~+/-]{20,300}=*)/g, 1),
  // NAME=value, NAME: value, "NAME": "value". The name is kept as a hint for matching against platform variables.
  P('named_secret', 'low', /(?<![A-Za-z0-9])([A-Za-z][A-Za-z0-9_.-]{1,60}?(?:SECRET|TOKEN|PASSWORD|PASSWD|PWD|API[_-]?KEY|ACCESS[_-]?KEY|PRIVATE[_-]?KEY|CREDENTIALS?))["']?\s{0,3}[:=]\s{0,3}["']?([^\s"'`<>;,)\]}]{12,200})/gi, 2),
];

const BODY_PREFIX = /^(?:sk-ant-|sk-proj-|sk-svcacct-|sk-admin-|sk-|(?:sk|rk|pk)_(?:live|test)_|whsec_|gh[pousr]_|github_pat_|glpat-|npm_|xox[baprs]-|hf_|SG\.|AKIA|ASIA|AIza)/;
const PLACEHOLDER_WORDS = /demo|example|sample|dummy|fake|changeme|change[-_]me|placeholder|your[-_]|xxxx|redacted|replace[-_]?me|insert[-_]|todo|abcdef|123456|qwerty|test(?:ing)?|secret|password|passwd|token|value|string|none|null|undefined|\*{4}|\.{3}|^<|>$/i;

export function entropy(s) {
  if (!s) return 0;
  const f = new Map();
  for (const c of s) f.set(c, (f.get(c) || 0) + 1);
  let h = 0;
  for (const n of f.values()) { const p = n / s.length; h -= p * Math.log2(p); }
  return h;
}

export function placeholderish(value, type) {
  const body = type && type !== 'named_secret' && type !== 'url_credential' && type !== 'bearer_token' ? value.replace(BODY_PREFIX, '') : value;
  if (/(.)\1{7,}/.test(body)) return true;                       // a long run of one character
  if (PLACEHOLDER_WORDS.test(body)) return true;
  if (/^[A-Za-z]+$/.test(body) && body.length < 24) return true;  // plain letters: a word, not a key
  if (body.length >= 16 && entropy(body) < 2.8) return true;
  if (type === 'private_key') return false;
  return false;
}

const LOW_SKIP = /^(?:\$|%|<|\(|\{\{|\[|\/|\.\/|~|[A-Za-z]:\\|https?:\/\/(?![^/\s:@]*:[^@\s]*@)|process\.env|os\.environ|getenv|config\.|settings\.|self\.|this\.|env\.)/i;

export function detect(text, { low = true } = {}) {
  if (typeof text !== 'string' || text.length < 8) return [];
  const t = text.length > MAX_SCAN ? text.slice(0, MAX_SCAN) : text;
  if (!HINT.test(t)) return [];
  const found = [];
  for (const p of PATTERNS) {
    if (p.tier === 'low' && !low) continue;
    p.re.lastIndex = 0;
    for (const m of t.matchAll(p.re)) {
      const value = m[p.group];
      if (typeof value !== 'string' || !value) continue;
      if (value.includes('[residue:')) continue;           // our own replacement token is never a finding (scrub must be idempotent)
      const [start, end] = m.indices[p.group];
      const rec = { type: p.type, tier: p.tier, start, end, placeholder: false, name: null };
      if (p.type === 'named_secret') {
        if (LOW_SKIP.test(value) || entropy(value) < 3.0 || !/[0-9]|[A-Z]/.test(value) && value.length < 16) continue;
        rec.name = m[1].slice(0, 60);
      }
      if (p.type === 'url_credential' && /^(?:pass(?:word)?|pwd|secret|xxx+|\*+|<[^>]*>|\$\{.*\}|\$[A-Z_]+)$/i.test(value)) continue;
      if (p.type === 'jwt' && value.length < 40) continue;
      // an OpenAI key body is mixed-case base62 with digits; a hyphenated word such as sk-learn-cross-validation-... is not a key
      if (p.type === 'openai_key') { const b = value.replace(BODY_PREFIX, ''); if (!(/[0-9]/.test(b) && /[A-Z]/.test(b) && /[a-z]/.test(b))) continue; }
      rec.placeholder = placeholderish(value, p.type);
      found.push(rec);
    }
  }
  // overlapping matches: keep the higher tier, then the earlier one
  found.sort((a, b) => TIER_RANK[a.tier] - TIER_RANK[b.tier] || a.start - b.start);
  const kept = [];
  for (const f of found) if (!kept.some(k => f.start < k.end && f.end > k.start)) kept.push(f);
  return kept.sort((a, b) => a.start - b.start);
}
