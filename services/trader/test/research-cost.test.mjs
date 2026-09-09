import test from 'node:test';
import assert from 'node:assert/strict';
import { researchQuoteReason, entryResearchFill, exitResearchFill, executableRoundTripReturn } from '../src/research-cost.mjs';

const st={maxPriceImpact:1,maxSlippageBps:50};
const q={inputMint:'USDC',outputMint:'TOKEN',inAmount:'1000000',outAmount:'500000',otherAmountThreshold:'495000',priceImpact:0.2,slippageBps:50,observedAt:1};

test('research quote accepts bounded executable route',()=>{
  assert.equal(researchQuoteReason(q,'USDC','TOKEN','1000000',st),null);
});

test('research quote rejects excessive impact',()=>{
  assert.equal(researchQuoteReason({...q,priceImpact:1.5},'USDC','TOKEN','1000000',st),'Route price impact exceeds limit');
});

test('round trip return uses executable minimum outputs',()=>{
  const entry=entryResearchFill(q);
  const exit=exitResearchFill({inputMint:'TOKEN',outputMint:'USDC',inAmount:entry.outputRaw,outAmount:'1100000',otherAmountThreshold:'1080000',priceImpact:0.1,slippageBps:50,observedAt:2});
  assert.ok(Math.abs(executableRoundTripReturn(entry,exit)-0.08)<1e-12);
});
