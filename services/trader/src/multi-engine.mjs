import { inspect } from './intelligence.mjs';
import { strategy } from './strategy.mjs';

const ENGINE_VERSION='multi-engine-v2';
const SHADOW_ONLY=true;
const OUTCOME_HORIZONS=[60000,300000,900000,3600000];
const unique=a=>[...new Set(a)];
const mean=a=>a.length?a.reduce((n,x)=>n+x,0)/a.length:0;
const std=a=>{if(a.length<2)return 0;const m=mean(a);return Math.sqrt(a.reduce((n,x)=>n+(x-m)**2,0)/(a.length-1))};

async function pairPrice(ctx,mint){const pair=(await ctx.p.pairs(mint))[0],price=Number(pair?.priceUsd),liquidity=Number(pair?.liquidity?.usd??pair?.liquidityUsd??0);return Number.isFinite(price)&&price>0?{price,liquidity}:null}

async function settleOutcomes(ctx,now){
  const signals=ctx.s.entities('engine_signal',500).filter(x=>x.entryPrice>0&&Array.isArray(x.engines));
  for(const signal of signals){
    const outcomes={...(signal.outcomes??{})};
    const due=OUTCOME_HORIZONS.filter(h=>outcomes[h]==null&&now-signal.at>=h);
    if(!due.length)continue;
    let quote;try{quote=await pairPrice(ctx,signal.mint)}catch{continue}if(!quote)continue;
    for(const horizon of due){const ret=quote.price/signal.entryPrice-1;outcomes[horizon]={at:now,price:quote.price,return:ret,win:ret>0};ctx.s.event('ENGINE_SIGNAL_OUTCOME',{signalId:signal.id,mint:signal.mint,horizonMs:horizon,entryPrice:signal.entryPrice,price:quote.price,return:ret,engines:signal.engines.map(e=>e.engine),policy:signal.policy});}
    ctx.s.entity('engine_signal',signal.id,{...signal,outcomes,updatedAt:now});
  }
  const settled=ctx.s.entities('engine_signal',1000),rows=[];
  for(const name of unique(settled.flatMap(s=>(s.engines??[]).map(e=>e.engine))))for(const horizon of OUTCOME_HORIZONS){const returns=settled.filter(s=>(s.engines??[]).some(e=>e.engine===name)&&s.outcomes?.[horizon]).map(s=>Number(s.outcomes[horizon].return)).filter(Number.isFinite);if(!returns.length)continue;const m=mean(returns),sd=std(returns);rows.push({engine:name,horizonMs:horizon,samples:returns.length,meanReturn:m,winRate:returns.filter(x=>x>0).length/returns.length,volatility:sd,riskAdjusted:sd?m/sd:m>0?m:0,updatedAt:now});}
  ctx.s.entity('experiment','engine-leaderboard',{at:now,policy:ENGINE_VERSION,shadowOnly:SHADOW_ONLY,rows:rows.sort((a,b)=>b.riskAdjusted-a.riskAdjusted)});
}

export function installMultiEngine(Trader){
  if(Trader.prototype.__multiEngineInstalled)return;
  Trader.prototype.__multiEngineInstalled=true;
  const original=Trader.prototype.evaluate;
  Trader.prototype.evaluate=async function multiEngineEvaluate(){
    await original.call(this);
    if(this.s.get('paused',false))return;
    const st=strategy(),now=Date.now();
    const maxAge=this.c.mode==='live'?st.maxDataAgeMsLive:st.maxDataAgeMsPaper;
    if(now-this.s.get('lastBlockTime',0)>maxAge)return;
    try{await settleOutcomes(this,now)}catch{}

    const recent=this.s.db.prepare('SELECT body FROM observations WHERE at>=? ORDER BY at').all(now-Math.max(st.observationWindowMs,900000)).map(r=>JSON.parse(r.body));
    const candidateMints=unique(recent.filter(x=>x.side==='buy'&&x.mint).map(x=>x.mint)).slice(-st.signalMintLimit);
    for(const mint of candidateMints){
      const five=recent.filter(x=>x.mint===mint&&x.at>=now-300000),one=five.filter(x=>x.at>=now-60000),prior=five.filter(x=>x.at<now-60000),buys=five.filter(x=>x.side==='buy'),sells=five.filter(x=>x.side==='sell'),buyers=unique(buys.map(x=>x.wallet).filter(Boolean)),engines=[];
      const flowRatio=buys.length/Math.max(1,buys.length+sells.length);
      if(buyers.length>=3&&buys.length>=4&&flowRatio>=0.75)engines.push({engine:'breadth',score:Math.min(100,45+buyers.length*8+flowRatio*20),evidence:{buyers:buyers.length,buys:buys.length,sells:sells.length,buyRatio:flowRatio}});
      const currentRate=one.filter(x=>x.side==='buy').length,priorRate=prior.filter(x=>x.side==='buy').length/4;
      if(currentRate>=3&&currentRate>=Math.max(2,priorRate*2))engines.push({engine:'flow_acceleration',score:Math.min(100,50+currentRate*8),evidence:{buysLastMinute:currentRate,priorBuysPerMinute:priorRate}});
      let quote;
      try{quote=await pairPrice(this,mint);const snap=this.s.get('engine:price:'+mint,null);if(quote){if(snap&&Number.isFinite(snap.price)&&snap.price>0&&now-snap.at>=30000&&now-snap.at<=900000){const change=quote.price/snap.price-1;if(change>=0.02&&change<=0.25)engines.push({engine:'price_momentum',score:Math.min(100,50+change*200),evidence:{change,from:snap.price,to:quote.price,ageMs:now-snap.at,liquidityUsd:quote.liquidity}})}if(!snap||now-snap.at>=60000)this.s.set('engine:price:'+mint,{at:now,price:quote.price})}}catch{}
      if(!engines.length)continue;
      let risk;try{risk=await inspect(mint,this.p,this.c)}catch(e){risk={score:0,reasons:['Risk inspection failed: '+String(e?.message??e)]}}
      const reasons=[...(risk.reasons??[])];if(engines.length<2)reasons.push('Multi-engine consensus requires 2 independent engines');if(st.requireRouterCredentials&&!this.c.jupiterKey)reasons.push('Router credentials missing');
      const score=Math.round(engines.reduce((n,e)=>n+e.score,0)/engines.length*(1-st.signalRiskWeight)+Number(risk.score??0)*st.signalRiskWeight),id='engine:'+mint+':'+Math.floor(now/st.signalBucketMs);if(this.s.get(id))continue;
      const signal={id,mint,symbol:risk.symbol,at:now,score,action:reasons.length?'REJECT':'SHADOW_BUY',reasons,policy:ENGINE_VERSION,entryPrice:quote?.price??null,engines,evidence:{engines,risk,strategy:st,shadowOnly:SHADOW_ONLY}};
      this.s.tx(()=>{this.s.entity('signal',id,signal);this.s.entity('engine_signal',id,{...signal,outcomes:{}});this.s.event(reasons.length?'ENGINE_SIGNAL_REJECTED':'ENGINE_SIGNAL_SHADOW',signal,id);this.s.set(id,true)});
    }
  };
}
