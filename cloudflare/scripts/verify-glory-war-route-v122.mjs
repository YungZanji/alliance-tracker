import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const archive = fs.readFileSync(new URL('../public/app-v085.js', import.meta.url), 'utf8');
const plan = fs.readFileSync(new URL('../public/app-v087.js', import.meta.url), 'utf8');

assert.match(app, /renderGloryWarLoading\(\)/);
assert.match(app, /alliance-route-change/);
assert.match(app, /detail: \{ route: 'glory-war' \}/);
assert.doesNotMatch(app, /route === 'glory-war'\) return renderComing/);
assert.match(app, /Loading Glory War…/);
assert.match(archive, /alliance-route-change/);
assert.match(archive, /event\.detail\?\.route === 'glory-war'/);
assert.match(plan, /alliance-route-change/);
assert.match(plan, /event\.detail\?\.route === 'glory-war'/);
assert.match(archive, /popstate/);
assert.match(plan, /popstate/);

console.log('Verified Glory War SPA navigation immediately wakes both Battle Plan and Results Archive renderers.');
