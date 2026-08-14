PRAGMA foreign_keys = ON;

-- Correct historical Week 1 State Ruler matchup.
-- The opponent was State 315, not State 350.
INSERT INTO event_week_context(
  event_type,cycle_id,cycle_week,opponent_state,opponent_label,source,updated_at,updated_by_uid
)
VALUES(
  'state_ruler','2026-08-02',1,315,'State 315','admin','2026-08-10T03:31:00.000Z',NULL
)
ON CONFLICT(event_type,cycle_id,cycle_week) DO UPDATE SET
  opponent_state=315,
  opponent_label='State 315',
  source='admin',
  updated_at='2026-08-10T03:31:00.000Z',
  updated_by_uid=NULL;
