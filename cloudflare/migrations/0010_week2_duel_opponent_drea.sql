PRAGMA foreign_keys = ON;

-- Week 2 matchup confirmed by the Aug 10 weekly_combined capture and operator context.
INSERT INTO duel_week_context(
  cycle_id,cycle_week,opponent_abbr,opponent_name,opponent_server_id,source,updated_at,updated_by_uid
) VALUES(
  '2026-08-02',2,'DREA','DREA',NULL,'admin','2026-08-10T10:30:00.000Z',NULL
)
ON CONFLICT(cycle_id,cycle_week) DO UPDATE SET
  opponent_abbr='DREA',
  opponent_name=CASE WHEN duel_week_context.opponent_name='' THEN 'DREA' ELSE duel_week_context.opponent_name END,
  source=CASE WHEN duel_week_context.source='admin' THEN duel_week_context.source ELSE 'admin' END,
  updated_at='2026-08-10T10:30:00.000Z';
