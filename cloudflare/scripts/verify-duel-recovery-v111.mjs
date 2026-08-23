import assert from 'node:assert/strict';
import { protectSundayResetSnapshots, resolveIncomingDuelWeek } from '../src/scoring-entry-v151.js';

const player = (uid, score, allianceAbbr = 'WDZ') => ({ uid, name: uid, score, allianceAbbr });
const ranking = (label, rows, capturedAt = '2026-08-23T23:13:41.428Z') => ({
  dataset: 'alliance_duel_rankings',
  capturedAt,
  context: { rankTypeLabel: label },
  rows,
});

const sunday = [
  ranking('current_day_combined', [player('a', 0), player('enemy', 0, 'bee')]),
  ranking('completed_days', [player('a', 0), player('enemy', 0, 'bee')]),
  ranking('weekly_combined', [player('a', 7_500_000), player('enemy', 8_000_000, 'bee')]),
  ranking('weekly_own_alliance', [player('a', 21_000_000)]),
  { dataset: 'alliance_duel_results', rows: [{ dayIndex: 6, allianceScore: 1_200_000 }] },
];

const protectedBatch = protectSundayResetSnapshots(sunday, 'WDZ');
assert.equal(protectedBatch.protected, true);
assert.equal(protectedBatch.ignored, 2);
assert.equal(protectedBatch.snapshots.some(row => row.context?.rankTypeLabel === 'completed_days'), false);
assert.equal(protectedBatch.snapshots.some(row => row.context?.rankTypeLabel === 'current_day_combined'), false);
assert.equal(protectedBatch.snapshots.some(row => row.context?.rankTypeLabel === 'weekly_combined'), true);
assert.equal(protectedBatch.snapshots.some(row => row.context?.rankTypeLabel === 'weekly_own_alliance'), true);
assert.equal(protectedBatch.snapshots.some(row => row.dataset === 'alliance_duel_results'), true);

const weekday = [
  ranking('completed_days', [player('a', 1_000_000), player('enemy', 900_000, 'bee')], '2026-08-22T23:55:10.000Z'),
  ranking('weekly_combined', [player('a', 6_000_000), player('enemy', 5_000_000, 'bee')], '2026-08-22T23:55:10.000Z'),
];
const weekdayBatch = protectSundayResetSnapshots(weekday, 'WDZ');
assert.equal(weekdayBatch.protected, false);
assert.equal(weekdayBatch.snapshots.length, weekday.length);

const emptyWeek = [
  ranking('completed_days', [player('a', 0)]),
  ranking('weekly_combined', [player('a', 0)]),
];
assert.equal(protectSundayResetSnapshots(emptyWeek, 'WDZ').protected, false);

const week = resolveIncomingDuelWeek(
  [ranking('weekly_combined', [player('a', 1)], '2026-08-23T23:13:41.428Z')],
  { DUEL_CYCLE_ANCHOR: '2026-08-02' },
);
assert.equal(week.cycleId, '2026-08-02');
assert.equal(week.cycleWeek, 3);
assert.equal(week.weekId, '2026-08-16');

console.log('Verified Sunday Duel reset protection and Pacific week resolution.');
