const DEFAULTS=Object.freeze({
  walletMinRoundTrips:30,
  walletMinScore:70,
  walletRequirePositiveLower95:true,
  walletRequireUntainted:true,
  walletConfidenceTrips:50,
  correlationGroupsRequired:3,
  observationWindowMs:300000,
  signalMintLimit:5,
  signalBucketMs:60000,
  minLiquidityUsd:100000,
  maxTop10HolderShare:0.30,
  requireTokenProgram:true,
  requireMintAuthorityRevoked:true,
  requireFreezeAuthorityRevoked:true,
  requireAssetReview:true,
  requireRouterCredentials:true,
  maxDataAgeMsPaper:30000,
  maxDataAgeMsLive:15000,
  quoteMaxAgeMs:5000,
  maxSlippageBps:50,
  maxPriceImpact:1,
  paperPositionPct:0.02,
  paperMaxExposurePct:0.15,
  livePositionPct:0.02,
  paperStopLossPct:0.10,
  paperTakeProfitPct:0.20,
  paperMaxHoldMs:3600000,
  liveStopLossPct:0.10,
  liveTakeProfitPct:0.20,
  liveMaxHoldMs:3600000,
  paperMaxDrawdownPct:0.10,
  liveMaxDrawdownPct:0.10,
  paperFillDelayMs:1500,
  markStaleMs:60000,
  walletScoreBase:50,
  walletScoreExpectancyWeight:30,
  walletScoreWinRateWeight:20,
  signalRiskWeight:0.40,
  signalGroupWeight:20
});

const SPEC={
 walletMinRoundTrips:[0,10000,'int'],walletMinScore:[0,100,'number'],walletRequirePositiveLower95:[0,1,'bool'],walletRequireUntainted:[0,1,'bool'],walletConfidenceTrips:[1,10000,'int'],correlationGroupsRequired:[0,100,'int'],observationWindowMs:[1000,86400000,'int'],signalMintLimit:[1,100,'int'],signalBucketMs:[1000,3600000,'int'],minLiquidityUsd:[0,1e12,'number'],maxTop10HolderShare:[0,1,'number'],requireTokenProgram:[0,1,'bool'],requireMintAuthorityRevoked:[0,1,'bool'],requireFreezeAuthorityRevoked:[0,1,'bool'],requireAssetReview:[0,1,'bool'],requireRouterCredentials:[0,1,'bool'],maxDataAgeMsPaper:[1000,3600000,'int'],maxDataAgeMsLive:[1000,3600000,'int'],quoteMaxAgeMs:[100,60000,'int'],maxSlippageBps:[1,5000,'int'],maxPriceImpact:[0,100,'number'],paperPositionPct:[0,1,'number'],paperMaxExposurePct:[0,1,'number'],livePositionPct:[0,1,'number'],paperStopLossPct:[0,1,'number'],paperTakeProfitPct:[0,10,'number'],paperMaxHoldMs:[1000,604800000,'int'],liveStopLossPct:[0,1,'number'],liveTakeProfitPct:[0,10,'number'],liveMaxHoldMs:[1000,604800000,'int'],paperMaxDrawdownPct:[0,1,'number'],liveMaxDrawdownPct:[0,1,'number'],paperFillDelayMs:[0,60000,'int'],markStaleMs:[1000,3600000,'int'],walletScoreBase:[0,100,'number'],walletScoreExpectancyWeight:[0,100,'number'],walletScoreWinRateWeight:[0,100,'number'],signalRiskWeight:[0,1,'number'],signalGroupWeight:[0,100,'number']
};
let active={...DEFAULTS};
export function defaultStrategy(){return {...DEFAULTS}}
export function strategy(){return {...active}}
export function validateStrategy(input,base=active){if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Strategy patch must be an object');const next={...base};for(const[k,v]of Object.entries(input)){const spec=SPEC[k];if(!spec)throw Error('Unknown strategy parameter: '+k);if(spec[2]==='bool'){if(typeof v!=='boolean')throw Error(k+' must be boolean');next[k]=v;continue}if(typeof v!=='number'||!Number.isFinite(v)||v<spec[0]||v>spec[1]||(spec[2]==='int'&&!Number.isInteger(v)))throw Error('Invalid strategy parameter: '+k);next[k]=v}if(next.paperPositionPct>next.paperMaxExposurePct)throw Error('paperPositionPct cannot exceed paperMaxExposurePct');return next}
export function setStrategy(value){active=validateStrategy(value,DEFAULTS);return strategy()}
export function patchStrategy(patch){active=validateStrategy(patch,active);return strategy()}
export function strategySchema(){return Object.fromEntries(Object.entries(SPEC).map(([k,[min,max,type]])=>[k,{type,min,max,default:DEFAULTS[k]}]))}
