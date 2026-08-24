import assert from 'node:assert/strict';
import fs from 'node:fs';
import { isLiveOutcomeSource } from '../src/scoring-entry-v153.js';

assert.equal(isLiveOutcomeSource('current_day_rankings'), true);
assert.equal(isLiveOutcomeSource('current_day_live'), true);
assert.equal(isLiveOutcomeSource('completed_days_rankings'), false);
assert.equal(isLiveOutcomeSource('weekly_final_delta_rankings'), false);

const migration = fs.readFileSync(new URL('../migrations/0023_live_duel_day_status.sql', import.meta.url), 'utf8');
assert.match(migration, /SET is_win=NULL/);
assert.match(migration, /outcome_source='current_day_live'/);
assert.match(migration, /WHERE outcome_source='current_day_rankings'/);

const outcomeUi = fs.readFileSync(new URL('../public/app-v075.js', import.meta.url), 'utf8');
assert.match(outcomeUi, /if \(day\.outcomeKnown\)/);

console.log('Verified live Duel scores stay unresolved until the day is completed.');
