import test from "node:test";
import assert from "node:assert/strict";
import {
  Keypair,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
  SystemProgram,
} from "@solana/web3.js";
import { config, USDC, TOKEN } from "../src/config.mjs";
import {
  positiveRaw,
  validateQuote,
  validateIntent,
  validateSimulation,
  validateTransaction,
  ata,
} from "../src/guard.mjs";
const wallet = Keypair.generate().publicKey.toBase58(),
  mint = Keypair.generate().publicKey.toBase58(),
  c = {
    ...config({}),
    maxOrder: 20,
    maxLamports: 5000000,
    minReserve: 10000000,
  };
const intent = () => ({
  id: "order-1",
  at: Date.now(),
  wallet,
  inputMint: USDC,
  outputMint: mint,
  amount: "1000000",
  signalId: "s",
});
const quote = () => ({
  inputMint: USDC,
  outputMint: mint,
  inAmount: "1000000",
  outAmount: "1000",
  otherAmountThreshold: "995",
  swapMode: "ExactIn",
  router: "metis",
  taker: wallet,
  slippageBps: 50,
  priceImpact: 0.1,
  transaction: "not-used-here",
  requestId: "q",
  lastValidBlockHeight: 1000,
});
function account(mint, amount) {
  const b = Buffer.alloc(165);
  new PublicKey(mint).toBuffer().copy(b, 0);
  new PublicKey(wallet).toBuffer().copy(b, 32);
  b.writeBigUInt64LE(BigInt(amount), 64);
  b[108] = 1;
  return {
    owner: TOKEN,
    data: [b.toString("base64"), "base64"],
    lamports: 2039280,
  };
}
function snapshots() {
  return {
    addresses: [wallet, ata(wallet, USDC), ata(wallet, mint)],
    before: [
      { owner: SystemProgram.programId.toBase58(), lamports: 30000000 },
      account(USDC, 5000000),
      account(mint, 0),
    ],
    after: [
      { owner: SystemProgram.programId.toBase58(), lamports: 29995000 },
      account(USDC, 4000000),
      account(mint, 1000),
    ],
  };
}
test("integer token arithmetic rejects floating point, negative and overflow amounts", () => {
  for (const v of [
    "0",
    "-1",
    "1.1",
    "1e9",
    "18446744073709551616",
    1,
    undefined,
  ])
    assert.throws(() => positiveRaw(v));
  assert.equal(positiveRaw("9007199254740993"), 9007199254740993n);
});
test("intent binds wallet, expiry, amount and provenance", () => {
  assert.doesNotThrow(() => validateIntent(intent(), c, wallet));
  for (const patch of [
    { wallet: mint },
    { at: 1 },
    { amount: "21000000" },
    { signalId: "" },
    { outputMint: USDC },
  ])
    assert.throws(() => validateIntent({ ...intent(), ...patch }, c, wallet));
});
test("quote cannot alter mint, slippage or minimum output", () => {
  assert.doesNotThrow(() => validateQuote(quote(), intent(), c, wallet));
  for (const patch of [
    { inputMint: mint },
    { inAmount: "2" },
    { otherAmountThreshold: "994" },
    { slippageBps: 51 },
    { router: "jupiterz" },
    { taker: mint },
    { priceImpact: NaN },
    { transaction: "" },
  ])
    assert.throws(() =>
      validateQuote({ ...quote(), ...patch }, intent(), c, wallet),
    );
});
test("valid simulated account deltas match exact intended input and minimum output", () => {
  const { addresses, before, after } = snapshots();
  assert.deepEqual(
    validateSimulation(addresses, before, after, intent(), c, wallet, 995n),
    { spent: "1000000", received: "1000" },
  );
});
test("simulation rejects native drain", () => {
  const x = snapshots();
  x.after[0].lamports = 20000000;
  assert.throws(
    () =>
      validateSimulation(
        x.addresses,
        x.before,
        x.after,
        intent(),
        c,
        wallet,
        995n,
      ),
    /Native/,
  );
});
test("simulation rejects delegate changes despite correct balances", () => {
  const x = snapshots(),
    b = Buffer.from(x.after[1].data[0], "base64");
  b.writeUInt32LE(1, 72);
  x.after[1].data[0] = b.toString("base64");
  assert.throws(
    () =>
      validateSimulation(
        x.addresses,
        x.before,
        x.after,
        intent(),
        c,
        wallet,
        995n,
      ),
    /authority/,
  );
});
test("simulation rejects underfill and excessive input", () => {
  for (const [input, output] of [
    [3999999, 1000],
    [4000000, 994],
  ]) {
    const x = snapshots();
    x.after[1] = account(USDC, input);
    x.after[2] = account(mint, output);
    assert.throws(
      () =>
        validateSimulation(
          x.addresses,
          x.before,
          x.after,
          intent(),
          c,
          wallet,
          995n,
        ),
      /amounts/,
    );
  }
});
test("simulation rejects unrelated token movements", () => {
  const x = snapshots(),
    other = Keypair.generate().publicKey.toBase58();
  x.addresses.push(ata(wallet, other));
  x.before.push(account(other, 2));
  x.after.push(account(other, 1));
  assert.throws(
    () =>
      validateSimulation(
        x.addresses,
        x.before,
        x.after,
        intent(),
        c,
        wallet,
        995n,
      ),
    /Unrelated/,
  );
});
test("arbitrary system transfer is rejected before any RPC simulation", async () => {
  const message = new TransactionMessage({
    payerKey: new PublicKey(wallet),
    recentBlockhash: Keypair.generate().publicKey.toBase58(),
    instructions: [
      SystemProgram.transfer({
        fromPubkey: new PublicKey(wallet),
        toPubkey: new PublicKey(mint),
        lamports: 1,
      }),
    ],
  }).compileToV0Message();
  const q = {
    ...quote(),
    transaction: Buffer.from(
      new VersionedTransaction(message).serialize(),
    ).toString("base64"),
  };
  await assert.rejects(
    () =>
      validateTransaction(q, intent(), c, wallet, {
        rpc: () => {
          throw Error("RPC must not run");
        },
      }),
    /Disallowed/,
  );
});
