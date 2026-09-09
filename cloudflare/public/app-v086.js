import './app-v085.js?v=116';

let scheduled = false;
let leaderboardBusy = false;
let guideBusy = false;
let adminBusy = false;

const observer = new MutationObserver(schedule);
observer.observe(document.getElementById('app'), { childList: true, subtree: true });
window.addEventListener('hashchange', schedule);
schedule();

function schedule() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => setTimeout(async () => {
    scheduled = false;
    await Promise.allSettled([
      enhanceGloryContributionLeaderboard(),
      enhanceGloryContributionGuide(),
      enhanceGloryContributionAdmin(),
    ]);
  }, 80));
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

async function enhanceGloryContributionLeaderboard() {
  if (location.hash !== '#leaderboards' || leaderboardBusy) return;
  const host = document.getElementById('participation-table');
  const table = host?.querySelector('.combined-contribution-table');
  if (!host || !table || host.dataset.gloryContributionV117 === '1') return;

  leaderboardBusy = true;
  try {
    const data = await api('/api/participation');
    if (location.hash !== '#leaderboards') return;
    const currentHost = document.getElementById('participation-table');
    const currentTable = currentHost?.querySelector('.combined-contribution-table');
    if (!currentHost || !currentTable) return;

    const playerById = new Map((data.players || []).map(row => [String(row.publicId || ''), row]));
    const gloryColumn = [...currentTable.querySelectorAll('thead th')].findIndex(node => node.textContent.trim() === 'Glory War');
    if (gloryColumn < 0) return;

    currentTable.querySelectorAll('tbody tr[data-player]').forEach(row => {
      const player = playerById.get(String(row.dataset.player || ''));
      const glory = player?.components?.glory_war || {};
      const cell = row.children[gloryColumn];
      if (!cell) return;
      cell.className = 'numeric event-index-cell';
      cell.innerHTML = `<strong>${Number(glory.eventIndex || 0).toFixed(1)}</strong><small>Index · ${compactPoints(glory.averageCreditedScore || 0)} avg · ${Number(glory.playedEvents || 0)}/${Number(glory.eligibleEvents || 0)} events</small>`;
    });

    const main = document.getElementById('main');
    const subtitle = main?.querySelector('.page-head p');
    if (subtitle) subtitle.textContent = 'Alliance Duel, State Ruler, and Glory War performance on one shared Contribution Index.';
    main?.querySelector('.combined-provisional-banner')?.remove();
    currentHost.dataset.gloryContributionV117 = '1';
  } catch (error) {
    console.warn('Could not activate Glory War Contribution leaderboard:', error);
  } finally {
    leaderboardBusy = false;
  }
}

async function enhanceGloryContributionGuide() {
  if (location.hash !== '#guide' || guideBusy) return;
  const section = document.querySelector('.combined-guide-section');
  if (!section || section.dataset.gloryContributionV117 === '1') return;

  guideBusy = true;
  try {
    const data = await api('/api/scoring-guide');
    const contribution = data.contribution || {};
    const scales = contribution.scales || {};
    const examples = contribution.examples || {};

    const intro = section.querySelector('.combined-guide-head p');
    if (intro) intro.textContent = 'Alliance Duel, State Ruler, and Glory War use different raw point ranges, so the portal converts each finalized event result to the same Contribution Index before applying the event weights.';

    const scaleGrid = section.querySelector('.combined-scale-grid');
    if (scaleGrid && !scaleGrid.querySelector('[data-glory-scale]')) {
      const card = document.createElement('article');
      card.className = 'combined-scale-card';
      card.dataset.gloryScale = '1';
      card.innerHTML = `<div class="eyebrow">Glory War</div><strong class="scale-baseline">${compactPoints(scales.gloryWarBaseline)} = 100</strong><span>Credited Glory War score</span><div class="scale-examples">${(examples.gloryWar || []).slice(0, 3).map(row => `<small>${Number(row.multiplier)}× = ${Number(row.index).toFixed(0)}</small>`).join('')}</div>`;
      scaleGrid.appendChild(card);
    }

    let gloryRules = section.querySelector('[data-glory-rules]');
    if (!gloryRules) {
      gloryRules = document.createElement('div');
      gloryRules.className = 'state-ruler-guide-grid';
      gloryRules.dataset.gloryRules = '1';
      gloryRules.innerHTML = `
        ${ruleCard('GLORY SCORE', 'Real captured score', 'A captured WDZ Glory War score is normalized against the Glory War baseline using the same square-root Contribution Index curve.')}
        ${ruleCard('MISS', '0 for a completed event', 'If a Glory War happened and a player has no captured score, that event counts as zero for that player.')}
        ${ruleCard('LEAVE', 'Neutral', 'Approved On Leave removes that Glory War from the player\'s personal event average rather than creating a zero.')}
        ${ruleCard('NO EVENT', 'Excluded', 'An Admin No Event week is removed completely. Glory War Bye weeks remain eligible but use the configured Bye multiplier.')}`;
      section.querySelector('.combined-guide-note')?.insertAdjacentElement('beforebegin', gloryRules);
    }

    const note = section.querySelector('.combined-guide-note');
    if (note) note.innerHTML = `<strong>Event adjustments:</strong><span>State Ruler and Glory War calculate their event index first, then apply the live Admin Bye multiplier. No Event and On Leave are excluded; a genuine missed completed event is zero. Glory War has no separate win bonus.</span>`;

    section.dataset.gloryContributionV117 = '1';
  } catch (error) {
    console.warn('Could not add Glory War Contribution Guide:', error);
  } finally {
    guideBusy = false;
  }
}

async function enhanceGloryContributionAdmin() {
  const main = document.getElementById('main');
  if (main?.querySelector('.page-head h1')?.textContent?.trim() !== 'Administrator' || adminBusy) return;
  const section = document.getElementById('contribution-scale-settings');
  if (!section || section.dataset.gloryContributionV117 === '1') return;

  adminBusy = true;
  try {
    const data = await api('/api/admin/contribution-model');
    const scales = data.scales || {};
    const grid = section.querySelector('.contribution-scale-grid');
    if (!grid) return;

    if (!document.getElementById('contribution-glory-baseline')) {
      const row = document.createElement('label');
      row.className = 'contribution-scale-row';
      row.innerHTML = `<span><strong>Glory War baseline</strong><small>Credited Glory War score that equals Contribution Index 100.</small></span><input class="input" id="contribution-glory-baseline" type="number" min="1" max="1000000000000" step="50000" value="${Number(scales.gloryWarBaseline || 1000000)}">`;
      const rulerFloor = document.getElementById('contribution-ruler-floor')?.closest('.contribution-scale-row');
      if (rulerFloor) grid.insertBefore(row, rulerFloor);
      else grid.appendChild(row);
    }

    const muted = section.querySelector('.panel-head .muted');
    if (muted) muted.textContent = 'These values put Alliance Duel, State Ruler, and Glory War onto the same Contribution Index without changing any raw event leaderboard.';

    const weightForm = document.getElementById('weights-form');
    if (weightForm) {
      weightForm.querySelectorAll('.contribution-weight-row').forEach(row => {
        const strong = row.querySelector('strong');
        const small = row.querySelector('small');
        if (strong?.textContent?.trim() === 'Glory War' && small) small.textContent = 'Active in the current combined ranking.';
      });
      const panel = weightForm.closest('.card,.panel') || weightForm.parentElement;
      const copy = panel?.querySelector('.muted');
      if (copy && /reserved|finalized/i.test(copy.textContent || '')) copy.textContent = 'These percentages determine how much each event contributes to the final score. All three event models are active.';
    }

    const oldButton = document.getElementById('save-contribution-scales');
    if (oldButton && oldButton.dataset.gloryContributionV117 !== '1') {
      const button = oldButton.cloneNode(true);
      button.dataset.gloryContributionV117 = '1';
      oldButton.replaceWith(button);
      button.addEventListener('click', saveContributionScales);
    }

    section.dataset.gloryContributionV117 = '1';
  } catch (error) {
    console.warn('Could not add Glory War Admin normalization setting:', error);
  } finally {
    adminBusy = false;
  }
}

async function saveContributionScales() {
  const button = document.getElementById('save-contribution-scales');
  const status = document.getElementById('contribution-scale-status');
  if (button) button.disabled = true;
  if (status) status.textContent = 'Saving…';
  try {
    const result = await api('/api/admin/contribution-model', {
      method: 'POST',
      body: JSON.stringify({
        duelBaseline: Number(document.getElementById('contribution-duel-baseline')?.value || 0),
        stateRulerBaseline: Number(document.getElementById('contribution-ruler-baseline')?.value || 0),
        gloryWarBaseline: Number(document.getElementById('contribution-glory-baseline')?.value || 0),
        stateRulerAttendanceFloor: Number(document.getElementById('contribution-ruler-floor')?.value || 0),
        curveExponent: Number(document.getElementById('contribution-curve')?.value || 0.5),
      }),
    });
    const scales = result.scales || {};
    setInput('contribution-duel-baseline', scales.duelBaseline);
    setInput('contribution-ruler-baseline', scales.stateRulerBaseline);
    setInput('contribution-glory-baseline', scales.gloryWarBaseline);
    setInput('contribution-ruler-floor', scales.stateRulerAttendanceFloor);
    setInput('contribution-curve', scales.curveExponent);
    if (status) status.textContent = 'Saved. Duel, State Ruler, Glory War, and Guide normalization updated.';
    document.querySelector('.duel-guide-page')?.removeAttribute('data-combined-v100');
    document.querySelector('.combined-guide-section')?.removeAttribute('data-glory-contribution-v117');
    document.getElementById('participation-table')?.removeAttribute('data-glory-contribution-v117');
  } catch (error) {
    if (status) status.textContent = error.message;
  } finally {
    if (button) button.disabled = false;
  }
}

function setInput(id, value) {
  const node = document.getElementById(id);
  if (node && value !== undefined && value !== null) node.value = String(value);
}

function ruleCard(kicker, title, copy) {
  return `<article class="combined-rule-card"><span>${esc(kicker)}</span><strong>${esc(title)}</strong><p>${esc(copy)}</p></article>`;
}

function compactPoints(value) {
  const n = Number(value || 0);
  if (Math.abs(n) >= 1e9) return `${(n / 1e9).toFixed(n >= 10e9 ? 1 : 2)}B`;
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(n >= 10e6 ? 1 : 2)}M`;
  if (Math.abs(n) >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return new Intl.NumberFormat().format(n);
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[char]));
}
