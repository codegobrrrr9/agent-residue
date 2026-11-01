import test from 'node:test';
import assert from 'node:assert/strict';
import { isolate, K, placeholder, body } from './helpers.js';

const iso = isolate(); iso.apply();
const { detect, entropy, placeholderish, MAX_SCAN } = await import('../skills/agent-residue/scripts/detect.js');

const one = (text, opts) => { const d = detect(text, opts); assert.equal(d.length, 1, `expected one finding, got ${d.map(x => x.type).join(',') || 'none'}`); return d[0]; };
const slice = (text, f) => text.slice(f.start, f.end);

test('high tier: provider-prefixed keys are found at exact offsets and are not placeholders', () => {
  const cases = [['stripe_key', K.stripe()], ['stripe_key', K.stripeTest()], ['stripe_webhook_secret', K.whsec()], ['aws_access_key_id', K.aws()], ['github_token', K.github()],
    ['openai_key', K.openai()], ['anthropic_key', K.anthropic()], ['slack_token', K.slack()], ['google_api_key', K.google()], ['npm_token', K.npm()]];
  for (const [type, key] of cases) {
    const text = `before ${key} after`;
    const f = one(text, { low: false });
    assert.equal(f.type, type); assert.equal(f.tier, 'high'); assert.equal(f.placeholder, false, type);
    assert.equal(slice(text, f), key, 'the offsets cover exactly the key');
  }
});

test('medium tier: credentialed URL (password only), PEM block, JWT, Bearer token', () => {
  const url = K.url(3), pw = url.split(':')[2].split('@')[0];
  const t1 = `DATABASE_URL=${url} and more`;
  const f1 = detect(t1, { low: false })[0];
  assert.equal(f1.type, 'url_credential'); assert.equal(slice(t1, f1), pw, 'only the password, host and user stay visible');
  const pem = K.pem(4);
  const f2 = one(`cat key.pem\n${pem}\ndone`, { low: false });
  assert.equal(f2.type, 'private_key'); assert.ok(slice(`cat key.pem\n${pem}\ndone`, f2).endsWith('PRIVATE KEY-----'));
  assert.equal(one(`token ${K.jwt(5)} end`, { low: false }).type, 'jwt');
  const t3 = `Authorization: Bearer ${body(40, 6)}`;
  assert.equal(slice(t3, one(t3, { low: false })), body(40, 6));
});

test('low tier: NAME=value with a secret-looking name, kept as a hint; off when low is false', () => {
  const v = K.password(7);
  const t = `export DB_PASSWORD=${v}`;
  const f = one(t, { low: true });
  assert.deepEqual([f.type, f.tier, f.name, slice(t, f)], ['named_secret', 'low', 'DB_PASSWORD', v]);
  assert.deepEqual(detect(t, { low: false }), []);
  const j = `{"client_secret": "${v}"}`;
  assert.equal(slice(j, one(j, { low: true })), v);
});

test('placeholders and test values are marked, not hidden: runs, demo words, low entropy', () => {
  assert.equal(one(`key ${placeholder.stripe()}`, { low: false }).placeholder, true);
  assert.equal(one(`key ${placeholder.aws()}`, { low: false }).placeholder, true);
  assert.equal(one('DB_TOKEN=your-api-token-goes-here-12345', { low: true }).placeholder, true);
  assert.deepEqual(detect(`TOKEN=${placeholder.demo()}`, { low: true }), [], 'a low-entropy low-tier value is dropped, not counted');
  assert.equal(placeholderish('changeme-changeme-changeme'), true);
  assert.equal(placeholderish(body(30, 9)), false);
  assert.ok(entropy(body(40, 2)) > 4.2 && entropy('aaaaaaaaaaaaaaaa') === 0);
});

test('adversarial negatives are not findings: git SHAs, hashes, UUIDs, lockfile integrity, image data URLs, hyphenated words, env references', () => {
  const negatives = [
    'commit 9fceb02d0ae598e95dc970b74767f19372d61af8 Author: x',
    'sha256: ' + 'a'.repeat(8) + body(56, 11).toLowerCase().replace(/[^0-9a-f]/g, 'a'),
    'id 3f2b8c1e-9a4d-4e6b-8f21-0c5d7e9a1b34',
    '"integrity": "sha512-' + body(86, 12) + '=="',
    'data:image/png;base64,' + body(400, 13).replace(/[^A-Za-z0-9]/g, 'A'),
    'use sk-learn-cross-validation-pipeline-with-grid-search-and-scoring-metrics',
    'a risk-assessment-for-the-next-quarter-with-long-hyphenated-words-here',
    'DB_PASSWORD=${DB_PASSWORD}', 'API_TOKEN=$API_TOKEN_FROM_ENV_FILE_VALUE', 'password: <your-password-here>',
    'max_tokens=4096', 'const token = getToken(session)', 'SECRET_KEY_REF=process.env.SECRET_KEY_VALUE',
    'export PATH=/usr/local/bin:/usr/bin npm_config_cache=/tmp/cache_dir_for_npm_things',
    'https://example.com/path?x=1', 'postgres://localhost:5432/app', 'redis://:password@cache:6379',
  ];
  for (const n of negatives) assert.deepEqual(detect(n, { low: true }).filter(f => !f.placeholder), [], n.slice(0, 60));
});

test('overlap: a named secret whose value is a provider key is reported once, as the higher tier', () => {
  const k = K.stripe(21);
  const f = detect(`STRIPE_SECRET_KEY=${k}`, { low: true });
  assert.equal(f.length, 1); assert.equal(f[0].tier, 'high');
});

test('a huge single string is bounded: cut at MAX_SCAN, no stall', () => {
  const big = 'x'.repeat(MAX_SCAN + 500_000) + K.stripe(5);
  const t0 = Date.now();
  assert.deepEqual(detect(big), []);
  assert.ok(Date.now() - t0 < 3000, 'a megabyte-long line must not hang the regexes');
  const nasty = ('=' .repeat(20) + 'secret ').repeat(20000);
  const t1 = Date.now(); detect(nasty); assert.ok(Date.now() - t1 < 3000, 'no catastrophic backtracking on repeated near-matches');
});
