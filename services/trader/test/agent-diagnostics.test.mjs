import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/db.mjs";
import { qualification, observationCoverage, walletBackfill, listWalletDiagnostics, systemDiagnostics } from "../src/agent-diagnostics.mjs";

const good = {wallet:"11111111111111111111111111111111",roundTrips:10,score:70,lowerMean95:0.02,expectancy:0.03,activeTaintedMints:0,wins:7,losses:3,pnl:2};
const weak = {wallet:"22222222222222222222222222222222",roundTrips:4,score:40,lowerMean95:-0.01,expectancy:-0.02,activeTaintedMints:2,wins:1,losses:3,pnl:-1};

test("qualification explains every failed wallet criterion",()=>{
  const q=qualification(weak,{walletMinRoundTrips:10,walletMinScore:55,walletRequirePositiveLower95:true,walletRequireUntainted:true});
  assert.equal(q.eligible,false);
  assert.deepEqual(q.checks,{realizedExits:false,score:false,lowerMean95:false,inventoryIntegrity:false});
  assert.equal(q.reasons.length,4);
});

test("observation coverage and worker checkpoint are auditable",()=>{
  const store=new Store(":memory:");
  store.observe({id:"a",wallet:good.wallet,mint:"m",at:10,side:"buy",rawQty:"1",usdRaw:"1000000"});
  store.observe({id:"b",wallet:good.wallet,mint:"m",at:20,side:"sell",rawQty:"1",usdRaw:"1100000"});
  store.set("worker:checkpoint",{[`wallet-backfill:${good.wallet}`]:{pages:3,relayed:42,before:"sig",complete:false}});
  const coverage=observationCoverage(store,good.wallet),backfill=walletBackfill(store,good.wallet);
  assert.equal(coverage.observations,2);assert.equal(coverage.buys,1);assert.equal(coverage.sells,1);assert.equal(coverage.spanMs,10);
  assert.deepEqual(backfill,{started:true,complete:false,pages:3,relayed:42,hasOlderCursor:true});
  store.close();
});

test("wallet and system diagnostics separate durable and active eligibility",()=>{
  const store=new Store(":memory:");
  store.entity("wallet",good.wallet,good);
  store.entity("wallet",weak.wallet,weak);
  const trader={state:()=>({wallets:[weak],signals:[{reasons:[]},{reasons:["No current deployer/supply review","Fewer than 2 eligible correlation groups"]}]})};
  const listed=listWalletDiagnostics(store,trader,{limit:10});
  assert.equal(listed.wallets[0].wallet,good.wallet);
  assert.equal(listed.wallets[0].eligible,true);
  assert.equal(listed.wallets[0].active,false);
  assert.equal(listed.historicalEligible,1);
  assert.equal(listed.activeEligible,0);
  const activeOnly=listWalletDiagnostics(store,trader,{limit:10,scope:"active"});
  assert.equal(activeOnly.wallets[0].wallet,weak.wallet);
  const diag=systemDiagnostics(store,trader);
  assert.equal(diag.wallets.historicalEligible,1);
  assert.equal(diag.wallets.historicalEligibleInactive,1);
  assert.equal(diag.wallets.activeEligible,0);
  assert.equal(diag.wallets.failures.realizedExits,1);
  assert.equal(diag.opportunities.eligible,1);
  assert.equal(diag.opportunities.rejectionReasons["No current deployer/supply review"],1);
  store.close();
});
