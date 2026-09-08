import test from "node:test";
import assert from "node:assert/strict";
import {
  Keypair,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { Store } from "../src/db.mjs";
import { Signer } from "../src/signer.mjs";
import { config, USDC, TOKEN, JUPITER } from "../src/config.mjs";
import { ata } from "../src/guard.mjs";
test("persist-before-submit, timeout, idempotent retry and finalized settlement", async () => {
  const key = Keypair.generate(),
    wallet = key.publicKey.toBase58(),
    mint = Keypair.generate().publicKey.toBase58(),
    s = new Store(":memory:");
  let calls = 0,
    confirmed = false;
  const c = {
    ...config({}),
    maxOrder: 20,
    maxDaily: 100,
    budget: 1000,
    maxLoss: 50,
  };
  const account = (m, amount) => {
    const b = Buffer.alloc(165);
    new PublicKey(m).toBuffer().copy(b);
    key.publicKey.toBuffer().copy(b, 32);
    b.writeBigUInt64LE(BigInt(amount), 64);
    b[108] = 1;
    return {
      owner: TOKEN,
      data: [b.toString("base64"), "base64"],
      lamports: 2039280,
    };
  };
  const before = [
      { owner: "11111111111111111111111111111111", lamports: 30000000 },
      account(USDC, 5000000),
      account(mint, 0),
    ],
    after = [
      { owner: "11111111111111111111111111111111", lamports: 29995000 },
      account(USDC, 4000000),
      account(mint, 1000),
    ];
  const message = new TransactionMessage({
    payerKey: key.publicKey,
    recentBlockhash: Keypair.generate().publicKey.toBase58(),
    instructions: [
      new TransactionInstruction({
        programId: new PublicKey(JUPITER),
        keys: [],
        data: Buffer.from([1]),
      }),
    ],
  }).compileToV0Message();
  const provider = {
    connection: {},
    quote: async () => ({
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
      observedAt: Date.now(),
      transaction: Buffer.from(
        new VersionedTransaction(message).serialize(),
      ).toString("base64"),
      requestId: "fake-provider",
      lastValidBlockHeight: 1000,
    }),
    execute: async () => {
      calls++;
      assert.equal(s.order("o").state, "signed");
      assert.ok(s.order("o").signed);
      throw Error("Simulated timeout after submission");
    },
    rpc: async (method, params) => {
      switch (method) {
        case "getFeeForMessage":
          return { value: 5000 };
        case "getTokenAccountsByOwner":
          if (params[1].programId.startsWith("Tokenz")) return { value: [] };
          return {
            value: [
              { pubkey: ata(wallet, USDC) },
              { pubkey: ata(wallet, mint) },
            ],
          };
        case "getMultipleAccounts":
          return { context: { slot: 10 }, value: before };
        case "simulateTransaction":
          return { value: { err: null, accounts: after } };
        case "getBlockHeight":
          return 10;
        case "getSignatureStatuses":
          return {
            value: [
              confirmed ? { confirmationStatus: "finalized", err: null } : null,
            ],
          };
        case "getTransaction":
          return {
            slot: 11,
            meta: {
              err: null,
              fee: 5000,
              preTokenBalances: [
                {
                  owner: wallet,
                  mint: USDC,
                  uiTokenAmount: { amount: "5000000" },
                },
                { owner: wallet, mint, uiTokenAmount: { amount: "0" } },
              ],
              postTokenBalances: [
                {
                  owner: wallet,
                  mint: USDC,
                  uiTokenAmount: { amount: "4000000" },
                },
                { owner: wallet, mint, uiTokenAmount: { amount: "1000" } },
              ],
            },
          };
        default:
          throw Error(method);
      }
    },
  };
  // Synthetic gate/chain fixtures isolate order lifecycle; they do not establish
  // Jupiter route compatibility or a mainnet trading result.
  const signer = new Signer(c, s, {
    provider,
    inspect: async () => ({ allowed: true }),
  });
  signer.key = key;
  signer.wallet = wallet;
  signer.readiness = () => ({ checks: [["synthetic-fixture", true]] });
  const intent = {
    id: "o",
    signalId: "s",
    wallet,
    inputMint: USDC,
    outputMint: mint,
    amount: "1000000",
    at: Date.now(),
  };
  assert.equal((await signer.execute(intent)).state, "unknown");
  assert.equal((await signer.execute(intent)).state, "unknown");
  assert.equal(calls, 1);
  await signer.reconcile();
  assert.equal(s.order("o").state, "unknown");
  confirmed = true;
  await signer.reconcile();
  assert.equal(s.order("o").state, "confirmed");
  assert.equal(s.get("holdings")[mint].raw, "1000");
  await signer.reconcile();
  assert.equal(s.get("holdings")[mint].raw, "1000");
  assert.equal(calls, 1);
  s.close();
});
