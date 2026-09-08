import test from 'node:test';
import assert from 'node:assert/strict';
import {performance} from '../src/performance.mjs';

function store(orders=[]){return{orders:()=>orders,get:(key,fallback)=>fallback,db:{prepare:(sql)=>({all:()=>[],get:()=>({n:0})})}}}

test('live performance reports signer bankroll instead of paper portfolio',()=>{
  const s=store([
    {id:'buy:1',mode:'live',side:'buy',state:'confirmed',at:1},
    {id:'exit:mint:1',mode:'live',side:'sell',state:'confirmed',at:2}
  ]);
  const liveStatus={risk:{walletUsdc:13,trackedExposureUsdc:0,equityUsdc:13,effectiveBankrollUsdc:13},holdings:{},unresolved:0,orders:[
    {id:'buy:1',state:'confirmed',at:1,result:{pnlUSDC:0}},
    {id:'exit:mint:1',state:'confirmed',at:2,result:{pnlUSDC:0.25}}
  ]};
  const r=performance(s,{mode:'live',liveStatus});
  assert.equal(r.mode,'live');
  assert.equal(r.portfolio.equityUSDC,13);
  assert.equal(r.portfolio.effectiveBankrollUSDC,13);
  assert.equal(r.performance.realizedPnlUSDC,0.25);
  assert.equal(r.performance.roundTrips,1);
  assert.equal(r.portfolio.initialUSDC,null);
  assert.equal(r.performance.returnOnInitial,null);
});
