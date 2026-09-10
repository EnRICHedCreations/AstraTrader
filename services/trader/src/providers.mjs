import { setTimeout as sleep } from "node:timers/promises";

const RETRYABLE_PROVIDER_STATUS = new Set([409, 429]);

export async function json(url, options = {}, retry = true) {
  for (let i = 0; ; i++) {
    let r;
    try {
      r = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(15000),
        redirect: "error",
      });
    } catch {
      if (retry && i < 4) {
        await sleep(Math.min(5000, 250 * 2 ** i));
        continue;
      }
      throw Error("Provider transport unavailable");
    }
    const retryable = RETRYABLE_PROVIDER_STATUS.has(r.status) || r.status >= 500;
    if (retry && retryable && i < 4) {
      const retryAfter = Number(r.headers.get("retry-after") ?? 0) * 1000;
      await sleep(Math.min(10000, retryAfter || 750 * 2 ** i));
      continue;
    }
    if (!r.ok) throw Error(`Provider HTTP ${r.status}`);
    try {
      return await r.json();
    } catch {
      throw Error("Provider returned invalid JSON");
    }
  }
}

export class Providers {
  constructor(c) {
    this.c = c;
    this.rpcTail = Promise.resolve();
    this.lastRpcAt = 0;
    this.rpcMinIntervalMs = Math.max(100, Math.min(2000, Number(process.env.RPC_MIN_INTERVAL_MS ?? 200) || 200));
  }
  async pacedRpc(fn) {
    const run = async () => {
      const delay = this.rpcMinIntervalMs - (Date.now() - this.lastRpcAt);
      if (delay > 0) await sleep(delay);
      try { return await fn(); }
      finally { this.lastRpcAt = Date.now(); }
    };
    const result = this.rpcTail.then(run, run);
    this.rpcTail = result.catch(() => {});
    return result;
  }
  async rpc(method, params = []) {
    // Paper mode may observe confirmed transactions for low-latency simulation.
    // Live mode never relaxes a caller's finalized commitment.
    const effectiveParams = method === "getTransaction" && this.c.mode === "paper" && params[1]?.commitment === "finalized"
      ? [params[0], { ...params[1], commitment: "confirmed" }]
      : params;
    return this.pacedRpc(async () => {
      const r = await json(
        this.c.rpc,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: effectiveParams }),
        },
        !["sendTransaction"].includes(method),
      );
      if (r.error) throw Error(`RPC ${method} code ${r.error.code}`);
      return r.result;
    });
  }
  async quote(inputMint, outputMint, amount, taker) {
    const params = new URLSearchParams({
      inputMint,
      outputMint,
      amount: String(amount),
      swapMode: "ExactIn",
      slippageBps: String(this.c.slippageBps),
      excludeRouters: "jupiterz,dflow,okx",
      ...(taker ? { taker } : {}),
    });
    const q = await json(`https://api.jup.ag/swap/v2/order?${params}`, {
      headers: { "x-api-key": this.c.jupiterKey },
    });
    return { ...q, observedAt: Date.now() };
  }
  async execute(q, signed) {
    return json(
      "https://api.jup.ag/swap/v2/execute",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": this.c.jupiterKey,
        },
        body: JSON.stringify({
          requestId: q.requestId,
          signedTransaction: signed,
          lastValidBlockHeight: q.lastValidBlockHeight,
        }),
      },
      false,
    );
  }
  async pairs(mint) {
    const list = await json(
      `https://api.dexscreener.com/token-pairs/v1/solana/${mint}`,
    );
    if (!Array.isArray(list)) throw Error("Invalid pair response");
    return list
      .filter((p) => p.baseToken?.address === mint)
      .sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));
  }
}
