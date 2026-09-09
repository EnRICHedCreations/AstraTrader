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
export const ENGINE_PROMOTION_POLICY={minSamples:30,minWinRate:0.55,minMeanReturn:0.005,minLower95:0,minRiskAdjusted:0.15};
const unique=a=>[...new Set(a)];
const mean=a=>a.length?a.reduce((n,x)=>n+x,0)/a.length:0;
const std=a=>{if(a.length<2)return 0;const m=mean(a);return Math.sqrt(a.reduce((n,x)=>n+(x-m)**2,0)/(a.length-1))};
const keyFor=s=>unique((s.engines??[]).map(e=>e.engine).filter(Boolean)).sort().join('+');
function metrics(r){const samples=r.length,m=mean(r),sd=std(r),winRate=samples?r.filter(x=>x>0).length/samples:0,se=samples?sd/Math.sqrt(samples):0,lower95=m-1.96*se,riskAdjusted=sd?m/sd:m>0?m:0;return{samples,meanReturn:m,winRate,volatility:sd,lower95,riskAdjusted}}
function promotion(m){const p=ENGINE_PROMOTION_POLICY,checks={minSamples:m.samples>=p.minSamples,minWinRate:m.winRate>=p.minWinRate,minMeanReturn:m.meanReturn>=p.minMeanReturn,positiveLower95:m.lower95>p.minLower95,minRiskAdjusted:m.riskAdjusted>=p.minRiskAdjusted};return{eligible:Object.values(checks).every(Boolean),checks,thresholds:p}}
function rebuiltRows(signals){const rows=[],names=unique(signals.flatMap(s=>(s.engines??[]).map(e=>e.engine).filter(Boolean))),combos=unique(signals.map(keyFor).filter(k=>k.includes('+')));for(const h of ENGINE_HORIZONS_MS){for(const name of names){const r=signals.filter(s=>(s.engines??[]).some(e=>e.engine===name)&&s.outcomes?.[h]).map(s=>Number(s.outcomes[h].return)).filter(Number.isFinite);if(r.length){const m=metrics(r);rows.push({type:'engine',name,horizonMs:h,...m,promotion:promotion(m)})}}for(const name of combos){const r=signals.filter(s=>keyFor(s)===name&&s.outcomes?.[h]).map(s=>Number(s.outcomes[h].return)).filter(Number.isFinite);if(r.length){const m=metrics(r);rows.push({type:'combination',name,horizonMs:h,...m,promotion:promotion(m)})}}}return rows.sort((a,b)=>b.lower95-a.lower95)}
export function engineResearch(store){
  const persisted=store.entities('experiment',100).find(x=>x.id==='engine-leaderboard')??null;
  const signals=store.entities('engine_signal',5000).filter(s=>Array.isArray(s.engines));
  const rebuilt=rebuiltRows(signals),rows=rebuilt.length?rebuilt:(persisted?.rows??[]);
  const recent=signals.slice(0,100).map(s=>({id:s.id,mint:s.mint,symbol:s.symbol,at:s.at,score:s.score,action:s.action,reasons:s.reasons??[],policy:s.policy,entryPrice:s.entryPrice??null,engines:s.engines??[],outcomes:s.outcomes??{}}));
  const counts=new Map();for(const s of signals)for(const e of s.engines??[])counts.set(e.engine,(counts.get(e.engine)??0)+1);
  const engines=ENGINE_CATALOG.map(e=>({...e,shadowOnly:true,signalSamples:counts.get(e.name)??0,performance:rows.filter(r=>r.type==='engine'&&r.name===e.name)}));
  return{at:Date.now(),policy:'multi-engine-v4',shadowOnly:true,horizonsMs:ENGINE_HORIZONS_MS,engines,combinations:rows.filter(r=>r.type==='combination'),promotionPolicy:persisted?.promotionPolicy??ENGINE_PROMOTION_POLICY,promotionEligible:rows.filter(r=>r.promotion?.eligible),leaderboardUpdatedAt:persisted?.at??null,researchSource:'persisted-engine-signals-cross-revision',signalCount:signals.length,recentSignals:recent};
}
