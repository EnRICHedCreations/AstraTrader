import { installMultiEngine as installV7 } from './multi-engine.mjs';
import { strategy } from './strategy.mjs';
import { USDC } from './config.mjs';
import { inspect } from './intelligence.mjs';
import { RESEARCH_NOTIONAL_USDC_RAW, researchQuoteReason, entryResearchFill, exitResearchFill, executableRoundTripReturn } from './research-cost.mjs';

const POLICY='multi-engine-v8';
const TEMPORAL_TTL_MS=5*60*1000;
const MIN_ENGINES=2;
const OUTCOME_HORIZONS=[60000,300000,900000,3600000];
const SETTLEMENT_DELAY_LIMIT_MS=120000;
const SETTLEMENT_SIGNAL_LIMIT=20;
const PROMOTION={minSamples:30,minWinRate:0.55,minMeanReturn:0.005,minLower95:0,minRiskAdjusted:0.15,maxDrawdown:0.15};
const unique=a=>[...new Set(a)];
const mean=a=>a.length?a.reduce((n,x)=>n+x,0)/a.length:0;
const std=a=>{if(a.length<2)return 0;const m=mean(a);return Math.sqrt(a.reduce((n,x)=>n+(x-m)**2,0)/(a.length-1))};
const comboKey=s=>unique((s.engines??[]).map(e=>e.engine).filter(Boolean)).sort().join('+');
function maxDrawdown(rs){let e=1,p=1,d=0;for(const r of rs){e*=Math.max(0,1+r);p=Math.max(p,e);d=Math.max(d,p?1-e/p:1)}return d}
function metrics(rs){const samples=rs.length,m=mean(rs),sd=std(rs),se=samples?sd/Math.sqrt(samples):0;return{samples,meanReturn:m,winRate:samples?rs.filter(x=>x>0).length/samples:0,volatility:sd,lower95:m-1.96*se,riskAdjusted:sd?m/sd:m>0?m:0,maxDrawdown:maxDrawdown(rs)}}
function promotion(m){const checks={minSamples:m.samples>=PROMOTION.minSamples,minWinRate:m.winRate>=PROMOTION.minWinRate,minMeanReturn:m.meanReturn>=PROMOTION.minMeanReturn,positiveLower95:m.lower95>PROMOTION.minLower95,minRiskAdjusted:m.riskAdjusted>=PROMOTION.minRiskAdjusted,maxDrawdown:m.maxDrawdown<=PROMOTION.maxDrawdown};return{eligible:Object.values(checks).every(Boolean),checks,thresholds:PROMOTION}}
async function pairPrice(ctx,mint){const pair=(await ctx.p.pairs(mint))[0],price=Number(pair?.priceUsd),liquidity=Number(pair?.liquidity?.usd??pair?.liquidityUsd??0);return Number.isFinite(price)&&price>0?{price,liquidity}:null}
function sourceSignals(ctx,mint,now){return ctx.s.entities('engine_signal',5000).filter(s=>s.mint===mint&&s.at>=now-TEMPORAL_TTL_MS&&String(s.policy||'').startsWith('multi-engine-v')&&Array.isArray(s.engines)&&s.engines.length)}
async function executableEntry(ctx,mint,st){const q=await ctx.p.quote(USDC,mint,RESEARCH_NOTIONAL_USDC_RAW);const reason=researchQuoteReason(q,USDC,mint,RESEARCH_NOTIONAL_USDC_RAW,st);return reason?{reason,quote:q}:{reason:null,quote:q,fill:entryResearchFill(q)}}
async function settle(ctx,now,st){
 let settledThisCycle=0;
 for(const s of ctx.s.entities('temporal_engine_signal',1000).filter(x=>x.entryFill?.outputRaw)){
  if(settledThisCycle>=SETTLEMENT_SIGNAL_LIMIT)break;
  const outcomes={...(s.outcomes??{})};let changed=false;
  for(const h of OUTCOME_HORIZONS){
   if(outcomes[h]||now-s.at<h)continue;
   const delay=Math.max(0,now-(s.at+h));let q,routeReason=null,exitFill=null,net=null,price=null,grossPriceReturn=null;
   try{q=await ctx.p.quote(s.mint,USDC,s.entryFill.outputRaw);routeReason=researchQuoteReason(q,s.mint,USDC,s.entryFill.outputRaw,st);if(!routeReason){exitFill=exitResearchFill(q);net=executableRoundTripReturn(s.entryFill,exitFill)}}catch(e){routeReason=String(e?.message??e)}
   try{const p=await pairPrice(ctx,s.mint);price=p?.price??null;if(price&&s.entryPrice)grossPriceReturn=price/s.entryPrice-1}catch{}
   const quality=delay<=SETTLEMENT_DELAY_LIMIT_MS?'usable':'late';
   outcomes[h]={at:now,price,grossPriceReturn,netReturn:net,return:net,entryFill:s.entryFill,exitFill,routeReason,settlementDelayMs:delay,settlementQuality:quality,costModel:'jupiter-executable-min-output-roundtrip',usableForPromotion:quality==='usable'&&!routeReason&&Number.isFinite(net),win:Number.isFinite(net)?net>0:null};
   changed=true;settledThisCycle++;break;
  }
  if(changed)ctx.s.entity('temporal_engine_signal',s.id,{...s,outcomes,updatedAt:now});
 }
 const settled=ctx.s.entities('temporal_engine_signal',5000),rows=[];
 for(const h of OUTCOME_HORIZONS){
  const overall=settled.filter(s=>s.outcomes?.[h]?.usableForPromotion).sort((a,b)=>a.at-b.at).map(s=>s.outcomes[h].netReturn).filter(Number.isFinite);
  if(overall.length){const m=metrics(overall);rows.push({type:'overall',name:'temporal-consensus',horizonMs:h,returnBasis:'jupiter-executable',...m,promotion:promotion(m)})}
  for(const name of unique(settled.map(comboKey).filter(Boolean))){const rs=settled.filter(s=>comboKey(s)===name&&s.outcomes?.[h]?.usableForPromotion).sort((a,b)=>a.at-b.at).map(s=>s.outcomes[h].netReturn).filter(Number.isFinite);if(rs.length){const m=metrics(rs);rows.push({type:'combination',name,horizonMs:h,returnBasis:'jupiter-executable',...m,promotion:promotion(m)})}}
 }
 ctx.s.entity('experiment','temporal-consensus-leaderboard',{at:now,policy:POLICY,shadowOnly:true,researchOnly:true,temporalTtlMs:TEMPORAL_TTL_MS,minIndependentEngines:MIN_ENGINES,settlementDelayLimitMs:SETTLEMENT_DELAY_LIMIT_MS,settlementSignalLimit:SETTLEMENT_SIGNAL_LIMIT,researchNotionalUsdc:RESEARCH_NOTIONAL_USDC_RAW/1e6,costModel:'jupiter-executable-min-output-roundtrip',promotionPolicy:PROMOTION,signals:settled.length,promotionEligible:rows.filter(r=>r.promotion?.eligible),rows:rows.sort((a,b)=>(b.lower95??-Infinity)-(a.lower95??-Infinity))});
}
export function installMultiEngine(Trader){
 installV7(Trader);if(Trader.prototype.__temporalConsensusInstalled)return;Trader.prototype.__temporalConsensusInstalled=true;const prior=Trader.prototype.evaluate;
 Trader.prototype.evaluate=async function(){
  await prior.call(this);if(this.s.get('paused',false))return;const st=strategy(),now=Date.now();try{await settle(this,now,st)}catch{}
  const recent=this.s.entities('engine_signal',5000).filter(s=>s.at>=now-TEMPORAL_TTL_MS&&s.evidence?.prefilteredSafeUniverse===true),mints=unique(recent.map(s=>s.mint));let candidates=0,confirmed=0,routerRejected=0,entryQuoteRejected=0,repeatSuppressed=0,freshRiskRejected=0;
  for(const mint of mints){
   const sources=sourceSignals(this,mint,now),safe=sources.filter(s=>(s.evidence?.risk?.reasons??[]).length===0),engineNames=unique(safe.flatMap(s=>(s.engines??[]).map(e=>e.engine)));
   if(!safe.length)continue;candidates++;if(engineNames.length<MIN_ENGINES)continue;confirmed++;
   const latchKey='temporal-consensus-latch:'+mint,latch=this.s.get(latchKey,null),lastEvidenceAt=Math.max(...safe.map(s=>Number(s.at)||0));
   if(latch?.active&&lastEvidenceAt-Number(latch.lastEvidenceAt||0)<TEMPORAL_TTL_MS){this.s.set(latchKey,{...latch,lastEvidenceAt});repeatSuppressed++;continue}
   const bucket=Math.floor(now/st.signalBucketMs),id='temporal:'+mint+':'+bucket;if(this.s.get(id))continue;const newest=safe.sort((a,b)=>b.at-a.at)[0],reasons=[];
   let freshRisk;try{freshRisk=await inspect(mint,this.p,this.c);if((freshRisk?.reasons??[]).length){reasons.push(...freshRisk.reasons);freshRiskRejected++}}catch{reasons.push('Fresh asset risk inspection unavailable');freshRiskRejected++}
   if(st.requireRouterCredentials&&!this.c.jupiterKey){reasons.push('Router credentials missing');routerRejected++}
   let market;try{market=await pairPrice(this,mint)}catch{}if(!market||market.liquidity<st.minLiquidityUsd)reasons.push('Executable market quote unavailable or below liquidity floor');
   let executable;if(!reasons.length)try{executable=await executableEntry(this,mint,st);if(executable.reason){reasons.push(executable.reason);entryQuoteRejected++}}catch(e){reasons.push('Executable entry quote unavailable');entryQuoteRejected++}
   const signal={id,mint,symbol:newest.symbol,at:now,score:Math.round(mean(safe.map(s=>Number(s.score)||0))),action:reasons.length?'REJECT':'SHADOW_BUY',reasons,policy:POLICY,entryPrice:market?.price??null,entryFill:executable?.fill??null,engines:engineNames.map(engine=>({engine})),evidence:{temporalConsensus:true,firstConsensusAfterReset:true,temporalTtlMs:TEMPORAL_TTL_MS,sourceSignalIds:safe.map(s=>s.id),sourcePolicies:unique(safe.map(s=>s.policy)),engineNames,risk:freshRisk??newest.evidence?.risk,strategy:st,shadowOnly:true,researchCostModel:'jupiter-executable-min-output-roundtrip'}};
   this.s.tx(()=>{this.s.entity('signal',id,signal);this.s.entity('temporal_engine_signal',id,{...signal,outcomes:{}});this.s.event(reasons.length?'TEMPORAL_SIGNAL_REJECTED':'TEMPORAL_SIGNAL_SHADOW',signal,id);this.s.set(id,true);if(!reasons.length)this.s.set(latchKey,{active:true,firstSignalId:id,activatedAt:now,lastEvidenceAt})});
  }
  this.s.entity('experiment','temporal-consensus-funnel',{at:now,policy:POLICY,temporalTtlMs:TEMPORAL_TTL_MS,mintsWithRecentSafeEvidence:mints.length,candidates,consensusPassed:confirmed,repeatSuppressed,freshRiskRejected,routerRejected,entryQuoteRejected,shadowOnly:true});
 };
}
