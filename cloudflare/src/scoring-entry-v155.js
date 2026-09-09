import portal from './scoring-entry-v154.js';

const PRIMARY_ALLIANCE = 'WDZ';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/sync' && request.method === 'POST') {
      let incoming = null;
      try { incoming = await request.clone().json(); } catch (_) {}
      const response = await portal.fetch(request, env, ctx);
      if (response.ok && incoming) {
        try {
          const result = await response.clone().json();
          await ingestGloryWar(incoming.snapshots || [], result, env);
        } catch (error) {
          console.error('Glory War ingestion failed', error);
        }
      }
      return response;
    }

    if (url.pathname === '/api/glory-war' && request.method === 'GET') {
      const gate = await requireUser(request, env, ctx);
      if (gate) return gate;
      return handleGloryWar(url, env);
    }

    return portal.fetch(request, env, ctx);
  },

  async scheduled(controller, env, ctx) {
    if (typeof portal.scheduled === 'function') return portal.scheduled(controller, env, ctx);
  }
};

async function requireUser(request, env, ctx) {
  const url = new URL(request.url);
  url.pathname = '/api/auth/me';
  url.search = '';
  const response = await portal.fetch(new Request(url.toString(), { method: 'GET', headers: request.headers }), env, ctx);
  return response.ok ? null : response;
}

async function ingestGloryWar(snapshots, syncResult, env) {
  const cycleId = String(syncResult?.cycleId || '').trim();
  const cycleWeek = Number(syncResult?.cycleWeek || 0);
  if (!cycleId || cycleWeek < 1 || cycleWeek > 4) return;

  const relevant = (Array.isArray(snapshots) ? snapshots : [])
    .filter(snapshot => String(snapshot?.dataset || '') === 'glory_war_rankings')
    .sort((a, b) => capturedAt(b).localeCompare(capturedAt(a)));
  if (!relevant.length) return;

  const snapshot = relevant[0];
  const context = snapshot.context || {};
  const primary = String(env.PRIMARY_ALLIANCE_ABBR || PRIMARY_ALLIANCE).trim().toLowerCase();
  const captured = capturedAt(snapshot);
  const sourceHash = String(snapshot?.source_hash || snapshot?.sourceHash || '');
  const rows = (Array.isArray(snapshot.rows) ? snapshot.rows : []).filter(row => {
    const abbr = String(row?.allianceAbbr || '').trim().toLowerCase();
    return !abbr || abbr === primary;
  });
  if (!rows.length) return;

  const knownResult = await env.DB.prepare('SELECT uid FROM players').all();
  const known = new Set((knownResult.results || []).map(row => String(row.uid)));
  const statements = [];
  const eventId = `${cycleId}:W${cycleWeek}`;

  for (const row of rows) {
    const uid = String(row?.uid || '').trim();
    if (!uid || !known.has(uid)) continue;
    const score = Math.max(0, Number(row?.score || 0));
    const position = Number(row?.position || 0) || null;
    const metadata = JSON.stringify({
      opponentAllianceAbbr: String(context.opponentAllianceAbbr || ''),
      opponentAllianceName: String(context.opponentAllianceName || ''),
      opponentServerId: Number(context.opponentServerId || 0) || null,
      result: String(context.result || ''),
      source: 'alliance.declare.war.personal.rank'
    });

    statements.push(env.DB.prepare(`
      INSERT INTO event_week_scores(event_type,cycle_id,cycle_week,uid,raw_score,credited_score,credit_source,leaderboard_position,source_command,captured_at,source_hash,metadata_json)
      VALUES('glory_war',?,?,?,?,?,'leaderboard',?,?,?,?,?)
      ON CONFLICT(event_type,cycle_id,cycle_week,uid) DO UPDATE SET
        raw_score=MAX(event_week_scores.raw_score,excluded.raw_score),
        credited_score=MAX(event_week_scores.credited_score,excluded.credited_score),
        credit_source='leaderboard',
        leaderboard_position=CASE WHEN excluded.raw_score>=COALESCE(event_week_scores.raw_score,-1) THEN excluded.leaderboard_position ELSE event_week_scores.leaderboard_position END,
        source_command=excluded.source_command,
        captured_at=CASE WHEN excluded.captured_at>event_week_scores.captured_at THEN excluded.captured_at ELSE event_week_scores.captured_at END,
        source_hash=CASE WHEN excluded.raw_score>=COALESCE(event_week_scores.raw_score,-1) THEN excluded.source_hash ELSE event_week_scores.source_hash END,
        metadata_json=CASE WHEN excluded.raw_score>=COALESCE(event_week_scores.raw_score,-1) THEN excluded.metadata_json ELSE event_week_scores.metadata_json END
    `).bind(cycleId, cycleWeek, uid, score, score, position, String(snapshot.command || 'alliance.declare.war.personal.rank'), captured, sourceHash, metadata));

    statements.push(env.DB.prepare(`
      INSERT INTO event_scores(event_type,event_id,uid,score,captured_at,source_hash,metadata_json)
      VALUES('glory_war',?,?,?,?,?,?)
      ON CONFLICT(event_type,event_id,uid) DO UPDATE SET
        score=MAX(event_scores.score,excluded.score),
        captured_at=CASE WHEN excluded.captured_at>event_scores.captured_at THEN excluded.captured_at ELSE event_scores.captured_at END,
        source_hash=CASE WHEN excluded.score>=event_scores.score THEN excluded.source_hash ELSE event_scores.source_hash END,
        metadata_json=CASE WHEN excluded.score>=event_scores.score THEN excluded.metadata_json ELSE event_scores.metadata_json END
    `).bind(eventId, uid, score, captured, sourceHash, metadata));
  }

  if (statements.length) await runBatches(env.DB, statements, 60);

  const resultText = String(context.result || '').toUpperCase();
  const isWin = resultText === 'WIN' ? 1 : resultText === 'LOSS' ? 0 : null;
  await env.DB.prepare(`
    INSERT INTO glory_war_matches(
      cycle_id,cycle_week,captured_at,source_hash,
      primary_alliance_id,primary_alliance_abbr,primary_alliance_name,primary_server_id,
      opponent_alliance_id,opponent_alliance_abbr,opponent_alliance_name,opponent_server_id,
      primary_state_score,opponent_state_score,primary_alliance_score,opponent_alliance_score,
      is_win,result,player_count,source_command,metadata_json
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(cycle_id,cycle_week) DO UPDATE SET
      captured_at=CASE WHEN excluded.captured_at>=glory_war_matches.captured_at THEN excluded.captured_at ELSE glory_war_matches.captured_at END,
      source_hash=CASE WHEN excluded.captured_at>=glory_war_matches.captured_at THEN excluded.source_hash ELSE glory_war_matches.source_hash END,
      primary_alliance_id=CASE WHEN excluded.captured_at>=glory_war_matches.captured_at THEN excluded.primary_alliance_id ELSE glory_war_matches.primary_alliance_id END,
      primary_alliance_abbr=CASE WHEN excluded.captured_at>=glory_war_matches.captured_at THEN excluded.primary_alliance_abbr ELSE glory_war_matches.primary_alliance_abbr END,
      primary_alliance_name=CASE WHEN excluded.captured_at>=glory_war_matches.captured_at THEN excluded.primary_alliance_name ELSE glory_war_matches.primary_alliance_name END,
      primary_server_id=CASE WHEN excluded.captured_at>=glory_war_matches.captured_at THEN excluded.primary_server_id ELSE glory_war_matches.primary_server_id END,
      opponent_alliance_id=CASE WHEN excluded.captured_at>=glory_war_matches.captured_at THEN excluded.opponent_alliance_id ELSE glory_war_matches.opponent_alliance_id END,
      opponent_alliance_abbr=CASE WHEN excluded.captured_at>=glory_war_matches.captured_at THEN excluded.opponent_alliance_abbr ELSE glory_war_matches.opponent_alliance_abbr END,
      opponent_alliance_name=CASE WHEN excluded.captured_at>=glory_war_matches.captured_at THEN excluded.opponent_alliance_name ELSE glory_war_matches.opponent_alliance_name END,
      opponent_server_id=CASE WHEN excluded.captured_at>=glory_war_matches.captured_at THEN excluded.opponent_server_id ELSE glory_war_matches.opponent_server_id END,
      primary_state_score=CASE WHEN excluded.captured_at>=glory_war_matches.captured_at THEN excluded.primary_state_score ELSE glory_war_matches.primary_state_score END,
      opponent_state_score=CASE WHEN excluded.captured_at>=glory_war_matches.captured_at THEN excluded.opponent_state_score ELSE glory_war_matches.opponent_state_score END,
      primary_alliance_score=CASE WHEN excluded.captured_at>=glory_war_matches.captured_at THEN excluded.primary_alliance_score ELSE glory_war_matches.primary_alliance_score END,
      opponent_alliance_score=CASE WHEN excluded.captured_at>=glory_war_matches.captured_at THEN excluded.opponent_alliance_score ELSE glory_war_matches.opponent_alliance_score END,
      is_win=CASE WHEN excluded.captured_at>=glory_war_matches.captured_at THEN excluded.is_win ELSE glory_war_matches.is_win END,
      result=CASE WHEN excluded.captured_at>=glory_war_matches.captured_at THEN excluded.result ELSE glory_war_matches.result END,
      player_count=CASE WHEN excluded.captured_at>=glory_war_matches.captured_at THEN excluded.player_count ELSE glory_war_matches.player_count END,
      source_command=CASE WHEN excluded.captured_at>=glory_war_matches.captured_at THEN excluded.source_command ELSE glory_war_matches.source_command END,
      metadata_json=CASE WHEN excluded.captured_at>=glory_war_matches.captured_at THEN excluded.metadata_json ELSE glory_war_matches.metadata_json END
  `).bind(
    cycleId, cycleWeek, captured, sourceHash,
    String(context.primaryAllianceId || ''), String(context.primaryAllianceAbbr || PRIMARY_ALLIANCE), String(context.primaryAllianceName || ''), numberOrNull(context.primaryServerId),
    String(context.opponentAllianceId || ''), String(context.opponentAllianceAbbr || ''), String(context.opponentAllianceName || ''), numberOrNull(context.opponentServerId),
    Number(context.primaryStateScore || 0), Number(context.opponentStateScore || 0), Number(context.primaryAllianceScore || 0), Number(context.opponentAllianceScore || 0),
    isWin, resultText, rows.length, String(snapshot.command || 'alliance.declare.war.personal.rank'),
    JSON.stringify({ opponentPlayerRowsStored: false, battleScope: String(context.battleScope || '') })
  ).run();
}

async function handleGloryWar(url, env) {
  const matchesResult = await env.DB.prepare(`
    SELECT cycle_id,cycle_week,captured_at,primary_alliance_abbr,primary_alliance_name,primary_server_id,
           opponent_alliance_abbr,opponent_alliance_name,opponent_server_id,
           primary_state_score,opponent_state_score,primary_alliance_score,opponent_alliance_score,
           is_win,result,player_count
    FROM glory_war_matches
    ORDER BY captured_at DESC
  `).all();
  const matches = (matchesResult.results || []).map(publicMatch);
  if (!matches.length) return json({ ok: true, matches: [], selected: null, players: [], summary: { status: 'empty' } });

  const requestedCycle = String(url.searchParams.get('cycle') || '').trim();
  const requestedWeek = Number(url.searchParams.get('week') || 0);
  const selected = matches.find(row => row.cycleId === requestedCycle && row.cycleWeek === requestedWeek) || matches[0];

  const scores = await env.DB.prepare(`
    SELECT p.public_id,p.current_name,p.alliance_abbr,p.server_id,s.raw_score,s.credited_score,s.leaderboard_position,s.captured_at
    FROM event_week_scores s
    JOIN players p ON p.uid=s.uid
    WHERE s.event_type='glory_war' AND s.cycle_id=? AND s.cycle_week=?
    ORDER BY s.credited_score DESC,p.current_name
  `).bind(selected.cycleId, selected.cycleWeek).all();

  const players = (scores.results || []).map((row, index) => ({
    rank: index + 1,
    publicId: String(row.public_id || ''),
    name: String(row.current_name || ''),
    allianceAbbr: String(row.alliance_abbr || ''),
    serverId: Number(row.server_id || 0),
    score: Number(row.credited_score || row.raw_score || 0),
    capturedAt: String(row.captured_at || '')
  }));

  return json({
    ok: true,
    matches,
    selected,
    players,
    summary: {
      status: 'complete',
      participants: players.length,
      allianceScore: selected.primaryAllianceScore,
      stateScore: selected.primaryStateScore,
      opponentStateScore: selected.opponentStateScore,
      opponentPlayerScoresStored: false
    }
  });
}

function publicMatch(row) {
  return {
    cycleId: String(row.cycle_id || ''),
    cycleWeek: Number(row.cycle_week || 0),
    capturedAt: String(row.captured_at || ''),
    primaryAllianceAbbr: String(row.primary_alliance_abbr || PRIMARY_ALLIANCE),
    primaryAllianceName: String(row.primary_alliance_name || ''),
    primaryServerId: Number(row.primary_server_id || 0),
    opponentAllianceAbbr: String(row.opponent_alliance_abbr || ''),
    opponentAllianceName: String(row.opponent_alliance_name || ''),
    opponentServerId: Number(row.opponent_server_id || 0),
    primaryStateScore: Number(row.primary_state_score || 0),
    opponentStateScore: Number(row.opponent_state_score || 0),
    primaryAllianceScore: Number(row.primary_alliance_score || 0),
    opponentAllianceScore: Number(row.opponent_alliance_score || 0),
    isWin: row.is_win == null ? null : Number(row.is_win) === 1,
    result: String(row.result || ''),
    playerCount: Number(row.player_count || 0)
  };
}

function capturedAt(snapshot) {
  return String(snapshot?.captured_at || snapshot?.capturedAt || new Date().toISOString());
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) && number !== 0 ? number : null;
}

async function runBatches(db, statements, size) {
  for (let index = 0; index < statements.length; index += size) {
    await db.batch(statements.slice(index, index + size));
  }
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}
