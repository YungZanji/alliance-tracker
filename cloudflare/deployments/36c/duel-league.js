const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const OWN = '0beb659cf5274a96952d91401ae41698';
export function opponentStages(teams) {
  const ordered=[...teams].sort((a,b)=>a.league_position-b.league_position);
  const own=ordered.findIndex(t=>t.alliance_id===OWN);
  if(ordered.length!==16||own<0)return [];
  return [1,2,4,8].map((size,index)=>{
    const start=Math.floor(own/size)*size;
    const other=start%(size*2)===0?start+size:start-size;
    return {week:index+1,teams:ordered.slice(other,other+size)};
  });
}
export function leagueMarkup(league) {
  const stages=opponentStages(league.teams||[]);
  const current=new Map((league.latestTeams||[]).map(t=>[t.alliance_id,t]));
  return `<header class="league-heading"><div class="eyebrow">36C · DUEL LEAGUE</div><h1>Road to the Final</h1><p>Our possible opponents if we win each week.</p>${league.group?`<p class="muted">Group ${escapeHTML(league.group.replaceAll('_','-'))}${league.currentWeek?' · Week '+escapeHTML(league.currentWeek):''}</p>`:''}</header>
    ${!stages.length?'<div class="empty">Waiting for a complete week-one league capture to establish the opening bracket.</div>':`<div class="league-path">${stages.map(stage=>`<section class="league-stage"><div class="league-stage-head"><h2>Week ${stage.week}</h2><span>${stage.teams.length===1?'Opening opponent':stage.teams.length+' possible opponents'}</span></div><div class="league-candidates">${stage.teams.map(seed=>{
      const team=current.get(seed.alliance_id)||seed;
      return `<article class="league-team"><div class="league-team-top"><strong>${escapeHTML(team.alliance_abbr)}</strong><span>State ${escapeHTML(team.server_id)}</span></div><p>${escapeHTML(team.alliance_name)}</p></article>`;
    }).join('')}</div></section>`).join('<div class="league-connector" aria-hidden="true">↓</div>')}</div>`}
    <p class="muted league-note">Updated through Direct Duel Sync. Potential opponents follow the opening bracket.</p>`;
}
export async function renderDuelLeague(main) {
  main.innerHTML='<section class="card league-page"><h1>Duel League</h1><p role="status">Loading league…</p></section>';
  const host=main.firstElementChild;
  try{
    const response=await fetch('/api/duel/league',{credentials:'same-origin',cache:'no-store'});
    let data={};try{data=await response.json();}catch{}
    if(!response.ok||data.ok===false)throw new Error(data.error||'League data is temporarily unavailable.');
    if(host.isConnected)host.innerHTML=leagueMarkup(data);
  }catch(error){
    if(host.isConnected){host.innerHTML=`<h1>Duel League</h1><p role="alert">${escapeHTML(error.message)}</p><button type="button" class="btn">Retry</button>`;host.querySelector('button').onclick=()=>renderDuelLeague(main);}
  }
}
