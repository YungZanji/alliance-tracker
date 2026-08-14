import './app-v069.js';

let scheduled = false;
let currentUserPromise = null;
const observer = new MutationObserver(schedule);
observer.observe(document.getElementById('app'), { childList: true, subtree: true });
window.addEventListener('hashchange', schedule);
window.addEventListener('resize', schedule, { passive: true });
schedule();

function schedule() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    setTimeout(async () => {
      scheduled = false;
      await enhanceMyRank();
    }, 35);
  });
}

async function api(url) {
  const response = await fetch(url, { cache: 'no-store', headers: { 'content-type': 'application/json' } });
  let data = {};
  try { data = await response.json(); } catch (_) {}
  if (!response.ok || data.ok === false) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

async function currentUser() {
  if (!currentUserPromise) {
    currentUserPromise = api('/api/auth/me').then(data => data.user || null).catch(() => null);
  }
  return currentUserPromise;
}

async function enhanceMyRank() {
  const main = document.getElementById('main');
  if (!main || !isRankingPage(main)) return;
  const user = await currentUser();
  if (!user) return;

  const tables = [...main.querySelectorAll('.table-wrap table, #duel-table table')];
  if (!tables.length) return;

  for (const table of tables) {
    const row = findMyRow(table, user);
    if (row) decorateMyRow(row);
    mountJumpButton(table, user);
  }
}

function isRankingPage(main) {
  const title = main.querySelector('.page-head h1')?.textContent?.trim() || '';
  return title.startsWith('Alliance Leaderboards') ||
    title.startsWith('Alliance Duel') ||
    title.startsWith('State Ruler') ||
    title.startsWith('Glory War');
}

function findMyRow(table, user) {
  const publicId = String(user.publicId || '').trim();
  if (publicId) {
    const exact = [...table.querySelectorAll('tbody tr[data-player]')]
      .find(row => String(row.dataset.player || '').trim() === publicId);
    if (exact) return exact;
  }

  const wanted = normalize(user.name);
  if (!wanted) return null;
  return [...table.querySelectorAll('tbody tr')].find(row => {
    const name = row.querySelector('.player-cell strong')?.textContent || row.children?.[1]?.querySelector?.('strong')?.textContent || '';
    return normalize(name) === wanted;
  }) || null;
}

function decorateMyRow(row) {
  row.classList.add('is-current-player');
  row.setAttribute('aria-current', 'true');
  const playerCell = row.querySelector('.player-cell') || row.children?.[1];
  const strong = playerCell?.querySelector?.('strong');
  if (strong && !playerCell.querySelector('.you-badge')) {
    const badge = document.createElement('span');
    badge.className = 'you-badge';
    badge.textContent = 'YOU';
    badge.title = 'This is your logged-in player row.';
    strong.insertAdjacentElement('afterend', badge);
  }
}

function mountJumpButton(table, user) {
  const panel = table.closest('.panel') || table.parentElement?.parentElement;
  if (!panel) return;
  let head = panel.querySelector('.panel-head');
  if (!head) {
    head = document.createElement('div');
    head.className = 'panel-head my-rank-head';
    panel.insertAdjacentElement('afterbegin', head);
  }
  if (head.querySelector('.my-rank-button')) return;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn btn-secondary my-rank-button';
  button.textContent = 'Jump to My Rank';
  button.title = `Jump to ${user.name || 'your'} row`;
  button.addEventListener('click', () => jumpToMyRow(table, user, button));
  head.appendChild(button);
}

function jumpToMyRow(table, user, button) {
  clearPlayerFilters(table);
  const original = button.textContent;
  button.disabled = true;
  button.textContent = 'Finding you...';

  const attempt = (remaining = 8) => {
    const liveTable = table.isConnected ? table : findLikelyCurrentTable();
    const row = liveTable ? findMyRow(liveTable, user) : null;
    if (row) {
      decorateMyRow(row);
      row.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
      row.classList.remove('my-rank-pulse');
      void row.offsetWidth;
      row.classList.add('my-rank-pulse');
      setTimeout(() => row.classList.remove('my-rank-pulse'), 1800);
      button.textContent = 'My Rank';
      setTimeout(() => {
        if (button.isConnected) {
          button.textContent = original;
          button.disabled = false;
        }
      }, 1200);
      return;
    }
    if (remaining > 0) {
      setTimeout(() => attempt(remaining - 1), 80);
      return;
    }
    button.textContent = 'Not in this view';
    setTimeout(() => {
      if (button.isConnected) {
        button.textContent = original;
        button.disabled = false;
      }
    }, 1600);
  };
  setTimeout(() => attempt(), 40);
}

function clearPlayerFilters(table) {
  const panel = table.closest('.panel') || document.getElementById('main');
  const inputs = [...(panel?.querySelectorAll('input') || [])].filter(input =>
    /search player/i.test(input.placeholder || '') || /player/i.test(input.id || '') && /search/i.test(input.id || '')
  );
  for (const input of inputs) {
    if (!input.value) continue;
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }
}

function findLikelyCurrentTable() {
  return document.querySelector('#main #duel-table table, #main .table-wrap table');
}

function normalize(value) {
  return String(value || '').trim().toLocaleLowerCase();
}
