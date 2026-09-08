import { createHash } from "node:crypto";
import { strategy } from "./strategy.mjs";

function digest(value){return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0,16)}
function finite(value,fallback=0){const n=Number(value);return Number.isFinite(n)?n:fallback}

export function strategyRevision(value=strategy()){return digest(value)}

export function performance(store,{since=0,sinceStrategyRevision=null,mode='paper',liveStatus=null}={}){
  let sinceAt=Math.max(0,finite(since,0));
  const changes=store.db.prepare("SELECT at,body FROM events WHERE kind='STRATEGY_CHANGED' ORDER BY seq").all().map(row=>{const body=JSON.parse(row.body);return{at:Number(row.at),revision:strategyRevision(body.strategy??{}),strategy:body.strategy??{}}});
  if(sinceStrategyRevision){const match=[...changes].reverse().find(x=>x.revision===sinceStrategyRevision);if(!match)throw Error("Unknown strategy revision");sinceAt=Math.max(sinceAt,match.at)}
  const currentStrategy=strategy(),currentRevision=strategyRevision(currentStrategy);
  const acceptedSignals=store.db.prepare("SELECT COUNT(*) AS n FROM events WHERE kind='SIGNAL_CREATED' AND at>=?").get(sinceAt)?.n??0;
  const rejectedSignals=store.db.prepare("SELECT COUNT(*) AS n FROM events WHERE kind='SIGNAL_REJECTED' AND at>=?").get(sinceAt)?.n??0;
  const common={at:Date.now(),mode,window:{since:sinceAt||null,sinceStrategyRevision:sinceStrategyRevision??null},strategy:{revision:currentRevision,active:currentStrategy,changes:changes.filter(x=>x.at>=sinceAt).map(x=>({at:x.at,revision:x.revision}))},signals:{accepted:Number(acceptedSignals),rejected:Number(rejectedSignals)}};

  if(mode==='live'){
    if(!liveStatus?.risk)throw Error('Live signer status unavailable');
    const sideById=new Map(store.orders().filter(o=>o.mode==='live').map(o=>[o.id,o.side]));
    const orders=(liveStatus.orders??[]).filter(o=>finite(o.at)>=sinceAt).map(o=>({...o,side:sideById.get(o.id)??(String(o.id).startsWith('exit:')?'sell':undefined)}));
    const exits=orders.filter(o=>o.side==='sell'&&o.state==='confirmed'&&Number.isFinite(Number(o.result?.pnlUSDC)));
    const pnls=exits.map(o=>Number(o.result.pnlUSDC)),realizedPnlUSDC=pnls.reduce((a,b)=>a+b,0),wins=pnls.filter(x=>x>0).length,losses=pnls.filter(x=>x<0).length;
    const risk=liveStatus.risk,holdings=liveStatus.holdings??{};
    return{...common,performance:{roundTrips:exits.length,wins,losses,breakeven:exits.length-wins-losses,winRate:exits.length?wins/exits.length:0,realizedPnlUSDC,expectancyUSDC:exits.length?realizedPnlUSDC/exits.length:0,feesUSDC:null,returnOnInitial:null},portfolio:{initialUSDC:null,walletUsdc:finite(risk.walletUsdc),trackedExposureUsdc:finite(risk.trackedExposureUsdc),equityUSDC:finite(risk.equityUsdc),effectiveBankrollUSDC:finite(risk.effectiveBankrollUsdc),currentRealizedUSDC:realizedPnlUSDC,openPositions:Object.keys(holdings).length},orders:{confirmed:orders.filter(o=>o.state==='confirmed').length,entries:orders.filter(o=>o.side==='buy'&&o.state==='confirmed').length,exits:exits.length,unresolved:Number(liveStatus.unresolved??0)},notes:["Live performance uses signer-reconciled orders and current signer bankroll/equity.","Live realized P&L includes only finalized sells with known reconciled cost basis.","Paper portfolio values are not reported as live capital."]};
  }

  const orders=store.orders().filter(o=>o.mode==='paper'&&o.state==='confirmed'&&finite(o.at)>=sinceAt);
  const exits=orders.filter(o=>o.side==='sell'&&Number.isFinite(Number(o.result?.pnlUSDC)));
  const pnls=exits.map(o=>Number(o.result.pnlUSDC));
  const realizedPnlUSDC=pnls.reduce((a,b)=>a+b,0),wins=pnls.filter(x=>x>0).length,losses=pnls.filter(x=>x<0).length,breakeven=pnls.length-wins-losses;
  const feesUSDC=orders.reduce((n,o)=>n+finite(o.result?.feeRaw)/1e6,0);
  let curve=0,peak=0,maxDrawdownUSDC=0;for(const pnl of [...pnls].reverse()){curve+=pnl;peak=Math.max(peak,curve);maxDrawdownUSDC=Math.max(maxDrawdownUSDC,peak-curve)}
  const portfolio=store.get('portfolio',{}),initialUSDC=finite(portfolio.initialRaw)/1e6,cashUSDC=finite(portfolio.cashRaw)/1e6,currentRealizedUSDC=finite(portfolio.realizedRaw)/1e6;
  const holdings=Object.values(portfolio.holdings??{}),markedHoldingsUSDC=holdings.reduce((n,h)=>n+finite(h.markRaw)/1e6,0),equityUSDC=cashUSDC+markedHoldingsUSDC;
  return{...common,performance:{roundTrips:exits.length,wins,losses,breakeven,winRate:exits.length?wins/exits.length:0,realizedPnlUSDC,expectancyUSDC:exits.length?realizedPnlUSDC/exits.length:0,feesUSDC,maxDrawdownUSDC,returnOnInitial:initialUSDC?realizedPnlUSDC/initialUSDC:0},portfolio:{initialUSDC,cashUSDC,equityUSDC,currentRealizedUSDC,openPositions:holdings.length},orders:{confirmed:orders.length,entries:orders.filter(o=>o.side==='buy').length,exits:exits.length},notes:["Performance is based on confirmed AstraTrader paper orders only.","Realized P&L already reflects modeled native fees recorded by the paper engine.","maxDrawdownUSDC is computed from the realized closed-trade P&L curve for the selected window; open-position mark-to-market drawdown is not included."]}
}
