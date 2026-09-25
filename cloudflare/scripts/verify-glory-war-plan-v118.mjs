import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker = fs.readFileSync(new URL('../src/scoring-entry-v158.js', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../migrations/0026_glory_war_plans.sql', import.meta.url), 'utf8');
const ui = fs.readFileSync(new URL('../public/app-v087.js', import.meta.url), 'utf8');
const archiveUi = fs.readFileSync(new URL('../public/app-v085.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../public/glory-war-plan-v118.css', import.meta.url), 'utf8');
const index = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const wrangler = fs.readFileSync(new URL('../wrangler.template.jsonc', import.meta.url), 'utf8');

assert.match(worker, /\/api\/glory-war-plan\/view/);
assert.match(worker, /\/api\/admin\/glory-war-plan/);
assert.match(worker, /authenticatedPlayer/);
assert.match(worker, /Attendance unknown/);
assert.match(worker, /MAX_PLAN_BYTES = 1_900_000/);
assert.match(worker, /Content-Security-Policy/);
assert.match(worker, /connect-src 'none'/);
assert.match(worker, /glory-war-map\.html/);
assert.match(worker, /\/gw-map/);
assert.match(migration, /CREATE TABLE IF NOT EXISTS glory_war_plans/);
assert.match(migration, /WHERE is_active=1/);
assert.match(ui, /Battle Plan/);
assert.match(ui, /DIRECT_GW_MAP/);
assert.match(ui, /\/gw-map/);
assert.match(ui, /Map updated/);
assert.match(ui, /Results Archive/);
assert.match(ui, /sandbox="allow-scripts allow-downloads"/);
assert.match(ui, /x-plan-filename/);
assert.match(ui, /\/api\/admin\/glory-war-plan\/activate/);
assert.match(archiveUi, /sessionStorage\.getItem\('glory-war-view'\) !== 'archive'/);
assert.match(css, /\.glory-plan-frame/);
assert.match(index, /app-v087\.js\?v=118/);
assert.match(index, /glory-war-plan-v118\.css\?v=118/);
assert.match(wrangler, /scoring-entry-v159\\.js/);
assert.match(wrangler, /glory-war-map\.html/);
assert.equal(fs.existsSync(new URL('../public/glory-war-map.html', import.meta.url)), false, 'Old public Glory War map must not remain directly accessible.');

console.log('Verified authenticated Glory War plan hosting, personalized position jump, admin upload/history, and removal of the public static map.');
