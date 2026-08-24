PRAGMA foreign_keys = ON;

-- A current-day ranking is a live score, not a completed Duel result.
-- Keep the score for display, but do not award a win/loss or Duel points until
-- the day appears in completed-day rankings (or is finalized by Sunday delta).
UPDATE duel_results
SET is_win=NULL,
    outcome_source='current_day_live'
WHERE outcome_source='current_day_rankings';
