import assert from 'node:assert/strict';
import fs from 'node:fs';
import { findStateRulerMatchup } from '../src/scoring-entry-v156.js';

const source = fs.readFileSync(new URL('../src/scoring-entry-v156.js', import.meta.url), 'utf8');
assert.match(source, /event_week_context/);
assert.match(source, /['"]svs_capture['"]/);
assert.match(source, /excluded\.updated_at >= event_week_context\.updated_at/);

const explicit = findStateRulerMatchup([
  {
    dataset: 'state_ruler_rankings',
    capturedAt: '2026-09-12T18:00:00Z',
    context: {
      primaryServerId: 305,
      opponentServerId: 411,
      opponentLabel: 'State 411',
      opponentDetectionConfidence: 'explicit',
      opponentDetectionSource: 'explicit_payload_hint',
    },
  },
]);
assert.equal(explicit.opponentState, 411);
assert.equal(explicit.primaryState, 305);
assert.equal(explicit.confidence, 'explicit');

const fallback = findStateRulerMatchup([
  {
    dataset: 'state_ruler_attendance',
    captured_at: '2026-09-12T18:05:00Z',
    context: {
      primaryServerId: 305,
      opponentState: 417,
      opponentDetectionConfidence: 'ranking_rows',
      opponentDetectionSource: 'ranking_player_servers',
    },
  },
]);
assert.equal(fallback.opponentState, 417);
assert.equal(fallback.opponentLabel, 'State 417');

const unsafe = findStateRulerMatchup([
  {
    dataset: 'state_ruler_rankings',
    capturedAt: '2026-09-12T18:00:00Z',
    context: {
      primaryServerId: 305,
      opponentServerId: 999,
      opponentDetectionConfidence: 'none',
    },
  },
]);
assert.equal(unsafe, null);

console.log('Verified SVS opponent-state extraction and safe event-week context updates.');
