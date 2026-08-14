import portal from './scoring-entry-v135.js';

const EVENT_TYPES = new Set(['alliance_duel', 'state_ruler', 'glory_war']);
const GLOBAL_KEYS = {
  alliance_duel: 'bye_week_multiplier_alliance_duel',
  state_ruler: 'bye_week_multiplier_state_ruler',
  glory_war: 'bye_week_multiplier_glory_war',
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/admin/bye-weights' && request.method === 'GET') {
      const gate = await requireAdminViaPortal(request, env, ctx);
      if (gate) return gate;
      return json({ ok: true, weights: await globalByeWeights(env) });
    }

    if (url.pathname === '/api/admin/bye-weights' && request.method === 'POST') {
      const gate = await requireAdminViaPortal(request, env, ctx);
      if (gate) return gate;
      return updateGlobalByeWeights(request, env);
    }

    if (url.pathname === '/api/admin/event-week-policy' && request.method === 'POST') {
      const gate = await requireAdminViaPortal(request, env, ctx);
      if (gate) return gate;
      return updateEventWeekPolicy(request, env);
    }

    if (url.pathname === '/api/event-week-policy' && request.method === 'GET') {
      const response = await portal.fetch(request, env, ctx);
      if (!response.ok) return response;
      return augmentPolicyResponse(response, env);
    }

    if (url.pathname === '/api/admin/scoring-context' && request.method === 'GET') {
      const response = await portal.fetch(request, env, ctx);
      if (!response.ok) return response;
      return augmentAdminContext(response, env);
    }

    return portal.fetch(request, env, ctx);
  }
};

async function requireAdminViaPortal(request, env, ctx) {
  const url = new URL(request.url);
  url.pathname = '/api/admin/scoring-context';
  url.search = '';
  const response = await portal.fetch(new Request(url.toString(), {
    method: 'GET',
    headers: request.headers,
  }), env, ctx);
  if (!response.ok) return response;
  return null;
}

async function updateGlobalByeWeights(request, env) {
  const body = await request.json();
  const incoming = body?.weights && typeof body.weights === 'object' ? body.weights : {};
  const now = new Date().toISOString();
  const statements = [];
  const normalized = {};

  for (const eventType of EVENT_TYPES) {
    let value = Number(incoming[eventType]);
    if (!Number.isFinite(value)) continue;
    value = Math.max(0, Math.min(2, value));
    normalized[eventType] = value;
    const key = GLOBAL_KEYS[eventType];
    statements.push(env.DB.prepare(`
      INSERT INTO scoring_settings(setting_key,numeric_value,text_value,updated_at)
      VALUES(?,?,?,?)
      ON CONFLICT(setting_key) DO UPDATE SET
        numeric_value=excluded.numeric_value,
        text_value=excluded.text_value,
        updated_at=excluded.updated_at
    `).bind(key, value, `Default ${eventLabel(eventType)} Bye-week weight`, now));
    statements.push(env.DB.prepare(`
      UPDATE event_week_policy
      SET weight_multiplier=?,updated_at=?
      WHERE event_type=? AND is_bye=1 AND use_default_bye_weight=1
    `).bind(value, now, eventType));
  }

  if (statements.length) await env.DB.batch(statements);
  return json({ ok: true, weights: await globalByeWeights(env), updated: normalized });
}

async function updateEventWeekPolicy(request, env) {
  const body = await request.json();
  const eventType = String(body?.eventType || '').trim();
  const cycleId = String(body?.cycleId || '').trim().slice(0, 120);
  const cycleWeek = Number(body?.cycleWeek || 0);
  const isBye = Boolean(body?.isBye);
  const useDefault = isBye && Boolean(body?.useDefaultByeWeight);
  const note = String(body?.note || '').trim().slice(0, 300);

  if (!EVENT_TYPES.has(eventType) || !cycleId || cycleWeek < 1 || cycleWeek > 4) {
    return json({ ok: false, error: 'Choose a valid event, cycle and week.' }, 400);
  }

  const defaults = await globalByeWeights(env);
  let multiplier = isBye && useDefault ? Number(defaults[eventType] ?? 0.35) : Number(body?.weightMultiplier);
  if (!Number.isFinite(multiplier)) multiplier = isBye ? Number(defaults[eventType] ?? 0.35) : 1;
  multiplier = Math.max(0, Math.min(2, multiplier));
  if (!isBye) multiplier = 1;

  const now = new Date().toISOString();
  await env.DB.prepare(`
    INSERT INTO event_week_policy(
      event_type,cycle_id,cycle_week,is_bye,weight_multiplier,note,updated_at,updated_by_uid,use_default_bye_weight
    ) VALUES(?,?,?,?,?,?,?,NULL,?)
    ON CONFLICT(event_type,cycle_id,cycle_week) DO UPDATE SET
      is_bye=excluded.is_bye,
      weight_multiplier=excluded.weight_multiplier,
      note=excluded.note,
      updated_at=excluded.updated_at,
      updated_by_uid=NULL,
      use_default_bye_weight=excluded.use_default_bye_weight
  `).bind(eventType, cycleId, cycleWeek, isBye ? 1 : 0, multiplier, note, now, useDefault ? 1 : 0).run();

  const row = await env.DB.prepare(`
    SELECT event_type,cycle_id,cycle_week,is_bye,weight_multiplier,note,updated_at,use_default_bye_weight
    FROM event_week_policy WHERE event_type=? AND cycle_id=? AND cycle_week=?
  `).bind(eventType, cycleId, cycleWeek).first();

  return json({ ok: true, policy: policyJson(row, defaults) });
}

async function augmentPolicyResponse(response, env) {
  const body = await response.json();
  const defaults = await globalByeWeights(env);
  const cycleId = String(body?.cycleId || '');
  const flags = cycleId ? await policyFlags(env, cycleId) : new Map();
  body.globalByeWeights = defaults;
  body.policies = (body.policies || []).map(row => {
    const useDefault = flags.get(policyKey(row.eventType, row.cycleWeek)) === 1;
    return {
      ...row,
      useDefaultByeWeight: useDefault,
      globalByeWeight: Number(defaults[row.eventType] ?? 0.35),
    };
  });
  return json(body, response.status);
}

async function augmentAdminContext(response, env) {
  const body = await response.json();
  const defaults = await globalByeWeights(env);
  const cycleId = String(body?.cycleId || '');
  const flags = cycleId ? await policyFlags(env, cycleId) : new Map();
  body.globalByeWeights = defaults;
  body.policies = (body.policies || []).map(row => ({
    ...row,
    useDefaultByeWeight: flags.get(policyKey(row.eventType, row.cycleWeek)) === 1,
    globalByeWeight: Number(defaults[row.eventType] ?? 0.35),
  }));
  return json(body, response.status);
}

async function policyFlags(env, cycleId) {
  const result = await env.DB.prepare(`
    SELECT event_type,cycle_week,use_default_bye_weight
    FROM event_week_policy WHERE cycle_id=?
  `).bind(cycleId).all();
  return new Map((result.results || []).map(row => [policyKey(row.event_type, row.cycle_week), Number(row.use_default_bye_weight || 0)]));
}

async function globalByeWeights(env) {
  const result = await env.DB.prepare(`
    SELECT setting_key,numeric_value FROM scoring_settings
    WHERE setting_key IN (?,?,?)
  `).bind(GLOBAL_KEYS.alliance_duel, GLOBAL_KEYS.state_ruler, GLOBAL_KEYS.glory_war).all();
  const byKey = new Map((result.results || []).map(row => [String(row.setting_key), Number(row.numeric_value)]));
  return {
    alliance_duel: finiteOr(byKey.get(GLOBAL_KEYS.alliance_duel), 0.35),
    state_ruler: finiteOr(byKey.get(GLOBAL_KEYS.state_ruler), 0.35),
    glory_war: finiteOr(byKey.get(GLOBAL_KEYS.glory_war), 0.35),
  };
}

function policyJson(row, defaults) {
  const eventType = String(row?.event_type || '');
  return {
    eventType,
    cycleId: String(row?.cycle_id || ''),
    cycleWeek: Number(row?.cycle_week || 0),
    isBye: Number(row?.is_bye || 0) === 1,
    weightMultiplier: Number(row?.weight_multiplier ?? 1),
    useDefaultByeWeight: Number(row?.use_default_bye_weight || 0) === 1,
    globalByeWeight: Number(defaults[eventType] ?? 0.35),
    note: String(row?.note || ''),
    updatedAt: String(row?.updated_at || ''),
  };
}

function policyKey(eventType, week) { return `${String(eventType)}|${Number(week)}`; }
function eventLabel(type) {
  return type === 'alliance_duel' ? 'Alliance Duel' : type === 'state_ruler' ? 'State Ruler' : 'Glory War';
}
function finiteOr(value, fallback) { return Number.isFinite(Number(value)) ? Number(value) : fallback; }
function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}
