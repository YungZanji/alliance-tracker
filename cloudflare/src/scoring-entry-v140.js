import portal from './scoring-entry-v139.js';

const DEFAULT_ATTENDANCE_FLOOR = 2_250_000;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const match = url.pathname.match(/^\/api\/admin\/polls\/([^/]+)\/apply-state-ruler$/);

    if (match && request.method === 'POST') {
      const gate = await requireAdmin(request, env, ctx);
      if (gate) return gate;
      return applyPollToStateRuler(decodeURIComponent(match[1]), request, env);
    }

    // Enrich Poll Archive detail with its State Ruler application history.
    const detailMatch = url.pathname.match(/^\/api\/admin\/polls\/([^/]+)$/);
    if (detailMatch && request.method === 'GET') {
      const response = await portal.fetch(request, env, ctx);
      if (!response.ok) return response;
      try {
        const body = await response.json();
        const pollId = decodeURIComponent(detailMatch[1]);
        const applied = await env.DB.prepare(`
          SELECT poll_id,cycle_id,cycle_week,attendance_option_id,attendance_option_text,attendance_floor,
                 yes_count,floor_credits_added,real_scores_preserved,explicit_other_votes,unknown_players,applied_at
          FROM poll_state_ruler_applications
          WHERE poll_id=?
          ORDER BY applied_at DESC
        `).bind(pollId).all();
        body.stateRulerApplications = (applied.results || []).map(row => ({
          pollId: String(row.poll_id || ''),
          cycleId: String(row.cycle_id || ''),
          cycleWeek: Number(row.cycle_week || 0),
          attendanceOptionId: String(row.attendance_option_id || ''),
          attendanceOptionText: String(row.attendance_option_text || ''),
          attendanceFloor: Number(row.attendance_floor || 0),
          yesCount: Number(row.yes_count || 0),
          floorCreditsAdded: Number(row.floor_credits_added || 0),
          realScoresPreserved: Number(row.real_scores_preserved || 0),
          explicitOtherVotes: Number(row.explicit_other_votes || 0),
          unknownPlayers: Number(row.unknown_players || 0),
          appliedAt: String(row.applied_at || ''),
        }));
        return json(body, response.status);
      } catch (_) {
        return response;
      }
    }

    return portal.fetch(request, env, ctx);
  }
};

async function requireAdmin(request, env, ctx) {
  const url = new URL(request.url);
  url.pathname = '/api/admin/scoring-context';
  url.search = '';
  const response = await portal.fetch(new Request(url.toString(), { method: 'GET', headers: request.headers }), env, ctx);
  return response.ok ? null : response;
}

async function applyPollToStateRuler(pollId, request, env) {
  let body = {};
  try { body = await request.json(); } catch (_) {
    return json({ ok: false, error: 'Invalid State Ruler backfill request.' }, 400);
  }

  const cycleId = String(body?.cycleId || '').trim().slice(0, 120);
  const cycleWeek = Number(body?.cycleWeek || 0);
  const attendanceOptionId = String(body?.attendanceOptionId || '').trim();
  if (!pollId || !cycleId || cycleWeek < 1 || cycleWeek > 4 || !attendanceOptionId) {
    return json({ ok: false, error: 'Choose a poll option, Duel cycle, and State Ruler week.' }, 400);
  }

  const [poll, option, participantResult, playerResult, existingScoreResult, floor] = await Promise.all([
    env.DB.prepare('SELECT poll_id,question,captured_at FROM alliance_polls WHERE poll_id=?').bind(pollId).first(),
    env.DB.prepare('SELECT option_id,option_text FROM alliance_poll_options WHERE poll_id=? AND option_id=?')
      .bind(pollId, attendanceOptionId).first(),
    env.DB.prepare(`
      SELECT uid,player_name,roster_member,voted,option_ids_json
      FROM alliance_poll_participants
      WHERE poll_id=?
    `).bind(pollId).all(),
    env.DB.prepare('SELECT uid,current_name FROM players').all(),
    env.DB.prepare(`
      SELECT uid,raw_score,credited_score,credit_source
      FROM event_week_scores
      WHERE event_type='state_ruler' AND cycle_id=? AND cycle_week=?
    `).bind(cycleId, cycleWeek).all(),
    numericSetting(env, 'state_ruler_attendance_floor', DEFAULT_ATTENDANCE_FLOOR),
  ]);

  if (!poll) return json({ ok: false, error: 'Archived poll was not found.' }, 404);
  if (!option) return json({ ok: false, error: 'That attendance option does not exist on this poll.' }, 400);

  const knownPlayers = new Map((playerResult.results || []).map(row => [String(row.uid), row]));
  const existingScores = new Map((existingScoreResult.results || []).map(row => [String(row.uid), row]));
  const participants = participantResult.results || [];
  const yesRows = [];
  let explicitOtherVotes = 0;

  for (const row of participants) {
    if (Number(row.voted || 0) !== 1) continue;
    const optionIds = parseJsonArray(row.option_ids_json).map(String);
    if (optionIds.includes(attendanceOptionId)) yesRows.push(row);
    else explicitOtherVotes += 1;
  }

  const now = new Date().toISOString();
  const statements = [];
  let floorCreditsAdded = 0;
  let realScoresPreserved = 0;
  let unknownPlayers = 0;
  const source = `alliance_poll:${pollId}`;
  const note = `Attendance indicated by poll option "${String(option.option_text || attendanceOptionId).slice(0, 120)}".`;

  for (const row of yesRows) {
    const uid = String(row.uid || '').trim();
    if (!uid || !knownPlayers.has(uid)) {
      unknownPlayers += 1;
      continue;
    }

    const existing = existingScores.get(uid);
    const hasRealScore = existing?.raw_score !== null && existing?.raw_score !== undefined;
    if (hasRealScore) realScoresPreserved += 1;
    else floorCreditsAdded += 1;

    statements.push(env.DB.prepare(`
      INSERT INTO event_attendance_evidence(
        event_type,cycle_id,cycle_week,uid,attended,last_online_at,window_start,window_end,source,note,updated_at,updated_by_uid
      ) VALUES('state_ruler',?,?,?,1,NULL,NULL,NULL,?,?,?,NULL)
      ON CONFLICT(event_type,cycle_id,cycle_week,uid) DO UPDATE SET
        attended=1,
        source=excluded.source,
        note=excluded.note,
        updated_at=excluded.updated_at
    `).bind(cycleId, cycleWeek, uid, source, note, now));

    statements.push(env.DB.prepare(`
      INSERT INTO event_week_scores(
        event_type,cycle_id,cycle_week,uid,raw_score,credited_score,credit_source,leaderboard_position,
        source_command,captured_at,source_hash,metadata_json
      ) VALUES('state_ruler',?,?,?,NULL,?,'attendance_minimum',NULL,'alliance_poll',? ,?,?)
      ON CONFLICT(event_type,cycle_id,cycle_week,uid) DO UPDATE SET
        credited_score=CASE
          WHEN event_week_scores.raw_score IS NULL THEN MAX(COALESCE(event_week_scores.credited_score,0), excluded.credited_score)
          ELSE event_week_scores.credited_score
        END,
        credit_source=CASE
          WHEN event_week_scores.raw_score IS NULL THEN 'attendance_minimum'
          ELSE event_week_scores.credit_source
        END,
        source_command=CASE
          WHEN event_week_scores.raw_score IS NULL THEN excluded.source_command
          ELSE event_week_scores.source_command
        END,
        captured_at=CASE
          WHEN event_week_scores.raw_score IS NULL THEN excluded.captured_at
          ELSE event_week_scores.captured_at
        END,
        source_hash=CASE
          WHEN event_week_scores.raw_score IS NULL THEN excluded.source_hash
          ELSE event_week_scores.source_hash
        END,
        metadata_json=CASE
          WHEN event_week_scores.raw_score IS NULL THEN excluded.metadata_json
          ELSE event_week_scores.metadata_json
        END
    `).bind(
      cycleId, cycleWeek, uid, floor, now, source,
      JSON.stringify({ attendanceSource: source, minimumCredit: floor, pollId, attendanceOptionId, attendanceOptionText: String(option.option_text || '') })
    ));
  }

  statements.push(env.DB.prepare(`
    INSERT INTO poll_state_ruler_applications(
      poll_id,cycle_id,cycle_week,attendance_option_id,attendance_option_text,attendance_floor,
      yes_count,floor_credits_added,real_scores_preserved,explicit_other_votes,unknown_players,applied_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(poll_id,cycle_id,cycle_week,attendance_option_id) DO UPDATE SET
      attendance_option_text=excluded.attendance_option_text,
      attendance_floor=excluded.attendance_floor,
      yes_count=excluded.yes_count,
      floor_credits_added=excluded.floor_credits_added,
      real_scores_preserved=excluded.real_scores_preserved,
      explicit_other_votes=excluded.explicit_other_votes,
      unknown_players=excluded.unknown_players,
      applied_at=excluded.applied_at
  `).bind(
    pollId,cycleId,cycleWeek,attendanceOptionId,String(option.option_text || ''),floor,
    yesRows.length,floorCreditsAdded,realScoresPreserved,explicitOtherVotes,unknownPlayers,now
  ));

  await runBatches(env.DB, statements, 80);

  return json({
    ok: true,
    pollId,
    question: String(poll.question || ''),
    cycleId,
    cycleWeek,
    attendanceOptionId,
    attendanceOptionText: String(option.option_text || ''),
    attendanceFloor: floor,
    yesVoters: yesRows.length,
    floorCreditsAdded,
    realScoresPreserved,
    explicitOtherVotes,
    unknownPlayers,
    appliedAt: now,
  });
}

async function numericSetting(env, key, fallback) {
  try {
    const row = await env.DB.prepare('SELECT numeric_value FROM scoring_settings WHERE setting_key=?').bind(key).first();
    const value = Number(row?.numeric_value);
    return Number.isFinite(value) ? value : fallback;
  } catch (_) {
    return fallback;
  }
}

async function runBatches(db, statements, size) {
  for (let index = 0; index < statements.length; index += size) {
    await db.batch(statements.slice(index, index + size));
  }
}

function parseJsonArray(value) {
  try {
    const parsed = JSON.parse(String(value || '[]'));
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}
