const PRIMARY='0beb659cf5274a96952d91401ae41698';
export function lifetimeStandings(rows) {
  const players=rows.map(row=>({publicId:String(row.public_id),name:String(row.current_name),allianceAbbr:'36C',serverId:261,totalDuelPoints:Number(row.total_points)}));
  if(players.some(p=>!Number.isSafeInteger(p.totalDuelPoints)||p.totalDuelPoints<0))throw new Error('Invalid Duel point total.');
  players.sort((a,b)=>b.totalDuelPoints-a.totalDuelPoints||a.name.localeCompare(b.name)||a.publicId.localeCompare(b.publicId));
  const poolTotal=players.reduce((sum,p)=>sum+p.totalDuelPoints,0);
  if(!Number.isSafeInteger(poolTotal))throw new Error('Alliance Duel total exceeds safe integer range.');
  let rank=0,previous=null;
  players.forEach((p,i)=>{if(p.totalDuelPoints!==previous)rank=i+1;previous=p.totalDuelPoints;p.rank=rank;p.score=poolTotal?Math.round(p.totalDuelPoints/poolTotal*10000)/100:0;});
  return {ok:true,players,poolTotal,scoreModel:'share-of-alliance-total',scope:'all-recorded-duel-leagues',activeEvents:['alliance_duel'],plannedWeights:{alliance_duel:.45,state_ruler:.45,glory_war:.1}};
}
export async function handleLifetimeContribution(request,env,ctx,portal) {
  const auth=await portal.fetch(new Request(new URL('/api/auth/me',request.url),{headers:request.headers}),env,ctx);
  if(!auth.ok)return auth;
  const session=await auth.json();
  if(!session.user||session.user.isGuest)return Response.json({ok:false,error:'Member sign-in required.'},{status:403});
  try{
    // duel_weekly is an upserted weekly total, not a log of every sync.
    // Sum each stored week once; do not add daily rows or league ranking totals.
    const result=await env.DB.prepare(`SELECT p.public_id,p.current_name,SUM(w.score) AS total_points
      FROM duel_weekly w JOIN players p ON p.uid=w.uid
      WHERE w.alliance_id=? AND w.alliance_abbr='36C' AND w.server_id=261 AND w.score>=0
      GROUP BY p.uid HAVING SUM(w.score)>0`).bind(PRIMARY).all();
    return Response.json(lifetimeStandings(result.results||[]),{headers:{'cache-control':'private, no-store'}});
  }catch{return Response.json({ok:false,error:'Lifetime Duel standings could not be loaded.'},{status:502});}
}
