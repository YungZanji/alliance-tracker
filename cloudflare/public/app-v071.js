import './app-v070.js';

let scheduled = false;
let guideLoading = false;
let guideLoaded = false;
const observer = new MutationObserver(schedule);
observer.observe(document.getElementById('app'), { childList: true, subtree: true });
window.addEventListener('hashchange', () => {
  guideLoaded = false;
  schedule();
});
window.addEventListener('popstate', () => {
  guideLoaded = false;
  schedule();
});
schedule();

function schedule() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => setTimeout(async () => {
    scheduled = false;
    ensureGuideNav();
    if (location.hash === '#guide') {
      await renderGuide();
    } else {
      guideLoaded = false;
    }
    await enhanceScoringAdmin();
    polishParticipationCopy();
  }, 30));
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
    guideLoaded = false;
    history.pushState(null, '', '#guide');
    renderGuide(true);
  });
  const admin = [...links.querySelectorAll('.nav-link')].find(node => node.textContent.trim() === 'Admin');
  if (admin) links.insertBefore(button, admin);
  else links.appendChild(button);
}

async function renderGuide(force = false) {
  const main = document.getElementById('main');
  if (!main || location.hash !== '#guide') return;
  if (guideLoading) return;
  if (guideLoaded && !force && main.querySelector('.guide-page')) return;

  guideLoading = true;
  document.querySelectorAll('.nav-link[data-route]').forEach(button => button.classList.remove('active'));
  document.querySelector('.guide-nav')?.classList.add('active');
  if (!main.querySelector('.guide-page')) main.innerHTML = '<div class="empty">Loading scoring guide…</div>';

  try {
    const data = await api('/api/scoring-guide');
    if (location.hash !== '#guide') return;
    main.innerHTML = guideMarkup(data);
    guideLoaded = true;
  } catch (error) {
    if (location.hash !== '#guide') return;
    main.innerHTML = `<div class="empty"><strong>Scoring Guide could not load.</strong><div class="muted" style="margin-top:8px">${esc(error.message)}</div><button type="button" class="btn btn-secondary" id="guide-retry" style="margin-top:16px">Try again</button></div>`;
    main.querySelector('#guide-retry')?.addEventListener('click', () => {
      guideLoaded = false;
      renderGuide(true);
    });
  } finally {
    guideLoading = false;
  }
}

function guideMarkup(data) {
  const s = data.settings || {};
  const weights = data.weights || [];
  const byes = data.byeWeights || {};
  const dayNames = s.dayNames || ['Tank Day','Build Day','Science Day','Hero Day','Training Day','Enemy Buster'];
  const duelDays = s.duelDays || [];
  const dailyMinimum = Number(s.dailyMinimum || 6000000);
  const weightCards = weights.map(row => `
    <article class="guide-card">
      <div class="eyebrow">${esc(row.label)}</div>
      <div class="guide-number">${Number(row.percent || 0).toFixed(0)}%</div>
      <p>${row.enabled ? 'Current share of the Overall Contribution Score when this event has usable scoring.' : 'Currently disabled in Admin.'}</p>
    </article>`).join('');
  const duelBenchmarkCards = dayNames.map((name, index) => `
    <article class="guide-card">
      <div class="eyebrow">Alliance Duel</div>
      <h3>${esc(name)}</h3>
      <div class="guide-number">${compact(duelDays[index])}</div>
      <p>Current Admin benchmark for ${esc(name)}.</p>
    </article>`).join('');
  const eventBenchmarks = `
    <article class="guide-card"><div class="eyebrow">State Ruler</div><h3>Weekly benchmark</h3><div class="guide-number">${compact(s.stateRuler)}</div><p>Current Admin benchmark for a State Ruler week.</p></article>
    <article class="guide-card"><div class="eyebrow">Glory War</div><h3>Event benchmark</h3><div class="guide-number">${Number(s.gloryWar || 0) > 0 ? compact(s.gloryWar) : 'Not set'}</div><p>${Number(s.gloryWar || 0) > 0 ? 'Current Admin Glory War benchmark.' : 'Glory War stays out of Contribution Score until a benchmark is configured.'}</p></article>`;

  return `
    <div class="guide-page">
      <section class="guide-hero">
        <div class="eyebrow">WDZ · SCORING GUIDE</div>
        <h1>Score high. Do it consistently.</h1>
        <p>This page always reflects the current scoring settings chosen by WDZ leadership.</p>
        <div style="margin-top:18px"><span class="guide-live">Live Admin settings</span></div>
      </section>

      <section>
        <div class="eyebrow" style="margin-bottom:10px">THE BASICS</div>
        <div class="guide-rule-grid">
          ${ruleCard('1','Hit the Duel minimum',`${compact(dailyMinimum)} every Alliance Duel day is the current standard. Falling below it stays visibly flagged.`)}
          ${ruleCard('2','Put up strong scores','Your real event points remain visible. Strong contributions should stand out.')}
          ${ruleCard('3','Do it consistently','Contribution is measured across the weeks you participate in, not from one isolated performance.')}
          ${ruleCard('4','Real life is allowed',`Approved On Leave weeks do not count against that player. Final Duel placement currently requires ${Number(s.minimumRankedDuelWeeks || 3)} played weeks.`)}
        </div>
      </section>

      <section>
        <div class="eyebrow" style="margin-bottom:10px">OVERALL EVENT WEIGHTS</div>
        <div class="guide-weight-grid">${weightCards}</div>
        <div class="guide-note" style="margin-top:12px">Leadership can adjust event weights in Admin. The values shown here update automatically.</div>
      </section>

      <section>
        <div class="eyebrow" style="margin-bottom:10px">CURRENT ALLIANCE DUEL BENCHMARKS</div>
        <div class="guide-benchmark-grid">${duelBenchmarkCards}</div>
      </section>

      <section>
        <div class="eyebrow" style="margin-bottom:10px">OTHER EVENT BENCHMARKS</div>
        <div class="guide-benchmark-grid">${eventBenchmarks}</div>
      </section>

      <section>
        <div class="eyebrow" style="margin-bottom:10px">NORMAL, BYE & LEAVE</div>
        <div class="guide-rule-grid">
          ${ruleCard('✓','Normal week','A normal competitive week carries full importance.')}
          ${ruleCard('↘','Alliance Duel Bye',`Current global default: ${pct(byes.alliance_duel)}. A specific week can have its own override.`)}
          ${ruleCard('↘','Glory / SVS Bye',`Glory War ${pct(byes.glory_war)} · State Ruler ${pct(byes.state_ruler)} current global defaults.`)}
          ${ruleCard('—','Approved On Leave','An approved leave week is neutral for that player. A missed week without approved leave is not treated as leave.')}
        </div>
      </section>
    </div>`;
}

function ruleCard(icon, title, copy) {
  return `<article class="guide-card"><div class="guide-rule-icon">${esc(icon)}</div><h3>${esc(title)}</h3><p>${esc(copy)}</p></article>`;
}

async function enhanceScoringAdmin() {
  const main = document.getElementById('main');
  if (main?.querySelector('.page-head h1')?.textContent?.trim() !== 'Administrator') return;
  const weights = document.getElementById('weights-form');
  if (!weights || document.getElementById('contribution-benchmarks')) return;

  const section = document.createElement('section');
  section.id = 'contribution-benchmarks';
  section.className = 'section panel benchmark-admin';
  section.innerHTML = `
    <div class="panel-head"><div><div class="panel-title">Contribution benchmarks</div><div class="muted">Scoring controls used by the current model and Guide. Save changes here, then the Guide updates automatically.</div></div></div>
    <div class="benchmark-group-title">Alliance Duel rules</div>
    <div class="benchmark-grid benchmark-grid-single">
      ${benchmarkRow('Daily minimum','duel-daily-minimum','The red/green daily standard shown on Alliance Duel.')}
      ${benchmarkRow('Final ranked weeks','minimum-ranked-weeks','Played Duel weeks required for an official final placement.', '1')}
    </div>
    <div class="benchmark-group-title">Alliance Duel day benchmarks</div>
    <div class="benchmark-grid benchmark-grid-single" id="duel-benchmark-grid"></div>
    <div class="benchmark-group-title">Other event benchmarks</div>
    <div class="benchmark-grid benchmark-grid-single">
      ${benchmarkRow('State Ruler','benchmark-state-ruler','Current State Ruler benchmark.')}
      ${benchmarkRow('Glory War','benchmark-glory-war','Set to 0 while Glory War scoring is still being trained.')}
    </div>
    <div class="benchmark-actions">
      <button class="btn btn-primary" type="button" id="save-contribution-benchmarks">Save benchmarks</button>
      <span class="duel-admin-status" id="contribution-benchmark-status"></span>
    </div>`;
  const anchor = document.getElementById('global-bye-weights') || weights;
  anchor.insertAdjacentElement('afterend', section);
  section.querySelector('#save-contribution-benchmarks').addEventListener('click', saveScoringModel);
  try {
    const data = await api('/api/admin/scoring-model');
    fillScoringAdmin(data);
  } catch (error) {
    setStatus(error.message, true);
  }
}

function benchmarkRow(label, id, note, step='100000') {
  return `<div class="benchmark-row"><div class="benchmark-copy"><strong>${esc(label)}</strong><div class="muted">${esc(note)}</div></div><input class="input benchmark-input" id="${id}" type="number" min="0" step="${step}"></div>`;
}

function fillScoringAdmin(data) {
  const s = data.settings || {};
  setValue('duel-daily-minimum', s.dailyMinimum);
  setValue('minimum-ranked-weeks', s.minimumRankedDuelWeeks);
  setValue('benchmark-state-ruler', s.stateRuler);
  setValue('benchmark-glory-war', s.gloryWar);
  const grid = document.getElementById('duel-benchmark-grid');
  if (grid) {
    grid.innerHTML = (s.dayNames || []).map((name, index) => benchmarkRow(name, `benchmark-duel-${index + 1}`, `Current ${name} benchmark.`)).join('');
    (s.duelDays || []).forEach((value, index) => setValue(`benchmark-duel-${index + 1}`, value));
  }
}

async function saveScoringModel() {
  const body = {
    dailyMinimum: numberValue('duel-daily-minimum'),
    minimumRankedDuelWeeks: numberValue('minimum-ranked-weeks'),
    stateRuler: numberValue('benchmark-state-ruler'),
    gloryWar: numberValue('benchmark-glory-war'),
    duelDays: Array.from({ length: 6 }, (_, index) => numberValue(`benchmark-duel-${index + 1}`)),
  };
  try {
    const data = await api('/api/admin/scoring-model', { method: 'POST', body: JSON.stringify(body) });
    fillScoringAdmin(data);
    setStatus('Settings saved. The Guide will use the new values immediately.', false, true);
    guideLoaded = false;
  } catch (error) {
    setStatus(error.message, true);
  }
}

function polishParticipationCopy() {
  const main = document.getElementById('main');
  const title = main?.querySelector('.page-head h1')?.textContent || '';
  if (!title.startsWith('Alliance Leaderboards')) return;
  const subtitle = main.querySelector('.page-head p');
  if (subtitle) subtitle.textContent = 'Contribution rankings combine event performance across the current scoring rules.';
}

function setValue(id, value) { const node = document.getElementById(id); if (node) node.value = String(Number(value || 0)); }
function numberValue(id) { return Number(document.getElementById(id)?.value || 0); }
function setStatus(message, error=false, success=false) {
  const node = document.getElementById('contribution-benchmark-status');
  if (!node) return;
  node.textContent = message || '';
  node.classList.toggle('error', error);
  node.classList.toggle('success', success && !error);
}
function compact(value) {
  const n = Number(value || 0);
  if (n >= 1e9) return `${trim(n / 1e9)}B`;
  if (n >= 1e6) return `${trim(n / 1e6)}M`;
  if (n >= 1e3) return `${trim(n / 1e3)}K`;
  return new Intl.NumberFormat().format(n);
}
function trim(value) { return Number(value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2)).toString(); }
function pct(value) { return `${Math.round(Number(value || 0) * 100)}%`; }
function esc(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c])); }
