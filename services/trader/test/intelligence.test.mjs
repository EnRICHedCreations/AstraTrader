import test from "node:test";
import assert from "node:assert/strict";
import {
  walletScore,
  relationshipGroups,
  decode,
  mintProgram,
} from "../src/intelligence.mjs";
import { USDC, JUPITER, TOKEN } from "../src/config.mjs";
const obs = (id, side, rawQty, usdRaw, at) => ({
  id,
  side,
  rawQty,
  usdRaw,
  mint: "token",
  at,
  slot: at,
  wallet: "a",
});
test("partial exits are scored as separate realized exits", () => {
  const r = walletScore([
    obs("a", "buy", "10", "100000000", 1),
    obs("b", "sell", "5", "60000000", 2),
    obs("c", "sell", "5", "60000000", 3),
  ]);
  assert.equal(r.roundTrips, 2);
  assert.ok(Math.abs(r.pnl - 19.94) < 0.001);
  assert.equal(r.eligible, false);
});
test("prefix-only historical sells are unscored until a clean buy establishes basis", () => {
  const r = walletScore([
    obs("prefix", "sell", "5", "50000000", 1),
    obs("buy", "buy", "10", "100000000", 2),
    obs("sell", "sell", "10", "120000000", 3),
  ]);
  assert.equal(r.unscoredHistoricalExits, 1);
  assert.equal(r.taintedInventoryEvents, 0);
  assert.equal(r.activeTaintedMints, 0);
  assert.equal(r.roundTrips, 1);
  assert.ok(r.pnl > 0);
});
test("inventory inconsistency after an established basis remains tainted", () => {
  const r = walletScore([
    obs("buy", "buy", "5", "50000000", 1),
    obs("oversell", "sell", "10", "100000000", 2),
    obs("later", "sell", "1", "10000000", 3),
  ]);
  assert.equal(r.roundTrips, 0);
  assert.ok(r.taintedInventoryEvents >= 1);
  assert.equal(r.activeTaintedMints, 1);
});
test("unobserved sells and token gifts cannot create profitable history", () => {
  const prefix = walletScore([obs("a", "sell", "1", "100000000", 1)]);
  assert.equal(prefix.roundTrips, 0);
  assert.equal(prefix.unscoredHistoricalExits, 1);
  const r = walletScore([
    obs("a", "buy", "10", "100000000", 1),
    obs("b", "transfer", "100", "0", 2),
    obs("c", "sell", "10", "200000000", 3),
  ]);
  assert.equal(r.eligible, false);
  assert.equal(r.roundTrips, 0);
  assert.equal(r.activeTaintedMints, 1);
});
test("future outcomes do not affect earlier scores", () => {
  const r = walletScore(
    [
      obs("a", "buy", "1", "1000000", 1),
      obs("b", "sell", "1", "1000000000", 1000),
    ],
    500,
  );
  assert.equal(r.pnl, 0);
  assert.equal(r.roundTrips, 0);
});
test("common funding reduces independent confirmations without claiming ownership", () => {
  const r = relationshipGroups(
    ["a", "b", "c"],
    [
      { kind: "funding", a: "f", b: "a" },
      { kind: "funding", a: "f", b: "b" },
    ],
    [],
  );
  assert.equal(r.groups.a, r.groups.b);
  assert.notEqual(r.groups.a, r.groups.c);
  assert.match(r.interpretation, /do not prove/);
});
test("opposed token deltas without DEX invocation are transfers, not swaps", () => {
  const t = {
    blockTime: 1,
    meta: {
      preTokenBalances: [
        {
          owner: "w",
          mint: USDC,
          uiTokenAmount: { amount: "1000000", decimals: 6 },
        },
      ],
      postTokenBalances: [
        { owner: "w", mint: "t", uiTokenAmount: { amount: "1", decimals: 0 } },
      ],
      fee: 5000,
    },
    transaction: {
      message: {
        accountKeys: [{ pubkey: "w", signer: true }],
        instructions: [],
      },
    },
  };
  assert.equal(decode(t, "s", 1).trades.length, 0);
  t.transaction.message.instructions = [{ programId: JUPITER }];
  assert.equal(decode(t, "s", 1).trades.length, 1);
});
test("mint programs are explicit and unknown programs fail closed", () => {
  assert.deepEqual(mintProgram(TOKEN), { id: TOKEN, name: "spl-token", recognized: true, executionSupported: true });
  assert.deepEqual(mintProgram("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"), { id: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb", name: "spl-token-2022", recognized: true, executionSupported: false });
  assert.deepEqual(mintProgram("not-a-token-program"), { id: "not-a-token-program", name: "unknown", recognized: false, executionSupported: false });
});
