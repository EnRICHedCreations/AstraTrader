export const ENGINE_CATALOG=[
  {name:'breadth',description:'Detects broad independent-wallet buying with a high buy/sell flow ratio.'},
  {name:'flow_acceleration',description:'Detects a sharp increase in buy frequency versus the preceding four-minute baseline.'},
  {name:'accumulation',description:'Detects multiple wallets accumulating while relatively few participating wallets sell.'},
  {name:'new_attention',description:'Detects a burst of recent buyers on a mint with little earlier activity in the observation window.'},
  {name:'sell_exhaustion',description:'Detects renewed buying after prior selling disappears from the most recent window.'},
  {name:'price_momentum',description:'Detects positive short-horizon price momentum from persisted pair-price snapshots.'},
  {name:'compression_accumulation',description:'Detects concentrated buying while price remains roughly flat or mildly compressed.'}
];
export const ENGINE_HORIZONS_MS=[60000,300000,900000,3600000];
export function engineResearch(store){
  const leaderboard=store.entities('experiment',100).find(x=>x.id==='engine-leaderboard')??null;
  const signals=store.entities('engine_signal',1000);
  const recent=signals.slice(0,100).map(s=>({id:s.id,mint:s.mint,symbol:s.symbol,at:s.at,score:s.score,action:s.action,reasons:s.reasons??[],policy:s.policy,entryPrice:s.entryPrice??null,engines:s.engines??[],outcomes:s.outcomes??{}}));
  const counts=new Map();
  for(const s of signals)for(const e of s.engines??[])counts.set(e.engine,(counts.get(e.engine)??0)+1);
  const rows=leaderboard?.rows??[];
  const engines=ENGINE_CATALOG.map(e=>({...e,shadowOnly:true,signalSamples:counts.get(e.name)??0,performance:rows.filter(r=>r.type==='engine'&&r.name===e.name)}));
  return{at:Date.now(),policy:leaderboard?.policy??'multi-engine-v4',shadowOnly:true,horizonsMs:ENGINE_HORIZONS_MS,engines,combinations:rows.filter(r=>r.type==='combination'),promotionPolicy:leaderboard?.promotionPolicy??null,promotionEligible:leaderboard?.eligible??[],leaderboardUpdatedAt:leaderboard?.at??null,recentSignals:recent};
}
