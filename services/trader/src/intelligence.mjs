import { USDC, JUPITER, TOKEN, assets, validAssetPolicy } from "./config.mjs";
import { strategy } from "./strategy.mjs";
import { createHash } from "node:crypto";
export function decode(tx, signature, slot, receivedAt = Date.now()) {
  if (!tx?.meta || tx.meta.err || !tx.blockTime) return { trades: [], edges: [], transfers: [] };
  const at = tx.blockTime * 1000, keys = tx.transaction.message.accountKeys;
  const instructions = [...tx.transaction.message.instructions, ...(tx.meta.innerInstructions ?? []).flatMap((g) => g.instructions)];
  const isSwap = instructions.some((i) => i.programId === JUPITER);
  const signers = new Set(keys.filter((k) => k.signer).map((k) => k.pubkey));
  const all = new Map();
  for (const [field, mul] of [["preTokenBalances", -1n],["postTokenBalances", 1n]]) for (const b of tx.meta[field] ?? []) {
    if (!b.owner) continue;
    const key = b.owner + ":" + b.mint, old = all.get(key) ?? {wallet:b.owner,mint:b.mint,raw:0n,decimals:b.uiTokenAmount.decimals};
    old.raw += mul * BigInt(b.uiTokenAmount.amount); all.set(key, old);
  }
  const trades=[],transfers=[],edges=[];
  for (const w of signers) {
    const deltas=[...all.values()].filter((x)=>x.wallet===w&&x.raw!==0n),usd=deltas.find((x)=>x.mint===USDC),others=deltas.filter((x)=>x.mint!==USDC);
    if (isSwap&&usd&&others.length===1&&usd.raw*others[0].raw<0n) {
      const t=others[0]; trades.push({id:signature+":"+w+":"+t.mint,signature,slot,at,receivedAt,wallet:w,mint:t.mint,side:t.raw>0n?"buy":"sell",rawQty:(t.raw<0n?-t.raw:t.raw).toString(),decimals:t.decimals,usdRaw:(usd.raw<0n?-usd.raw:usd.raw).toString(),feeLamports:tx.meta.fee,classification:"Jupiter invocation with single signer-owned USDC/token delta"});
    } else for (const d of deltas) if (d.mint!==USDC) transfers.push({id:signature+":transfer:"+w+":"+d.mint,wallet:w,mint:d.mint,side:"transfer",at,slot,rawQty:d.raw.toString(),signature});
  }
  for (const i of instructions) { const p=i.parsed; if(i.program==="system"&&p?.type==="transfer")edges.push({a:p.info.source,b:p.info.destination,kind:"funding",at,signature,lamports:p.info.lamports}); if(i.program==="spl-token"&&["mintTo","mintToChecked","initializeMint","initializeMint2"].includes(p?.type))edges.push({kind:p.type,a:p.info.mintAuthority??p.info.authority,b:p.info.mint,at,signature}); }
  return {trades,edges,transfers};
}
export function walletScore(observations,asOf=Date.now()){
  const s=strategy(),inventory=new Map(),realizedExits=[];let realized=0,tainted=0;
  const rows=observations.filter(t=>t.at<=asOf).sort((a,b)=>a.at-b.at||a.slot-b.slot||a.id.localeCompare(b.id));
  for(const t of rows){
    let p=inventory.get(t.mint)??{lots:[],tainted:false};
    if(t.side==="transfer"){
      const delta=BigInt(t.rawQty);if(delta===0n)continue;
      p={lots:[],tainted:true};tainted++;inventory.set(t.mint,p);continue;
    }
    const qty=BigInt(t.rawQty);if(qty<=0n)continue;const usd=Number(t.usdRaw)/1e6;if(!Number.isFinite(usd)||usd<=0)continue;
    if(t.side==="buy"){
      const cost=usd+.02;
      if(p.tainted)p={lots:[],tainted:false};
      p.lots.push({qty,cost,openedAt:t.at});inventory.set(t.mint,p);continue;
    }
    if(t.side!=="sell")continue;
    const available=p.lots.reduce((n,l)=>n+l.qty,0n);
    if(p.tainted||available<qty){p={lots:[],tainted:true};tainted++;inventory.set(t.mint,p);continue;}
    let remaining=qty,matchedCost=0,weightedOpened=0,matchedQty=0;
    while(remaining>0n&&p.lots.length){const lot=p.lots[0],take=lot.qty<remaining?lot.qty:remaining,frac=Number(take)/Number(lot.qty);matchedCost+=lot.cost*frac;weightedOpened+=lot.openedAt*Number(take);matchedQty+=Number(take);lot.qty-=take;lot.cost-=lot.cost*frac;remaining-=take;if(lot.qty===0n)p.lots.shift();}
    const proceeds=usd-.02,profit=proceeds-matchedCost,ret=matchedCost>0?profit/matchedCost:0;realized+=profit;
    realizedExits.push({pnl:profit,return:ret,at:t.at,holdingMs:matchedQty>0?t.at-weightedOpened/matchedQty:0});
    inventory.set(t.mint,p);
  }
  const n=realizedExits.length,wins=realizedExits.filter(r=>r.pnl>0),losses=realizedExits.filter(r=>r.pnl<=0),mean=realizedExits.reduce((x,r)=>x+r.return,0)/(n||1),variance=realizedExits.reduce((x,r)=>x+(r.return-mean)**2,0)/Math.max(1,n-1),lower=mean-1.96*Math.sqrt(variance/Math.max(1,n)),score=Math.round(Math.max(0,Math.min(100,s.walletScoreBase+s.walletScoreExpectancyWeight*Math.tanh(mean*5)+s.walletScoreWinRateWeight*((2*(wins.length+2))/(n+4)-1))));
  const activeTaints=[...inventory.values()].filter(p=>p.tainted).length,eligible=n>=s.walletMinRoundTrips&&score>=s.walletMinScore&&(!s.walletRequirePositiveLower95||lower>0)&&(!s.walletRequireUntainted||activeTaints===0);
  return{score,roundTrips:n,pnl:realized,wins:wins.length,losses:losses.length,confidence:Math.min(1,n/s.walletConfidenceTrips),expectancy:mean,lowerMean95:lower,profitFactor:losses.length&&losses.some(r=>r.pnl<0)?wins.reduce((x,r)=>x+r.pnl,0)/-losses.reduce((x,r)=>x+r.pnl,0):null,taintedInventoryEvents:tainted,activeTaintedMints:activeTaints,eligible,copyability:"Realized finalized Jupiter exits scored with FIFO cost basis; verified separately with delayed router quotes",asOf}
}
export function relationshipGroups(wallets,edges,trades){const parent=new Map(wallets.map((w)=>[w,w])),root=(w)=>{if(!parent.has(w))parent.set(w,w);let r=w;while(parent.get(r)!==r)r=parent.get(r);return r},join=(a,b)=>parent.set(root(a),root(b)),evidence=[],funders=new Map();for(const e of edges.filter((e)=>e.kind==="funding")){if(wallets.includes(e.a)&&wallets.includes(e.b)){join(e.a,e.b);evidence.push({...e,reason:"Direct funding; conservative correlation group"})}const set=funders.get(e.a)??new Set();set.add(e.b);funders.set(e.a,set)}for(const[f,targets]of funders){const ws=[...targets].filter((w)=>wallets.includes(w));if(ws.length>1&&targets.size<=20){for(const w of ws)join(ws[0],w);evidence.push({reason:"Shared non-hub funding source",funder:f,wallets:ws})}}const bins=new Map();for(const t of trades.filter((t)=>t.side==="buy")){const k=t.mint+":"+Math.floor(t.at/10000),list=bins.get(k)??new Set();list.add(t.wallet);bins.set(k,list)}const pairs=new Map();for(const set of bins.values()){const ws=[...set].sort();if(ws.length>20)continue;for(let i=0;i<ws.length;i++)for(let j=i+1;j<ws.length;j++){const k=ws[i]+":"+ws[j];pairs.set(k,(pairs.get(k)??0)+1)}}for(const[key,n]of pairs)if(n>=3){const[a,b]=key.split(":");join(a,b);evidence.push({a,b,coentries:n,reason:"Repeated synchronized entries; correlated evidence"})}return{groups:Object.fromEntries(wallets.map((w)=>[w,root(w)])),evidence,interpretation:"Correlation groups reduce confirmation counts; they do not prove wallet ownership"}}
export async function inspect(mint,p,c,assetPolicy=assets(c)){const s=strategy(),at=Date.now(),reasons=[];const account=await p.rpc("getAccountInfo",[mint,{encoding:"jsonParsed",commitment:"finalized"}]),info=account?.value?.data?.parsed?.info;if(s.requireTokenProgram&&(account?.value?.owner!==TOKEN||!info))reasons.push("Unsupported mint program");if(s.requireMintAuthorityRevoked&&info?.mintAuthority!==null)reasons.push("Mint authority active/unknown");if(s.requireFreezeAuthorityRevoked&&info?.freezeAuthority!==null)reasons.push("Freeze authority active/unknown");const pair=(await p.pairs(mint))[0],liquidity=pair?.liquidity?.usd??0;if(liquidity<s.minLiquidityUsd)reasons.push("Insufficient liquidity");const largest=await p.rpc("getTokenLargestAccounts",[mint,{commitment:"finalized"}]),addresses=largest.value.map((a)=>a.address),owners=addresses.length?await p.rpc("getMultipleAccounts",[addresses,{encoding:"jsonParsed",commitment:"finalized"}]):{value:[]},concentration=new Map();largest.value.forEach((a,i)=>{const owner=owners.value[i]?.data?.parsed?.info?.owner;if(!owner){reasons.push("Holder owner unresolved");return}concentration.set(owner,(concentration.get(owner)??0n)+BigInt(a.amount))});const supply=BigInt(info?.supply??0),topOwners=[...concentration.values()].sort((a,b)=>(a>b?-1:1)).slice(0,10),top10=supply>0n?Number(topOwners.reduce((a,b)=>a+b,0n))/Number(supply):null;if(top10===null||top10>s.maxTop10HolderShare)reasons.push("Concentrated holder ownership");const approval=validAssetPolicy(assetPolicy).find((a)=>a.mint===mint);if(s.requireAssetReview&&!approval)reasons.push("No current deployer/supply review");return{mint,at,symbol:String(pair?.baseToken?.symbol??mint.slice(0,6)).slice(0,24),price:Number(pair?.priceUsd??0),liquidity,decimals:info?.decimals,mintAuthority:info?.mintAuthority,freezeAuthority:info?.freezeAuthority,top10,holderOwners:[...concentration].map(([owner,raw])=>({owner,raw:raw.toString()})),approval:approval??null,reasons,allowed:reasons.length===0,score:Math.max(0,100-reasons.length*20),deployerVerified:!!approval,provenance:{rpc:"finalized",market:"DexScreener",deployer:"Runtime strategy-controlled asset review; approval does not alter other enabled checks"}}}
export function hash(value){return createHash("sha256").update(JSON.stringify(value)).digest("hex")}
