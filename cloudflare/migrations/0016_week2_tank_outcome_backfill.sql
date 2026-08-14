-- Portal 0.9.5: backfill the completed Tank Day result from the verified 2026-08-11 one-touch capture.
-- Capture evidence: WDZ 1,247,293,231 vs DREA 718,207,203 on Day 1 (Tank Day), cycle 2026-08-02 Week 2.
-- Future one-touch syncs derive completed-day outcomes automatically from the same combined ranking dataset.

INSERT INTO duel_results(
  cycle_id,cycle_week,week_id,week_start_time,day_index,event_name,
  alliance_score,opponent_score,is_win,mvp_uid,mvp_name,mvp_score,captured_at,source_hash
) VALUES(
  '2026-08-02',2,'2026-08-09',0,1,'Tank Day',
  1247293231,718207203,1,'','',0,'2026-08-11T09:15:01.806Z','backfill:20260811-completed-days-week2-day1'
)
ON CONFLICT(cycle_id,cycle_week,day_index) DO UPDATE SET
  alliance_score=CASE WHEN duel_results.alliance_score IS NULL THEN excluded.alliance_score ELSE duel_results.alliance_score END,
  opponent_score=CASE WHEN duel_results.opponent_score IS NULL THEN excluded.opponent_score ELSE duel_results.opponent_score END,
  is_win=CASE WHEN duel_results.is_win IS NULL THEN excluded.is_win ELSE duel_results.is_win END,
  captured_at=CASE WHEN duel_results.captured_at IS NULL OR duel_results.captured_at='' THEN excluded.captured_at ELSE duel_results.captured_at END,
  source_hash=CASE WHEN duel_results.source_hash IS NULL OR duel_results.source_hash='' THEN excluded.source_hash ELSE duel_results.source_hash END;
