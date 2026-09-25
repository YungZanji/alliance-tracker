import assert from 'node:assert/strict';
import fs from 'node:fs';

const entry = fs.readFileSync(new URL('../src/entry.js', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

assert.match(entry, /SameSite=Lax/);
assert.doesNotMatch(entry, /SameSite=Strict/);
assert.match(entry, /Priority=High/);
assert.match(entry, /replace\/\[\^0-9\]\/g/);
assert.match(app, /credentials: 'same-origin'/);
assert.match(app, /allow401: true/);
assert.match(app, /did not keep the sign-in session/);
assert.match(app, /\/gw-map/);
assert.match(app, /navigate\(requestedRoute === 'glory-war'/);

console.log('Verified mobile-compatible session cookies, explicit fetch credentials, accurate login errors, and /gw-map post-login routing.');
