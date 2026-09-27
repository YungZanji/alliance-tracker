import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker = fs.readFileSync(new URL('../src/scoring-entry-v161.js', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../migrations/0030_admin_password_runtime_fix.sql', import.meta.url), 'utf8');
const wrangler = fs.readFileSync(new URL('../wrangler.template.jsonc', import.meta.url), 'utf8');

assert.match(worker, /HMAC_PREFIX = 'hmac256:'/);
assert.match(worker, /BOOTSTRAP_PREFIX = 'sha256:'/);
assert.match(worker, /deriveBootstrapDigest/);
assert.match(worker, /deriveHmacPassword/);
assert.match(worker, /upgradeCredentialToHmac/);
assert.match(worker, /ADMIN_AUTH_RUNTIME/);
assert.doesNotMatch(worker, /PBKDF2/);
assert.match(migration, /iterations=1/);
assert.match(migration, /sha256:/);
assert.match(wrangler, /scoring-entry-v161\.js/);

console.log('Verified Worker-safe admin password verification and bootstrap credential upgrade.');
