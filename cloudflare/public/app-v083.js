import './app-v082.js';

let scheduled = false;
let busy = false;
let cachedUser = null;
let cachedAt = 0;
let userPromise = null;

const observer = new MutationObserver(schedule);
observer.observe(document.getElementById('app'), { childList: true, subtree: true });
window.addEventListener('hashchange', () => {
  cachedAt = 0;
  schedule();
});
window.addEventListener('popstate', () => {
  cachedAt = 0;
  schedule();
});
schedule();

function schedule() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => setTimeout(async () => {
    scheduled = false;
    await repairMyRank();
  }, 70));
}

async function api(url) {
  const response = await fetch(url, {
    cache: 'no-store',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
  });
  let data = {};
  try { data = await response.json(); } catch (_) {}
  if (!response.ok || data.ok === false) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

async function currentUser(force = false) {
  const fresh = cachedUser && !force && (Date.now() - cachedAt) < 2000;
  if (fresh) return cachedUser;
  if (!userPromise) {
    userPromise = api('/api/auth/me')
      .then(data => {
        cachedUser = data.user || null;
        cachedAt = Date.now();
        return cachedUser;
      })
      .catch(() => null)
      .finally(() => { userPromise = null; });
  }
  return userPromise;
}

async function repairMyRank() {
  if (busy) return;
  const main = document.getElementById('main');
  if (!main || !isRankingPage(main)) return;
  busy = true;
  try {
    const user = await currentUser();
    if (!user) return;

    if (user.isGuest) {
      clearMyRankUi(main);
      return;
    }

    const tables = rankingTables(main);
    if (!tables.length) return;

    clearStaleDecorations(main, user);
    for (const table of tables) {
      const row = findMyRow(table, user);
      if (row) decorateMyRow(row);
      mountOrRepairJumpButton(table, user);
    }
  } finally {
    busy = false;
  }
}

function isRankingPage(main) {
  const title = main.querySelector('.page-head h1')?.textContent?.trim() || '';
  return title.startsWith('Alliance Leaderboards') ||
    title.startsWith('Alliance Duel') ||
    title.startsWith('State Ruler') ||
    title.startsWith('Glory War');
}

function rankingTables(main) {
  return [...new Set([
    ...main.querySelectorAll('#participation-table table'),
    ...main.querySelectorAll('#duel-table table'),
    ...main.querySelectorAll('.combined-contribution-table'),
    ...main.querySelectorAll('.responsive-table'),
  ])].filter(table => table.querySelector('tbody tr'));
}

function userKey(user) {
  return `${String(user.publicId || '').trim()}|${normalize(user.name)}`;
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
    const name = row.querySelector('.player-cell strong')?.textContent ||
      row.children?.[1]?.querySelector?.('strong')?.textContent || '';
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

function clearStaleDecorations(main, user) {
  const key = userKey(user);
  main.querySelectorAll('tr.is-current-player').forEach(row => {
    if (row.dataset.myRankUser === key || findMyRow(row.closest('table'), user) === row) {
      row.dataset.myRankUser = key;
      return;
    }
    row.classList.remove('is-current-player', 'my-rank-pulse');
    row.removeAttribute('aria-current');
    row.querySelector('.you-badge')?.remove();
    delete row.dataset.myRankUser;
  });
}

function clearMyRankUi(main) {
  main.querySelectorAll('.my-rank-button').forEach(button => button.remove());
  main.querySelectorAll('tr.is-current-player').forEach(row => {
    row.classList.remove('is-current-player', 'my-rank-pulse');
    row.removeAttribute('aria-current');
    row.querySelector('.you-badge')?.remove();
  });
}

function mountOrRepairJumpButton(table, user) {
  const panel = table.closest('.panel') || table.parentElement?.parentElement;
  if (!panel) return;
  let head = panel.querySelector('.panel-head');
  if (!head) {
    head = document.createElement('div');
    head.className = 'panel-head my-rank-head';
    panel.insertAdjacentElement('afterbegin', head);
  }

  const key = userKey(user);
  let button = head.querySelector('.my-rank-button');
  if (button && button.dataset.myRankUser === key && button.dataset.rankFix === '109') return;

  const replacement = document.createElement('button');
  replacement.type = 'button';
  replacement.className = 'btn btn-secondary my-rank-button';
  replacement.textContent = 'Jump to My Rank';
  replacement.title = `Jump to ${user.name || 'your'} row`;
  replacement.dataset.myRankUser = key;
  replacement.dataset.rankFix = '109';
  replacement.addEventListener('click', () => jumpToMyRow(panel, user, replacement));

  if (button) button.replaceWith(replacement);
  else head.appendChild(replacement);
}

function jumpToMyRow(panel, user, button) {
  clearPlayerFilters(panel);
  const original = 'Jump to My Rank';
  button.disabled = true;
  button.textContent = 'Finding you...';

  const attempt = async (remaining = 10) => {
    const liveMain = document.getElementById('main');
    const tables = liveMain ? rankingTables(liveMain) : [];
    let row = null;
    for (const table of tables) {
      row = findMyRow(table, user);
      if (row) break;
    }

    if (!row && remaining === 5) {
      const refreshed = await currentUser(true);
      if (refreshed && !refreshed.isGuest) user = refreshed;
    }

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
      setTimeout(() => attempt(remaining - 1), 100);
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

  setTimeout(() => attempt(), 60);
}

function clearPlayerFilters(panel) {
  const inputs = [...(panel?.querySelectorAll('input') || [])].filter(input =>
    /search player/i.test(input.placeholder || '') ||
    (/player/i.test(input.id || '') && /search/i.test(input.id || ''))
  );
  for (const input of inputs) {
    if (!input.value) continue;
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }
}

function normalize(value) {
  return String(value || '').trim().toLocaleLowerCase();
}
