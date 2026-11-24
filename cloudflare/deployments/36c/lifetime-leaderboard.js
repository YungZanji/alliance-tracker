const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const points=value=>new Intl.NumberFormat('en').format(value);
export function lifetimeTable(players) {
  if(!players.length)return '<div class="empty">No matching players.</div>';
  return `<table class="responsive-table lifetime-contribution-table"><thead><tr><th>Rank</th><th>Player</th><th class="numeric">Overall Contribution <span class="lifetime-heading-note">Share of alliance total</span></th><th class="numeric">Alliance Duel · 45%<span class="lifetime-heading-note">Lifetime points</span></th><th class="numeric">State Ruler · 45%</th><th class="numeric">Glory War · 10%</th></tr></thead><tbody>${players.map(p=>`<tr data-player="${esc(p.publicId)}"><td class="rank-cell" data-label="Rank">#${p.rank}</td><td class="player-cell" data-label="Player"><strong>${esc(p.name)}</strong></td><td class="numeric score" data-label="Contribution points">${Number(p.score).toFixed(1)}</td><td class="numeric" data-label="Duel · 45% · Lifetime points">${points(p.totalDuelPoints)}</td><td class="numeric muted" data-label="State Ruler · 45%">N/A</td><td class="numeric muted" data-label="Glory War · 10%">N/A</td></tr>`).join('')}</tbody></table>`;
}
export async function renderLifetimeLeaderboard(main) {
  main.innerHTML='<section class="page-head"><div><h1>Alliance Leaderboards</h1><p>Loading lifetime Duel points…</p></div></section>';
  const pending=main.firstElementChild;
  try{
    const response=await fetch('/api/duel/lifetime-contribution',{credentials:'same-origin',cache:'no-store'});
    const data=await response.json();
    if(!response.ok||data.ok===false)throw new Error(data.error||'Could not load standings.');
    if(!pending.isConnected)return;
    main.innerHTML=`<section class="page-head"><div><h1>Alliance Leaderboards</h1><p>Total Alliance Duel points across every recorded Duel League.</p></div></section><section class="panel section lifetime-leaderboard"><div class="panel-head"><div><div class="panel-title">Overall Contribution</div><div class="muted">Planned split: Duel 45% · State Ruler 45% · Glory War 10%</div></div><input class="input" id="lifetime-search" type="search" aria-label="Search player" placeholder="Search player" style="max-width:310px"></div><p class="lifetime-note"><strong>Alliance Duel total: ${points(data.poolTotal)}</strong><br>Duel only for now: your total ÷ the alliance’s total × 100. Unavailable events are excluded.</p><div class="table-wrap" id="lifetime-table"></div></section>`;
    const table=main.querySelector('#lifetime-table');
    const draw=query=>{const q=query.trim().toLocaleLowerCase();table.innerHTML=lifetimeTable(data.players.filter(p=>p.name.toLocaleLowerCase().includes(q)));};
    draw('');main.querySelector('#lifetime-search').addEventListener('input',event=>draw(event.target.value));
  }catch(error){if(pending.isConnected)main.innerHTML=`<section class="page-head"><div><h1>Alliance Leaderboards</h1><p role="alert">${esc(error.message)}</p></div></section>`;}
}
