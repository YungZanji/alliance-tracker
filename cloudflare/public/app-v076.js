import './app-v075.js';

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
      enhanceCombinedLeaderboard(),
      enhanceCombinedGuide(),
      enhanceContributionAdmin(),
    ]);
  }, 55));
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

async function enhanceCombinedLeaderboard() {
  if (location.hash !== '#leaderboards' || leaderboardBusy) return;
  const main = document.getElementById('main');
  const host = document.getElementById('participation-table');
  const title = main?.querySelector('.page-head h1')?.textContent?.trim() || '';
  if (!host || !title.startsWith('Alliance Leaderboards') || host.dataset.combinedV100 === '1') return;

  leaderboardBusy = true;
  main?.classList.add('combined-contribution-loading');
  try {
    const data = await api('/api/participation');
    if (location.hash !== '#leaderboards' || !document.getElementById('participation-table')) return;

    const subtitle = main.querySelector('.page-head p');
    if (subtitle) subtitle.textContent = 'Alliance Duel and State Ruler performance on one shared Contribution Index.';
    const method = main.querySelector('.method-box');
    if (method) method.innerHTML = `<strong>How this works:</strong> ${esc(data.method || '')}`;
    const panelTitle = main.querySelector('.panel-title');
    if (panelTitle) panelTitle.textContent = 'Overall Contribution ranking';
    const panelMuted = main.querySelector('.panel-head .muted');
    if (panelMuted) panelMuted.textContent = 'Alliance Duel 45%, State Ruler 25%, Glory War 30% by default. Every value shown here is driven by the live Admin settings.';

    let search = document.getElementById('participation-search');
    if (search && search.dataset.combinedSearch !== '1') {
      const replacement = search.cloneNode(true);
      replacement.dataset.combinedSearch = '1';
      replacement.value = '';
      search.replaceWith(replacement);
      search = replacement;
      search.addEventListener('input', event => renderCombinedRows(data, event.target.value));
    }

    host.dataset.duelModel = 'v090'; // Keep the older Duel-only enhancer from repainting over this table.
    host.dataset.combinedV100 = '1';
    renderCombinedRows(data, search?.value || '');
    ensureProvisionalBanner(main, data);
  } catch (error) {
    console.warn('Could not render combined Contribution leaderboard:', error);
  } finally {
    leaderboardBusy = false;
    main?.classList.remove('combined-contribution-loading');
  }
}

function renderCombinedRows(data, query) {
  const host = document.getElementById('participation-table');
  if (!host) return;
  const q = String(query || '').trim().toLowerCase();
  const rows = (data.players || []).filter(row => !q || String(row.name || '').toLowerCase().includes(q));
  if (!rows.length) {
    host.innerHTML = '<div class="empty">No matching players.</div>';
    return;
  }

  const weights = data.contribution?.weights || {};
  host.innerHTML = `<table class="responsive-table combined-contribution-table"><thead><tr>
    <th>Rank</th><th>Player</th><th class="numeric">Overall Contribution</th><th class="numeric">Alliance Duel</th><th class="numeric">State Ruler</th><th class="numeric">Glory War</th>
  </tr></thead><tbody>${rows.map(row => {
    const duel = row.components?.alliance_duel || {};
    const ruler = row.components?.state_ruler || {};
    return `<tr data-player="${esc(row.publicId)}">
      <td class="rank-cell">#${Number(row.rank || 0)}</td>
      <td class="player-cell"><strong>${esc(row.name)}</strong><small>${esc(row.allianceAbbr)} · S${Number(row.serverId || 0)}</small></td>
      <td class="numeric contribution-score"><strong>${Number(row.score || 0).toFixed(1)}</strong><small>Duel ${pct(weights.alliance_duel)} · Ruler ${pct(weights.state_ruler)} · Glory ${pct(weights.glory_war)}</small></td>
      <td class="numeric event-index-cell"><strong>${Number(duel.eventIndex || 0).toFixed(1)}</strong><small>Index · ${compactPoints(duel.weightedAverage || 0)} weighted avg</small></td>
      <td class="numeric event-index-cell"><strong>${Number(ruler.eventIndex || 0).toFixed(1)}</strong><small>Index · ${compactPoints(ruler.averageCreditedScore || 0)} avg · ${Number(ruler.playedWeeks || 0)}/${Number(ruler.eligibleWeeks || 0)} weeks</small></td>
      <td class="numeric event-index-cell pending"><strong>Pending</strong><small>${pct(weights.glory_war)} reserved</small></td>
    </tr>`;
  }).join('')}</tbody></table>`;
}

function ensureProvisionalBanner(main, data) {
  main.querySelector('.combined-provisional-banner')?.remove();
  if (!data.contribution?.provisional) return;
  const panel = main.querySelector('#participation-table')?.closest('.panel');
  if (!panel) return;
  const banner = document.createElement('div');
  banner.className = 'combined-provisional-banner';
  banner.innerHTML = `<strong>Combined score is provisional.</strong><span>Alliance Duel and State Ruler are live. Glory War's ${pct(data.contribution?.weights?.glory_war)} share is reserved at zero until its scoring model is finalized, so the existing event scores will not be reweighted later.</span>`;
  panel.querySelector('.panel-head')?.insertAdjacentElement('afterend', banner);
}

async function enhanceCombinedGuide() {
  if (location.hash !== '#guide' || guideBusy) return;
  const page = document.querySelector('.duel-guide-page');
  if (!page || page.dataset.combinedV100 === '1') return;
  guideBusy = true;
  try {
    const data = await api('/api/scoring-guide');
    const contribution = data.contribution || {};
    const scales = contribution.scales || {};
    const weights = contribution.weights || {};
    const examples = contribution.examples || {};
    const stateExamples = examples.stateRuler || [];
    const duelExamples = examples.duel || [];

    const section = document.createElement('section');
    section.className = 'combined-guide-section';
    section.innerHTML = `
      <div class="combined-guide-head">
        <div><div class="eyebrow">OVERALL CONTRIBUTION</div><h2>Different events. One fair scale.</h2><p>Alliance Duel and State Ruler use completely different raw point ranges, so the portal converts each finalized event result to a shared Contribution Index before applying the event weights.</p></div>
        <div class="combined-weight-ring"><strong>${pct(weights.alliance_duel)}</strong><span>Duel</span><strong>${pct(weights.state_ruler)}</strong><span>State Ruler</span><strong>${pct(weights.glory_war)}</strong><span>Glory</span></div>
      </div>
      <div class="combined-scale-grid">
        ${scaleCard('Alliance Duel', compactPoints(scales.duelBaseline), 'Weighted Duel Average', duelExamples)}
        ${scaleCard('State Ruler', compactPoints(scales.stateRulerBaseline), 'Credited State Ruler score', stateExamples)}
      </div>
      <div class="combined-formula-card">
        <div><span class="eyebrow">THE SIMPLE RULE</span><h3>The baseline is 100. Stronger performance climbs from there.</h3><p>At the current ${Number(scales.curveExponent || 0.5).toFixed(2)} curve, twice the baseline is about ${exampleIndex(stateExamples, 2)}, four times the baseline is ${exampleIndex(stateExamples, 4)}, and scores are never capped. Nobody is compared with the highest spender.</p></div>
        <div class="combined-formula">Overall = Duel Index × ${pct(weights.alliance_duel)} + State Ruler Index × ${pct(weights.state_ruler)} + Glory War Index × ${pct(weights.glory_war)}</div>
      </div>
      <div class="state-ruler-guide-grid">
        ${ruleCard('REAL SCORE', 'Leaderboard result', 'If you appear on the State Ruler leaderboard, your real captured score is used.')}
        ${ruleCard('ATTEND', `${compactPoints(scales.stateRulerAttendanceFloor)} floor`, 'Confirmed attendance without a leaderboard score receives the attendance floor instead of being ignored.')}
        ${ruleCard('MISS', '0 for that event', 'Once a State Ruler week has happened, no score and no attendance evidence is a zero. Participation therefore always helps.')}
        ${ruleCard('LEAVE', 'Neutral', 'Approved On Leave removes that State Ruler week from your personal average rather than creating a zero.')}
      </div>
      <div class="combined-guide-note"><strong>State Ruler Bye weeks:</strong><span>The weekly State Ruler index is calculated first, then the live Admin Bye multiplier is applied. Glory War remains reserved but inactive until its own model is finalized.</span></div>`;

    const future = page.querySelector('.duel-future-note');
    if (future) future.replaceWith(section);
    else page.appendChild(section);
    page.dataset.combinedV100 = '1';
  } catch (error) {
    console.warn('Could not add combined Contribution Guide:', error);
  } finally {
    guideBusy = false;
  }
}

function scaleCard(title, baseline, source, examples) {
  return `<article class="combined-scale-card"><div class="eyebrow">${esc(title)}</div><strong class="scale-baseline">${esc(baseline)} = 100</strong><span>${esc(source)}</span><div class="scale-examples">${(examples || []).slice(0, 3).map(row => `<small>${Number(row.multiplier)}× = ${Number(row.index).toFixed(0)}</small>`).join('')}</div></article>`;
}
function ruleCard(kicker, title, copy) { return `<article class="combined-rule-card"><span>${esc(kicker)}</span><strong>${esc(title)}</strong><p>${esc(copy)}</p></article>`; }
function exampleIndex(rows, multiplier) { const row = (rows || []).find(item => Number(item.multiplier) === Number(multiplier)); return row ? Number(row.index).toFixed(0) : '—'; }

async function enhanceContributionAdmin() {
  const main = document.getElementById('main');
  if (main?.querySelector('.page-head h1')?.textContent?.trim() !== 'Administrator' || adminBusy) return;
  const legacyForm = document.getElementById('weights-form');
  if (!legacyForm || main.querySelector('#contribution-scale-settings')) return;

  adminBusy = true;
  try {
    const data = await api('/api/admin/contribution-model');
    modernizeWeightEditor(legacyForm, data);
    addScaleEditor(main, legacyForm, data);
  } catch (error) {
    console.warn('Could not load Contribution model Admin settings:', error);
  } finally {
    adminBusy = false;
  }
}

function modernizeWeightEditor(form, data) {
  const weights = data.weights || {};
  const panel = form.closest('.card,.panel') || form.parentElement;
  const title = panel?.querySelector('h3,.panel-title');
  const muted = panel?.querySelector('.muted');
  if (title) title.textContent = 'Overall Contribution weights';
  if (muted) muted.textContent = 'These percentages determine how much each event contributes to the final score. Glory War is reserved at zero until its scoring model is finalized.';

  const replacement = document.createElement('form');
  replacement.id = 'weights-form';
  replacement.dataset.duelFutureCopy = '1';
  replacement.className = 'contribution-weight-form';
  replacement.innerHTML = `
    ${weightRow('Alliance Duel','alliance_duel',weights.alliance_duel)}
    ${weightRow('State Ruler','state_ruler',weights.state_ruler)}
    ${weightRow('Glory War','glory_war',weights.glory_war)}
    <div class="contribution-weight-total"><span>Total allocation</span><strong id="contribution-weight-total">${Math.round(Number(data.weightTotal || 0) * 100)}%</strong></div>
    <button class="btn btn-primary" type="submit">Save contribution weights</button>
    <span class="contribution-admin-status" id="contribution-weight-status"></span>`;
  form.replaceWith(replacement);
  replacement.querySelectorAll('input').forEach(input => input.addEventListener('input', updateWeightTotal));
  replacement.addEventListener('submit', saveContributionWeights);
}

function weightRow(label, name, value) {
  return `<label class="contribution-weight-row"><span><strong>${esc(label)}</strong><small>${name === 'glory_war' ? 'Reserved until the Glory War model is finalized.' : 'Active in the current combined ranking.'}</small></span><div class="percent-input"><input class="input" type="number" min="0" max="100" step="1" name="${esc(name)}" value="${Math.round(Number(value || 0) * 100)}"><b>%</b></div></label>`;
}
function updateWeightTotal() {
  const form = document.getElementById('weights-form');
  if (!form) return;
  const total = [...form.querySelectorAll('input[name]')].reduce((sum, input) => sum + Number(input.value || 0), 0);
  const host = document.getElementById('contribution-weight-total');
  if (host) host.textContent = `${Math.round(total)}%`;
  form.classList.toggle('weight-total-warning', Math.abs(total - 100) > 0.01);
}
async function saveContributionWeights(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const status = document.getElementById('contribution-weight-status');
  const weights = Object.fromEntries([...new FormData(form).entries()].map(([key, value]) => [key, Number(value) / 100]));
  const total = Object.values(weights).reduce((sum, value) => sum + value, 0);
  if (Math.abs(total - 1) > 0.0001) {
    if (status) status.textContent = 'Weights must add to 100%.';
    return;
  }
  try {
    if (status) status.textContent = 'Saving…';
    await api('/api/admin/weights', { method: 'POST', body: JSON.stringify({ weights }) });
    if (status) status.textContent = 'Saved. Overall Contribution and Guide updated.';
  } catch (error) {
    if (status) status.textContent = error.message;
  }
}

function addScaleEditor(main, weightForm, data) {
  const scales = data.scales || {};
  const section = document.createElement('section');
  section.id = 'contribution-scale-settings';
  section.className = 'section panel contribution-scale-admin';
  section.innerHTML = `
    <div class="panel-head"><div><div class="panel-title">Contribution normalization scales</div><div class="muted">These values put Alliance Duel and State Ruler onto the same index without changing either event's raw leaderboard. The public Guide reads these live values.</div></div></div>
    <div class="contribution-scale-grid">
      ${scaleInput('Alliance Duel baseline','contribution-duel-baseline',scales.duelBaseline,100000,'Weighted Duel Average that equals Contribution Index 100.')}
      ${scaleInput('State Ruler baseline','contribution-ruler-baseline',scales.stateRulerBaseline,50000,'Credited State Ruler score that equals Contribution Index 100.')}
      ${scaleInput('State Ruler attendance floor','contribution-ruler-floor',scales.stateRulerAttendanceFloor,50000,'Credit for confirmed attendance when no real State Ruler leaderboard score exists. Existing attendance-only rows follow this live value.')}
      ${scaleInput('Normalization curve','contribution-curve',scales.curveExponent,0.05,'0.50 is the approved square-root scale. 1.00 would be linear. Lower values compress extreme scores more strongly.',0.10,1.00)}
    </div>
    <div class="contribution-admin-note"><strong>Still controlled elsewhere in Admin:</strong><span>Alliance Duel Secured Week Weight and daily minimum stay in Alliance Duel scoring. Event Bye multipliers stay in Absences & Bye Weeks. All of those feed the same backend before normalization.</span></div>
    <div class="contribution-admin-actions"><button class="btn btn-primary" id="save-contribution-scales">Save normalization scales</button><span class="contribution-admin-status" id="contribution-scale-status"></span></div>`;

  const anchor = weightForm.closest('.card,.panel') || weightForm.parentElement;
  anchor.insertAdjacentElement('afterend', section);
  section.querySelector('#save-contribution-scales')?.addEventListener('click', saveContributionScales);
}

function scaleInput(title, id, value, step, copy, min = 1, max = 1e12) {
  return `<label class="contribution-scale-row"><span><strong>${esc(title)}</strong><small>${esc(copy)}</small></span><input class="input" id="${esc(id)}" type="number" min="${min}" max="${max}" step="${step}" value="${Number(value || 0)}"></label>`;
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
        stateRulerAttendanceFloor: Number(document.getElementById('contribution-ruler-floor')?.value || 0),
        curveExponent: Number(document.getElementById('contribution-curve')?.value || 0.5),
      }),
    });
    const scales = result.scales || {};
    document.getElementById('contribution-duel-baseline').value = String(scales.duelBaseline ?? '');
    document.getElementById('contribution-ruler-baseline').value = String(scales.stateRulerBaseline ?? '');
    document.getElementById('contribution-ruler-floor').value = String(scales.stateRulerAttendanceFloor ?? '');
    document.getElementById('contribution-curve').value = String(scales.curveExponent ?? '');
    if (status) status.textContent = 'Saved. State Ruler credits, leaderboard normalization, and Guide updated.';
    document.querySelector('.duel-guide-page')?.removeAttribute('data-combined-v100');
  } catch (error) {
    if (status) status.textContent = error.message;
  } finally {
    if (button) button.disabled = false;
  }
}

function compactPoints(value) {
  const n = Number(value || 0);
  if (Math.abs(n) >= 1e9) return `${(n / 1e9).toFixed(n >= 10e9 ? 1 : 2)}B`;
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(n >= 10e6 ? 1 : 2)}M`;
  if (Math.abs(n) >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return new Intl.NumberFormat().format(n);
}
function pct(value) { return `${Math.round(Number(value || 0) * 100)}%`; }
function esc(value) { return String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[char])); }
