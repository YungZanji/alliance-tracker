import assert from 'node:assert/strict';
import fs from 'node:fs';
import { contributionIndex, scoreGloryWar } from '../src/scoring-entry-v157.js';

const worker = fs.readFileSync(new URL('../src/scoring-entry-v157.js', import.meta.url), 'utf8');
const ui = fs.readFileSync(new URL('../public/app-v086.js', import.meta.url), 'utf8');
const index = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const wrangler = fs.readFileSync(new URL('../wrangler.template.jsonc', import.meta.url), 'utf8');

assert.equal(contributionIndex(1_000_000, 1_000_000, 0.5), 100);
assert.equal(contributionIndex(4_000_000, 1_000_000, 0.5), 200);
assert.equal(contributionIndex(0, 1_000_000, 0.5), 0);

const uid = 'player-1';
const matches = [
  { cycleId: '2026-08-30', cycleWeek: 2, capturedAt: '2026-09-06T18:00:00Z' },
  { cycleId: '2026-08-30', cycleWeek: 3, capturedAt: '2026-09-13T18:00:00Z' },
  { cycleId: '2026-08-30', cycleWeek: 4, capturedAt: '2026-09-20T18:00:00Z' },
];
const scores = new Map([
  [`${uid}|2026-08-30|2`, { raw_score: 4_000_000, credited_score: 4_000_000, leaderboard_position: 1 }],
  [`${uid}|2026-08-30|3`, { raw_score: 1_000_000, credited_score: 1_000_000, leaderboard_position: 5 }],
]);
const policies = new Map([
  ['2026-08-30|3', { isBye: true, multiplier: 0.5 }],
]);
const away = new Set([`${uid}|2026-08-30|4`]);
const noEvents = new Set();

const scored = scoreGloryWar(uid, matches, scores, policies, away, noEvents, 1_000_000, 0.5);
assert.equal(scored.eligibleEvents, 2);
assert.equal(scored.playedEvents, 2);
assert.equal(scored.leaveEvents, 1);
assert.equal(scored.missedEvents, 0);
assert.equal(scored.eventIndex, 125); // (200 + (100 × 0.5)) / 2

const missed = scoreGloryWar(uid, matches, scores, policies, new Set(), noEvents, 1_000_000, 0.5);
assert.equal(missed.eligibleEvents, 3);
assert.equal(missed.missedEvents, 1);
assert.equal(missed.eventIndex, 83.33); // (200 + 50 + 0) / 3

const noEvent = scoreGloryWar(uid, matches, scores, policies, new Set(), new Set(['2026-08-30|4']), 1_000_000, 0.5);
assert.equal(noEvent.eligibleEvents, 2);
assert.equal(noEvent.noEventCount, 1);
assert.equal(noEvent.eventIndex, 125);

assert.match(worker, /DEFAULT_GLORY_WAR_BASELINE = 1_000_000/);
assert.match(worker, /glory_war_contribution_baseline/);
assert.match(worker, /missedCompletedEvent: 'zero'/);
assert.match(worker, /winBonus: false/);
assert.match(worker, /gloryWarStatus: 'active'/);
assert.match(ui, /contribution-glory-baseline/);
assert.match(ui, /gloryWarBaseline/);
assert.match(ui, /playedEvents/);
assert.match(ui, /genuine missed completed event is zero/);
assert.match(index, /app-v086\.js\?v=117/);
assert.match(wrangler, /scoring-entry-v157\.js/);

console.log('Verified Glory War Contribution Index, 1M baseline, Bye/Leave/No Event handling, missed-event zero, Admin control, and active leaderboard display.');
