import { installMultiEngine as installV8 } from './multi-engine-v8.mjs';

const POLICY='multi-engine-v9-candidate-source';
const SOURCE_POLICY='multi-engine-v8';
const PROMOTION_MIN_SAMPLES=30;

function combo(signal){return [...new Set((signal.engines??[]).map(x=>x.engine).filter(Boolean))].sort().join('+')}
function usableOutcomes(signal){return Object.fromEntries(Object.entries(signal.outcomes??{}).filter(([,o])=>o?.usableForPromotion===true&&Number.isFinite(o?.netReturn)))}

export function installMultiEngine(Trader){
 installV8(Trader);
 if(Trader.prototype.__multiEngineCandidateSourceInstalled)return;
 Trader.prototype.__multiEngineCandidateSourceInstalled=true;
 const prior=Trader.prototype.evaluate;
 Trader.prototype.evaluate=async function(){
  await prior.call(this);
  if(this.s.get('paused',false))return;
  const now=Date.now();
  const temporal=this.s.entities('temporal_engine_signal',5000).filter(s=>s.policy===SOURCE_POLICY);
  let shadow=0,rejected=0,settled=0;
  for(const s of temporal){
   const outcomes=usableOutcomes(s),usableCount=Object.keys(outcomes).length;
   const status=s.reasons?.length?'REJECTED':'SHADOW_VALIDATING';
   if(status==='REJECTED')rejected++;else shadow++;
   if(usableCount)settled++;
   const candidate={
    id:'candidate:'+s.id,
    sourceSignalId:s.id,
    source:'multi-engine-consensus',
    sourcePolicy:s.policy,
    policy:POLICY,
    mint:s.mint,
    symbol:s.symbol,
    at:s.at,
    updatedAt:now,
    score:s.score,
    status,
    action:'SHADOW_ONLY',
    executionEligible:false,
    livePromotionAllowed:false,
    reasons:s.reasons??[],
    engines:s.engines??[],
    combination:combo(s),
    entryPrice:s.entryPrice??null,
    entryFill:s.entryFill??null,
    outcomes:s.outcomes??{},
    usableOutcomes:outcomes,
    validation:{
     costModel:'jupiter-executable-min-output-roundtrip',
     requiredSamples:PROMOTION_MIN_SAMPLES,
     usableOutcomeCount:usableCount,
     independentCandidateSource:true,
     legacyWalletEligibilityRequired:false,
     productionSafetyGatesPreserved:true
    },
    evidence:{...(s.evidence??{}),candidateSource:POLICY,shadowOnly:true}
   };
   this.s.entity('multi_engine_candidate',candidate.id,candidate);
  }
  this.s.entity('experiment','multi-engine-candidate-funnel',{
   at:now,policy:POLICY,sourcePolicy:SOURCE_POLICY,independentCandidateSource:true,
   legacyWalletEligibilityRequired:false,shadowOnly:true,livePromotionAllowed:false,
   productionSafetyGatesPreserved:true,total:temporal.length,shadow,rejected,withUsableOutcomes:settled,
   note:'Candidate source is isolated from Trader.entry; promotion requires separately validated executable performance.'
  });
 };
}
