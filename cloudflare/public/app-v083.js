import './app-v082.js';
import { getSessionUser } from './app.js';

let scheduled = false;
const observer = new MutationObserver(schedule);
observer.observe(document.getElementById('app'), { childList: true, subtree: true });
window.addEventListener('hashchange', schedule);
window.addEventListener('popstate', schedule);
schedule();

function schedule() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => setTimeout(() => {
    scheduled = false;
    repairMyRank();
  }, 70));
}

function repairMyRank() {
  const main = document.getElementById('main');
  const user = getSessionUser();
  if (!main || !isRankingPage(main) || !user || user.isGuest) return;

  clearStaleDecorations(main, user);
  for (const table of rankingTables(main)) {
    const row = findMyRow(table, user);
    if (row) decorateMyRow(row);
    mountOrRepairJumpButton(table, user);
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

  if (publicId && table.querySelector('tbody tr[data-player]')) return null;
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
    if (findMyRow(row.closest('table'), user) === row) {
      row.dataset.myRankUser = key;
      return;
    }
    row.classList.remove('is-current-player', 'my-rank-pulse');
    row.removeAttribute('aria-current');
    row.querySelector('.you-badge')?.remove();
    delete row.dataset.myRankUser;
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

  const attempt = (remaining = 10) => {
    if (!panel.isConnected || getSessionUser() !== user) return;
    const tables = rankingTables(panel);
    let row = null;
    for (const table of tables) {
      row = findMyRow(table, user);
      if (row) break;
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
