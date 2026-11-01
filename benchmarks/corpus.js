// Detector benchmark corpus. Positives are generated at RUN TIME from a fixed seed, so no key-shaped string is ever committed
// (GitHub push protection blocks those). The pre-registration is this file (templates, seed) plus PREREGISTRATION.md, committed before
// the detector is run on it.
//
// Each case: { id, kind, text, planted: [{ value, type, tier, designMiss? }] }.
// `designMiss: true` marks a secret the detector is NOT designed to find (a bare hex string in prose, a base64 value in a Kubernetes Secret,
// a short password). They are reported separately so the headline recall is not flattered and the limit is visible.

const B62 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const B64 = B62 + '+/';
const HEX = '0123456789abcdef';
const UP = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

export function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const take = (r, alphabet, n) => { let s = ''; for (let i = 0; i < n; i++) s += alphabet[Math.floor(r() * alphabet.length)]; return s; };
const mixed = (r, n) => 'aB3' + take(r, B62, n - 3);

export function secrets(r) {
  return {
    stripe: ['sk', 'live', mixed(r, 26)].join('_'),
    stripeTest: ['sk', 'test', mixed(r, 26)].join('_'),
    whsec: ['whsec', mixed(r, 32)].join('_'),
    aws: 'AK' + 'IA' + take(r, UP, 16),
    awsSecret: mixed(r, 40),
    github: 'gh' + 'p_' + mixed(r, 36),
    openai: 'sk' + '-proj-' + mixed(r, 44),
    anthropic: 'sk' + '-ant-api03-' + mixed(r, 48),
    slack: 'xo' + 'xb-' + take(r, '0123456789', 10) + '-' + mixed(r, 24),
    google: 'AI' + 'za' + mixed(r, 35),
    npm: 'npm' + '_' + mixed(r, 36),
    telegram: take(r, '0123456789', 9) + ':' + 'AA' + take(r, B62 + '_-', 33),
    pw: mixed(r, 20),
    hex40: take(r, HEX, 40),
    b64: take(r, B64, 32) + '=',
    short: take(r, 'abcdefghijklmnopqrstuvwxyz', 7),
    pem: ['-----BEGIN ' + 'RSA PRIVATE KEY-----', take(r, B64, 64), take(r, B64, 64), take(r, B64, 64), take(r, B64, 24) + '==', '-----END ' + 'RSA PRIVATE KEY-----'].join('\n'),
    jwt: ['eyJ' + take(r, B62, 24), 'eyJ' + take(r, B62, 40), take(r, B62 + '-_', 43)].join('.'),
  };
}

const P = (value, type, tier, extra = {}) => ({ value, type, tier, ...extra });

const TEMPLATES = [
  (s) => ({ kind: 'cat .env', text: `PORT=3000\nNODE_ENV=production\nSTRIPE_SECRET_KEY=${s.stripe}\nDATABASE_URL=postgres://app:${s.pw}@db.internal:5432/app\nSENTRY_DSN=https://abc@o1.ingest.example.io/1\nJWT_SECRET=${s.hex40}${s.hex40.slice(0, 24)}\n`, planted: [P(s.stripe, 'stripe_key', 'high'), P(s.pw, 'url_credential', 'medium'), P(s.hex40 + s.hex40.slice(0, 24), 'named_secret', 'low')] }),
  (s) => ({ kind: 'printenv', text: `HOME=/home/dev\nPATH=/usr/local/bin:/usr/bin\nAWS_ACCESS_KEY_ID=${s.aws}\nAWS_SECRET_ACCESS_KEY=${s.awsSecret}\nGITHUB_TOKEN=${s.github}\nLANG=en_US.UTF-8\n`, planted: [P(s.aws, 'aws_access_key_id', 'high'), P(s.awsSecret, 'named_secret', 'low'), P(s.github, 'github_token', 'high')] }),
  (s) => ({ kind: 'curl -v', text: `> POST /v1/messages HTTP/2\n> Host: api.example.com\n> Authorization: Bearer ${s.anthropic}\n> content-type: application/json\n< HTTP/2 200\n`, planted: [P(s.anthropic, 'anthropic_key', 'high')] }),
  (s) => ({ kind: 'curl -v', text: `> GET /v1/models HTTP/1.1\n> Authorization: Bearer ${s.openai}\n< HTTP/1.1 200 OK\n`, planted: [P(s.openai, 'openai_key', 'high')] }),
  (s) => ({ kind: 'docker inspect', text: `"Config": {\n  "Env": [\n    "PATH=/usr/local/sbin:/usr/local/bin",\n    "API_KEY=${s.stripeTest}",\n    "SLACK_TOKEN=${s.slack}"\n  ]\n}`, planted: [P(s.stripeTest, 'stripe_key', 'high'), P(s.slack, 'slack_token', 'high')] }),
  (s) => ({ kind: 'git remote -v', text: `origin\thttps://x-access-token:${s.github}@github.com/acme/app.git (fetch)\norigin\thttps://x-access-token:${s.github}@github.com/acme/app.git (push)\n`, planted: [P(s.github, 'github_token', 'high')] }),
  (s) => ({ kind: '.npmrc', text: `registry=https://registry.npmjs.org/\n//registry.npmjs.org/:_authToken=${s.npm}\nalways-auth=true\n`, planted: [P(s.npm, 'npm_token', 'high')] }),
  (s) => ({ kind: 'aws credentials file', text: `[default]\naws_access_key_id = ${s.aws}\naws_secret_access_key = ${s.awsSecret}\nregion = us-east-1\n`, planted: [P(s.aws, 'aws_access_key_id', 'high'), P(s.awsSecret, 'named_secret', 'low')] }),
  (s) => ({ kind: 'source code', text: `import stripe\nstripe.api_key = "${s.stripe}"\nwebhook_secret = "${s.whsec}"\ndef charge(amount):\n    return stripe.Charge.create(amount=amount)\n`, planted: [P(s.stripe, 'stripe_key', 'high'), P(s.whsec, 'stripe_webhook_secret', 'high')] }),
  (s) => ({ kind: 'json config', text: `{\n  "slack_bot_token": "${s.slack}",\n  "db_password": "${s.pw}",\n  "retries": 3\n}`, planted: [P(s.slack, 'slack_token', 'high'), P(s.pw, 'named_secret', 'low')] }),
  (s) => ({ kind: 'yaml', text: `database:\n  host: db.internal\n  user: app\n  password: ${s.pw}\napi:\n  key: ${s.google}\n`, planted: [P(s.pw, 'named_secret', 'low'), P(s.google, 'google_api_key', 'high')] }),
  (s) => ({ kind: 'pem file', text: `$ cat deploy_key\n${s.pem}\n$ ls\n`, planted: [P(s.pem, 'private_key', 'medium')] }),
  (s) => ({ kind: 'cookie header', text: `> Cookie: session=${s.jwt}; theme=dark\n`, planted: [P(s.jwt, 'jwt', 'medium')] }),
  (s) => ({ kind: 'error message', text: `Error: connection to postgres://admin:${s.pw}@db.prod.internal:5432/app failed: timeout`, planted: [P(s.pw, 'url_credential', 'medium')] }),
  (s) => ({ kind: 'url query', text: `GET https://maps.example.com/api/geocode?address=1+Main+St&key=${s.google}&format=json`, planted: [P(s.google, 'google_api_key', 'high')] }),
  (s) => ({ kind: 'telegram', text: `curl https://api.telegram.org/bot${s.telegram}/getMe`, planted: [P(s.telegram, 'telegram_bot_token', 'high')] }),
  // not detectable by design: reported separately
  (s) => ({ kind: 'prose, bare hex token', text: `I rotated it earlier. The new deploy token is ${s.hex40} so use that one.`, planted: [P(s.hex40, 'bare_hex', 'none', { designMiss: true })] }),
  (s) => ({ kind: 'k8s Secret (base64 data)', text: `apiVersion: v1\nkind: Secret\ndata:\n  api: ${s.b64}\n`, planted: [P(s.b64, 'base64_value', 'none', { designMiss: true })] }),
  (s) => ({ kind: 'short password', text: `mysql -u root --password=${s.short} -h localhost\nDB_PASSWORD=${s.short}\n`, planted: [P(s.short, 'short_password', 'none', { designMiss: true })] }),
];

// Hard negatives: text that looks like it could be a secret and is not. Included in every seed.
const NEGATIVE_TEMPLATES = [
  (r) => `commit ${take(r, HEX, 40)}\nAuthor: Dev <dev@example.com>\nDate:   Mon Oct 5 12:00:00 2026`,
  (r) => `sha256: ${take(r, HEX, 64)}`,
  (r) => `"integrity": "sha512-${take(r, B64, 86)}=="`,
  (r) => `request id ${take(r, HEX, 8)}-${take(r, HEX, 4)}-${take(r, HEX, 4)}-${take(r, HEX, 4)}-${take(r, HEX, 12)}`,
  (r) => `data:image/png;base64,${take(r, B64, 600)}`,
  (r) => `use sk-learn-cross-validation-pipeline-with-grid-search-and-scoring-metrics-${take(r, 'abcdefghij', 6)}`,
  (r) => `DB_PASSWORD=\${DB_PASSWORD}\nAPI_TOKEN=$API_TOKEN\nsecret: <your-secret-here>\npassword: "***"`,
  (r) => `max_tokens=4096\nconst token = getToken(session)\nTOKEN_COUNT=${take(r, '0123456789', 6)}`,
  (r) => `build ${take(r, HEX, 7)} on node ${22 + Math.floor(r() * 3)}.${Math.floor(r() * 20)}.${Math.floor(r() * 9)}  ${take(r, HEX, 7)}..${take(r, HEX, 7)}`,
  (r) => `export PATH=/usr/local/bin:/usr/bin npm_config_cache=/tmp/cache_dir_for_npm_things_${take(r, 'abcdef', 4)}`,
];

export function generate({ seed = 20261101, perTemplate = 6 } = {}) {
  const cases = [];
  for (let t = 0; t < TEMPLATES.length; t++) {
    for (let k = 0; k < perTemplate; k++) {
      const r = rng(seed + t * 1000 + k);
      const c = TEMPLATES[t](secrets(r));
      cases.push({ id: `p${t}-${k}`, ...c });
    }
  }
  const negatives = [];
  for (let t = 0; t < NEGATIVE_TEMPLATES.length; t++) for (let k = 0; k < perTemplate; k++) negatives.push({ id: `n${t}-${k}`, kind: 'negative', text: NEGATIVE_TEMPLATES[t](rng(seed + 500000 + t * 1000 + k)), planted: [] });
  return { cases, negatives };
}
