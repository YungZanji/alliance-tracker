const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number = value => new Intl.NumberFormat('en').format(value);
const OWN = '0beb659cf5274a96952d91401ae41698';
export function opponentStages(teams) {
  const ordered=[...teams].sort((a,b)=>a.league_position-b.league_position);
  const own=ordered.findIndex(t=>t.alliance_id===OWN);
  if(ordered.length!==16||own<0)return [];
  return [1,2,4,8].map((size,index)=>{
    const start=Math.floor(own/size)*size;
    const other=start% (size*2)===0?start+size:start-size;
    return {week:index+1,teams:ordered.slice(other,other+size)};
  });
}
export function powerComparison(teams,powers) {
  const rows=teams.map(t=>powers.find(p=>p.allianceId===t.alliance_id));
  if(rows.some(p=>!p||p.status!=='complete'||!Number.isSafeInteger(p.totalMigratePower)||p.totalMigratePower<0)||new Set(rows.map(p=>p.scanId)).size!==1)return null;
  const max=Math.max(...rows.map(p=>p.totalMigratePower));
  return {leaders:rows.filter(p=>p.totalMigratePower===max).map(p=>p.allianceId),close:max>0&&rows.filter(p=>p.totalMigratePower>=max*.9).length>1};
}
async function get(url,signal) {
  const response=await fetch(url,{credentials:'same-origin',cache:'no-store',signal});
  let data={};try{data=await response.json();}catch{}
  if(!response.ok||data.ok===false)throw new Error(data.error||'League data is temporarily unavailable.');
  return data;
}
export async function renderDuelLeague(main) {
  const controller=new AbortController();
  main.innerHTML='<section class="card league-page"><h1>Duel League</h1><p role="status">Loading league…</p></section>';
  const host=main.firstElementChild;
  // Route changes detach this host; never paint over another page.
  const active=()=>host.isConnected;
  let league, powers=[],powerMessage='Loading migration power…',scan=null;
  const draw=()=>{
    if(!active())return;
    const stages=opponentStages(league.teams||[]);
    host.innerHTML=`<header class="league-heading"><div class="eyebrow">36C · DUEL LEAGUE</div><h1>Road to the Final</h1><p>36C’s opponent path if we win each week.</p><p class="muted">${league.group?'Group '+escapeHTML(league.group.replaceAll('_','-'))+' · ':''}${league.currentWeek?'Latest capture: week '+escapeHTML(league.currentWeek):'Awaiting a league capture'}</p></header>
      ${!stages.length?'<div class="empty">Waiting for a complete week-one league capture to establish the opening bracket.</div>':`<div class="league-path">${stages.map(stage=>{
        const comparison=powerComparison(stage.teams,powers);
        return `<section class="league-stage"><div class="league-stage-head"><h2>Week ${stage.week}</h2><span>${stage.teams.length===1?'Opening opponent':stage.teams.length+' possible opponents'}</span></div><div class="league-candidates">${stage.teams.map(team=>{
          const p=powers.find(p=>p.allianceId===team.alliance_id);
          const leader=comparison?.leaders.includes(team.alliance_id)&&stage.teams.length>1;
          return `<details class="league-team ${leader?'league-strongest':''}"><summary><span class="league-seed">${escapeHTML(team.league_position)}</span><span><strong>${escapeHTML(team.alliance_abbr)}</strong><small>State ${escapeHTML(team.server_id)}</small></span><span class="league-power">${p?.status==='complete'?number(p.totalMigratePower):'—'}<small>Migration power</small></span></summary>${leader?`<span class="badge badge-amber">${comparison.close?'Similar power contenders':'Highest measured power'}</span>`:''}<p>${escapeHTML(team.alliance_name)}</p><p class="muted">${p?`${escapeHTML(p.status)} coverage · ${number(p.playersWithPower||0)} / ${number(p.presentPlayers||0)} players with power`:'Migration-power scan not loaded.'}</p></details>`;
        }).join('')}</div>${comparison?.close?'<p class="muted league-close">Several contenders are within 10% of the highest power.</p>':''}</section>`;
      }).join('<div class="league-connector" aria-hidden="true">↓</div>')}</div>`}
      <footer class="league-foot"><p role="status">${escapeHTML(powerMessage)}</p>${scan?`<p class="muted">Catalog scan: ${escapeHTML(scan.scannedAt||scan.scanId)}</p>`:''}<button type="button" class="btn btn-secondary" id="league-refresh">Refresh migration power</button><p class="muted">Migration power indicates roster strength, not a win probability. The path uses opening bracket positions; later results can change who remains. Missing or partial scans receive no favorite label.</p></footer>`;
    host.querySelector('#league-refresh').addEventListener('click',loadPower);
  };
  async function loadPower(){
    const button=host.querySelector('#league-refresh');if(button?.disabled)return;
    if(button)button.disabled=true;
    powerMessage='Loading migration power…';
    const status=host.querySelector('[role="status"]');if(status)status.textContent=powerMessage;
    try{
      const result=await get('/api/duel/league-power',controller.signal);
      if(result.group!==league.group)throw new Error('The league changed. Reopen Duel League to load the new bracket.');
      powers=result.alliances||[];scan=result;
      powerMessage=powers.every(p=>p.status==='complete')?'Latest catalog comparison loaded.':'Some alliances have incomplete catalog coverage.';
    }catch(error){powers=[];scan=null;powerMessage=error.message;}
    draw();
  }
  try{league=await get('/api/duel/league',controller.signal);if(!active())return;draw();if(league.openingAvailable)await loadPower();else{powerMessage='Sync the opening league standings to build this path.';draw();}}
  catch(error){if(active()){host.innerHTML=`<h1>Duel League</h1><p role="alert">${escapeHTML(error.message)}</p><button type="button" class="btn">Retry</button>`;host.querySelector('button').onclick=()=>renderDuelLeague(main);}}
}
