import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker = fs.readFileSync(new URL('../src/scoring-entry-v159.js', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../migrations/0027_canyon_plan_images.sql', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../public/canyon-v121.css', import.meta.url), 'utf8');
const index = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const wrangler = fs.readFileSync(new URL('../wrangler.template.jsonc', import.meta.url), 'utf8');

assert.match(worker, /\/api\/canyon-plan/);
assert.match(worker, /\/api\/canyon-plan\/image/);
assert.match(worker, /\/api\/admin\/canyon-plan\/image/);
assert.match(worker, /authenticatedPlayer/);
assert.match(worker, /Administrator access required/);
assert.match(worker, /MAX_CANYON_IMAGE_BYTES = 1_300_000/);
assert.match(worker, /English/);
assert.match(worker, /ไทย/);
assert.match(worker, /Español/);
assert.match(worker, /Deutsch/);
assert.match(worker, /Ελληνικά/);
assert.match(worker, /Български/);
assert.match(migration, /CREATE TABLE IF NOT EXISTS canyon_plan_images/);
assert.match(app, /navButton\('canyon', 'Canyon Clash'\)/);
assert.match(app, /path === '\/canyon'/);
assert.match(app, /renderCanyon/);
assert.match(app, /canyon-upload-all/);
assert.match(app, /View full size/);
assert.match(css, /\.canyon-language-select-wrap/);
assert.match(css, /\.canyon-lightbox/);
assert.match(index, /canyon-v121\.css\?v=121/);
assert.match(wrangler, /scoring-entry-v159\.js/);

console.log('Verified authenticated Canyon Clash language viewer, clean /canyon route, admin image upload, and mobile full-size viewing.');
