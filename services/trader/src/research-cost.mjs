export const RESEARCH_NOTIONAL_USDC_RAW=1000000;

export function researchQuoteReason(q, inputMint, outputMint, amount, st){
  if(!q||typeof q!=='object')return 'Quote unavailable';
  if(q.inputMint!==inputMint)return 'Route input mint mismatch';
  if(q.outputMint!==outputMint)return 'Route output mint mismatch';
  if(String(q.inAmount)!==String(amount))return 'Route input amount mismatch';
  const out=Number(q.otherAmountThreshold??q.outAmount),rawOut=Number(q.outAmount);
  if(!Number.isFinite(out)||out<=0||!Number.isFinite(rawOut)||rawOut<=0)return 'Route output invalid';
  if(out>rawOut)return 'Route minimum output exceeds quoted output';
  const impact=Number(q.priceImpact);
  if(!Number.isFinite(impact))return 'Route price impact invalid';
  if(Math.abs(impact)>Number(st.maxPriceImpact))return 'Route price impact exceeds limit';
  const slippage=Number(q.slippageBps);
  if(!Number.isFinite(slippage)||slippage>Number(st.maxSlippageBps))return 'Route slippage exceeds limit';
  return null;
}

export function entryResearchFill(q){
  return {
    inputRaw:String(q.inAmount),
    outputRaw:String(q.otherAmountThreshold??q.outAmount),
    quotedOutputRaw:String(q.outAmount),
    priceImpact:Number(q.priceImpact),
    slippageBps:Number(q.slippageBps),
    observedAt:Number(q.observedAt??Date.now()),
  };
}

export function exitResearchFill(q){
  return {
    inputRaw:String(q.inAmount),
    outputRaw:String(q.otherAmountThreshold??q.outAmount),
    quotedOutputRaw:String(q.outAmount),
    priceImpact:Number(q.priceImpact),
    slippageBps:Number(q.slippageBps),
    observedAt:Number(q.observedAt??Date.now()),
  };
}

export function executableRoundTripReturn(entry,exit){
  const spent=Number(entry?.inputRaw),received=Number(exit?.outputRaw);
  if(!Number.isFinite(spent)||spent<=0||!Number.isFinite(received)||received<0)return null;
  return received/spent-1;
}
