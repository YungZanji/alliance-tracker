import './app-v077.js';

let scheduled = false;
let activityBusy = false;
let activityRendered = false;
let activityTab = 'logins';
let activityData = { logins: [], audit: [] };
let pollFilterBusy = false;

const observer = new MutationObserver(schedule);
observer.observe(document.getElementById('app'), { childList: true, subtree: true });
window.addEventListener('hashchange', () => {
  if (location.hash === '#activity') activityRendered = false;
  schedule();
});
schedule();

function schedule() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => setTimeout(async () => {
    scheduled = false;
    ensureActivityNav();
    extractLoginHistoryFromAdmin();
    if (location.hash === '#activity' && !document.querySelector('.admin-activity-page')) await renderAdminActivity();
    if (location.hash === '#polls') await enhancePollAnswerFilters();
  }, 60));
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    cache: 'no-store',
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
  });
  let data = {};
  try { data = await response.json(); } catch (_) {}
  if (!response.ok || data.ok === false) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

function ensureActivityNav() {
  const links = document.querySelector('.nav-links');
  if (!links || links.querySelector('.activity-nav')) return;
  const admin = [...links.querySelectorAll('.nav-link')].find(node => node.textContent.trim() === 'Admin');
  if (!admin) return;
  const button = document.createElement('button');
  button.className = 'nav-link activity-nav';
  button.textContent = 'Activity';
  button.type = 'button';
  button.addEventListener('click', () => {
    history.pushState(null, '', '#activity');
    activityRendered = false;
    renderAdminActivity();
  });
  links.insertBefore(button, admin);
}

function extractLoginHistoryFromAdmin() {
  const main = document.getElementById('main');
  if (!main || main.querySelector('.page-head h1')?.textContent?.trim() !== 'Administrator') return;

  const loginTitle = [...main.querySelectorAll('.panel-title')].find(node => node.textContent.trim() === 'Login history');
  const loginPanel = loginTitle?.closest('.panel');
  const grid = loginPanel?.parentElement;
  if (loginPanel) loginPanel.remove();
  if (grid?.classList.contains('admin-grid')) grid.classList.add('admin-login-history-removed');

  const head = main.querySelector('.page-head');
  if (head && !head.querySelector('.admin-activity-open')) {
    const button = document.createElement('button');
    button.className = 'btn admin-activity-open';
    button.type = 'button';
    button.innerHTML = '<span>Admin Activity</span><small>Logins + update audit</small>';
    button.addEventListener('click', () => {
      history.pushState(null, '', '#activity');
      activityRendered = false;
      renderAdminActivity();
    });
    head.appendChild(button);
  }
}

async function renderAdminActivity() {
  if (activityBusy) return;
  const main = document.getElementById('main');
  if (!main) return;
  if (activityRendered && main.querySelector('.admin-activity-page')) return;

  document.querySelectorAll('.nav-link').forEach(node => node.classList.remove('active'));
  document.querySelector('.activity-nav')?.classList.add('active');

  if (!activityRendered) {
    activityBusy = true;
    main.innerHTML = '<div class="empty">Loading admin activity…</div>';
    try {
      const [loginData, auditData] = await Promise.all([
        api('/api/admin/logins?limit=250'),
        api('/api/admin/activity?limit=250'),
      ]);
      if (location.hash !== '#activity') return;
      activityData = {
        logins: loginData.logins || [],
        audit: auditData.activity || [],
      };
      main.innerHTML = activityMarkup();
      activityRendered = true;
      bindActivity();
      renderActivityTab();
    } catch (error) {
      if (location.hash === '#activity') {
        main.innerHTML = `<div class="empty"><strong>Could not load Admin Activity.</strong><span>${esc(error.message)}</span></div>`;
      }
    } finally {
      activityBusy = false;
    }
    return;
  }

  main.innerHTML = activityMarkup();
  bindActivity();
  renderActivityTab();
}

function activityMarkup() {
  return `
    <div class="admin-activity-page">
      <section class="page-head activity-page-head">
        <div><div class="eyebrow">WDZ · ADMIN</div><h1>Activity History</h1><p>Access history and a chronological audit of the data that has been synchronized into the tracker.</p></div>
      </section>
      <section class="activity-tab-grid" role="tablist">
        <button class="activity-tab-card ${activityTab === 'logins' ? 'active' : ''}" data-activity-tab="logins" type="button">
          <span>ACCESS</span><strong>Login History</strong><small>${activityData.logins.length} recent access attempts</small>
        </button>
        <button class="activity-tab-card ${activityTab === 'audit' ? 'active' : ''}" data-activity-tab="audit" type="button">
          <span>DATA UPDATES</span><strong>Audit History</strong><small>${activityData.audit.length} recent tracker updates</small>
        </button>
      </section>
      <section class="activity-content panel" id="activity-content"></section>
    </div>`;
}

function bindActivity() {
  document.querySelectorAll('[data-activity-tab]').forEach(button => {
    button.addEventListener('click', () => {
      activityTab = button.dataset.activityTab || 'logins';
      document.querySelectorAll('[data-activity-tab]').forEach(node => node.classList.toggle('active', node === button));
      renderActivityTab();
    });
  });
}

function renderActivityTab() {
  const host = document.getElementById('activity-content');
  if (!host) return;
  if (activityTab === 'audit') renderAuditHistory(host);
  else renderLoginHistory(host);
}

function renderLoginHistory(host) {
  const rows = activityData.logins || [];
  host.innerHTML = `
    <div class="activity-panel-head">
      <div><div class="panel-title">Login History</div><div class="muted">Recent successful and failed access attempts without a wide horizontal table.</div></div>
      <div class="activity-tools"><select class="select" id="login-result-filter"><option value="all">All results</option><option value="success">Successful</option><option value="failed">Failed</option></select><input class="input" id="login-history-search" placeholder="Search player or location"></div>
    </div>
    <div class="activity-card-list" id="login-history-list">${loginCards(rows)}</div>`;

  const apply = () => {
    const query = String(document.getElementById('login-history-search')?.value || '').trim().toLowerCase();
    const result = String(document.getElementById('login-result-filter')?.value || 'all');
    document.querySelectorAll('.login-history-card').forEach(card => {
      const matchesQuery = !query || String(card.dataset.search || '').includes(query);
      const matchesResult = result === 'all' || card.dataset.result === result;
      card.hidden = !(matchesQuery && matchesResult);
    });
  };
  document.getElementById('login-history-search')?.addEventListener('input', apply);
  document.getElementById('login-result-filter')?.addEventListener('change', apply);
}

function loginCards(rows) {
  if (!rows.length) return '<div class="empty compact">No login history yet.</div>';
  return rows.map(row => {
    const location = [row.country, row.colo].filter(Boolean).join(' · ') || 'Unknown location';
    const result = row.success ? 'success' : 'failed';
    const resultText = row.success ? 'Success' : (row.reason || 'Failed');
    const search = `${row.playerName || ''} ${location} ${row.ipFingerprint || ''} ${row.userAgent || ''}`.toLowerCase();
    return `<article class="login-history-card ${result}" data-result="${result}" data-search="${esc(search)}">
      <div class="activity-card-main"><div><strong>${esc(row.playerName || 'Unknown player')}</strong><span>${dateLong(row.createdAt)}</span></div><b>${esc(resultText)}</b></div>
      <div class="activity-meta-grid"><span><small>Location</small>${esc(location)}</span><span><small>IP fingerprint</small>${esc(row.ipFingerprint || '—')}</span><span class="activity-client"><small>Client</small>${esc(row.userAgent || '—')}</span></div>
    </article>`;
  }).join('');
}

function renderAuditHistory(host) {
  const rows = activityData.audit || [];
  const types = [...new Set(rows.map(row => row.type).filter(Boolean))];
  host.innerHTML = `
    <div class="activity-panel-head">
      <div><div class="panel-title">Audit History</div><div class="muted">What reached Cloudflare and when: Duel syncs, State Ruler, polls, and other event updates.</div></div>
      <div class="activity-tools"><select class="select" id="audit-type-filter"><option value="all">All updates</option>${types.map(type => `<option value="${esc(type)}">${esc(typeLabel(type))}</option>`).join('')}</select><input class="input" id="audit-history-search" placeholder="Search update history"></div>
    </div>
    <div class="activity-timeline" id="audit-history-list">${auditCards(rows)}</div>`;

  const apply = () => {
    const query = String(document.getElementById('audit-history-search')?.value || '').trim().toLowerCase();
    const type = String(document.getElementById('audit-type-filter')?.value || 'all');
    document.querySelectorAll('.audit-history-card').forEach(card => {
      const matchesQuery = !query || String(card.dataset.search || '').includes(query);
      const matchesType = type === 'all' || card.dataset.type === type;
      card.hidden = !(matchesQuery && matchesType);
    });
  };
  document.getElementById('audit-history-search')?.addEventListener('input', apply);
  document.getElementById('audit-type-filter')?.addEventListener('change', apply);
}

function auditCards(rows) {
  if (!rows.length) return '<div class="empty compact">No tracker update history is available yet.</div>';
  return rows.map(row => {
    const search = `${row.label || ''} ${row.title || ''} ${row.detail || ''} ${row.meta || ''}`.toLowerCase();
    return `<article class="audit-history-card type-${esc(row.type || 'other')}" data-type="${esc(row.type || '')}" data-search="${esc(search)}">
      <div class="audit-marker"></div>
      <div class="audit-history-body"><div class="audit-history-top"><span class="audit-type-badge">${esc(row.label || typeLabel(row.type))}</span><time>${dateLong(row.occurredAt)}</time></div><strong>${esc(row.title || 'Tracker update')}</strong><p>${esc(row.detail || '')}</p>${row.meta ? `<small>${esc(row.meta)}</small>` : ''}</div>
    </article>`;
  }).join('');
}

async function enhancePollAnswerFilters() {
  if (pollFilterBusy) return;
  const host = document.getElementById('polls-detail');
  const active = document.querySelector('.poll-list-item.active');
  const pollId = String(active?.dataset.pollId || '');
  const optionGrid = host?.querySelector('.poll-option-grid');
  const table = host?.querySelector('.poll-participant-table');
  if (!host || !pollId || !optionGrid || !table || optionGrid.dataset.answerFilters === pollId) return;

  pollFilterBusy = true;
  try {
    const data = await api(`/api/admin/polls/${encodeURIComponent(pollId)}`);
    if (location.hash !== '#polls' || String(document.querySelector('.poll-list-item.active')?.dataset.pollId || '') !== pollId) return;
    const options = data.options || [];
    const participants = data.participants || [];
    const participantByUid = new Map(participants.map(row => [String(row.uid || ''), row]));
    const cards = [...optionGrid.querySelectorAll('.poll-option-card')];
    let selectedOptionId = '';

    cards.forEach((card, index) => {
      const option = options[index];
      if (!option) return;
      card.dataset.optionId = String(option.id || '');
      card.dataset.optionFilterReady = '1';
      card.setAttribute('role', 'button');
      card.setAttribute('tabindex', '0');
      card.setAttribute('aria-pressed', 'false');
      const activate = () => {
        const id = String(option.id || '');
        selectedOptionId = selectedOptionId === id ? '' : id;
        cards.forEach(node => {
          const activeNow = Boolean(selectedOptionId && node.dataset.optionId === selectedOptionId);
          node.classList.toggle('answer-filter-active', activeNow);
          node.setAttribute('aria-pressed', activeNow ? 'true' : 'false');
        });
        updatePollFilterHint(optionGrid, selectedOptionId ? option.text : '');
        applyPollFilters(table, selectedOptionId);
      };
      card.addEventListener('click', activate);
      card.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activate(); }
      });
    });

    table.querySelectorAll('tbody tr').forEach(row => {
      const uidText = String(row.querySelector('td small')?.textContent || '').split('·')[0].trim();
      const participant = participantByUid.get(uidText);
      const ids = Array.isArray(participant?.optionIds) ? participant.optionIds.map(String) : [];
      row.dataset.optionIds = `|${ids.join('|')}|`;
    });

    optionGrid.dataset.answerFilters = pollId;
    updatePollFilterHint(optionGrid, '');

    host.querySelectorAll('.poll-filter').forEach(button => button.addEventListener('click', () => setTimeout(() => applyPollFilters(table, selectedOptionId), 0)));
    host.querySelector('#poll-player-search')?.addEventListener('input', () => setTimeout(() => applyPollFilters(table, selectedOptionId), 0));
  } catch (error) {
    console.warn('Could not enable poll answer filtering:', error);
  } finally {
    pollFilterBusy = false;
  }
}

function applyPollFilters(table, selectedOptionId) {
  if (!table) return;
  const host = table.closest('#polls-detail') || document;
  const stateFilter = String(host.querySelector('.poll-filter.active')?.dataset.filter || 'all');
  const query = String(host.querySelector('#poll-player-search')?.value || '').trim().toLowerCase();
  table.querySelectorAll('tbody tr').forEach(row => {
    const stateOk = stateFilter === 'all' || row.dataset.voteState === stateFilter;
    const searchOk = !query || String(row.dataset.search || '').includes(query);
    const optionOk = !selectedOptionId || String(row.dataset.optionIds || '').includes(`|${selectedOptionId}|`);
    row.hidden = !(stateOk && searchOk && optionOk);
  });
}

function updatePollFilterHint(optionGrid, optionText) {
  let hint = optionGrid.parentElement?.querySelector('.poll-answer-filter-hint');
  if (!hint) {
    hint = document.createElement('div');
    hint.className = 'poll-answer-filter-hint';
    optionGrid.insertAdjacentElement('afterend', hint);
  }
  hint.innerHTML = optionText
    ? `<strong>Showing “${esc(optionText)}” voters.</strong><span>Click the selected answer again to clear this filter.</span>`
    : '<strong>Filter by answer.</strong><span>Click any answer card above to show only the players who selected it.</span>';
}

function typeLabel(type) {
  return ({
    alliance_duel: 'Alliance Duel Sync',
    poll: 'Poll Archive',
    state_ruler: 'State Ruler',
    glory_war: 'Glory War',
    poll_state_ruler: 'Poll → State Ruler',
  })[type] || 'Tracker Update';
}

function dateLong(value) {
  const date = new Date(String(value || ''));
  return Number.isNaN(date.getTime()) ? 'Unknown time' : new Intl.DateTimeFormat(undefined, { month:'short', day:'numeric', year:'numeric', hour:'numeric', minute:'2-digit' }).format(date);
}
function esc(value) { return String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[char])); }
