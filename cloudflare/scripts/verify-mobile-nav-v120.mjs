import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const mobile = fs.readFileSync(new URL('../public/mobile-v062.css', import.meta.url), 'utf8');
const worker = fs.readFileSync(new URL('../src/scoring-entry-v158.js', import.meta.url), 'utf8');

assert.match(app, /mobile-nav-button/);
assert.match(app, /aria-controls="primary-nav"/);
assert.match(app, /mobile-nav-open/);
assert.match(mobile, /\.mobile-nav-button\{display:none\}/);
assert.match(mobile, /\.nav\.mobile-nav-open \.nav-links\{display:grid\}/);
assert.match(mobile, /top:calc\(100% \+ 7px\)/);
assert.match(worker, /style-src 'unsafe-inline' https:\/\/fonts\.googleapis\.com/);
assert.match(worker, /font-src data: https:\/\/fonts\.gstatic\.com/);

console.log('Verified compact mobile navigation and Google Sans-compatible Glory War iframe CSP.');
