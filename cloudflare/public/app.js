const app = document.getElementById('app');
const toast = document.getElementById('toast');
const root = document.documentElement;
const state = {
  user: null,
  dashboard: null,
  participation: null,
  duel: null,
  admin: null,
  logins: [],
  route: 'home',
  selectedCycle: '',
  selectedWeek: 1,
  duelMetric: 'weekly',
  duelSearch: ''
};

const icons = {
  home: '<svg viewBox="0 0 24 24"><path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10.5V20h13v-9.5"/><path d="M9.5 20v-6h5v6"/></svg>',
  leaderboard: '<svg viewBox="0 0 24 24"><path d="M5 20V10h4v10M10 20V4h4v16M15 20v-7h4v7"/><path d="M3 20h18"/></svg>',
  duel: '<svg viewBox="0 0 24 24"><path d="m8 4 8 16M16 4 8 20"/><path d="M5 7h5M14 17h5M14 7h5M5 17h5"/></svg>',
  ruler: '<svg viewBox="0 0 24 24"><path d="M4 7h16v10H4z"/><path d="M7 7v4M10 7v2M13 7v4M16 7v2"/></svg>',
  glory: '<svg viewBox="0 0 24 24"><path d="M12 3 9 8l-5 .8 3.6 3.7-.9 5.2L12 15l5.3 2.7-.9-5.2L20 8.8 15 8z"/><path d="M9 20h6"/></svg>',
  admin: '<svg viewBox="0 0 24 24"><path d="M12 3 5 6v5c0 4.8 2.8 8.2 7 10 4.2-1.8 7-5.2 7-10V6z"/><path d="M9.5 11.5 11 13l3.5-3.5"/></svg>',
  moon: '<svg viewBox="0 0 24 24"><path d="M20 15.5A8 8 0 0 1 8.5 4 8.5 8.5 0 1 0 20 15.5Z"/></svg>',
  sun: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>'
};

const fmt = value => new Intl.NumberFormat().format(Number(value || 0));
const dec = value => Number(value || 0).toFixed(1);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
const when = value => value ? new Date(value).toLocaleString() : 'Not captured';

boot();

async function boot() {
  applyTheme(localStorage.getItem('alliance-theme') || 'dark');
  try {
    const data = await api('/api/auth/me', { allow401: true });
    if (data?.user) {
      state.user = data.user;
      renderShell();
      navigate(location.hash.slice(1) || 'home', false);
    } else {
      renderLogin();
    }
  } catch (_) {
    renderLogin();
  }
  window.addEventListener('hashchange', () => state.user && navigate(location.hash.slice(1) || 'home', false));
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
    cache: 'no-store'
  });
  let data = {};
  try { data = await response.json(); } catch (_) {}
  if (response.status === 401 && !options.allow401) {
    state.user = null;
    renderLogin('Your session expired. Log in again.');
    throw new Error('Authentication required.');
  }
  if (!response.ok || data.ok === false) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

function renderLogin(message = '') {
  app.innerHTML = `
    <main class="login-page">
      <section class="login-visual">
        <div class="login-crest"><small>STATE</small><strong>305</strong></div>
        <div class="eyebrow">WDZ · ALLIANCE TRACKER</div>
        <h1>Participation that follows the player.</h1>
        <p>Alliance Duel today, with State Ruler, Glory War and the combined seasonal participation leaderboard built into the same identity system.</p>
      </section>
      <section class="login-side">
        <form class="login-card" id="login-form">
          <div class="eyebrow" style="color:var(--blue)">PLAYER ACCESS</div>
          <h2>Sign in with your UID</h2>
          <p>Open your profile in Last Z, copy your player UID, and paste it below. Your UID stays tied to your account even when your in-game name changes.</p>
          <div class="field" style="margin-top:22px">
            <label for="uid">Player UID</label>
            <input id="uid" class="input" inputmode="numeric" autocomplete="off" placeholder="Paste your Last Z UID" required>
          </div>
          <button class="btn btn-primary" style="width:100%;margin-top:14px" type="submit" id="login-button">Open Alliance Tracker</button>
          <div class="login-error ${message ? 'show' : ''}" id="login-error">${esc(message)}</div>
          <div class="login-help">Access is limited to players already present in the synchronized WDZ roster.</div>
        </form>
      </section>
    </main>`;
  document.getElementById('login-form').addEventListener('submit', login);
}

async function login(event) {
  event.preventDefault();
  const button = document.getElementById('login-button');
  const error = document.getElementById('login-error');
  button.disabled = true;
  button.textContent = 'Signing in…';
  error.classList.remove('show');
  try {
    const data = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ uid: document.getElementById('uid').value.trim() }) });
    state.user = data.user;
    renderShell();
    navigate('home');
  } catch (err) {
    error.textContent = err.message;
    error.classList.add('show');
  } finally {
    button.disabled = false;
    button.textContent = 'Open Alliance Tracker';
  }
}

function renderShell() {
  app.innerHTML = `
    <div class="shell">
      <header class="site-header">
        <nav class="nav">
          <button class="brand nav-link" data-route="home" style="padding:0;background:transparent">
            <span class="brand-mark">305</span><span class="brand-copy">WDZ Tracker<small>STATE 305</small></span>
          </button>
          <div class="nav-links">
            ${navButton('home', 'Home')}
            ${navButton('leaderboards', 'Alliance Leaderboards')}
            ${navButton('duel', 'Alliance Duel')}
            ${navButton('state-ruler', 'State Ruler')}
            ${navButton('glory-war', 'Glory War')}
            ${state.user.isAdmin ? navButton('admin', 'Admin') : ''}
          </div>
          <div class="nav-actions">
            <span class="account-pill">${esc(state.user.name)}</span>
            <button class="icon-btn" id="theme-button" aria-label="Toggle theme"></button>
            <button class="icon-btn" id="logout-button" aria-label="Log out"><svg viewBox="0 0 24 24"><path d="M10 5H5v14h5M14 8l4 4-4 4M8 12h10"/></svg></button>
          </div>
        </nav>
      </header>
      <main class="main" id="main"><div class="empty">Loading…</div></main>
      <footer class="main footer">WDZ Alliance Tracker · State 305 · Cloudflare D1</footer>
    </div>`;
  document.querySelectorAll('[data-route]').forEach(button => button.addEventListener('click', () => navigate(button.dataset.route)));
  document.getElementById('theme-button').addEventListener('click', toggleTheme);
  document.getElementById('logout-button').addEventListener('click', logout);
  refreshThemeIcon();
}

function navButton(route, label) {
  return `<button class="nav-link" data-route="${route}">${esc(label)}</button>`;
}

function navigate(route, push = true) {
  const allowed = ['home', 'leaderboards', 'duel', 'state-ruler', 'glory-war', 'admin'];
  if (!allowed.includes(route) || (route === 'admin' && !state.user?.isAdmin)) route = 'home';
  state.route = route;
  if (push && location.hash !== `#${route}`) history.pushState(null, '', `#${route}`);
  document.querySelectorAll('.nav-link[data-route]').forEach(button => button.classList.toggle('active', button.dataset.route === route));
  const main = document.getElementById('main');
  main.innerHTML = '<div class="empty">Loading…</div>';
  if (route === 'home') return renderHome();
  if (route === 'leaderboards') return renderParticipation();
  if (route === 'duel') return renderDuelPage();
  if (route === 'state-ruler') return renderComing('State Ruler', 'State versus State participation', 'ruler');
  if (route === 'glory-war') return renderComing('Glory War', 'Glory War participation', 'glory');
  if (route === 'admin') return renderAdmin();
}

async function ensureDashboard() {
  if (!state.dashboard) state.dashboard = await api('/api/dashboard');
  if (!state.selectedCycle) state.selectedCycle = state.dashboard.selectedCycleId || '';
  return state.dashboard;
}

async function ensureParticipation(force = false) {
  if (!state.participation || force) state.participation = await api('/api/participation');
  return state.participation;
}

async function renderHome() {
  try {
    const [dashboard, participation] = await Promise.all([ensureDashboard(), ensureParticipation()]);
    const summary = dashboard.summary || {};
    const top = participation.players?.[0];
    document.getElementById('main').innerHTML = `
      <section class="hero">
        <div class="eyebrow">WDZ · PARTICIPATION HUB</div>
        <h1>One place for every score that matters.</h1>
        <p>Track Alliance Duel performance now, add State Ruler and Glory War as their game responses are confirmed, and keep a stable player identity through every name change.</p>
        <div class="hero-meta">
          <span class="hero-chip">${fmt(summary.participants)} players tracked</span>
          <span class="hero-chip">${fmt(summary.duelCycles)} duel league${Number(summary.duelCycles) === 1 ? '' : 's'}</span>
          <span class="hero-chip">Latest sync ${esc(when(summary.latestCapture))}</span>
        </div>
      </section>
      <section class="section grid grid-4">
        ${featureCard('leaderboards', 'leaderboard', 'Alliance Leaderboards', 'Combined participation', `Current leader: ${top ? esc(top.name) : 'Waiting for data'}`, 'Live', 'green')}
        ${featureCard('duel', 'duel', 'Alliance Duel', 'AD points', `${fmt(summary.allTimeScore)} synchronized points`, 'Live', 'blue')}
        ${featureCard('state-ruler', 'ruler', 'State Ruler', 'State vs State', 'Capture discovery is ready for the next event.', 'Discovery ready', 'amber')}
        ${featureCard('glory-war', 'glory', 'Glory War', 'Event participation', 'Command discovery is ready while you navigate the event.', 'Discovery ready', 'purple')}
      </section>
      <section class="section metrics">
        ${metric('All duel points', fmt(summary.allTimeScore), 'Across every stored four-week duel league')}
        ${metric('Current duel', fmt(summary.cycleScore), dashboard.cycle?.label || 'No current cycle')}
        ${metric('Players', fmt(summary.participants), `${fmt(summary.cycleParticipants)} captured in selected duel`)}
        ${metric('Your account', esc(state.user.name), state.user.isAdmin ? 'Administrator access' : `Server ${state.user.serverId}`)}
      </section>`;
    bindRouteCards();
  } catch (err) { pageError(err); }
}

function featureCard(route, icon, title, kicker, text, status, tone) {
  return `<article class="card feature-card clickable" data-card-route="${route}"><div class="feature-icon">${icons[icon]}</div><div class="eyebrow" style="color:var(--muted)">${esc(kicker)}</div><h2>${esc(title)}</h2><p>${text}</p><div class="card-footer"><span class="badge badge-${tone}">${esc(status)}</span><span class="arrow">→</span></div></article>`;
}

function bindRouteCards() {
  document.querySelectorAll('[data-card-route]').forEach(card => card.addEventListener('click', () => navigate(card.dataset.cardRoute)));
}

function metric(label, value, note) {
  return `<article class="metric"><div class="metric-label">${esc(label)}</div><div class="metric-value">${value}</div><div class="metric-note">${esc(note)}</div></article>`;
}

async function renderParticipation() {
  try {
    const data = await ensureParticipation(true);
    const availableLabels = data.weights.filter(w => data.availability[w.eventType]).map(w => w.label).join(' + ') || 'No event data';
    document.getElementById('main').innerHTML = `
      ${pageHead('Alliance Leaderboards', 'A normalized participation index that can combine events with very different raw scoring scales.', `<span class="badge badge-blue">${esc(availableLabels)}</span>`)}
      <div class="method-box">${esc(data.method)}</div>
      <section class="section panel">
        <div class="panel-head"><div><div class="panel-title">Season participation ranking</div><div class="muted">As State Ruler and Glory War data arrive, their normalized components join this score automatically.</div></div><input class="input" id="participation-search" placeholder="Search player" style="max-width:310px"></div>
        <div class="table-wrap" id="participation-table"></div>
      </section>`;
    const render = query => {
      const q = query.trim().toLowerCase();
      const rows = (data.players || []).filter(row => !q || row.name.toLowerCase().includes(q));
      document.getElementById('participation-table').innerHTML = participationTable(rows, data.availability);
    };
    render('');
    document.getElementById('participation-search').addEventListener('input', event => render(event.target.value));
  } catch (err) { pageError(err); }
}

function participationTable(rows, availability) {
  if (!rows.length) return '<div class="empty">No matching players.</div>';
  return `<table><thead><tr><th>Rank</th><th>Player</th><th class="numeric">Participation</th><th class="numeric">Alliance Duel</th><th class="numeric">State Ruler</th><th class="numeric">Glory War</th></tr></thead><tbody>${rows.map(row => `
    <tr><td class="rank-cell">#${fmt(row.rank)}</td><td class="player-cell"><strong>${esc(row.name)}</strong><small>${esc(row.allianceAbbr)} · S${fmt(row.serverId)}</small></td>
    <td class="numeric score">${dec(row.score)}</td>
    ${componentCell(row.components.alliance_duel, true)}
    ${componentCell(row.components.state_ruler, availability.state_ruler)}
    ${componentCell(row.components.glory_war, availability.glory_war)}</tr>`).join('')}</tbody></table>`;
}

function componentCell(component, available) {
  if (!available) return '<td class="numeric muted">—</td>';
  return `<td class="numeric"><strong>${dec(component?.index)}</strong><br><small class="muted">${fmt(component?.raw)}</small></td>`;
}

async function renderDuelPage() {
  try {
    const dashboard = await ensureDashboard();
    document.getElementById('main').innerHTML = `
      ${pageHead('Alliance Duel', 'Six daily score categories, four weekly totals per duel league, and every player tied to their stable game identity.', `
        <select class="select" id="cycle-select" style="min-width:260px">${(dashboard.cycles || []).map(c => `<option value="${esc(c.id)}" ${c.id === state.selectedCycle ? 'selected' : ''}>${esc(c.label)}</option>`).join('')}</select>
        <select class="select" id="week-select" style="min-width:130px">${[1,2,3,4].map(w => `<option value="${w}" ${w === state.selectedWeek ? 'selected' : ''}>Week ${w}</option>`).join('')}</select>`)}
      <div id="duel-content"><div class="empty">Loading Alliance Duel scores…</div></div>`;
    document.getElementById('cycle-select').addEventListener('change', event => { state.selectedCycle = event.target.value; loadDuel(); });
    document.getElementById('week-select').addEventListener('change', event => { state.selectedWeek = Number(event.target.value); loadDuel(); });
    await loadDuel();
  } catch (err) { pageError(err); }
}

async function loadDuel() {
  try {
    const data = await api(`/api/duel?cycle=${encodeURIComponent(state.selectedCycle)}&week=${state.selectedWeek}`);
    state.duel = data;
    state.duelMetric = state.duelMetric || 'weekly';
    renderDuelContent();
  } catch (err) { document.getElementById('duel-content').innerHTML = `<div class="empty">${esc(err.message)}</div>`; }
}

function renderDuelContent() {
  const data = state.duel;
  const metricOptions = [`<option value="weekly" ${state.duelMetric === 'weekly' ? 'selected' : ''}>Weekly total</option>`, ...(data.days || []).map(day => `<option value="day${day.dayIndex}" ${state.duelMetric === `day${day.dayIndex}` ? 'selected' : ''}>Day ${day.dayIndex} · ${esc(day.short)}</option>`)];
  document.getElementById('duel-content').innerHTML = `
    <section class="day-grid">${(data.days || []).map(day => dayCard(day)).join('')}</section>
    <section class="section metrics">
      ${metric('Week total', fmt(data.summary?.weeklyTotal), 'Authoritative weekly ranking total')}
      ${metric('Daily breakdown', fmt(data.summary?.dailyTotal), 'Sum of currently captured daily player rows')}
      ${metric('Players', fmt(data.summary?.players), 'Includes zero-point weekly participants')}
      ${metric('Last captured', data.summary?.latestCapture ? new Date(data.summary.latestCapture).toLocaleDateString() : '—', data.summary?.latestCapture ? when(data.summary.latestCapture) : 'No capture')}
    </section>
    <section class="section panel">
      <div class="panel-head"><div><div class="panel-title">Week ${data.cycleWeek} player scores</div><div class="muted">Choose a day to rank the table by that day, or use Weekly total.</div></div><div class="toolbar" style="margin:0"><div class="field"><label>Rank by</label><select class="select" id="duel-metric">${metricOptions.join('')}</select></div><div class="field"><label>Player</label><input class="input" id="duel-search" placeholder="Search player" value="${esc(state.duelSearch)}"></div></div></div>
      <div class="table-wrap" id="duel-table"></div>
      <div id="player-detail"></div>
    </section>`;
  document.querySelectorAll('.day-card').forEach(card => card.addEventListener('click', () => { state.duelMetric = `day${card.dataset.day}`; document.getElementById('duel-metric').value = state.duelMetric; renderDuelTable(); }));
  document.getElementById('duel-metric').addEventListener('change', event => { state.duelMetric = event.target.value; renderDuelTable(); });
  document.getElementById('duel-search').addEventListener('input', event => { state.duelSearch = event.target.value; renderDuelTable(); });
  renderDuelTable();
}

function dayCard(day) {
  const score = day.officialAllianceScore ?? day.calculatedTotal;
  const source = day.officialAllianceScore != null ? 'Official alliance score' : (day.captured ? 'Captured player total' : 'Not captured yet');
  return `<button class="day-card ${state.duelMetric === `day${day.dayIndex}` ? 'active' : ''}" data-day="${day.dayIndex}"><div class="day-number">Day ${day.dayIndex}</div><div class="day-name">${esc(day.name)}</div><div class="day-score">${fmt(score)}</div><div class="day-note">${esc(source)}</div></button>`;
}

function renderDuelTable() {
  const data = state.duel;
  let rows = [...(data.players || [])];
  const q = state.duelSearch.trim().toLowerCase();
  if (q) rows = rows.filter(row => row.name.toLowerCase().includes(q));
  const metricValue = row => state.duelMetric === 'weekly' ? Number(row.weeklyScore || 0) : Number(row.dayScores?.[Number(state.duelMetric.slice(3)) - 1] || 0);
  rows.sort((a, b) => metricValue(b) - metricValue(a) || b.weeklyScore - a.weeklyScore || a.name.localeCompare(b.name));
  document.querySelectorAll('.day-card').forEach(card => card.classList.toggle('active', state.duelMetric === `day${card.dataset.day}`));
  document.getElementById('duel-table').innerHTML = rows.length ? `<table><thead><tr><th>Rank</th><th>Player</th>${(data.days || []).map(day => `<th class="numeric">D${day.dayIndex} ${esc(day.short)}</th>`).join('')}<th class="numeric">Daily sum</th><th class="numeric">Weekly total</th></tr></thead><tbody>${rows.map((row, index) => `<tr data-player="${esc(row.publicId)}" class="player-row"><td class="rank-cell">#${index + 1}</td><td class="player-cell"><strong>${esc(row.name)}</strong><small>${esc(row.allianceAbbr)} · S${fmt(row.serverId)}</small></td>${(row.dayScores || []).map(value => `<td class="numeric">${fmt(value)}</td>`).join('')}<td class="numeric">${fmt(row.dailySum)}</td><td class="numeric score">${fmt(row.weeklyScore)}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">No matching players.</div>';
  document.querySelectorAll('.player-row').forEach(row => row.addEventListener('click', () => openPlayer(row.dataset.player)));
}

async function openPlayer(publicId) {
  const target = document.getElementById('player-detail');
  target.innerHTML = '<div class="empty">Loading player history…</div>';
  try {
    const data = await api(`/api/player/${encodeURIComponent(publicId)}?cycle=${encodeURIComponent(state.selectedCycle)}`);
    const p = data.player;
    target.innerHTML = `<div class="card" style="margin:16px"><div class="page-head" style="margin:0"><div><div class="eyebrow" style="color:var(--blue)">PLAYER DETAIL</div><h2 style="font-size:28px;margin:4px 0">${esc(p.name)}</h2><p>${esc(p.allianceAbbr)} · Server ${fmt(p.serverId)} · ${data.cyclesParticipated} duel league${data.cyclesParticipated === 1 ? '' : 's'}</p></div><div style="text-align:right"><div class="metric-label">All duel points</div><div class="metric-value">${fmt(data.allTimeTotal)}</div></div></div></div>`;
  } catch (err) { target.innerHTML = `<div class="empty">${esc(err.message)}</div>`; }
}

function renderComing(title, subtitle, icon) {
  document.getElementById('main').innerHTML = `
    ${pageHead(title, subtitle, '<span class="badge badge-amber">Discovery ready</span>')}
    <section class="panel coming"><div><div class="coming-icon">${icons[icon]}</div><h2>${esc(title)} capture is staged</h2><p class="muted" style="max-width:650px">The Windows capture client now watches the confirmed State Ruler/SVS response family and surfaces likely ranking/event commands while you manually click through the game. Once we capture a real ${esc(title)} session, this page will switch from discovery to a live leaderboard without changing player identities.</p><div class="hero-meta" style="justify-content:center"><span class="badge badge-blue">server.battle.score.person.rank</span><span class="badge badge-blue">server.battle.score.info</span>${title === 'State Ruler' ? '<span class="badge badge-blue">get.person.arms.group.rank</span>' : '<span class="badge badge-purple">keyword discovery enabled</span>'}</div></div></section>`;
}

async function renderAdmin() {
  if (!state.user?.isAdmin) return navigate('home');
  try {
    const [summary, logs] = await Promise.all([api('/api/admin/summary'), api('/api/admin/logins?limit=150')]);
    state.admin = summary;
    state.logins = logs.logins || [];
    const s = summary.summary || {};
    document.getElementById('main').innerHTML = `
      ${pageHead('Administrator', 'System health, login history and participation configuration. Player UIDs are never displayed in this panel.', '<span class="badge badge-green">Administrator</span>')}
      <section class="metrics">
        ${metric('Players', fmt(s.players), 'UID-enabled roster accounts')}
        ${metric('Active sessions', fmt(s.activeSessions), 'Unexpired browser sessions')}
        ${metric('Successful logins · 7d', fmt(s.successfulLogins7d), 'Recorded in login history')}
        ${metric('Failed logins · 7d', fmt(s.failedLogins7d), 'Raw attempted UIDs are not stored')}
      </section>
      <section class="section admin-grid">
        <div class="panel"><div class="panel-head"><div><div class="panel-title">Login history</div><div class="muted">Recent successful and failed access attempts.</div></div></div><div class="table-wrap">${auditTable(state.logins)}</div></div>
        <div class="card"><h3>Participation weights</h3><p class="muted">Weights only apply when that event has captured data. Until then it is excluded from the combined metric.</p><form id="weights-form">${(summary.weights || []).map(weight => `<div class="weight-row"><div><strong>${esc(weight.label)}</strong><div class="muted" style="font-size:12px">${esc(weight.eventType)}</div></div><input class="input" type="number" min="0" max="10" step="0.1" name="${esc(weight.eventType)}" value="${weight.weight}"></div>`).join('')}<button class="btn btn-primary" style="margin-top:14px" type="submit">Save weights</button></form><div class="section" style="margin-top:22px"><div class="metric-label">Latest capture</div><strong>${esc(when(s.latestCapture))}</strong><div class="metric-note">${fmt(s.captures)} normalized capture snapshots stored</div></div></div>
      </section>`;
    document.getElementById('weights-form').addEventListener('submit', saveWeights);
  } catch (err) { pageError(err); }
}

function auditTable(rows) {
  if (!rows.length) return '<div class="empty">No login history yet.</div>';
  return `<table><thead><tr><th>Time</th><th>Player</th><th>Result</th><th>Location</th><th>IP fingerprint</th><th>Client</th></tr></thead><tbody>${rows.map(row => `<tr><td>${esc(when(row.createdAt))}</td><td>${esc(row.playerName)}</td><td class="${row.success ? 'audit-success' : 'audit-fail'}">${row.success ? 'Success' : esc(row.reason)}</td><td>${esc([row.country, row.colo].filter(Boolean).join(' · ') || '—')}</td><td>${esc(row.ipFingerprint || '—')}</td><td style="max-width:300px;overflow:hidden;text-overflow:ellipsis">${esc(row.userAgent || '—')}</td></tr>`).join('')}</tbody></table>`;
}

async function saveWeights(event) {
  event.preventDefault();
  const form = new FormData(event.target);
  const weights = Object.fromEntries([...form.entries()].map(([key, value]) => [key, Number(value)]));
  try {
    await api('/api/admin/weights', { method: 'POST', body: JSON.stringify({ weights }) });
    state.participation = null;
    showToast('Participation weights saved.');
    renderAdmin();
  } catch (err) { showToast(err.message); }
}

function pageHead(title, subtitle, actions = '') {
  return `<div class="page-head"><div><div class="eyebrow" style="color:var(--blue)">WDZ · STATE 305</div><h1>${esc(title)}</h1><p>${esc(subtitle)}</p></div><div class="head-actions">${actions}</div></div>`;
}

function pageError(err) {
  document.getElementById('main').innerHTML = `<div class="card empty"><strong>Could not load this page.</strong><br>${esc(err.message || err)}</div>`;
}

async function logout() {
  try { await api('/api/auth/logout', { method: 'POST', body: '{}' }); } catch (_) {}
  state.user = null;
  state.dashboard = null;
  state.participation = null;
  history.replaceState(null, '', location.pathname);
  renderLogin();
}

function applyTheme(theme) {
  root.dataset.theme = theme === 'light' ? 'light' : 'dark';
  localStorage.setItem('alliance-theme', root.dataset.theme);
  refreshThemeIcon();
}
function toggleTheme() { applyTheme(root.dataset.theme === 'dark' ? 'light' : 'dark'); }
function refreshThemeIcon() {
  const button = document.getElementById('theme-button');
  if (!button) return;
  button.innerHTML = root.dataset.theme === 'dark' ? icons.moon : icons.sun;
  button.title = root.dataset.theme === 'dark' ? 'Dark mode' : 'Light mode';
}
function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove('show'), 2600);
}
