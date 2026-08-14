import './app-v070.js';

let scheduled = false;
let guideBusy = false;
let guideRendered = false;
let leaderboardBusy = false;
let leaderboardRenderedFor = '';
let adminBusy = false;

const observer = new MutationObserver(schedule);
observer.observe(document.getElementById('app'), { childList: true, subtree: true });
window.addEventListener('hashchange', () => {
  guideRendered = false;
  leaderboardRenderedFor = '';
  schedule();
});
window.addEventListener('popstate', schedule);
schedule();

function schedule() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => setTimeout(async () => {
    scheduled = false;
    ensureGuideNav();
    await Promise.allSettled([
      maybeRenderGuide(),
      enhanceDuelLeaderboard(),
      enhanceDuelAdmin(),
    ]);
  }, 35));
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

function ensureGuideNav() {
  const links = document.querySelector('.nav-links');
  if (!links || links.querySelector('.guide-nav')) return;
  const button = document.createElement('button');
  button.className = 'nav-link guide-nav';
  button.textContent = 'Guide';
  button.type = 'button';
  button.addEventListener('click', () => {
    history.pushState(null, '', '#guide');
    guideRendered = false;
    renderGuide();
  });
  const admin = [...links.querySelectorAll('.nav-link')].find(node => node.textContent.trim() === 'Admin');
  if (admin) links.insertBefore(button, admin);
  else links.appendChild(button);
}

async function maybeRenderGuide() {
  if (location.hash !== '#guide' || guideRendered || guideBusy) return;
  await renderGuide();
}

async function renderGuide() {
  const main = document.getElementById('main');
  if (!main || guideBusy) return;
  guideBusy = true;
  document.querySelectorAll('.nav-link[data-route]').forEach(button => button.classList.remove('active'));
  document.querySelector('.guide-nav')?.classList.add('active');
  if (!main.querySelector('.duel-guide-page')) main.innerHTML = '<div class="empty">Loading Alliance Duel guide…</div>';
  try {
    const data = await api('/api/scoring-guide');
    if (location.hash !== '#guide') return;
    main.innerHTML = guideMarkup(data);
    guideRendered = true;
  } catch (error) {
    if (location.hash !== '#guide') return;
    main.innerHTML = `<div class="empty guide-error"><strong>Could not load the Alliance Duel guide.</strong><span>${esc(error.message)}</span><button class="btn btn-secondary" id="guide-retry">Retry</button></div>`;
    document.getElementById('guide-retry')?.addEventListener('click', () => {
      guideRendered = false;
      renderGuide();
    });
  } finally {
    guideBusy = false;
  }
}

function guideMarkup(data) {
  const duel = data.duel || {};
  const days = duel.dayWeights || [];
  const minimum = Number(duel.dailyMinimum || 6_000_000);
  const bye = Number(duel.byeWeight ?? 0.35);
  const totalWeight = Number(duel.totalDayWeight || 13);
  const dayCards = days.map(day => `
    <article class="duel-weight-card">
      <div><span class="eyebrow">DAY ${Number(day.dayIndex)}</span><h3>${esc(day.name)}</h3></div>
      <div class="duel-weight-value">×${Number(day.weight)}</div>
      <p>${share(day.weight, totalWeight)} of the full six-day weighting.</p>
    </article>`).join('');

  return `
    <div class="duel-guide-page">
      <section class="duel-guide-hero">
        <div class="eyebrow">WDZ · ALLIANCE DUEL GUIDE</div>
        <h1>Score high. Do it consistently.</h1>
        <p>Your Alliance Duel rank is built from your real points across the current four-week Duel League. Nobody is compared against the biggest spender, and huge scores are never capped.</p>
      </section>

      <section class="duel-guide-principles">
        ${guideRule('1','Average every day','Tank is averaged with Tank across the available weeks, Build with Build, and so on. A future day that has not happened yet is not treated as zero.')}
        ${guideRule('2','Weight what wins more','The game awards different Duel win points by day, so the ranking uses the same importance: 1 / 2 / 2 / 2 / 2 / 4.')}
        ${guideRule('3','Keep the real scale','Your result remains an average measured in real points. A massive score still matters; it is not compressed into an artificial 0–100 grade.')}
        ${guideRule('4',`${compact(minimum)} is the daily standard`,'Consistency is tracked separately. Normal Duel days at or above the minimum improve your 6M Consistency; falling below it stays visible.')}
      </section>

      <section class="duel-guide-section">
        <div class="section-copy"><div class="eyebrow">DAY IMPORTANCE</div><h2>The game value becomes the score weight.</h2><p>Enemy Buster is worth four Duel win points, so the same raw score there carries four times the weight of Tank Day. The six weights add to ${totalWeight}.</p></div>
        <div class="duel-weight-grid">${dayCards}</div>
      </section>

      <section class="duel-formula-card">
        <div class="eyebrow">WEIGHTED DUEL AVERAGE</div>
        <h2>One formula for the whole Duel League.</h2>
        <div class="duel-formula">(Tank Avg × 1 + Build Avg × 2 + Science Avg × 2 + Hero Avg × 2 + Training Avg × 2 + Enemy Buster Avg × 4) ÷ 13</div>
        <p>Higher consistent daily averages naturally rise to the top. One giant week cannot erase several weak weeks because every day's score is averaged across its available weeks first.</p>
      </section>

      <section class="duel-guide-section">
        <div class="section-copy"><div class="eyebrow">NORMAL, BYE & LEAVE</div><h2>Real life and resource-save weeks are handled plainly.</h2></div>
        <div class="duel-rule-grid">
          ${guideRule('✓','Normal week','100% of the recorded score is used.')}
          ${guideRule('↘','Bye week',`Scores are discounted to ${Math.round(bye * 100)}% by default. A specific Bye week can have its own Admin override.`)}
          ${guideRule('—','Approved On Leave','That player/week is removed from their averages instead of becoming a zero.')}
          ${guideRule('0','Missed without leave','A captured day with no score counts as zero. Bye weeks are excluded from the daily-minimum consistency check.')}
        </div>
      </section>

      <section class="duel-guide-section">
        <div class="section-copy"><div class="eyebrow">WHAT YOU SEE ON THE LEADERBOARD</div><h2>Two numbers tell the story.</h2></div>
        <div class="duel-stat-grid">
          <article class="guide-card"><h3>Weighted Duel Average</h3><p>Your primary ranking number, calculated from the six day averages and their 1/2/2/2/2/4 importance.</p></article>
          <article class="guide-card"><h3>${compact(minimum)} Consistency</h3><p>The percentage of eligible normal Duel days where you met the daily minimum. It is the first tie-breaker when Weighted Duel Averages match.</p></article>
          <article class="guide-card"><h3>League Raw Points</h3><p>Your actual captured points remain visible for context. Raw points are never capped or hidden.</p></article>
        </div>
      </section>

      <section class="duel-future-note">
        <strong>State Ruler and Glory War are separate.</strong>
        <span>Their final scoring systems are still being developed and are not mixed into this Alliance Duel ranking yet.</span>
      </section>
    </div>`;
}

function guideRule(icon, title, copy) {
  return `<article class="guide-card"><div class="guide-rule-icon">${esc(icon)}</div><h3>${esc(title)}</h3><p>${esc(copy)}</p></article>`;
}

async function enhanceDuelLeaderboard() {
  const main = document.getElementById('main');
  const title = main?.querySelector('.page-head h1')?.textContent?.trim() || '';
  const tableHost = document.getElementById('participation-table');
  if (!title.startsWith('Alliance Leaderboards') || !tableHost || leaderboardBusy) return;
  const mountKey = `${title}|${tableHost.dataset.duelModel || ''}`;
  if (tableHost.dataset.duelModel === 'v090' && leaderboardRenderedFor === mountKey) return;

  leaderboardBusy = true;
  try {
    const data = await api('/api/participation');
    if (!document.getElementById('participation-table')) return;
    const subtitle = main.querySelector('.page-head p');
    if (subtitle) subtitle.textContent = 'Alliance Duel performance across the current four-week Duel League.';
    const method = main.querySelector('.method-box');
    if (method) method.textContent = data.method || '';
    const panelTitle = main.querySelector('.panel-title');
    if (panelTitle) panelTitle.textContent = 'Alliance Duel performance ranking';
    const panelMuted = main.querySelector('.panel-head .muted');
    if (panelMuted) panelMuted.textContent = 'Ranked by Weighted Duel Average. 6M Consistency is the first tie-breaker.';

    let search = document.getElementById('participation-search');
    if (search && search.dataset.duelSearch !== 'v090') {
      const replacement = search.cloneNode(true);
      replacement.dataset.duelSearch = 'v090';
      replacement.value = '';
      search.replaceWith(replacement);
      search = replacement;
      search.addEventListener('input', event => renderDuelRows(data, event.target.value));
    }
    tableHost.dataset.duelModel = 'v090';
    renderDuelRows(data, search?.value || '');
    leaderboardRenderedFor = `${title}|v090`;
  } catch (error) {
    console.warn('Could not render weighted Alliance Duel leaderboard:', error);
  } finally {
    leaderboardBusy = false;
  }
}

function renderDuelRows(data, query) {
  const host = document.getElementById('participation-table');
  if (!host) return;
  const q = String(query || '').trim().toLowerCase();
  const rows = (data.players || []).filter(row => !q || String(row.name || '').toLowerCase().includes(q));
  if (!rows.length) {
    host.innerHTML = '<div class="empty">No matching players.</div>';
    return;
  }
  host.innerHTML = `<table class="responsive-table duel-season-table"><thead><tr>
    <th>Rank</th><th>Player</th><th class="numeric">Weighted Duel Avg</th><th class="numeric">6M Consistency</th><th class="numeric">League Raw Points</th><th class="numeric">Played Weeks</th>
  </tr></thead><tbody>${rows.map(row => {
    const duel = row.components?.alliance_duel || {};
    const qualification = row.qualification || {};
    return `<tr data-player="${esc(row.publicId)}"${qualification.finalCheckActive && !qualification.qualified ? ' class="duel-provisional"' : ''}>
      <td class="rank-cell">#${Number(row.rank || 0)}</td>
      <td class="player-cell"><strong>${esc(row.name)}</strong><small>${esc(row.allianceAbbr)} · S${Number(row.serverId || 0)}${qualification.finalCheckActive && !qualification.qualified ? ' · Provisional' : ''}</small></td>
      <td class="numeric score">${compactPoints(duel.weightedAverage || row.score)}</td>
      <td class="numeric"><strong>${Number(duel.consistencyPercent || 0).toFixed(1)}%</strong><br><small class="muted">${Number(duel.minimumDaysHit || 0)}/${Number(duel.minimumDaysAvailable || 0)} days</small></td>
      <td class="numeric">${format(duel.raw || 0)}</td>
      <td class="numeric">${Number(duel.playedWeeks || 0)}${qualification.finalCheckActive ? ` / ${Number(qualification.requiredDuelWeeks || 3)} required` : ''}</td>
    </tr>`;
  }).join('')}</tbody></table>`;
}

async function enhanceDuelAdmin() {
  const main = document.getElementById('main');
  if (main?.querySelector('.page-head h1')?.textContent?.trim() !== 'Administrator') return;
  polishFutureWeights(main);
  if (document.getElementById('duel-scoring-settings') || adminBusy) return;
  const anchor = document.getElementById('global-bye-weights') || document.getElementById('weights-form');
  if (!anchor) return;
  adminBusy = true;
  try {
    const data = await api('/api/admin/scoring-model');
    const duel = data.duel || {};
    const panel = document.createElement('section');
    panel.id = 'duel-scoring-settings';
    panel.className = 'section panel duel-scoring-admin';
    panel.innerHTML = `
      <div class="panel-head"><div><div class="panel-title">Alliance Duel scoring</div><div class="muted">The 1 / 2 / 2 / 2 / 2 / 4 day weights come directly from Duel win points and are fixed. These are the only adjustable ranking rules.</div></div></div>
      <div class="duel-admin-rule-grid">
        <label class="duel-admin-rule"><span><strong>Daily minimum</strong><small>Used for the red/green Duel standard and 6M Consistency.</small></span><input class="input" id="duel-model-minimum" type="number" min="0" step="100000" value="${Number(duel.dailyMinimum || 6_000_000)}"></label>
        <label class="duel-admin-rule"><span><strong>Final ranked weeks</strong><small>Actual played weeks required for an official placement once the four-week league is complete.</small></span><input class="input" id="duel-model-ranked-weeks" type="number" min="1" max="4" step="1" value="${Number(duel.minimumRankedDuelWeeks || 3)}"></label>
      </div>
      <div class="duel-fixed-weights"><strong>Fixed day weights</strong><span>Tank ×1</span><span>Build ×2</span><span>Science ×2</span><span>Hero ×2</span><span>Training ×2</span><span>Enemy Buster ×4</span></div>
      <div class="duel-admin-actions"><button class="btn btn-primary" id="save-duel-scoring-model">Save Alliance Duel rules</button><span class="duel-admin-status" id="duel-scoring-status"></span></div>`;
    anchor.insertAdjacentElement('afterend', panel);
    panel.querySelector('#save-duel-scoring-model').addEventListener('click', saveDuelScoringModel);
  } catch (error) {
    console.warn('Could not load Alliance Duel scoring settings:', error);
  } finally {
    adminBusy = false;
  }
}

function polishFutureWeights(main) {
  const form = document.getElementById('weights-form');
  if (!form || form.dataset.duelFutureCopy === '1') return;
  form.dataset.duelFutureCopy = '1';
  const panel = form.closest('.panel') || form.parentElement;
  const title = panel?.querySelector('.panel-title');
  const muted = panel?.querySelector('.panel-head .muted, .muted');
  if (title) title.textContent = 'Future combined event weights';
  if (muted) muted.textContent = 'Stored for the future combined model. They do not affect the current Alliance Duel ranking while State Ruler and Glory War scoring are being finalized.';
}

async function saveDuelScoringModel() {
  const body = {
    dailyMinimum: Number(document.getElementById('duel-model-minimum')?.value || 0),
    minimumRankedDuelWeeks: Number(document.getElementById('duel-model-ranked-weeks')?.value || 3),
  };
  const status = document.getElementById('duel-scoring-status');
  try {
    const data = await api('/api/admin/scoring-model', { method: 'POST', body: JSON.stringify(body) });
    if (status) {
      status.textContent = 'Alliance Duel rules saved. Guide and leaderboard use them immediately.';
      status.className = 'duel-admin-status success';
    }
    const duel = data.duel || {};
    if (document.getElementById('duel-model-minimum')) document.getElementById('duel-model-minimum').value = String(Number(duel.dailyMinimum || body.dailyMinimum));
    if (document.getElementById('duel-model-ranked-weeks')) document.getElementById('duel-model-ranked-weeks').value = String(Number(duel.minimumRankedDuelWeeks || body.minimumRankedDuelWeeks));
    guideRendered = false;
    leaderboardRenderedFor = '';
  } catch (error) {
    if (status) {
      status.textContent = error.message;
      status.className = 'duel-admin-status error';
    }
  }
}

function share(weight, total) { return `${(Number(weight || 0) * 100 / Math.max(1, Number(total || 1))).toFixed(1)}%`; }
function compact(value) {
  const n = Number(value || 0);
  if (n >= 1e9) return `${trim(n / 1e9)}B`;
  if (n >= 1e6) return `${trim(n / 1e6)}M`;
  if (n >= 1e3) return `${trim(n / 1e3)}K`;
  return new Intl.NumberFormat().format(n);
}
function compactPoints(value) { return compact(value); }
function trim(value) { return Number(value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2)).toString(); }
function format(value) { return new Intl.NumberFormat().format(Number(value || 0)); }
function esc(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c])); }
