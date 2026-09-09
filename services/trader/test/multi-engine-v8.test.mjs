import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultStrategy } from '../src/strategy.mjs';

test('safe strategy defaults remain conservative',()=>{const s=defaultStrategy();assert.equal(s.correlationGroupsRequired,1);assert.equal(s.minLiquidityUsd,100000);assert.equal(s.maxTop10HolderShare,0.30);assert.equal(s.requireTokenProgram,true);assert.equal(s.requireMintAuthorityRevoked,true);assert.equal(s.requireFreezeAuthorityRevoked,true);assert.equal(s.maxSlippageBps,50);assert.equal(s.maxPriceImpact,1);assert.equal(s.livePositionPct,0.02)});

test('research layer is shadow-only by source contract',async()=>{const src=await import('node:fs/promises').then(fs=>fs.readFile(new URL('../src/multi-engine-v8.mjs',import.meta.url),'utf8'));assert.match(src,/shadowOnly:true/);assert.doesNotMatch(src,/\.entry\(/);assert.match(src,/MIN_ENGINES=2/);assert.match(src,/TEMPORAL_TTL_MS=5\*60\*1000/);assert.match(src,/SETTLEMENT_DELAY_LIMIT_MS=120000/)});
