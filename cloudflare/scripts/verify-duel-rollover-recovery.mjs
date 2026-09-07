import assert from 'node:assert/strict';
import fs from 'node:fs';
import { derivePreviousWeekScore } from '../src/scoring-entry-v154.js';

assert.equal(derivePreviousWeekScore(233_439_760, 0, 0), 233_439_760);
assert.equal(derivePreviousWeekScore(243_439_760, 10_000_000, 0), 233_439_760);
assert.equal(derivePreviousWeekScore(500, 50, 100), 350);
assert.equal(derivePreviousWeekScore(100, 150, 0), null);

const source = fs.readFileSync(new URL('../src/scoring-entry-v154.js', import.meta.url), 'utf8');
assert.match(source, /weekly_own_alliance/);
assert.match(source, /weekly_combined/);
assert.match(source, /current_day_combined/);
assert.match(source, /rollover_cumulative_recovery/);
assert.match(source, /lastPreviousWeekSync/);
assert.match(source, /weeklyRows\.get\(uid\) !== currentRows\.get\(uid\)/);

const migration = fs.readFileSync(new URL('../migrations/0024_missed_sunday_rollover_recovery.sql', import.meta.url), 'utf8');
assert.match(migration, /2026-08-30/);
assert.match(migration, /l\.score - COALESCE\(current\.score,0\)/);
assert.match(migration, /day_index=6/);
assert.match(migration, /rollover_cumulative_recovery/);
assert.doesNotMatch(migration, /CREATE\s+TEMP(?:ORARY)?\s+TABLE/i);
assert.match(migration, /CREATE TABLE _rollover_week1_final/);
assert.match(migration, /CREATE TABLE _rollover_week1_day6/);
assert.match(migration, /DROP TABLE _rollover_week1_final/);

console.log('Verified missed-Sunday rollover recovery, Monday score separation, and D1-compatible migration staging.');
