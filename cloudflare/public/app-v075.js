import './app-v074.js';

let duelEntryPending = location.hash === '#duel';
let duelDefaultBusy = false;
let duelDefaultGeneration = 0;
let duelOutcomeBusy = false;
let duelOutcomeKey = '';
let guideSecuredBusy = false;
let adminSecuredBusy = false;

const observer = new MutationObserver(schedule);
observer.observe(document.getElementById('app'), { childList: true, subtree: true });
window.addEventListener('hashchange', () => {
  if (location.hash === '#duel') {
    duelEntryPending = true;
    markDuelResolving(true);
  } else {
    duelEntryPending = false;
    markDuelResolving(false);
  }
  duelOutcomeKey = '';
  schedule();
});
document.addEventListener('click', event => {
  const target = event.target.closest?.('[data-route="duel"],[data-card-route="duel"]');
  if (target) {
    duelEntryPending = true;
    duelOutcomeKey = '';
    markDuelResolving(true);
    setTimeout(schedule, 0);
  }
}, true);
schedule();

function schedule() {
  requestAnimationFrame(() => setTimeout(() => {
    defaultDuelToCurrentWeek();
    decorateDuelOutcomes();
    enhanceSecuredGuide();
    enhanceSecuredAdmin();
  }, 40));
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

function markDuelResolving(active) {
  const main = document.getElementById('main');
  if (!main) return;
  main.classList.toggle('duel-current-resolving', Boolean(active && location.hash === '#duel'));
}

function waitForDuelRender(timeoutMs = 5000) {
  const host = document.getElementById('duel-content');
  if (!host) return Promise.resolve();
  return new Promise(resolve => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      observer.disconnect();
      clearTimeout(timer);
      resolve();
    };
    const observer = new MutationObserver(() => {
      if (host.querySelector('.day-grid') || host.querySelector('.empty')) finish();
    });
    observer.observe(host, { childList: true, subtree: true });
    const timer = setTimeout(finish, timeoutMs);
  });
}

async function defaultDuelToCurrentWeek() {
  if (!duelEntryPending || duelDefaultBusy || location.hash !== '#duel') return;
  const cycle = document.getElementById('cycle-select');
  const week = document.getElementById('week-select');
  if (!cycle || !week) return;

  duelDefaultBusy = true;
  const generation = ++duelDefaultGeneration;
  markDuelResolving(true);
  try {
    const dashboard = await api('/api/dashboard');
    if (generation !== duelDefaultGeneration || location.hash !== '#duel') return;
    const currentCycle = String(dashboard.selectedCycleId || '');
    const currentWeek = Math.max(1, Math.min(4, Number(dashboard.summary?.currentWeek || 1)));

    if (currentCycle && String(cycle.value) !== currentCycle) {
      const waiting = waitForDuelRender();
      cycle.value = currentCycle;
      cycle.dispatchEvent(new Event('change', { bubbles: true }));
      await waiting;
      if (generation !== duelDefaultGeneration || location.hash !== '#duel') return;
    }

    const liveWeek = document.getElementById('week-select');
    if (liveWeek && String(liveWeek.value) !== String(currentWeek)) {
      const waiting = waitForDuelRender();
      liveWeek.value = String(currentWeek);
      liveWeek.dispatchEvent(new Event('change', { bubbles: true }));
      await waiting;
      if (generation !== duelDefaultGeneration || location.hash !== '#duel') return;
    }

    duelEntryPending = false;
    duelOutcomeKey = '';
    await decorateDuelOutcomes(true);
  } catch (error) {
    console.warn('Could not default Alliance Duel to the current week:', error);
    duelEntryPending = false;
  } finally {
    duelDefaultBusy = false;
    if (generation === duelDefaultGeneration) markDuelResolving(false);
  }
}

async function decorateDuelOutcomes(force = false) {
  if (location.hash !== '#duel' || duelOutcomeBusy || duelEntryPending) return;
  const cycle = document.getElementById('cycle-select');
  const week = document.getElementById('week-select');
  const grid = document.querySelector('#duel-content .day-grid');
  if (!cycle || !week || !grid) return;
  const key = `${cycle.value}|${week.value}|${grid.textContent.length}`;
  if (!force && duelOutcomeKey === key && grid.dataset.outcomesV094 === '1') return;
  duelOutcomeBusy = true;
  try {
    const selectedCycle = String(cycle.value);
    const selectedWeek = String(week.value);
    const data = await api(`/api/duel?cycle=${encodeURIComponent(selectedCycle)}&week=${encodeURIComponent(selectedWeek)}`);
    if (location.hash !== '#duel' || String(document.getElementById('cycle-select')?.value || '') !== selectedCycle || String(document.getElementById('week-select')?.value || '') !== selectedWeek) return;
    const cards = [...document.querySelectorAll('#duel-content .day-card')];
    for (const day of data.days || []) {
      const card = cards.find(node => Number(node.dataset.day || 0) === Number(day.dayIndex || 0));
      if (!card) continue;
      card.querySelector('.duel-outcome-badges')?.remove();
      const badges = document.createElement('div');
      badges.className = 'duel-outcome-badges';
      if (day.outcomeKnown) {
        badges.insertAdjacentHTML('beforeend', day.isWin
          ? '<span class="duel-result-badge win">WIN</span>'
          : '<span class="duel-result-badge loss">LOSS</span>');
      }
      if (day.weekSecuredHere) badges.insertAdjacentHTML('beforeend', '<span class="duel-result-badge secured">WEEK SECURED</span>');
      if (day.afterWeekSecured) badges.insertAdjacentHTML('beforeend', `<span class="duel-result-badge reduced">${Math.round(Number(day.securedWeekMultiplier || 1) * 100)}% SCORE WEIGHT</span>`);
      if (badges.children.length) card.querySelector('.day-number')?.insertAdjacentElement('afterend', badges);
      if (day.opponentScore != null) {
        const note = card.querySelector('.day-note');
        if (note) note.textContent = `${day.isWin ? 'WDZ win' : 'WDZ loss'} · WDZ ${format(day.officialAllianceScore)} vs ${format(day.opponentScore)}`;
      }
    }
    document.querySelector('.duel-week-state')?.remove();
    if (data.weekOutcome) {
      const outcome = data.weekOutcome;
      const panel = document.createElement('section');
      panel.className = `duel-week-state ${outcome.secured ? 'secured' : ''}`;
      const knownCopy = Number(outcome.knownDays || 0)
        ? `${Number(outcome.knownDays)} completed day${Number(outcome.knownDays) === 1 ? '' : 's'} recorded.`
        : 'No completed-day result has been recorded yet.';
      panel.innerHTML = `<div><span class="eyebrow">DUEL WEEK STATUS</span><strong>${Number(outcome.pointsWon || 0)} / ${Number(outcome.totalPoints || 13)} points won</strong></div><div class="duel-week-state-copy">${outcome.secured ? `Week secured on ${escapeHtml(outcome.securedDayName)}. Later days count at ${Math.round(Number(outcome.securedWeekWeight || 0.35) * 100)}% for Contribution scoring.` : `${Number(outcome.winThreshold || 7)} points are required to secure the week. ${knownCopy}`}</div>`;
      grid.insertAdjacentElement('afterend', panel);
    }
    grid.dataset.outcomesV094 = '1';
    duelOutcomeKey = key;
  } catch (error) {
    console.warn('Could not decorate Duel outcomes:', error);
  } finally {
    duelOutcomeBusy = false;
  }
}

async function enhanceSecuredGuide() {
  if (location.hash !== '#guide' || guideSecuredBusy) return;
  const page = document.querySelector('.duel-guide-page');
  if (!page || page.querySelector('.secured-week-guide')) return;
  guideSecuredBusy = true;
  try {
    const data = await api('/api/scoring-guide');
    const duel = data.duel || {};
    const weight = Math.round(Number(duel.securedWeekWeight ?? 0.35) * 100);
    const threshold = Number(duel.weekWinThreshold || 7);
    const formula = page.querySelector('.duel-formula-card');
    const section = document.createElement('section');
    section.className = 'secured-week-guide';
    section.innerHTML = `
      <div class="secured-week-guide-icon">✓</div>
      <div class="secured-week-guide-copy">
        <div class="eyebrow">WHEN THE WEEK IS ALREADY WON</div>
        <h2>Push when the points still matter. Save when the result is secured.</h2>
        <p>WDZ secures a Duel week as soon as it reaches <strong>${threshold} of 13</strong> win points. The day that reaches ${threshold} still counts at full value because it helped clinch the week. Only the days after that are reduced.</p>
      </div>
      <div class="secured-week-guide-weight"><span>After clinch</span><strong>${weight}%</strong><small>of the normal score value</small></div>
      <div class="secured-week-example"><span>Example</span><strong>Hero Day reaches 7 points → Hero counts normally → Training + Enemy Buster use ${weight}% score weight.</strong></div>`;
    if (formula) formula.insertAdjacentElement('afterend', section);
    else page.appendChild(section);
  } catch (error) {
    console.warn('Could not add secured-week Guide rule:', error);
  } finally {
    guideSecuredBusy = false;
  }
}

async function enhanceSecuredAdmin() {
  const main = document.getElementById('main');
  if (main?.querySelector('.page-head h1')?.textContent?.trim() !== 'Administrator' || adminSecuredBusy) return;
  const panel = document.getElementById('duel-scoring-settings');
  if (!panel || panel.dataset.securedV094 === '1') return;
  adminSecuredBusy = true;
  try {
    const data = await api('/api/admin/scoring-model');
    const duel = data.duel || {};
    const grid = panel.querySelector('.duel-admin-rule-grid');
    if (!grid) return;
    const row = document.createElement('label');
    row.className = 'duel-admin-rule secured-admin-rule';
    row.innerHTML = `<span><strong>Secured week weight</strong><small>After WDZ reaches 7 of 13 week points, later Duel days use this share of their normal score value. The clinching day still counts fully.</small></span><div class="secured-admin-input"><input class="input" id="duel-secured-week-weight" type="number" min="0" max="1" step="0.05" value="${Number(duel.securedWeekWeight ?? 0.35)}"><span>0–1</span></div>`;
    grid.appendChild(row);

    const oldButton = panel.querySelector('#save-duel-scoring-model');
    if (oldButton) {
      const button = oldButton.cloneNode(true);
      oldButton.replaceWith(button);
      button.addEventListener('click', async () => {
        const status = panel.querySelector('#duel-scoring-status');
        button.disabled = true;
        if (status) status.textContent = 'Saving…';
        try {
          const result = await api('/api/admin/scoring-model', {
            method: 'POST',
            body: JSON.stringify({
              dailyMinimum: Number(document.getElementById('duel-model-minimum')?.value || 0),
              minimumRankedDuelWeeks: Number(document.getElementById('duel-model-ranked-weeks')?.value || 3),
              securedWeekWeight: Number(document.getElementById('duel-secured-week-weight')?.value || 0.35),
            }),
          });
          const next = Number(result.duel?.securedWeekWeight ?? result.settings?.securedWeekWeight ?? 0.35);
          document.getElementById('duel-secured-week-weight').value = String(next);
          if (status) status.textContent = 'Saved. Leaderboard scoring and Guide updated.';
          document.querySelector('.secured-week-guide')?.remove();
        } catch (error) {
          if (status) status.textContent = error.message;
        } finally {
          button.disabled = false;
        }
      });
    }
    panel.dataset.securedV094 = '1';
  } catch (error) {
    console.warn('Could not add secured-week Admin setting:', error);
  } finally {
    adminSecuredBusy = false;
  }
}

function format(value) { return new Intl.NumberFormat().format(Number(value || 0)); }
function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[char])); }
