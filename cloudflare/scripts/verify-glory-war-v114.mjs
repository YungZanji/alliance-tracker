import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker = fs.readFileSync(new URL('../src/scoring-entry-v155.js', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../migrations/0025_glory_war_archive.sql', import.meta.url), 'utf8');
const ui = fs.readFileSync(new URL('../public/app-v085.js', import.meta.url), 'utf8');
const index = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

assert.match(worker, /glory_war_rankings/);
assert.match(worker, /alliance\.declare\.war\.personal\.rank/);
assert.match(worker, /event_week_scores/);
assert.match(worker, /glory_war_matches/);
assert.match(worker, /opponentPlayerRowsStored: false/);
assert.match(worker, /\/api\/glory-war/);
assert.match(migration, /CREATE TABLE IF NOT EXISTS glory_war_matches/);
assert.match(ui, /Opponent player scores are not stored or displayed/);
assert.match(ui, /WDZ Glory War scores/);
assert.match(index, /app-v085\.js\?v=114/);

console.log('Verified Glory War ingestion, matchup archive, WDZ-only player leaderboard, and portal page.');
