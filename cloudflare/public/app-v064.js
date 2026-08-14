import './app-v062.js';

const duelContextCache = new Map();
let scheduled = false;
let adminData = null;

const observer = new MutationObserver(scheduleEnhancements);
observer.observe(document.getElementById('app'), { childList: true, subtree: true });
window.addEventListener('hashchange', () => {
  adminData = null;
  scheduleEnhancements();
});
scheduleEnhancements();

function scheduleEnhancements() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(async () => {
    scheduled = false;
    await Promise.allSettled([
      enhanceHomeOpponent(),
      enhanceDuelContext(),
      enhanceAdministrator(),
    ]);
  });
}

async function getJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
    cache: 'no-store',
  });
  let data = {};
  try { data = await response.json(); } catch (_) {}
  if (!response.ok || data.ok === false) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

async function enhanceHomeOpponent() {
  const main = document.getElementById('main');
  if (!main?.querySelector('.hero')) return;
  const duelCard = [...main.querySelectorAll('.feature-card')].find(card => card.querySelector('h2')?.textContent?.trim() === 'Alliance Duel');
  if (!duelCard || duelCard.dataset.opponentContextLoaded === '1' || duelCard.dataset.opponentLoading === '1') return;
  duelCard.dataset.opponentLoading = '1';
  try {
    const data = await getJson('/api/duel-context');
    const opponent = data.currentOpponent;
    const copy = duelCard.querySelector('p');
    if (copy && opponent?.abbr) {
      const text = `Current opponent: WDZ vs ${opponent.abbr}`;
      if (copy.textContent !== text) copy.textContent = text;
      copy.title = opponent.name ? `${opponent.abbr} · ${opponent.name}` : opponent.abbr;
    }
    duelCard.dataset.opponentContextLoaded = '1';
  } catch (error) {
    console.warn('Could not load current Duel opponent:', error);
  } finally {
    duelCard.dataset.opponentLoading = '0';
  }
}

async function enhanceDuelContext() {
  const main = document.getElementById('main');
  const title = main?.querySelector('.page-head h1');
  if (!title || !title.textContent.startsWith('Alliance Duel')) return;
  const cycleSelect = document.getElementById('cycle-select');
  const weekSelect = document.getElementById('week-select');
  if (!cycleSelect || !weekSelect || !cycleSelect.value) return;

  const cycle = cycleSelect.value;
  const week = Number(weekSelect.value || 1);
  const key = `${cycle}|${week}`;
  let data = duelContextCache.get(key);
  if (!data) {
    try {
      data = await getJson(`/api/duel-context?cycle=${encodeURIComponent(cycle)}&week=${week}`);
      duelContextCache.set(key, data);
    } catch (error) {
      console.warn('Could not load Duel context:', error);
      return;
    }
  }
  applyDuelContext(data);
}

function applyDuelContext(data) {
  const weekSelect = document.getElementById('week-select');
  if (weekSelect) {
    for (const option of [...weekSelect.options]) {
      const row = (data.weeks || []).find(item => Number(item.cycleWeek) === Number(option.value));
      if (row?.label && option.textContent !== row.label) option.textContent = row.label;
    }
  }

  const title = document.querySelector('#main .page-head h1');
  const selected = (data.weeks || []).find(item => Number(item.cycleWeek) === Number(data.cycleWeek));
  if (title) {
    const nextTitle = selected?.opponent?.abbr
      ? `Alliance Duel · Week ${data.cycleWeek} · WDZ vs ${selected.opponent.abbr}`
      : `Alliance Duel · Week ${data.cycleWeek}`;
    if (title.textContent !== nextTitle) title.textContent = nextTitle;
  }

  const leaveMap = new Map((data.leave || []).map(item => [String(item.publicId), item]));
  document.querySelectorAll('#duel-table tbody tr[data-player]').forEach(row => {
    const leave = leaveMap.get(String(row.dataset.player || ''));
    let badge = row.querySelector('.player-leave-badge');
    if (!leave) {
      if (badge) badge.remove();
      row.classList.remove('player-on-leave');
      return;
    }
    const playerCell = row.querySelector('.player-cell') || row.children[1];
    if (!playerCell) return;
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'player-leave-badge';
      badge.textContent = 'On Leave';
      playerCell.appendChild(badge);
    }
    const nextTitle = leave.note || 'Administrator marked this player as away for this Duel week.';
    if (badge.title !== nextTitle) badge.title = nextTitle;
    row.classList.add('player-on-leave');
  });
}

async function enhanceAdministrator() {
  const main = document.getElementById('main');
  const title = main?.querySelector('.page-head h1')?.textContent?.trim();
  if (title !== 'Administrator') return;
  if (!document.getElementById('duel-admin-context')) mountAdminPanel(main);
  if (!adminData) await loadAdminData();
}

function mountAdminPanel(main) {
  const panel = document.createElement('section');
  panel.id = 'duel-admin-context';
  panel.className = 'section panel duel-admin-panel';
  panel.innerHTML = `
    <div class="panel-head">
      <div>
        <div class="panel-title">Alliance Duel week context</div>
        <div class="muted">Opponent labels are learned from combined captures. You can override them and mark players On Leave for selected weeks.</div>
      </div>
    </div>
    <div class="duel-admin-grid">
      <div class="duel-admin-card">
        <h3>Week opponent</h3>
        <label>Cycle</label>
        <select class="select" id="duel-admin-cycle"></select>
        <label>Week</label>
        <select class="select" id="duel-admin-week">${[1,2,3,4].map(w => `<option value="${w}">Week ${w}</option>`).join('')}</select>
        <label>Opponent abbreviation</label>
        <input class="input" id="duel-opponent-abbr" maxlength="24" placeholder="Example: 404B">
        <label>Opponent name <span class="muted">optional</span></label>
        <input class="input" id="duel-opponent-name" maxlength="120" placeholder="Alliance name">
        <div class="duel-admin-actions">
          <button class="btn btn-primary" id="duel-save-opponent">Save opponent</button>
          <button class="btn" id="duel-clear-opponent">Clear</button>
        </div>
        <div class="duel-admin-status" id="duel-opponent-status"></div>
      </div>
      <div class="duel-admin-card">
        <h3>Player leave</h3>
        <label>Player</label>
        <select class="select" id="duel-leave-player"></select>
        <label>Weeks marked On Leave</label>
        <div class="duel-week-checks">${[1,2,3,4].map(w => `<label><input type="checkbox" value="${w}" class="duel-leave-week"> Week ${w}</label>`).join('')}</div>
        <label>Note <span class="muted">optional, admin context</span></label>
        <input class="input" id="duel-leave-note" maxlength="240" placeholder="Vacation, travel, personal leave, etc.">
        <div class="duel-admin-actions">
          <button class="btn btn-primary" id="duel-save-leave">Save leave weeks</button>
          <button class="btn" id="duel-clear-leave">Clear all weeks</button>
        </div>
        <div class="duel-admin-status" id="duel-leave-status"></div>
      </div>
    </div>`;
  main.appendChild(panel);

  panel.querySelector('#duel-admin-cycle').addEventListener('change', async event => {
    adminData = null;
    await loadAdminData(event.target.value);
  });
  panel.querySelector('#duel-admin-week').addEventListener('change', fillOpponentForm);
  panel.querySelector('#duel-leave-player').addEventListener('change', fillLeaveForm);
  panel.querySelector('#duel-save-opponent').addEventListener('click', () => saveOpponent(false));
  panel.querySelector('#duel-clear-opponent').addEventListener('click', () => saveOpponent(true));
  panel.querySelector('#duel-save-leave').addEventListener('click', () => saveLeave(false));
  panel.querySelector('#duel-clear-leave').addEventListener('click', () => saveLeave(true));
}

async function loadAdminData(preferredCycle = '') {
  const cycleSelect = document.getElementById('duel-admin-cycle');
  if (!cycleSelect) return;
  const requested = preferredCycle || cycleSelect.value || '';
  try {
    const suffix = requested ? `?cycle=${encodeURIComponent(requested)}` : '';
    adminData = await getJson(`/api/admin/duel-context${suffix}`);
    const cycles = adminData.cycles || [];
    cycleSelect.innerHTML = cycles.map(row => `<option value="${escapeHtml(row.id)}">${escapeHtml(row.id)}</option>`).join('');
    if (adminData.cycleId) cycleSelect.value = adminData.cycleId;

    const playerSelect = document.getElementById('duel-leave-player');
    if (playerSelect) {
      playerSelect.innerHTML = (adminData.players || []).map(row =>
        `<option value="${escapeHtml(row.publicId)}">${escapeHtml(row.name)} · S${Number(row.serverId || 0)}</option>`
      ).join('');
    }
    fillOpponentForm();
    fillLeaveForm();
  } catch (error) {
    setAdminStatus('duel-opponent-status', error.message, true);
    setAdminStatus('duel-leave-status', error.message, true);
  }
}

function fillOpponentForm() {
  if (!adminData) return;
  const week = Number(document.getElementById('duel-admin-week')?.value || adminData.cycleWeek || 1);
  const row = (adminData.weeks || []).find(item => Number(item.cycleWeek) === week);
  const opponent = row?.opponent || {};
  const abbr = document.getElementById('duel-opponent-abbr');
  const name = document.getElementById('duel-opponent-name');
  if (abbr) abbr.value = opponent.abbr || '';
  if (name) name.value = opponent.name || '';
  const status = opponent.abbr
    ? `${opponent.source === 'admin' ? 'Admin override' : 'Captured automatically'} · ${opponent.updatedAt ? new Date(opponent.updatedAt).toLocaleString() : ''}`
    : 'No opponent recorded for this week yet.';
  setAdminStatus('duel-opponent-status', status, false);
}

function fillLeaveForm() {
  if (!adminData) return;
  const publicId = document.getElementById('duel-leave-player')?.value || '';
  const entries = (adminData.leave || []).filter(item => String(item.publicId) === publicId);
  const weeks = new Set(entries.map(item => Number(item.cycleWeek)));
  document.querySelectorAll('.duel-leave-week').forEach(input => { input.checked = weeks.has(Number(input.value)); });
  const note = document.getElementById('duel-leave-note');
  if (note) note.value = entries.find(item => item.note)?.note || '';
  setAdminStatus('duel-leave-status', weeks.size ? `On Leave: ${[...weeks].sort().map(w => `Week ${w}`).join(', ')}` : 'No leave weeks are set for this player.', false);
}

async function saveOpponent(clear) {
  const cycleId = document.getElementById('duel-admin-cycle')?.value || '';
  const cycleWeek = Number(document.getElementById('duel-admin-week')?.value || 1);
  const opponentAbbr = clear ? '' : document.getElementById('duel-opponent-abbr')?.value.trim() || '';
  const opponentName = clear ? '' : document.getElementById('duel-opponent-name')?.value.trim() || '';
  try {
    await getJson('/api/admin/duel-context', {
      method: 'POST',
      body: JSON.stringify({ cycleId, cycleWeek, opponentAbbr, opponentName }),
    });
    duelContextCache.clear();
    setAdminStatus('duel-opponent-status', clear ? 'Opponent cleared.' : 'Opponent saved.', false, true);
    adminData = null;
    await loadAdminData(cycleId);
  } catch (error) {
    setAdminStatus('duel-opponent-status', error.message, true);
  }
}

async function saveLeave(clear) {
  const cycleId = document.getElementById('duel-admin-cycle')?.value || '';
  const publicId = document.getElementById('duel-leave-player')?.value || '';
  const cycleWeeks = clear ? [] : [...document.querySelectorAll('.duel-leave-week:checked')].map(input => Number(input.value));
  const note = clear ? '' : document.getElementById('duel-leave-note')?.value.trim() || '';
  try {
    await getJson('/api/admin/player-leave', {
      method: 'POST',
      body: JSON.stringify({ cycleId, publicId, cycleWeeks, note }),
    });
    duelContextCache.clear();
    setAdminStatus('duel-leave-status', cycleWeeks.length ? 'Leave weeks saved.' : 'Leave cleared.', false, true);
    adminData = null;
    await loadAdminData(cycleId);
  } catch (error) {
    setAdminStatus('duel-leave-status', error.message, true);
  }
}

function setAdminStatus(id, message, error = false, success = false) {
  const node = document.getElementById(id);
  if (!node) return;
  node.textContent = message || '';
  node.classList.toggle('error', error);
  node.classList.toggle('success', success && !error);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[char]));
}
