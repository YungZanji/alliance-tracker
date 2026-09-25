import portal from './scoring-entry-v157.js';

const MAX_PLAN_BYTES = 1_900_000;
const PLAN_META_SCHEMA = 'glory-war-plan/1';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/glory-war-plan' && request.method === 'GET') {
      return handlePlanMeta(request, env, ctx);
    }
    if (url.pathname === '/api/glory-war-plan/view' && request.method === 'GET') {
      return handlePlanView(request, env, ctx);
    }
    if (url.pathname === '/api/admin/glory-war-plan' && request.method === 'POST') {
      return handlePlanUpload(request, env, ctx);
    }
    if (url.pathname === '/api/admin/glory-war-plan/activate' && request.method === 'POST') {
      return handlePlanActivate(request, env, ctx);
    }

    return portal.fetch(request, env, ctx);
  },

  async scheduled(controller, env, ctx) {
    if (typeof portal.scheduled === 'function') return portal.scheduled(controller, env, ctx);
  }
};

async function handlePlanMeta(request, env, ctx) {
  const auth = await authenticatedPlayer(request, env, ctx);
  if (auth.response) return auth.response;
  const active = await activePlan(env);
  return json(await planMetaPayload(active, auth.user, env));
}

async function handlePlanView(request, env, ctx) {
  const auth = await authenticatedPlayer(request, env, ctx);
  if (auth.response) return auth.response;
  const active = await env.DB.prepare(`
    SELECT plan_id,title,state_id,source_filename,plan_updated_at,metadata_json,plan_html
    FROM glory_war_plans
    WHERE is_active=1
    ORDER BY uploaded_at DESC
    LIMIT 1
  `).first();
  if (!active) return htmlResponse(emptyPlanDocument(), 404);

  const meta = parseJson(active.metadata_json, {});
  const viewer = viewerStatus(meta, auth.user);
  const document = injectViewer(String(active.plan_html || ''), {
    uid: auth.user.uid,
    name: auth.user.name,
    status: viewer.status,
    message: viewer.message
  });

  return htmlResponse(document, 200);
}

async function handlePlanUpload(request, env, ctx) {
  const auth = await authenticatedPlayer(request, env, ctx);
  if (auth.response) return auth.response;
  if (!auth.user.isAdmin) return json({ ok: false, error: 'Administrator access required.' }, 403);

  const planHtml = await request.text();
  const byteSize = new TextEncoder().encode(planHtml).byteLength;
  if (!planHtml.trim()) return json({ ok: false, error: 'Choose a Glory War HTML plan to upload.' }, 400);
  if (byteSize > MAX_PLAN_BYTES) {
    return json({ ok: false, error: `Plan is too large. Maximum supported upload is ${MAX_PLAN_BYTES.toLocaleString()} bytes.` }, 413);
  }

  let metadata;
  try {
    metadata = extractPlanMetadata(planHtml);
  } catch (error) {
    return json({ ok: false, error: String(error?.message || error) }, 400);
  }

  const contentHash = await sha256(planHtml);
  const existing = await env.DB.prepare(`
    SELECT plan_id FROM glory_war_plans WHERE content_hash=? LIMIT 1
  `).bind(contentHash).first();

  const now = new Date().toISOString();
  let planId = String(existing?.plan_id || '');
  const filename = safeFilename(request.headers.get('x-plan-filename')) || `glory-war-state-${metadata.state || 'unknown'}.html`;

  if (planId) {
    await env.DB.batch([
      env.DB.prepare('UPDATE glory_war_plans SET is_active=0 WHERE is_active=1'),
      env.DB.prepare(`
        UPDATE glory_war_plans
        SET is_active=1,activated_at=?,source_filename=?,uploaded_by_uid=?,uploaded_by_name=?
        WHERE plan_id=?
      `).bind(now, filename, auth.user.uid, auth.user.name, planId)
    ]);
  } else {
    planId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare('UPDATE glory_war_plans SET is_active=0 WHERE is_active=1'),
      env.DB.prepare(`
        INSERT INTO glory_war_plans(
          plan_id,title,state_id,alliance_abbr,plan_updated_at,source_filename,content_hash,
          byte_size,metadata_json,plan_html,uploaded_by_uid,uploaded_by_name,uploaded_at,activated_at,is_active
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)
      `).bind(
        planId,
        metadata.title,
        metadata.state || null,
        metadata.allianceAbbr,
        metadata.planUpdatedAt,
        filename,
        contentHash,
        byteSize,
        JSON.stringify(metadata),
        planHtml,
        auth.user.uid,
        auth.user.name,
        now,
        now
      )
    ]);
  }

  const active = await activePlan(env);
  return json(await planMetaPayload(active, auth.user, env));
}

async function handlePlanActivate(request, env, ctx) {
  const auth = await authenticatedPlayer(request, env, ctx);
  if (auth.response) return auth.response;
  if (!auth.user.isAdmin) return json({ ok: false, error: 'Administrator access required.' }, 403);

  let body = {};
  try { body = await request.json(); } catch (_) {}
  const planId = String(body?.planId || '').trim();
  if (!planId) return json({ ok: false, error: 'Plan ID is required.' }, 400);
  const exists = await env.DB.prepare('SELECT plan_id FROM glory_war_plans WHERE plan_id=?').bind(planId).first();
  if (!exists) return json({ ok: false, error: 'That Glory War plan no longer exists.' }, 404);

  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare('UPDATE glory_war_plans SET is_active=0 WHERE is_active=1'),
    env.DB.prepare('UPDATE glory_war_plans SET is_active=1,activated_at=? WHERE plan_id=?').bind(now, planId)
  ]);
  const active = await activePlan(env);
  return json(await planMetaPayload(active, auth.user, env));
}

async function authenticatedPlayer(request, env, ctx) {
  const authUrl = new URL(request.url);
  authUrl.pathname = '/api/auth/me';
  authUrl.search = '';
  const authHeaders = new Headers();
  const cookie = request.headers.get('cookie');
  if (cookie) authHeaders.set('cookie', cookie);
  const agent = request.headers.get('user-agent');
  if (agent) authHeaders.set('user-agent', agent);

  const authResponse = await portal.fetch(new Request(authUrl.toString(), {
    method: 'GET',
    headers: authHeaders
  }), env, ctx);

  if (!authResponse.ok) {
    return { response: json({ ok: false, error: 'Authentication required.' }, authResponse.status === 401 ? 401 : 403) };
  }

  let payload = {};
  try { payload = await authResponse.json(); } catch (_) {}
  const publicUser = payload?.user || null;
  if (!publicUser || publicUser.isGuest) {
    return { response: json({ ok: false, error: 'Alliance member access is required for Glory War plans.' }, 403) };
  }

  const publicId = String(publicUser.publicId || '').trim();
  if (!publicId) return { response: json({ ok: false, error: 'Player identity is unavailable.' }, 403) };
  const player = await env.DB.prepare(`
    SELECT uid,public_id,current_name,is_admin FROM players WHERE public_id=? LIMIT 1
  `).bind(publicId).first();
  if (!player) return { response: json({ ok: false, error: 'Player identity is unavailable.' }, 403) };

  return {
    user: {
      uid: String(player.uid || ''),
      publicId,
      name: String(player.current_name || publicUser.name || ''),
      isAdmin: Number(player.is_admin || 0) === 1 || Boolean(publicUser.isAdmin)
    }
  };
}

async function activePlan(env) {
  return env.DB.prepare(`
    SELECT plan_id,title,state_id,alliance_abbr,plan_updated_at,source_filename,content_hash,
           byte_size,metadata_json,uploaded_by_name,uploaded_at,activated_at,is_active
    FROM glory_war_plans
    WHERE is_active=1
    ORDER BY uploaded_at DESC
    LIMIT 1
  `).first();
}

async function planMetaPayload(active, user, env) {
  const canManage = Boolean(user?.isAdmin);
  let history = [];
  if (canManage) {
    const rows = await env.DB.prepare(`
      SELECT plan_id,title,state_id,alliance_abbr,plan_updated_at,source_filename,byte_size,
             uploaded_by_name,uploaded_at,activated_at,is_active
      FROM glory_war_plans
      ORDER BY uploaded_at DESC
      LIMIT 12
    `).all();
    history = (rows.results || []).map(publicPlan);
  }

  if (!active) {
    return {
      ok: true,
      active: null,
      viewer: {
        name: String(user?.name || ''),
        status: 'no_plan',
        message: 'No Glory War battle plan has been uploaded yet.'
      },
      canManage,
      history
    };
  }

  const metadata = parseJson(active.metadata_json, {});
  return {
    ok: true,
    active: {
      ...publicPlan(active),
      rosterCount: Number(metadata.rosterCount || 0),
      placementCount: Number(metadata.placementCount || 0)
    },
    viewer: viewerStatus(metadata, user),
    canManage,
    history
  };
}

function publicPlan(row) {
  return {
    planId: String(row?.plan_id || ''),
    title: String(row?.title || 'Glory War battle plan'),
    state: row?.state_id == null ? null : Number(row.state_id),
    allianceAbbr: String(row?.alliance_abbr || ''),
    planUpdatedAt: String(row?.plan_updated_at || ''),
    filename: String(row?.source_filename || ''),
    byteSize: Number(row?.byte_size || 0),
    uploadedBy: String(row?.uploaded_by_name || ''),
    uploadedAt: String(row?.uploaded_at || ''),
    activatedAt: String(row?.activated_at || ''),
    isActive: Number(row?.is_active || 0) === 1
  };
}

function viewerStatus(metadata, user) {
  const uid = String(user?.uid || '');
  const name = normalizeName(user?.name || '');
  const placements = Array.isArray(metadata?.placements) ? metadata.placements : [];
  const roster = Array.isArray(metadata?.roster) ? metadata.roster : [];
  const placement = placements.find(row => (uid && String(row.uid || '') === uid) || normalizeName(row.name) === name);
  if (placement) {
    return {
      name: String(user?.name || placement.name || ''),
      status: 'assigned',
      message: `Position assigned at X ${Number(placement.x)} · Y ${Number(placement.y)}.`,
      placement: {
        name: String(placement.name || user?.name || ''),
        x: Number(placement.x),
        y: Number(placement.y),
        group: Number(placement.group || 0),
        role: String(placement.role || '')
      }
    };
  }

  const rosterRow = roster.find(row => (uid && String(row.uid || '') === uid) || normalizeName(row.name) === name);
  return {
    name: String(user?.name || rosterRow?.name || ''),
    status: 'attendance_unknown',
    message: rosterRow
      ? 'Attendance unknown — you are in this week’s roster but do not have a position in the current plan.'
      : 'Attendance unknown — you are not included in this week’s uploaded plan.'
  };
}

function extractPlanMetadata(html) {
  if (!/<canvas[^>]+id=["']stage["']/i.test(html)) throw new Error('This file does not look like a Glory War command-map HTML export.');
  if (!/id=["']memberLookup["']/i.test(html) || !/id=["']jumpMember["']/i.test(html)) {
    throw new Error('This Glory War file is missing the member lookup / Jump to my position controls.');
  }
  const match = html.match(/const\s+DATA\s*=\s*(\{[\s\S]*\})\s*,\s*P\s*=\s*DATA\.plan\s*,/);
  if (!match) throw new Error('Could not read the embedded Glory War plan data from this HTML file.');

  let data;
  try { data = JSON.parse(match[1]); } catch (_) { throw new Error('The embedded Glory War plan data is not valid JSON.'); }
  const plan = data?.plan || {};
  const rosterObject = plan.roster && typeof plan.roster === 'object' ? plan.roster : {};
  const placementObject = plan.placements && typeof plan.placements === 'object' ? plan.placements : {};

  const roster = Object.entries(rosterObject).map(([name, member]) => ({
    uid: String(member?.uid || ''),
    name: String(name || ''),
    vote: String(member?.vote || ''),
    attending: member?.attending === true ? true : member?.attending === false ? false : null,
    team: Number(member?.team || 0)
  }));

  const placements = Object.entries(placementObject).map(([name, placement]) => ({
    uid: String(placement?.uid || rosterObject?.[name]?.uid || ''),
    name: String(name || ''),
    x: Number(placement?.x),
    y: Number(placement?.y),
    group: Number(placement?.group || 0),
    role: String(placement?.role || '')
  })).filter(row => Number.isFinite(row.x) && Number.isFinite(row.y));

  return {
    schema: PLAN_META_SCHEMA,
    state: Number.isFinite(Number(plan.state)) ? Number(plan.state) : null,
    title: String(plan.title || 'Glory War battle plan'),
    allianceAbbr: String(plan.our_tag || ''),
    planUpdatedAt: String(plan.updated || plan.created || ''),
    rosterCount: roster.length,
    placementCount: placements.length,
    roster,
    placements
  };
}

function injectViewer(html, viewer) {
  const safeViewer = scriptJson(viewer);
  const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; font-src data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">`;
  const bootstrap = `<script>
(() => {
  const viewer = ${safeViewer};
  let initialized = false;
  function setStatus(kind, message) {
    const top = document.getElementById('top');
    if (top && !document.getElementById('viewerPlanStatus')) {
      const live = top.querySelector('.live');
      if (live) live.style.marginLeft = '0';
      const badge = document.createElement('div');
      badge.id = 'viewerPlanStatus';
      badge.style.cssText = 'margin-left:auto;max-width:330px;padding:7px 10px;border-radius:10px;border:1px solid #ffffff18;background:#08111dcc;font-size:11px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;pointer-events:none;';
      if (live) top.insertBefore(badge, live); else top.appendChild(badge);
    }
    const badge = document.getElementById('viewerPlanStatus');
    if (badge) {
      badge.textContent = kind === 'assigned' ? 'YOUR POSITION · ' + message : 'ATTENDANCE UNKNOWN';
      badge.style.color = kind === 'assigned' ? '#62e6a6' : '#ffbd59';
    }
  }
  function showUnknown() {
    setStatus('attendance_unknown', viewer.message || '');
    const d = document.getElementById('details');
    if (d) {
      const coord = document.getElementById('dcoord');
      const title = document.getElementById('dtitle');
      const body = document.getElementById('dbody');
      if (coord) coord.textContent = 'YOUR GLORY WAR STATUS';
      if (title) title.textContent = 'Attendance unknown';
      if (body) body.textContent = viewer.message || 'You do not have a position in this week’s plan.';
      d.style.display = 'block';
    }
  }
  function initViewer() {
    if (initialized) return;
    const input = document.getElementById('memberLookup');
    const button = document.getElementById('jumpMember');
    if (!input || !button) return;
    initialized = true;
    input.value = viewer.name || '';
    input.readOnly = true;
    input.title = 'Filled from your Alliance Tracker login';
    const doJump = () => {
      const jump = typeof jumpToMember === 'function' ? jumpToMember : window.jumpToMember;
      if (viewer.status === 'assigned' && typeof jump === 'function' && jump(viewer.uid)) {
        setStatus('assigned', viewer.message || 'Position assigned');
        return true;
      }
      showUnknown();
      return false;
    };
    button.onclick = doJump;
    if (viewer.status !== 'assigned') {
      button.textContent = 'Attendance unknown';
    }
    setTimeout(doJump, 20);
  }
  addEventListener('load', () => setTimeout(initViewer, 0), { once: true });
  setTimeout(() => { if (document.readyState === 'complete') initViewer(); }, 180);
})();
</script>`;

  let output = String(html || '');
  if (/<head[^>]*>/i.test(output)) output = output.replace(/<head[^>]*>/i, match => `${match}${csp}`);
  else output = csp + output;
  if (/<\/body>/i.test(output)) output = output.replace(/<\/body>/i, `${bootstrap}</body>`);
  else output += bootstrap;
  return output;
}

function emptyPlanDocument() {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{height:100%;margin:0;background:#07101d;color:#f3f7ff;font:15px/1.5 system-ui}body{display:grid;place-items:center}.box{max-width:520px;padding:28px;border:1px solid #ffffff18;border-radius:18px;background:#0e1724}</style></head><body><div class="box"><h1>No active Glory War plan</h1><p>An administrator has not uploaded this week’s plan yet.</p></div></body></html>`;
}

function safeFilename(value) {
  if (!value) return '';
  let decoded = String(value);
  try { decoded = decodeURIComponent(decoded); } catch (_) {}
  return decoded.replace(/[^\w.\- ()]/g, '_').slice(0, 160);
}

function normalizeName(value) {
  return String(value || '').trim().toLocaleLowerCase();
}

function parseJson(value, fallback) {
  try { return JSON.parse(String(value || '')); } catch (_) { return fallback; }
}

function scriptJson(value) {
  return JSON.stringify(value)
    .replaceAll('<', '\\u003c')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029');
}

async function sha256(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value || '')));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function htmlResponse(value, status = 200) {
  return new Response(value, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'private, no-store, max-age=0',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; font-src data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'"
    }
  });
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}
