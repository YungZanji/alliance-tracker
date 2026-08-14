import portal from './scoring-entry-v133.js';

const PRIMARY_STATE = 305;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/state-ruler' && request.method === 'GET') {
      const response = await portal.fetch(request, env, ctx);
      if (!response.ok) return response;
      try {
        const body = await response.json();
        const cycleId = String(body?.cycleId || '').trim();
        const cycleWeek = Number(body?.cycleWeek || 1);
        const matchup = cycleId
          ? await env.DB.prepare(`
              SELECT opponent_state,opponent_label,source,updated_at
              FROM event_week_context
              WHERE event_type='state_ruler' AND cycle_id=? AND cycle_week=?
            `).bind(cycleId, cycleWeek).first()
          : null;
        const currentLeader = Array.isArray(body?.players) && body.players.length
          ? { publicId: body.players[0].publicId, name: body.players[0].name, score: Number(body.players[0].creditedScore || 0) }
          : null;
        body.matchup = {
          homeState: PRIMARY_STATE,
          opponentState: matchup?.opponent_state == null ? null : Number(matchup.opponent_state),
          opponentLabel: String(matchup?.opponent_label || ''),
          source: String(matchup?.source || ''),
          updatedAt: String(matchup?.updated_at || ''),
        };
        body.currentLeader = currentLeader;
        return json(body, response.status);
      } catch (_) {
        return response;
      }
    }

    if (url.pathname === '/api/admin/event-overview' && request.method === 'GET') {
      const gate = await requireAdminViaPortal(request, env, ctx);
      if (gate) return gate;
      return handleAdminEventOverview(url, env);
    }

    if (url.pathname === '/api/admin/state-ruler-context' && request.method === 'POST') {
      const gate = await requireAdminViaPortal(request, env, ctx);
      if (gate) return gate;
      return handleStateRulerContextUpdate(request, env);
    }

    return portal.fetch(request, env, ctx);
  }
};

async function requireAdminViaPortal(request, env, ctx) {
  const url = new URL(request.url);
  url.pathname = '/api/admin/scoring-context';
  url.search = '';
  const gateRequest = new Request(url.toString(), {
    method: 'GET',
    headers: request.headers,
  });
  const response = await portal.fetch(gateRequest, env, ctx);
  if (!response.ok) return response;
  return null;
}

async function handleAdminEventOverview(url, env) {
  const requestedCycle = String(url.searchParams.get('cycle') || '').trim();
  const latest = await env.DB.prepare(`
    SELECT cycle_id,MAX(captured_at) AS latest_capture
    FROM duel_weekly GROUP BY cycle_id ORDER BY latest_capture DESC LIMIT 1
  `).first();
  const cycleId = requestedCycle || String(latest?.cycle_id || '');

  const [leaves, policies, duelMatchups, stateMatchups, cycles] = await Promise.all([
    cycleId ? env.DB.prepare(`
      SELECT l.cycle_id,l.cycle_week,l.status,l.note,l.updated_at,
             p.public_id,p.current_name,p.server_id
      FROM player_week_leave l JOIN players p ON p.uid=l.uid
      WHERE l.cycle_id=? AND l.status='away'
      ORDER BY l.cycle_week,p.current_name
    `).bind(cycleId).all() : { results: [] },
    cycleId ? env.DB.prepare(`
      SELECT event_type,cycle_id,cycle_week,is_bye,weight_multiplier,note,updated_at
      FROM event_week_policy WHERE cycle_id=?
      ORDER BY cycle_week,event_type
    `).bind(cycleId).all() : { results: [] },
    cycleId ? env.DB.prepare(`
      SELECT cycle_id,cycle_week,opponent_abbr,opponent_name,opponent_server_id,source,updated_at
      FROM duel_week_context WHERE cycle_id=? ORDER BY cycle_week
    `).bind(cycleId).all() : { results: [] },
    cycleId ? env.DB.prepare(`
      SELECT event_type,cycle_id,cycle_week,opponent_state,opponent_label,source,updated_at
      FROM event_week_context WHERE cycle_id=? AND event_type='state_ruler' ORDER BY cycle_week
    `).bind(cycleId).all() : { results: [] },
    env.DB.prepare(`
      SELECT cycle_id,MAX(captured_at) AS latest_capture
      FROM duel_weekly GROUP BY cycle_id ORDER BY latest_capture DESC
    `).all(),
  ]);

  return json({
    ok: true,
    cycleId,
    cycles: (cycles.results || []).map(row => ({ id: String(row.cycle_id || ''), latestCapture: String(row.latest_capture || '') })),
    leaves: (leaves.results || []).map(row => ({
      cycleId: String(row.cycle_id || ''),
      cycleWeek: Number(row.cycle_week || 0),
      publicId: String(row.public_id || ''),
      name: String(row.current_name || ''),
      serverId: Number(row.server_id || 0),
      status: String(row.status || ''),
      note: String(row.note || ''),
      updatedAt: String(row.updated_at || ''),
    })),
    policies: (policies.results || []).map(row => ({
      eventType: String(row.event_type || ''),
      cycleId: String(row.cycle_id || ''),
      cycleWeek: Number(row.cycle_week || 0),
      isBye: Number(row.is_bye || 0) === 1,
      weightMultiplier: Number(row.weight_multiplier ?? 1),
      note: String(row.note || ''),
      updatedAt: String(row.updated_at || ''),
    })),
    duelMatchups: (duelMatchups.results || []).map(row => ({
      cycleWeek: Number(row.cycle_week || 0),
      opponentAbbr: String(row.opponent_abbr || ''),
      opponentName: String(row.opponent_name || ''),
      opponentServerId: row.opponent_server_id == null ? null : Number(row.opponent_server_id),
      source: String(row.source || ''),
    })),
    stateRulerMatchups: (stateMatchups.results || []).map(row => ({
      cycleWeek: Number(row.cycle_week || 0),
      opponentState: row.opponent_state == null ? null : Number(row.opponent_state),
      opponentLabel: String(row.opponent_label || ''),
      source: String(row.source || ''),
    })),
  });
}

async function handleStateRulerContextUpdate(request, env) {
  const body = await request.json();
  const cycleId = String(body?.cycleId || '').trim().slice(0, 120);
  const cycleWeek = Number(body?.cycleWeek || 0);
  const opponentState = Number(body?.opponentState || 0);
  if (!cycleId || cycleWeek < 1 || cycleWeek > 4 || opponentState < 1 || opponentState > 99999) {
    return json({ ok: false, error: 'Choose a valid cycle, week and opponent state.' }, 400);
  }
  const now = new Date().toISOString();
  await env.DB.prepare(`
    INSERT INTO event_week_context(
      event_type,cycle_id,cycle_week,opponent_state,opponent_label,source,updated_at,updated_by_uid
    ) VALUES('state_ruler',?,?,?,?,'admin',?,NULL)
    ON CONFLICT(event_type,cycle_id,cycle_week) DO UPDATE SET
      opponent_state=excluded.opponent_state,
      opponent_label=excluded.opponent_label,
      source='admin',
      updated_at=excluded.updated_at
  `).bind(cycleId, cycleWeek, opponentState, `State ${opponentState}`, now).run();
  return json({ ok: true, cycleId, cycleWeek, opponentState });
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}
