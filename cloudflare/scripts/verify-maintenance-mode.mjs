import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../src/maintenance-entry.js', import.meta.url), 'utf8');
const config = fs.readFileSync(new URL('../wrangler.template.jsonc', import.meta.url), 'utf8');
const worker = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

assert.match(config, /"main":\s*"\.\/src\/maintenance-entry\.js"/);
assert.match(config, /"run_worker_first":\s*true/);
assert.match(config, /"database_name":\s*"alliance-tracker-db"/);
assert.doesNotMatch(config, /"triggers"\s*:/);

const page = await worker.default.fetch(new Request('https://wdz.state305.cc/'));
assert.equal(page.status, 410);
assert.match(page.headers.get('content-type') || '', /text\/html/);
assert.match(page.headers.get('x-robots-tag') || '', /noindex/);
assert.match(await page.text(), /Tracker unavailable/);
assert.match(await (await worker.default.fetch(new Request('https://wdz.state305.cc/glory-war/archive'))).text(), /Tracker unavailable/);

const api = await worker.default.fetch(new Request('https://wdz.state305.cc/api/sync', { method: 'POST' }));
assert.equal(api.status, 410);
assert.match(api.headers.get('x-robots-tag') || '', /noindex/);

const health = await worker.default.fetch(new Request('https://wdz.state305.cc/api/health'));
assert.equal(health.status, 200);
assert.equal((await health.json()).status, 'unavailable');

const robots = await worker.default.fetch(new Request('https://wdz.state305.cc/robots.txt'));
assert.equal(robots.status, 200);
assert.match(await robots.text(), /Allow: \/\n/);

console.log('Verified public pages show the no-index notice, application APIs are closed, deployment health stays available, and the existing D1 binding remains configured.');
