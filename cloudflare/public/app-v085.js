import './app-v084.js';

let gloryBusy = false;
let scheduled = false;

const observer = new MutationObserver(schedule);
observer.observe(document.getElementById('app'), { childList: true, subtree: true });
window.addEventListener('hashchange', schedule);
schedule();

function schedule() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => setTimeout(async () => {
    scheduled = false;
    await renderGloryWar();
  }, 55));
}

async function api(url) {
  const response = await fetch(url, { cache: 'no-store', headers: { 'content-type': 'application/json' } });
  let data = {};
  try { data = await response.json(); } catch (_) {}
  if (!response.ok || data.ok === false) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

async function renderGloryWar(cycle = '', week = 0) {
  if (location.hash !== '#glory-war' || gloryBusy) return;
  const main = document.getElementById('main');
  if (!main) return;
  const title = main.querySelector('.page-head h1')?.textContent?.trim() || '';
  if (!cycle && main.dataset.gloryWarV114 === '1') return;
  if (!cycle && title !== 'Glory War') return;

  gloryBusy = true;
  try {
    const query = cycle && week ? `?cycle=${encodeURIComponent(cycle)}&week=${Number(week)}` : '';
    const data = await api(`/api/glory-war${query}`);
    if (location.hash !== '#glory-war') return;
    paintGlory(main, data);
  } catch (error) {
    main.innerHTML = `<section class="page-head"><div><div class="eyebrow">GLORY WAR</div><h1>Glory War</h1><p>Glory War archive could not be loaded.</p></div></section><div class="empty">${esc(error.message)}</div>`;
  } finally {
    gloryBusy = false;
  }
}

function paintGlory(main, data) {
  const selected = data.selected;
  if (!selected) {
    main.innerHTML = `<section class="page-head"><div><div class="eyebrow">GLORY WAR</div><h1>Glory War</h1><p>WDZ player scores and completed matchup history.</p></div></section><div class="coming"><h2>No Glory War results archived yet</h2><p>Run Glory War Capture after a completed battle, open Personal Ranking, then sync it.</p></div>`;
    main.dataset.gloryWarV114 = '1';
    return;
  }

  const opponent = selected.opponentAllianceName || selected.opponentAllianceAbbr || 'Opponent';
  const resultTone = selected.result === 'WIN' ? 'green' : selected.result === 'LOSS' ? 'red' : 'amber';
  const matches = data.matches || [];
  const rows = data.players || [];

  main.innerHTML = `
    <section class="page-head">
      <div><div class="eyebrow">GLORY WAR ARCHIVE</div><h1>Glory War</h1><p>WDZ individual scores with the completed state-vs-state matchup. Opponent player scores are not stored or displayed.</p></div>
      <div><select class="input" id="glory-match-select">${matches.map(match => `<option value="${esc(match.cycleId)}|${Number(match.cycleWeek)}" ${match.cycleId === selected.cycleId && Number(match.cycleWeek) === Number(selected.cycleWeek) ? 'selected' : ''}>${esc(match.cycleId)} · Week ${Number(match.cycleWeek)} · ${esc(match.opponentAllianceAbbr || match.opponentAllianceName || 'Opponent')}</option>`).join('')}</select></div>
    </section>
    <section class="section metrics">
      ${metric(selected.result || '—', 'Result', `WDZ vs ${opponent}`)}
      ${metric(fmt(selected.primaryStateScore), `State ${Number(selected.primaryServerId || 0)}`, 'Combined battle-side score')}
      ${metric(fmt(selected.opponentStateScore), `State ${Number(selected.opponentServerId || 0)}`, `${opponent} side score`)}
      ${metric(fmt(rows.length), 'WDZ scorers', 'Individual scores archived')}
    </section>
    <section class="section panel">
      <div class="panel-head"><div><div class="panel-title">Match result</div><div class="muted">Captured ${esc(when(selected.capturedAt))}</div></div><span class="badge badge-${resultTone}">${esc(selected.result || 'RESULT')}</span></div>
      <div class="method-box"><strong>${esc(selected.primaryAllianceAbbr || 'WDZ')} · State ${Number(selected.primaryServerId || 0)}</strong> ${fmt(selected.primaryStateScore)} &nbsp; vs &nbsp; <strong>${esc(opponent)}${selected.opponentAllianceAbbr ? ` (${esc(selected.opponentAllianceAbbr)})` : ''} · State ${Number(selected.opponentServerId || 0)}</strong> ${fmt(selected.opponentStateScore)}<br><span class="muted">Alliance contribution: WDZ ${fmt(selected.primaryAllianceScore)} · ${esc(opponent)} ${fmt(selected.opponentAllianceScore)}</span></div>
    </section>
    <section class="section panel">
      <div class="panel-head"><div><div class="panel-title">WDZ Glory War scores</div><div class="muted">Only WDZ individual rows are archived. Opponent individuals are intentionally excluded.</div></div><input class="input" id="glory-search" placeholder="Search player" style="max-width:300px"></div>
      <div class="table-wrap" id="glory-table"></div>
    </section>`;

  const renderRows = query => {
    const q = String(query || '').trim().toLowerCase();
    const filtered = rows.filter(row => !q || String(row.name || '').toLowerCase().includes(q));
    document.getElementById('glory-table').innerHTML = filtered.length
      ? `<table class="responsive-table"><thead><tr><th>Rank</th><th>Player</th><th class="numeric">Glory War score</th></tr></thead><tbody>${filtered.map(row => `<tr><td class="rank-cell">#${Number(row.rank || 0)}</td><td class="player-cell"><strong>${esc(row.name)}</strong><small>${esc(row.allianceAbbr || 'WDZ')} · S${Number(row.serverId || selected.primaryServerId || 0)}</small></td><td class="numeric score">${fmt(row.score)}</td></tr>`).join('')}</tbody></table>`
      : '<div class="empty">No matching players.</div>';
  };
  renderRows('');
  document.getElementById('glory-search')?.addEventListener('input', event => renderRows(event.target.value));
  document.getElementById('glory-match-select')?.addEventListener('change', event => {
    const [nextCycle, nextWeek] = String(event.target.value || '').split('|');
    main.dataset.gloryWarV114 = '';
    renderGloryWar(nextCycle, Number(nextWeek));
  });
  main.dataset.gloryWarV114 = '1';
}

function metric(value, label, note) {
  return `<article class="metric"><div class="metric-label">${esc(label)}</div><div class="metric-value">${esc(value)}</div><div class="metric-note">${esc(note)}</div></article>`;
}
function fmt(value) { return new Intl.NumberFormat().format(Number(value || 0)); }
function when(value) { return value ? new Date(value).toLocaleString() : 'Unknown time'; }
function esc(value) { return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char])); }
