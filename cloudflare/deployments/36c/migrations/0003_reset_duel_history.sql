-- Start 36C Duel tracking over; leave other event data and account records intact.
DELETE FROM duel_daily;
DELETE FROM duel_day_outcome_override;
DELETE FROM duel_group_members;
DELETE FROM duel_league_total;
DELETE FROM duel_matchups;
DELETE FROM duel_rank_positions;
DELETE FROM duel_restore_log;
DELETE FROM duel_restore_points;
DELETE FROM duel_results;
DELETE FROM duel_seasons;
DELETE FROM duel_week_context;
DELETE FROM duel_week_membership;
DELETE FROM duel_weekly;
DELETE FROM captures WHERE substr(dataset,1,14)='alliance_duel_';
DELETE FROM score_history WHERE metric_type IN ('weekly','daily');
