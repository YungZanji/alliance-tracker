PRAGMA foreign_keys = ON;

-- NoBunny was present in the complete Week 1 recovery source but was removed
-- from the later 99-player capture while on leave. Keep Week 1 untouched and
-- mark only Week 2 as On Leave.
-- Historical UID identified by comparing the 100-player Week 1 recovery source
-- against 20260808_211658_Alliance_Duel_Auto_Sync (99 WDZ players).
INSERT INTO player_week_leave(
  cycle_id, cycle_week, uid, status, note, created_at, updated_at, updated_by_uid
)
SELECT
  '2026-08-02', 2, p.uid, 'away',
  'On Leave for Week 2; Week 1 remains a normal scored week.',
  '2026-08-09T18:00:00.000Z', '2026-08-09T18:00:00.000Z', NULL
FROM players p
WHERE p.uid='1083205961000319'
ON CONFLICT(cycle_id, cycle_week, uid) DO UPDATE SET
  status='away',
  note='On Leave for Week 2; Week 1 remains a normal scored week.',
  updated_at='2026-08-09T18:00:00.000Z',
  updated_by_uid=NULL;
