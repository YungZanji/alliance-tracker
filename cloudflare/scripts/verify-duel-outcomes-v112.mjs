import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('../migrations/0022_duel_outcome_authority.sql', import.meta.url), 'utf8');
const worker = readFileSync(new URL('../src/scoring-entry-v152.js', import.meta.url), 'utf8');
const historyUi = readFileSync(new URL('../public/data-history-v112.js', import.meta.url), 'utf8');

const weights = [0, 1, 2, 2, 2, 2, 4];
const week2 = [
  [1, 1247293231, 718207203, 1],
  [2, 822182299, 569633755, 1],
  [3, 877525978, 573979009, 1],
  [4, 2414774754, 1263334778, 1],
  [5, 789637746, 610884145, 1],
  [6, 1941691033, 1318166412, 1],
];
const week3 = [
  [1, 1230450234, 1634377499, 0],
  [2, 861450877, 855778111, 1],
  [3, 908905367, 987331004, 0],
  [4, 2391899734, 2513539189, 0],
  [5, 877267583, 1051494792, 0],
  [6, 1293794669, 1961502338, 0],
];

function summarize(rows) {
  return {
    own: rows.reduce((sum, row) => sum + row[1], 0),
    opponent: rows.reduce((sum, row) => sum + row[2], 0),
    points: rows.reduce((sum, row) => sum + (row[3] ? weights[row[0]] : 0), 0),
  };
}

assert.deepEqual(summarize(week2), { own: 8093105041, opponent: 5054205302, points: 13 });
assert.deepEqual(summarize(week3), { own: 7563768464, opponent: 9004022933, points: 2 });

for (const [day, own, opponent, win] of [...week2, ...week3]) {
  assert.ok(migration.includes(String(own)), `Missing recovered alliance score ${own} for day ${day}`);
  assert.ok(migration.includes(String(opponent)), `Missing recovered opponent score ${opponent} for day ${day}`);
  assert.ok(Number.isInteger(win));
}

assert.ok(migration.includes("'DREA','rankings_recovered'"));
assert.ok(migration.includes("'Gwgp','rankings_recovered'"));
assert.ok(migration.includes('CREATE TABLE IF NOT EXISTS duel_week_membership'));

assert.ok(worker.includes("dataset: 'alliance_duel_results_diagnostic'"));
assert.ok(worker.includes("'completed_days_rankings'"));
assert.ok(worker.includes("'weekly_final_delta_rankings'"));
assert.ok(worker.includes('duel_week_membership'));
assert.ok(worker.includes('/api/admin/duel-history-checkpoints/preview'));
assert.ok(worker.includes('/api/admin/duel-history-checkpoints/restore'));

assert.ok(historyUi.includes('HISTORICAL SYNC CHECKPOINTS'));
assert.ok(historyUi.includes('Preview scores'));
assert.ok(historyUi.includes('Rewind scores'));

console.log('Verified Duel matchup authority, Week 2/3 recovery totals, authoritative roster filtering, and historical score rewind UI.');
