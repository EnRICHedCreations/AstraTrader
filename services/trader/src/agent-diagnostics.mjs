import { strategy } from "./strategy.mjs";

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function qualification(wallet, st = strategy()) {
  const checks = {
    realizedExits: num(wallet.roundTrips) >= st.walletMinRoundTrips,
    score: num(wallet.score) >= st.walletMinScore,
    lowerMean95: !st.walletRequirePositiveLower95 || num(wallet.lowerMean95, -Infinity) > 0,
    inventoryIntegrity: !st.walletRequireUntainted || num(wallet.activeTaintedMints) === 0,
  };
  const reasons = [];
  if (!checks.realizedExits) reasons.push(`${num(wallet.roundTrips)} realized exits; requires ${st.walletMinRoundTrips}`);
  if (!checks.score) reasons.push(`score ${num(wallet.score)}; requires ${st.walletMinScore}`);
  if (!checks.lowerMean95) reasons.push(`lower 95% expectancy ${num(wallet.lowerMean95)}; requires > 0`);
  if (!checks.inventoryIntegrity) reasons.push(`${num(wallet.activeTaintedMints)} active tainted mints; requires 0`);
  return { eligible: Object.values(checks).every(Boolean), checks, reasons };
}

export function observationCoverage(store, wallet) {
  const row = store.db.prepare(`SELECT COUNT(*) AS observations,
    SUM(CASE WHEN json_extract(body,'$.side')='buy' THEN 1 ELSE 0 END) AS buys,
    SUM(CASE WHEN json_extract(body,'$.side')='sell' THEN 1 ELSE 0 END) AS sells,
    SUM(CASE WHEN json_extract(body,'$.side')='transfer' THEN 1 ELSE 0 END) AS transfers,
    COUNT(DISTINCT mint) AS mints, MIN(at) AS oldestAt, MAX(at) AS newestAt
    FROM observations WHERE wallet=?`).get(wallet);
  return {
    observations: num(row?.observations), buys: num(row?.buys), sells: num(row?.sells),
    transfers: num(row?.transfers), mints: num(row?.mints),
    oldestAt: row?.oldestAt == null ? null : Number(row.oldestAt),
    newestAt: row?.newestAt == null ? null : Number(row.newestAt),
    spanMs: row?.oldestAt == null || row?.newestAt == null ? 0 : Math.max(0, Number(row.newestAt) - Number(row.oldestAt)),
  };
}

export function walletBackfill(store, wallet) {
  const checkpoint = store.get("worker:checkpoint", {}) ?? {};
  const state = checkpoint[`wallet-backfill:${wallet}`] ?? null;
  if (!state) return { started: false, complete: false, pages: 0, relayed: 0 };
  return {
    started: true,
    complete: !!state.complete,
    pages: num(state.pages),
    relayed: num(state.relayed),
    hasOlderCursor: !!state.before,
  };
}

function walletView(store, wallet, st = strategy(), includeCoverage = false) {
  const q = qualification(wallet, st);
  const base = {
    wallet: wallet.wallet,
    eligible: q.eligible,
    roundTrips: num(wallet.roundTrips),
    requiredRoundTrips: st.walletMinRoundTrips,
    score: num(wallet.score),
    requiredScore: st.walletMinScore,
    expectancy: num(wallet.expectancy),
    lowerMean95: num(wallet.lowerMean95),
    positiveLower95Required: !!st.walletRequirePositiveLower95,
    activeTaintedMints: num(wallet.activeTaintedMints),
    untaintedRequired: !!st.walletRequireUntainted,
    unscoredHistoricalExits: num(wallet.unscoredHistoricalExits),
    wins: num(wallet.wins), losses: num(wallet.losses), pnl: num(wallet.pnl),
    confidence: num(wallet.confidence), copyability: wallet.copyability ?? null,
    qualification: q.checks, reasons: q.reasons,
    backfill: walletBackfill(store, wallet.wallet),
  };
  if (includeCoverage) base.historyCoverage = observationCoverage(store, wallet.wallet);
  return base;
}

export function listWalletDiagnostics(store, trader, { limit = 100, eligible = null } = {}) {
  const st = strategy();
  let wallets = trader.state().wallets.map(w => walletView(store, w, st, false));
  if (eligible !== null) wallets = wallets.filter(w => w.eligible === eligible);
  wallets.sort((a,b) => Number(b.eligible)-Number(a.eligible) || b.score-a.score || b.roundTrips-a.roundTrips || b.lowerMean95-a.lowerMean95);
  return {
    at: Date.now(), activeEvaluated: trader.state().wallets.length, returned: Math.min(limit, wallets.length),
    requirements: { roundTrips: st.walletMinRoundTrips, score: st.walletMinScore, positiveLower95: st.walletRequirePositiveLower95, untainted: st.walletRequireUntainted },
    wallets: wallets.slice(0, limit),
  };
}

export function walletDiagnostic(store, trader, walletId) {
  const wallet = trader.state().wallets.find(w => w.wallet === walletId)
    ?? store.entities("wallet", 100000).find(w => w.wallet === walletId);
  if (!wallet) return null;
  return { at: Date.now(), ...walletView(store, wallet, strategy(), true) };
}

export function backfillDiagnostics(store, trader) {
  const checkpoint = store.get("worker:checkpoint", {}) ?? {};
  const entries = Object.entries(checkpoint).filter(([k]) => k.startsWith("wallet-backfill:"));
  const complete = entries.filter(([,v]) => !!v?.complete).length;
  const totalPages = entries.reduce((n,[,v]) => n + num(v?.pages), 0);
  const totalRelayed = entries.reduce((n,[,v]) => n + num(v?.relayed), 0);
  const st = strategy();
  const candidates = trader.state().wallets
    .map(w => walletView(store, w, st, false))
    .filter(w => !w.eligible)
    .sort((a,b) => {
      const ap = (a.qualification.score?20:0)+(a.qualification.lowerMean95?20:0)+(a.qualification.inventoryIntegrity?20:0)+Math.min(20,a.roundTrips*20/Math.max(1,a.requiredRoundTrips));
      const bp = (b.qualification.score?20:0)+(b.qualification.lowerMean95?20:0)+(b.qualification.inventoryIntegrity?20:0)+Math.min(20,b.roundTrips*20/Math.max(1,b.requiredRoundTrips));
      return bp-ap || b.score-a.score;
    })
    .slice(0,25);
  return {
    at: Date.now(), workerCheckpointPresent: Object.keys(checkpoint).length > 0,
    walletsStarted: entries.length, walletsComplete: complete, walletsInProgress: entries.length-complete,
    totalPages, totalTransactionsRelayed: totalRelayed,
    note: "Backfill progress describes worker pagination/relay coverage; completion does not imply a profitable or eligible wallet.",
    priorityCandidates: candidates,
  };
}

export function systemDiagnostics(store, trader) {
  const st = strategy(), wallets = trader.state().wallets;
  const failures = { realizedExits: 0, score: 0, lowerMean95: 0, inventoryIntegrity: 0 };
  let eligible = 0;
  for (const w of wallets) {
    const q = qualification(w, st); if (q.eligible) eligible++;
    for (const [k,ok] of Object.entries(q.checks)) if (!ok) failures[k]++;
  }
  const signals = trader.state().signals.slice(0,100);
  const rejectionReasons = {};
  for (const s of signals) for (const reason of s.reasons ?? []) rejectionReasons[reason] = (rejectionReasons[reason] ?? 0) + 1;
  return {
    at: Date.now(), wallets: { activeEvaluated: wallets.length, eligible, failures },
    opportunities: { evaluated: signals.length, eligible: signals.filter(s => !(s.reasons?.length)).length, rejectionReasons },
    backfill: backfillDiagnostics(store, trader),
  };
}
