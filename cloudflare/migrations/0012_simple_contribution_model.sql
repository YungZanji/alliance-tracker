PRAGMA foreign_keys = ON;

-- Portal 0.8.0 simple contribution model.
-- Raw scores remain uncapped. Fixed benchmarks replace top-player normalization.
-- Duel daily benchmarks start at the established 6M standard and are independently editable.

INSERT INTO participation_weights(event_type,label,weight,enabled)
VALUES
  ('alliance_duel','Alliance Duel',0.45,1),
  ('glory_war','Glory War',0.30,1),
  ('state_ruler','State Ruler',0.25,1)
ON CONFLICT(event_type) DO UPDATE SET
  label=excluded.label,
  weight=excluded.weight,
  enabled=excluded.enabled;

INSERT INTO scoring_settings(setting_key,numeric_value,text_value,updated_at)
VALUES
  ('duel_daily_minimum',6000000,'Alliance Duel daily minimum','2026-08-10T13:50:00.000Z'),
  ('benchmark_duel_day_1',6000000,'Tank Day contribution benchmark','2026-08-10T13:50:00.000Z'),
  ('benchmark_duel_day_2',6000000,'Build Day contribution benchmark','2026-08-10T13:50:00.000Z'),
  ('benchmark_duel_day_3',6000000,'Science Day contribution benchmark','2026-08-10T13:50:00.000Z'),
  ('benchmark_duel_day_4',6000000,'Hero Day contribution benchmark','2026-08-10T13:50:00.000Z'),
  ('benchmark_duel_day_5',6000000,'Training Day contribution benchmark','2026-08-10T13:50:00.000Z'),
  ('benchmark_duel_day_6',6000000,'Enemy Buster contribution benchmark','2026-08-10T13:50:00.000Z'),
  ('benchmark_state_ruler',2250000,'State Ruler contribution benchmark','2026-08-10T13:50:00.000Z'),
  ('benchmark_glory_war',0,'Glory War contribution benchmark; configure after capture discovery','2026-08-10T13:50:00.000Z'),
  ('minimum_ranked_duel_weeks',3,'Minimum played Alliance Duel weeks for final ranked eligibility','2026-08-10T13:50:00.000Z')
ON CONFLICT(setting_key) DO NOTHING;
