// All catalog credentials remain inside the 36C Worker.
const BASE = 'https://shared-player-catalog.zanji.workers.dev';
const norm = value => String(value || '').normalize('NFKC').trim().toLocaleLowerCase();
const reply = (body, status=200) => Response.json(body,{status,headers:{'cache-control':'private, no-store'}});
export async function collectLeaguePower(teams, token, getFetch=fetch) {
  async function get(path) {
    const response=await getFetch(BASE+path,{headers:{'x-catalog-read-token':token},signal:AbortSignal.timeout(20000)});
    if(!response.ok)throw new Error('Catalog request failed (HTTP '+response.status+').');
    return response.json();
  }
  const current=await get('/api/catalog/current');
  if(!current.snapshot)throw new Error('Catalog has no active scan.');
  const fingerprint=JSON.stringify(current.snapshot);
  const scanId=String(current.snapshot.id||current.snapshot.importId||current.snapshot.completedAt||'');
  if(!scanId)throw new Error('Catalog scan identity unavailable.');
  const alliances=[];
  // Sequential requests bound subrequest count and avoid catalog overload.
  for(const team of teams){
    const row={allianceId:team.alliance_id,abbr:team.alliance_abbr,name:team.alliance_name,state:Number(team.server_id),totalMigratePower:null,status:'unmatched'};
    const filters=await get('/api/catalog/filters?'+new URLSearchParams({state:String(row.state),presence:'present'}));
    if(!Array.isArray(filters.alliances))throw new Error('Unexpected catalog alliance response.');
    const idMatches=filters.alliances.filter(a=>String(a.allianceId||a.id||a.key)===row.allianceId);
    const matches=idMatches.length?idMatches:filters.alliances.filter(a=>norm(a.abbreviation)===norm(row.abbr)&&norm(a.name)===norm(row.name));
    if(matches.length!==1||typeof matches[0].key!=='string'){alliances.push({...row,status:matches.length>1?'ambiguous':'unmatched'});continue;}
    row.allianceKey=matches[0].key;
    row.matchMethod=idMatches.length?'alliance-id':'state-tag-name';
    let offset=0,total=null,sum=0,known=0;
    const seen=new Set();
    for(let page=0;page<5;page++){
      const data=await get('/api/catalog/players?'+new URLSearchParams({state:String(row.state),allianceKey:row.allianceKey,presence:'present',limit:'500',offset:String(offset),includeRecord:'false'}));
      if(!Array.isArray(data.rows)||!Number.isSafeInteger(data.total)||data.total<0)throw new Error('Unexpected catalog player response.');
      if(total!==null&&total!==data.total)throw new Error('Catalog roster changed during pagination. Retry.');
      total=data.total;
      for(const player of data.rows){
        const uid=String(player.uid||'');
        if(!uid||seen.has(uid))throw new Error('Duplicate or missing catalog player identity.');
        if(Number(player.state)!==row.state||norm(player.allianceAbbr)!==norm(row.abbr)||player.presenceStatus!=='present')throw new Error('Catalog returned a player outside the requested alliance.');
        seen.add(uid);
        const raw=player.migratePower, value=typeof raw==='number'?raw:typeof raw==='string'&&raw.trim()!==''?Number(raw):NaN;
        if(Number.isSafeInteger(value)&&value>=0){sum+=value;known++;}
      }
      offset+=data.rows.length;
      if(offset===total)break;
      if(!data.rows.length||offset>total||page===4)throw new Error('Incomplete catalog pagination.');
    }
    if(!Number.isSafeInteger(sum))throw new Error('Catalog power total exceeds safe integer range.');
    alliances.push({...row,presentPlayers:seen.size,playersWithPower:known,totalMigratePower:seen.size&&known===seen.size?sum:null,knownMigratePower:sum,
      status:!seen.size?'empty':known===seen.size?'complete':'partial',scanId,scannedAt:current.snapshot.completedAt||null});
  }
  const after=await get('/api/catalog/current');
  if(JSON.stringify(after.snapshot)!==fingerprint)throw new Error('Active catalog scan changed during collection. Retry.');
  return {scanId,scannedAt:current.snapshot.completedAt||null,alliances};
}
export async function handleLeaguePower(request,env,ctx,portal){
  const authURL=new URL('/api/auth/me',request.url);
  const auth=await portal.fetch(new Request(authURL,{headers:request.headers}),env,ctx);
  if(!auth.ok)return auth;
  const session=await auth.json();
  if(!session.user||session.user.isGuest)return reply({ok:false,error:'Member sign-in required.'},403);
  if(!env.CATALOG_EXTERNAL_READ_TOKEN)return reply({ok:false,error:'CATALOG_EXTERNAL_READ_TOKEN is not configured on alliance-tracker-36c.'},503);
  try{
    const data=await env.DB.prepare('SELECT * FROM duel_group_members WHERE captured_at=(SELECT MAX(captured_at) FROM duel_group_members) ORDER BY league_position').all();
    const teams=data.results||[];
    if(teams.length!==16||new Set(teams.map(t=>t.alliance_id)).size!==16||new Set(teams.map(t=>t.duel_group)).size!==1)return reply({ok:false,error:'A complete 16-alliance league capture is required.'},422);
    const result=await collectLeaguePower(teams,env.CATALOG_EXTERNAL_READ_TOKEN);
    return reply({ok:true,group:teams[0].duel_group,...result});
  }catch(error){
    // Never include upstream response bodies or credential values in errors.
    return reply({ok:false,error:String(error.message||'Catalog lookup failed.').replaceAll(String(env.CATALOG_EXTERNAL_READ_TOKEN),'[redacted]')},502);
  }
}
