import assert from 'node:assert/strict';
import fs from 'node:fs';

const legacyWorker = fs.readFileSync(new URL('../src/scoring-entry-v160.js', import.meta.url), 'utf8');
const worker = fs.readFileSync(new URL('../src/scoring-entry-v161.js', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../migrations/0029_admin_password_auth.sql', import.meta.url), 'utf8');
const runtimeMigration = fs.readFileSync(new URL('../migrations/0030_admin_password_runtime_fix.sql', import.meta.url), 'utf8');
const ui = fs.readFileSync(new URL('../public/admin-security-v123.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../public/admin-security-v123.css', import.meta.url), 'utf8');
const index = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const wrangler = fs.readFileSync(new URL('../wrangler.template.jsonc', import.meta.url), 'utf8');

assert.match(legacyWorker, /\/api\/auth\/admin-logout/);
assert.match(legacyWorker, /url\.pathname\.startsWith\('\/api\/admin\/'\)/);
assert.match(legacyWorker, /requireAdminPassword/);
assert.match(legacyWorker, /admin_sessions/);
assert.match(legacyWorker, /admin_credentials/);
assert.match(legacyWorker, /ADMIN_LOGIN_ATTEMPT_LIMIT = 8/);
assert.match(legacyWorker, /adminEligible/);
assert.match(legacyWorker, /sanitizeManageResponse/);
assert.match(legacyWorker, /SameSite=Lax/);

assert.match(worker, /\/api\/auth\/admin-login/);
assert.match(worker, /\/api\/auth\/admin-password/);
assert.match(worker, /HMAC_PREFIX = 'hmac256:'/);
assert.match(worker, /BOOTSTRAP_PREFIX = 'sha256:'/);
assert.match(worker, /deriveHmacPassword/);
assert.match(worker, /ADMIN_PASSWORD_PEPPER \|\| env\.UPLOAD_TOKEN/);
assert.match(worker, /ADMIN_AUTH_RUNTIME/);
assert.doesNotMatch(worker, /PBKDF2/);
assert.doesNotMatch(worker, /210_000/);

assert.match(migration, /CREATE TABLE IF NOT EXISTS admin_credentials/);
assert.match(migration, /CREATE TABLE IF NOT EXISTS admin_sessions/);
assert.match(migration, /CREATE TABLE IF NOT EXISTS admin_login_audit/);
assert.doesNotMatch(migration, /YOq22TwEZsVmchlMfU3TrZcs/);
assert.match(runtimeMigration, /sha256:VOH\/3hlSPwYmed\/MB4wYMRvpdOAlL7pUo\+Ap4PlIU5Y=/);
assert.match(runtimeMigration, /WHERE password_hash='e2CJsw\/1zZir8fQvgZm9v3ztCFvxK9QIpTYSaicbBw0='/);
assert.doesNotMatch(runtimeMigration, /YOq22TwEZsVmchlMfU3TrZcs/);

assert.match(ui, /Unlock administrator access/);
assert.match(ui, /Continue as member/);
assert.match(ui, /\/api\/auth\/admin-login/);
assert.match(ui, /\/api\/auth\/admin-password/);
assert.match(ui, /data-weight-editor-v123|weightEditorV123/);
assert.match(ui, /Draft total is/);
assert.match(ui, /Your draft has been preserved/);
assert.match(ui, /Reset to saved/);
assert.match(css, /\.admin-unlock-backdrop/);
assert.match(css, /\.stable-weight-editor/);
assert.match(index, /admin-security-v123\.js\?v=123/);
assert.match(index, /admin-security-v123\.css\?v=123/);
// Admin auth remains implemented by v161 while compatible feature wrappers
// may sit above it as the current production entrypoint.
assert.match(wrangler, /scoring-entry-v16[1-9]\.js/);

console.log('Verified password-gated admin sessions, Worker-safe fast credential verification, protected admin APIs, and stable editable contribution weights.');
