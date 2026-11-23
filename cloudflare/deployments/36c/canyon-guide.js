// Render inside the 36C portal shell. The guide markup is static; selections update text nodes.
const template = `<style>
.canyon-guide {--cc-a:var(--red);--cc-b:var(--blue-2);--cc-c:var(--green);--cc-d:var(--amber)}
.canyon-guide .phase-controls,.canyon-guide .orientation,.canyon-guide .phases {display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.canyon-guide .phase-controls {justify-content:space-between;margin-bottom:14px}
.canyon-guide .phase-controls button {min-height:44px;color:var(--ink);background:var(--card);border:1px solid var(--line);border-radius:10px;padding:7px 11px;font-weight:750}
.canyon-guide .phase-controls button[aria-pressed=true] {background:var(--blue-soft);color:var(--blue-2);border-color:var(--blue)}
.canyon-guide .cc-layout,.canyon-guide .cc-notes {display:grid;grid-template-columns:minmax(0,1.35fr) minmax(0,1fr);gap:14px;align-items:start}
.canyon-guide .cc-notes {margin-top:14px}
.canyon-guide .cc-board {margin:0;padding:clamp(8px,2vw,18px)}
.canyon-guide .cc-board header {display:flex;align-items:baseline;justify-content:space-between;gap:6px 12px;flex-wrap:wrap;margin-bottom:8px}
.canyon-guide .orientation,.canyon-guide .cc-board small,.canyon-guide .cc-summary p,.canyon-guide #map-copy {color:var(--muted)}
.canyon-guide .cc-map {container-type:inline-size;position:relative;isolation:isolate;aspect-ratio:1320/1330;background:radial-gradient(ellipse at 48% 52%,#906345,#553821 75%);border-radius:12px;overflow:hidden}
.canyon-guide .terrain {position:absolute;inset:0;width:100%;height:100%;pointer-events:none}
.canyon-guide .pin {position:absolute;left:var(--x);top:var(--y);transform:translate(-50%,-50%);display:grid;place-items:center;width:5cqw;height:5cqw;border:1px solid #edd1a3;border-radius:50%;padding:0;background:#231c17;color:#f8dfa5;z-index:1}
.canyon-guide .pin .icon {width:70%;height:70%}
.canyon-guide .pin.base,.canyon-guide .pin.hospital,.canyon-guide .pin.core {width:6.5cqw;height:6.5cqw}
.canyon-guide .pin[data-zone] {width:7.5cqw;height:7.5cqw;font-size:5.3cqw;font-weight:900;border-radius:20%}
.canyon-guide .pin.owned,.canyon-guide .pin[data-zone] {color:var(--map-accent);border-color:var(--map-accent)}
.canyon-guide .pin[aria-pressed=true] {outline:2px solid white;z-index:2}
.canyon-guide .zone-a {--accent:var(--cc-a);--map-accent:#ff9686}
.canyon-guide .zone-b {--accent:var(--cc-b);--map-accent:#8acbff}
.canyon-guide .zone-c {--accent:var(--cc-c);--map-accent:#a8dc91}
.canyon-guide .zone-d {--accent:var(--cc-d);--map-accent:#ffcd77}
.canyon-guide .map-corner {position:absolute;padding:.25em .55em;background:#211a14;color:#fff2da;border-radius:.35em;font-size:clamp(8px,2.5cqw,15px);font-weight:850;pointer-events:none}
.canyon-guide .north-west {top:1%;left:1%}.canyon-guide .south-east {bottom:1%;right:1%}
.canyon-guide .readout {display:grid;padding:10px;margin:8px 0;border-radius:10px;background:var(--card-2)}
.canyon-guide .readout br {display:none}
.canyon-guide .legend {display:flex;flex-wrap:wrap;gap:5px 12px;margin:0;padding:0;list-style:none;color:var(--muted);font-size:.85rem}
.canyon-guide .legend .icon {width:1em;height:1em;margin-inline-end:4px;vertical-align:middle;color:var(--amber)}
.canyon-guide .order {display:block;width:100%;text-align:start;color:var(--ink);background:var(--card-2);border:1px solid var(--line);border-inline-start:4px solid var(--accent);border-radius:11px;padding:10px;margin-top:8px}
.canyon-guide .order b {display:block;color:var(--accent)}
.canyon-guide .order[aria-pressed=true] {outline:1px solid var(--accent)}
.canyon-guide button:focus-visible,.canyon-guide a:focus-visible {outline:2px solid var(--blue);outline-offset:2px}
.canyon-guide #captain-link {color:var(--blue-2);text-decoration:underline}
.canyon-guide #captain-guide {scroll-margin-top:125px}
.canyon-guide [hidden] {display:none}
.canyon-guide .handover {margin-top:14px}
@media(max-width:760px){.canyon-guide .cc-layout,.canyon-guide .cc-notes{grid-template-columns:minmax(0,1fr)}.canyon-guide .phases{width:100%;display:grid;grid-template-columns:repeat(2,minmax(0,1fr))}}
</style>
<svg width="0" height="0" style="position:absolute" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
<defs>
<symbol id="cc-refinery" viewBox="0 0 24 24"><path fill="currentColor" d="M12 1C9 6 4 11 4 15a8 8 0 0 0 16 0c0-4-5-9-8-14Z"/><path d="M8 15c0 2 1 3 3 4" stroke="#183b50" stroke-width="1.5" fill="none" stroke-linecap="round"/></symbol>
<symbol id="cc-hospital" viewBox="0 0 24 24"><path fill="currentColor" d="M2 20 9 5h6l7 15Z"/><path d="M15 10v6m-3-3h6M5 20l4-9 3 9" stroke="#34241b" stroke-width="1.5" fill="none"/></symbol>
<symbol id="cc-base" viewBox="0 0 24 24"><path fill="currentColor" d="M10 2h10l-3 3 3 2h-8v4h8v4h2v7h-7v-5H9v5H2v-7h2v-4h6Z"/></symbol>
<symbol id="cc-captain" viewBox="0 0 24 24"><path fill="currentColor" d="M12 2a9 9 0 0 0-5 16v4h10v-4a9 9 0 0 0-5-16Z"/><g fill="#34241b"><circle cx="8.5" cy="11" r="2"/><circle cx="15.5" cy="11" r="2"/><path d="m12 13-1.5 3h3ZM9 18h1v4H9zm2.5 0h1v4h-1zm2.5 0h1v4h-1z"/></g></symbol>
<symbol id="cc-core" viewBox="0 0 24 24"><path fill="currentColor" d="M8 2h2v9h4V2h2v10l4 4v3h3v3h-9v-4h-4v4H1v-3h3v-3l4-4z"/><path stroke="currentColor" stroke-width="1.5" d="M12 3v7"/></symbol>
<symbol id="cc-signal" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" d="m7 22 5-15 5 15m-8-5h6M7 10a7 7 0 0 1 0-8m10 0a7 7 0 0 1 0 8M4 13A10 10 0 0 1 4 0m16 0a10 10 0 0 1 0 13"/><circle fill="currentColor" cx="12" cy="6" r="2"/></symbol>
</defs>
</svg>
<header class="page-head"><div><h1>Canyon Clash Battle Plan</h1><p>36C · State 261</p></div></header>
<div class="phase-controls">
<div role="group" aria-label="Match phase" class="phases">
<button type="button" data-phase="pre" aria-pressed="true">Pre-Core</button>
<button type="button" data-phase="bases" aria-pressed="false">Military Bases Open</button>
<button type="button" data-phase="core" aria-pressed="false">During Core</button>
<button type="button" data-phase="post" aria-pressed="false">Post-Core</button>
</div>
<div class="orientation"><span id="home-position" role="status">Home: bottom right</span><button type="button" id="flip" aria-label="Flip home and enemy sides">Flip</button></div>
</div>
<section class="cc-layout" aria-label="Battle map and team assignments">
<figure class="card flat cc-board">
<header><h2>Battlefield</h2><small>Select a team or landmark</small></header>
<div class="cc-map" id="map" role="group" aria-label="Canyon Clash battlefield map">
<svg class="terrain" viewBox="0 0 100 100" aria-hidden="true" preserveAspectRatio="none">
<defs><pattern id="cc-grid" width="10" height="10" patternUnits="userSpaceOnUse"><path d="M10 0H0v10" fill="none" stroke="#ffd8aa" stroke-opacity=".13" stroke-width=".26"/></pattern></defs>
<path d="M0 0h100v100H0z" fill="url(#cc-grid)"/>
<path d="M0 0h15v13H0zM100 100H83V88h17z" fill="#211b14" fill-opacity=".45" stroke="#e5ae77" stroke-opacity=".4" stroke-width=".4"/>
<path d="M0 46c12 0 15-22 32-24s25 7 34 5 22-8 34-6M0 73c14 9 22 2 37 6s22 12 36 4 20-18 27-17M28 0c1 13 17 16 21 32s-8 28-3 45 18 21 18 23" fill="none" stroke="#edbb8c" stroke-opacity=".21" stroke-width=".7" stroke-dasharray="2 1"/>
<path d="M50 4v92M4 49h92" fill="none" stroke="#ffd8aa" stroke-opacity=".24" stroke-width=".32"/>
</svg>
</div>
<figcaption><div class="readout" role="status"><strong id="map-title">Energy Core</strong><span id="map-copy">The central objective. Team A takes the lead when it opens, with Team B reinforcing.</span><br id="captain-break" hidden><a id="captain-link" href="#captain-guide" hidden>View the Canyon Captain checklist ↓</a></div><ul id="legend" class="legend" aria-label="Map legend"></ul></figcaption>
</figure>
<aside class="card flat cc-summary" aria-labelledby="phase-title"><p class="eyebrow">36C</p><h2 id="phase-title">Pre-Core</h2><p id="phase-note"></p><div id="orders"></div></aside>
</section>
<section class="cc-notes" aria-label="Captain and match reminders">
<article class="card flat" id="captain-guide" tabindex="-1"><h2>Canyon Captain</h2>
<p>Usually three players are appointed to handle Canyon Captain (Tyrant). Check if you’re on the list before the match.</p>
<ol><li>Stay in the group call and listen for the Captain’s arrival time.</li><li>Teleport to the top right before the Captain arrives.</li><li>Send all your trucks out immediately and have them waiting outside. Hit the Captain together as soon as it appears.</li></ol>
</article>
<article class="card flat"><h2>Important Reminders</h2><ul>
<li>Follow alliance chat and the Canyon group call.</li>
<li>Hold buildings until you need to move.</li>
<li>At Core opening, A and B move immediately. C and D hold bases and capture nearby uncontested buildings.</li>
<li>Stay ready to reinforce wherever needed.</li>
</ul></article>
</section>
`;

export function renderCanyonGuide(main) {
  const root = document.createElement('section');
  root.className = 'canyon-guide';
  root.innerHTML = template;
  main.replaceChildren(root);
  const map=root.querySelector('#map');
  const legend=root.querySelector('#legend');
  const title=root.querySelector('#map-title'), copy=root.querySelector('#map-copy');
  const phases=[...root.querySelectorAll('[data-phase]')];
  const flip=root.querySelector('#flip');
  let home=1;
  const keys=['A','B','C','D'];
  const starts=[[19.8,64.2],[28.9,24.1],[68.9,75.2],[73.4,19.9]];
  const bases=[[6.1,85.2],[21.8,94.8]];
  const baseBadges=[[6.5,77],[31,95]];
  const refineries=[
   [17.8,10.2,'B'],[11.2,17.3,'B'],[50.9,11.4,'D'],[84.9,15.5,'D'],
   [71.9,30.6,'D'],[90.5,48.1,'D'],[11.1,53,'A'],[23.2,77.9,'A'],
   [13.3,88.8,'A'],[37.8,88.5,'A'],[85.7,82.1,'C'],[76.7,92.8,'C']
  ];
  const icon=id=>'<svg class="icon" aria-hidden="true"><use href="#cc-'+id+'"/></svg>';
  let phase='pre', selected='core';
  const items=[];
  function add(id,type,x,y,team){
   const pin=document.createElement('button');
   pin.type='button';pin.className='pin '+type; pin.dataset.landmark = id;
   if(team){pin.dataset.zone=team;pin.classList.add('zone-'+team.toLowerCase());pin.textContent=team;}
   else pin.innerHTML=icon(type);
   pin.addEventListener('click',()=>select(id));
   map.append(pin);
   const item={id,type,x,y,team,pin};
   items.push(item);return item;
  }
  const refs=refineries.map(([x,y],i)=>add('ref-'+i,'refinery',x,y));
  const hospitals=[[18.5,17.5],[77.5,85.5]].map(([x,y],i)=>add('hospital-'+i,'hospital',x,y));
  const military=bases.map(([x,y],i)=>add('base-'+i,'base',x,y));
  const captain=add('captain','captain',96,5);
  const core=add('core','core',50.5,47.5);
  const teams=keys.map((t,i)=>add(t,'team-marker',...starts[i],t));
  const corners=['north-west','south-east'].map(pos=>{
   const el=document.createElement('span');el.className='map-corner '+pos;map.append(el);return el;
  });
  for(const [type,label] of [['refinery','Refineries'],['hospital','Hospitals'],['base','Military bases'],['captain','Canyon Captain'],['core','Energy Core']]){
   const li=document.createElement('li');li.innerHTML=icon(type);li.append(label);legend.append(li);
  }
  function select(id){
   const item=items.find(x=>x.id===id&&!x.pin.hidden)||core;
   selected=item.id;
   for(const entry of items)entry.pin.setAttribute('aria-pressed',String(entry===item));
   root.querySelectorAll('.order').forEach(el=>el.setAttribute('aria-pressed',String(el.dataset.team===selected)));
   title.textContent=item.label;copy.textContent=item.detail;
   root.querySelector('#captain-link').hidden=item.id!=='captain';
   root.querySelector('#captain-break').hidden=item.id!=='captain';
  }
  function render(){
   const enemy=1-home;
   const side=['top left','bottom right'];
   const hospitalBadges=[starts[1],starts[2]];
   corners.forEach((el,i)=>el.textContent=i===home?'HOME':'ENEMY');
   root.querySelector('#home-position').textContent='Home: '+side[home];
   const hospitalB='Capture and hold the enemy hospital ('+side[enemy]+'), its two adjacent refineries, and nearby buildings.';
   const hospitalC='Defend the home hospital ('+side[home]+'), its two adjacent refineries, and nearby buildings.';
   const positions={
    pre:[starts[0],hospitalBadges[enemy],hospitalBadges[home],starts[3]],
    bases:[baseBadges[enemy],hospitalBadges[enemy],hospitalBadges[home],baseBadges[home]],
    core:[[41,47.5],[60,47.5],baseBadges[enemy],baseBadges[home]],
    post:[baseBadges[enemy],hospitalBadges[enemy],hospitalBadges[home],baseBadges[home]]
   };
   const orders={
    pre:['Hold the bottom left refinery group until military bases open.',hospitalB,hospitalC,
     'Hold the four upper right refineries and assist with early Tyrants. Stage trucks in the top right before Canyon Captain appears so they’re ready when it opens.'],
    bases:['Push and hold the enemy military base as soon as it opens.',hospitalB+' Stay until Core opens.',hospitalC+' Stay until Core opens.',
     'After the early Tyrant assignment, teleport immediately to the home military base as soon as it opens. Capture and hold it.'],
    core:['Rotate immediately from the enemy military base to the Energy Core. Capture and hold it.',
     'Teleport to the Core right away to reinforce A. Help zero enemy bases as opportunities come up while keeping the Core fight the priority.',
     'Take over the enemy military base from A. Cover the westmost refinery and nearby uncontested buildings when safe.',
     'Keep holding the home military base. Pick up nearby uncontested refineries and buildings when safe.'],
    post:['Return to the enemy military base when the Core fight is settled.',
     'Return to the enemy hospital and its nearby buildings.',
     'Return to the home hospital and its nearby buildings.',
     'Continue holding the home military base.']
   }[phase];
   root.querySelector('#phase-title').textContent={pre:'Pre-Core',bases:'Military Bases Open',core:'During Core',post:'Post-Core'}[phase];
   root.querySelector('#phase-note').textContent={
    pre:'Start here before military bases open.',
    bases:'A and D move as soon as bases open. B and C stay at their hospitals.',
    core:'A and B move immediately. C and D keep control of the bases and pick up open buildings as the fight allows.',
    post:'Return to these positions once the Core fight is settled. If the fight is still contested or the lead is narrow, stay available to reinforce wherever needed.'
   }[phase];
   phases.forEach(el=>el.setAttribute('aria-pressed',String(el.dataset.phase===phase)));
   const list=root.querySelector('#orders');list.replaceChildren();
   teams.forEach((item,i)=>{
    [item.x,item.y]=positions[phase][i];
    item.label='Team '+keys[i];item.detail=orders[i];
    const button=document.createElement('button');
    button.type='button';button.className='order zone-'+keys[i].toLowerCase();button.dataset.team=keys[i];
    const heading=document.createElement('b');heading.textContent=item.label;
    button.append(heading,item.detail);button.addEventListener('click',()=>select(item.id));list.append(button);
   });
   if(phase==='post'){
    const handover=document.createElement('section');handover.className='handover';
    handover.innerHTML='<h3>Substitutions</h3><p>With a safe lead, subs can join to earn points. Request a replacement in the group call, and <strong>wait until your sub is confirmed and ready before leaving</strong>.</p>';
    list.append(handover);
   }
   function paint(item,owner){
    keys.forEach(t=>item.pin.classList.toggle('zone-'+t.toLowerCase(),t===owner));
    item.pin.classList.toggle('owned',!!owner);
   }
   refs.forEach((item,i)=>{
    const distance=bases.map(([x,y])=>(x-item.x)**2+(y-item.y)**2);
    const nearest=distance[0]<distance[1]?0:1;
    const sector=refineries[i][2];
    const hospitalSide=sector==='B'?0:sector==='C'?1:null;
    const hospitalTeam=hospitalSide===home?'C':'B';
    const early=phase==='pre', hospitalPhase=phase!=='core';
    const support=phase==='core'&&(i===6||[7,8,9].includes(i));
    const owner=early?(hospitalSide===null?sector:hospitalTeam)
      :hospitalPhase&&hospitalSide!==null?hospitalTeam
      :support?(i===6?'C':nearest===home?'D':'C'):'';
    paint(item,owner);
    item.label='Refinery '+(i+1)+(owner?' · Team '+owner:'');
    item.detail=owner?(support?'Optional pickup for Team '+owner+' if uncontested and the military base is covered.':'Team '+owner+' covers this refinery in this phase.')
      :phase==='pre'?'No fixed assignment.':'No fixed assignment. Keep it if safe or take it when uncontested, without delaying priority moves.';
   });
   hospitals.forEach((item,i)=>{
    const friendly=i===home, owner=phase==='core'?'':friendly?'C':'B';
    paint(item,owner);
    item.label=(friendly?'Home':'Enemy')+' Hospital'+(owner?' · Team '+owner:'');
    item.detail=owner?(friendly?'Team C defends this hospital and nearby buildings.':'Team B takes and holds this hospital and nearby buildings.')
      :'Supporting players can hold or capture it if uncontested and higher priorities are covered.';
   });
   military.forEach((item,i)=>{
    const friendly=i===home, owner=phase==='pre'?'':friendly?'D':phase==='core'?'C':'A';
    paint(item,owner);
    item.label=(friendly?'Home':'Enemy')+' Military Base'+(owner?' · Team '+owner:'');
    item.detail=phase==='pre'?'Opens in the next phase. '+(friendly?'Team D moves here immediately.':'Team A moves here immediately.')
     :friendly?'Team D holds the home military base.'
     :phase==='core'?'Team C takes over from Team A.':'Team A holds the enemy military base.';
   });
   core.label='Energy Core';
   core.detail=phase==='core'?'Team A captures and holds it; Team B reinforces. Call for more support if needed.'
     :phase==='post'?'If the fight is still contested, be ready to reinforce before returning to your assignments.'
     :'Teams A and B move here when the Core opens.';
   captain.label='Canyon Captain';captain.detail='Three appointed players usually stage here before the Tyrant arrives. Stay in call and have all trucks ready.';
   items.forEach(({pin,x,y,label})=>{
    pin.style.setProperty('--x',x+'%');pin.style.setProperty('--y',y+'%');pin.setAttribute('aria-label',label);pin.title=label;
   });
   select(selected);
  }
  phases.forEach(el=>el.addEventListener('click',()=>{phase=el.dataset.phase;render();}));
  flip.addEventListener('click',()=>{home=1-home;render();});
  render();
  root.querySelector('#captain-link').addEventListener('click', event => {
   event.preventDefault();
   const checklist = root.querySelector('#captain-guide');
   checklist.focus({preventScroll:true});
   checklist.scrollIntoView({block:'nearest'});
  });
}
