import { inspect } from './intelligence.mjs';
import { strategy } from './strategy.mjs';

const ENGINE_VERSION='multi-engine-v1';
const SHADOW_ONLY=true;
const unique=a=>[...new Set(a)];

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

    const recent=this.s.db.prepare('SELECT body FROM observations WHERE at>=? ORDER BY at').all(now-Math.max(st.observationWindowMs,900000)).map(r=>JSON.parse(r.body));
    const candidateMints=unique(recent.filter(x=>x.side==='buy'&&x.mint).map(x=>x.mint)).slice(-st.signalMintLimit);
    for(const mint of candidateMints){
      const five=recent.filter(x=>x.mint===mint&&x.at>=now-300000);
      const one=five.filter(x=>x.at>=now-60000);
      const prior=five.filter(x=>x.at<now-60000);
      const buys=five.filter(x=>x.side==='buy'),sells=five.filter(x=>x.side==='sell');
      const buyers=unique(buys.map(x=>x.wallet).filter(Boolean));
      const engines=[];

      const flowRatio=buys.length/Math.max(1,buys.length+sells.length);
      if(buyers.length>=3&&buys.length>=4&&flowRatio>=0.75)engines.push({engine:'breadth',score:Math.min(100,45+buyers.length*8+flowRatio*20),evidence:{buyers:buyers.length,buys:buys.length,sells:sells.length,buyRatio:flowRatio}});

      const currentRate=one.filter(x=>x.side==='buy').length;
      const priorRate=prior.filter(x=>x.side==='buy').length/4;
      if(currentRate>=3&&currentRate>=Math.max(2,priorRate*2))engines.push({engine:'flow_acceleration',score:Math.min(100,50+currentRate*8),evidence:{buysLastMinute:currentRate,priorBuysPerMinute:priorRate}});

      try{
        const pair=(await this.p.pairs(mint))[0],price=Number(pair?.priceUsd),liquidity=Number(pair?.liquidity?.usd??pair?.liquidityUsd??0),snap=this.s.get('engine:price:'+mint,null);
        if(Number.isFinite(price)&&price>0){
          if(snap&&Number.isFinite(snap.price)&&snap.price>0&&now-snap.at>=30000&&now-snap.at<=900000){
            const change=price/snap.price-1;
            if(change>=0.02&&change<=0.25)engines.push({engine:'price_momentum',score:Math.min(100,50+change*200),evidence:{change,from:snap.price,to:price,ageMs:now-snap.at,liquidityUsd:liquidity}});
          }
          if(!snap||now-snap.at>=60000)this.s.set('engine:price:'+mint,{at:now,price});
        }
      }catch{}

      if(!engines.length)continue;
      let risk;
      try{risk=await inspect(mint,this.p,this.c)}catch(e){risk={score:0,reasons:['Risk inspection failed: '+String(e?.message??e)]}}
      const reasons=[...(risk.reasons??[])];
      if(engines.length<2)reasons.push('Multi-engine consensus requires 2 independent engines');
      if(st.requireRouterCredentials&&!this.c.jupiterKey)reasons.push('Router credentials missing');
      const score=Math.round(engines.reduce((n,e)=>n+e.score,0)/engines.length*(1-st.signalRiskWeight)+Number(risk.score??0)*st.signalRiskWeight);
      const id='engine:'+mint+':'+Math.floor(now/st.signalBucketMs);
      if(this.s.get(id))continue;
      const signal={id,mint,symbol:risk.symbol,at:now,score,action:reasons.length?'REJECT':'SHADOW_BUY',reasons,policy:ENGINE_VERSION,evidence:{engines,risk,strategy:st,shadowOnly:SHADOW_ONLY}};
      this.s.tx(()=>{this.s.entity('signal',id,signal);this.s.event(reasons.length?'ENGINE_SIGNAL_REJECTED':'ENGINE_SIGNAL_SHADOW',signal,id);this.s.set(id,true)});
    }
  };
}
