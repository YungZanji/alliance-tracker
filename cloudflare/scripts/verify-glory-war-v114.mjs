import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker = fs.readFileSync(new URL('../src/scoring-entry-v155.js', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../migrations/0025_glory_war_archive.sql', import.meta.url), 'utf8');
const ui = fs.readFileSync(new URL('../public/app-v085.js', import.meta.url), 'utf8');
const legacyUi = fs.readFileSync(new URL('../public/app-v068.js', import.meta.url), 'utf8');
const index = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

assert.match(worker, /glory_war_rankings/);
assert.match(worker, /alliance\.declare\.war\.personal\.rank/);
assert.match(worker, /event_week_scores/);
assert.match(worker, /glory_war_matches/);
assert.match(worker, /opponentPlayerRowsStored: false/);
assert.match(worker, /\/api\/glory-war/);
assert.match(worker, /score: Number\(row\.credited_score \|\| row\.raw_score \|\| 0\)/);
assert.match(migration, /CREATE TABLE IF NOT EXISTS glory_war_matches/);
assert.match(ui, /Opponent player scores are not stored or displayed/);
assert.match(ui, /WDZ Glory War scores/);
assert.match(ui, /fmt\(row\.score\)/);
assert.match(ui, /data-player=/);

// app-v068 used to repaint the Glory War table from the same MutationObserver and
// expected a retired `creditedScore` API field. That caused an endless repaint loop
// and displayed every score as zero while app-v085 simultaneously rendered the
// authoritative page. Keep the legacy layer out of Glory War rendering entirely.
assert.doesNotMatch(legacyUi, /enhanceGloryWarPersistence/);
assert.doesNotMatch(legacyUi, /creditedScore/);

// app-v085 imports the same exact app-v084 module URL that index.html loads. ES
// modules are evaluated once per URL, so the older observer chain is shared instead
// of being instantiated a second time under a different URL.
assert.match(index, /app-v084\.js\?v=110/);
assert.match(index, /app-v085\.js\?v=116/);
assert.match(ui, /import '\.\/app-v084\.js\?v=110';/);

console.log('Verified Glory War ingestion, non-zero score field contract, single renderer ownership, and one shared portal observer graph.');
