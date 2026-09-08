import { createHash } from "node:crypto";
import { strategy } from "./strategy.mjs";

function digest(value){return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0,16)}
function finite(value,fallback=0){const n=Number(value);return Number.isFinite(n)?n:fallback}

export function strategyRevision(value=strategy()){return digest(value)}

export function performance(store,{since=0,sinceStrategyRevision=null}={}){
  let sinceAt=Math.max(0,finite(since,0));
  const changes=store.db.prepare("SELECT at,body FROM events WHERE kind='STRATEGY_CHANGED' ORDER BY seq").all().map(row=>{const body=JSON.parse(row.body);return{at:Number(row.at),revision:strategyRevision(body.strategy??{}),strategy:body.strategy??{}}});
  if(sinceStrategyRevision){
    const match=[...changes].reverse().find(x=>x.revision===sinceStrategyRevision);
    if(!match)throw Error("Unknown strategy revision");
    sinceAt=Math.max(sinceAt,match.at);
  }
  const currentStrategy=strategy(),currentRevision=strategyRevision(currentStrategy);
  const orders=store.orders().filter(o=>o.mode==='paper'&&o.state==='confirmed'&&finite(o.at)>=sinceAt);
  const exits=orders.filter(o=>o.side==='sell'&&Number.isFinite(Number(o.result?.pnlUSDC)));
  const pnls=exits.map(o=>Number(o.result.pnlUSDC));
  const realizedPnlUSDC=pnls.reduce((a,b)=>a+b,0),wins=pnls.filter(x=>x>0).length,losses=pnls.filter(x=>x<0).length,breakeven=pnls.length-wins-losses;
  const feesUSDC=orders.reduce((n,o)=>n+finite(o.result?.feeRaw)/1e6,0);
  let curve=0,peak=0,maxDrawdownUSDC=0;
  for(const pnl of [...pnls].reverse()){curve+=pnl;peak=Math.max(peak,curve);maxDrawdownUSDC=Math.max(maxDrawdownUSDC,peak-curve)}
  const portfolio=store.get('portfolio',{}),initialUSDC=finite(portfolio.initialRaw)/1e6,cashUSDC=finite(portfolio.cashRaw)/1e6,currentRealizedUSDC=finite(portfolio.realizedRaw)/1e6;
  const holdings=Object.values(portfolio.holdings??{}),markedHoldingsUSDC=holdings.reduce((n,h)=>n+finite(h.markRaw)/1e6,0),equityUSDC=cashUSDC+markedHoldingsUSDC;
  const acceptedSignals=store.db.prepare("SELECT COUNT(*) AS n FROM events WHERE kind='SIGNAL_CREATED' AND at>=?").get(sinceAt)?.n??0;
  const rejectedSignals=store.db.prepare("SELECT COUNT(*) AS n FROM events WHERE kind='SIGNAL_REJECTED' AND at>=?").get(sinceAt)?.n??0;
  return{at:Date.now(),mode:'paper',window:{since:sinceAt||null,sinceStrategyRevision:sinceStrategyRevision??null},strategy:{revision:currentRevision,active:currentStrategy,changes:changes.filter(x=>x.at>=sinceAt).map(x=>({at:x.at,revision:x.revision}))},performance:{roundTrips:exits.length,wins,losses,breakeven,winRate:exits.length?wins/exits.length:0,realizedPnlUSDC,expectancyUSDC:exits.length?realizedPnlUSDC/exits.length:0,feesUSDC,maxDrawdownUSDC,returnOnInitial:initialUSDC?realizedPnlUSDC/initialUSDC:0},portfolio:{initialUSDC,cashUSDC,equityUSDC,currentRealizedUSDC,openPositions:holdings.length},signals:{accepted:Number(acceptedSignals),rejected:Number(rejectedSignals)},orders:{confirmed:orders.length,entries:orders.filter(o=>o.side==='buy').length,exits:exits.length},notes:["Performance is based on confirmed AstraTrader paper orders only.","Realized P&L already reflects modeled native fees recorded by the paper engine.","maxDrawdownUSDC is computed from the realized closed-trade P&L curve for the selected window; open-position mark-to-market drawdown is not included."]}
}
