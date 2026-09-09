export const ENGINE_CATALOG=[
{name:'breadth',description:'Detects broad independent-wallet buying with a high buy/sell flow ratio.'},{name:'flow_acceleration',description:'Detects a sharp increase in buy frequency versus the preceding four-minute baseline.'},{name:'accumulation',description:'Detects multiple wallets accumulating while relatively few participating wallets sell.'},{name:'new_attention',description:'Detects a burst of recent buyers on a mint with little earlier activity in the observation window.'},{name:'sell_exhaustion',description:'Detects renewed buying after prior selling disappears from the most recent window.'},{name:'price_momentum',description:'Detects positive short-horizon price momentum from persisted pair-price snapshots.'},{name:'compression_accumulation',description:'Detects concentrated buying while price remains roughly flat or mildly compressed.'}];
export const ENGINE_HORIZONS_MS=[60000,300000,900000,3600000];
export const ENGINE_PROMOTION_POLICY={minSamples:30,minWinRate:0.55,minMeanReturn:0.005,minLower95:0,minRiskAdjusted:0.15,maxDrawdown:0.15};
export function engineResearch(store){
 const persisted=store.entities('experiment',100).find(x=>x.id==='engine-leaderboard')??null;
 const temporalLeaderboard=store.entities('experiment',100).find(x=>x.id==='temporal-consensus-leaderboard')??null;
 const temporalFunnel=store.entities('experiment',100).find(x=>x.id==='temporal-consensus-funnel')??null;
 const signals=store.entities('engine_signal',5000).filter(s=>Array.isArray(s.engines));
 const temporalSignals=store.entities('temporal_engine_signal',5000).filter(s=>Array.isArray(s.engines));
 const rows=persisted?.rows??[];
 const recent=signals.slice(0,100).map(s=>({id:s.id,mint:s.mint,symbol:s.symbol,at:s.at,score:s.score,action:s.action,reasons:s.reasons??[],policy:s.policy,entryPrice:s.entryPrice??null,engines:s.engines??[],outcomes:s.outcomes??{}}));
 const recentTemporal=temporalSignals.slice(0,100).map(s=>({id:s.id,mint:s.mint,symbol:s.symbol,at:s.at,score:s.score,action:s.action,reasons:s.reasons??[],policy:s.policy,entryPrice:s.entryPrice??null,entryFill:s.entryFill??null,engines:s.engines??[],outcomes:s.outcomes??{},evidence:s.evidence??{}}));
 const counts=new Map();for(const s of signals)for(const e of s.engines??[])counts.set(e.engine,(counts.get(e.engine)??0)+1);
 const engines=ENGINE_CATALOG.map(e=>({...e,shadowOnly:true,signalSamples:counts.get(e.name)??0,tradableSamples:signals.filter(s=>s.action==='SHADOW_BUY'&&(s.reasons??[]).length===0&&(s.engines??[]).some(x=>x.engine===e.name)).length,performance:rows.filter(r=>r.type==='engine'&&r.name===e.name)}));
 return{
  at:Date.now(),policy:persisted?.policy??'multi-engine-v5',shadowOnly:true,horizonsMs:ENGINE_HORIZONS_MS,engines,
  combinations:rows.filter(r=>r.type==='combination'),promotionPolicy:persisted?.promotionPolicy??ENGINE_PROMOTION_POLICY,promotionEligible:rows.filter(r=>r.promotion?.eligible),leaderboardUpdatedAt:persisted?.at??null,researchSource:'persisted-engine-signals-cross-revision',signalCount:signals.length,
  diagnostics:persisted?.diagnostics??{totalSignals:signals.length,tradableSignals:signals.filter(s=>s.action==='SHADOW_BUY'&&(s.reasons??[]).length===0).length,rejectedSignals:signals.filter(s=>s.action!=='SHADOW_BUY'||(s.reasons??[]).length>0).length},recentSignals:recent,
  temporal:{policy:temporalLeaderboard?.policy??'multi-engine-v8',shadowOnly:true,researchOnly:true,temporalTtlMs:temporalLeaderboard?.temporalTtlMs??300000,minIndependentEngines:temporalLeaderboard?.minIndependentEngines??2,costModel:temporalLeaderboard?.costModel??'jupiter-executable-min-output-roundtrip',settlementDelayLimitMs:temporalLeaderboard?.settlementDelayLimitMs??120000,researchNotionalUsdc:temporalLeaderboard?.researchNotionalUsdc??1,signalCount:temporalSignals.length,funnel:temporalFunnel,leaderboardUpdatedAt:temporalLeaderboard?.at??null,rows:temporalLeaderboard?.rows??[],promotionPolicy:temporalLeaderboard?.promotionPolicy??ENGINE_PROMOTION_POLICY,promotionEligible:temporalLeaderboard?.promotionEligible??[],recentSignals:recentTemporal}
 }
}
