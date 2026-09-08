import { Providers, json } from "./providers.mjs";
import { USDC, assets, liveConfiguration } from "./config.mjs";
import {
  decode,
  walletScore,
  relationshipGroups,
  inspect,
  hash,
} from "./intelligence.mjs";
import { positiveRaw } from "./guard.mjs";
export class Trader {
  constructor(c, s, p = new Providers(c)) {
    this.c = c;
    this.s = s;
    this.p = p;
    this.busy = false;
    this.stop = false;
    if (!s.get("portfolio"))
      s.set("portfolio", {
        cashRaw: c.paperBalance * 1e6,
        initialRaw: c.paperBalance * 1e6,
        peakRaw: c.paperBalance * 1e6,
        realizedRaw: 0,
        holdings: {},
      });
  }
  async signer(path, method = "GET", body) {
    if(this.c.signerTransport==='pull'){
      if(path==='/status'){const status=this.s.entities('signer')[0];if(!status||Date.now()-status.at>15000)throw Error('Signer heartbeat unavailable');return status;}
      if(path==='/execute')return {id:body.id,state:'queued',at:Date.now()};
      if(path==='/kill'){this.s.set('signerKillRequested',true);const status=this.s.entities('signer')[0];if(!status||Date.now()-status.at>15000||status.checks.find(x=>x[0]==='Kill switch clear')?.[1]!==false)throw Error('Waiting for signer kill acknowledgement');return {killed:true};}
      throw Error('Unknown signer command');
    }

    return json(
      new URL(path, this.c.signerURL),
      {
        method,
        headers: {
          authorization: "Bearer " + this.c.signerToken,
          "content-type": "application/json",
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      },
      method === "GET",
    );
  }
  async discovery() {
    for (const program of this.c.discoveryPrograms) {
      const key = "cursor:" + program,
        checkpoint = this.s.get(key),
        backlog = this.s.get("backlog:" + program);
      let before = backlog?.before,
        newest = backlog?.newest;
      let page;
      for (let pageNo = 0; pageNo < 3; pageNo++) {
        page = await this.p.rpc("getSignaturesForAddress", [
          program,
          {
            limit: 100,
            commitment: "finalized",
            ...(before ? { before } : {}),
            ...(checkpoint ? { until: checkpoint } : {}),
          },
        ]);
        if (!page.length) {
          this.s.tx(() => {
            if (newest) this.s.set(key, newest);
            this.s.set("backlog:" + program, null);
          });
          break;
        }
        newest ??= page[0].signature;
        this.s.tx(() => {
          for (const item of [...page].reverse())
            if (!item.err)
              this.s.enqueue(item.signature, {
                signature: item.signature,
                slot: item.slot,
                blockTime: item.blockTime,
                source: program,
              });
          if (page.length < 100 || !checkpoint) {
            this.s.set(key, newest);
            this.s.set("backlog:" + program, null);
          } else
            this.s.set("backlog:" + program, {
              before: page.at(-1).signature,
              newest,
            });
        });
        if (page.length < 100 || !checkpoint) break;
        before = page.at(-1).signature;
      }
      this.s.set("discoveryLastSuccess", Date.now());
    }
  }
  async ingest() {
    for (let i = 0; i < 20; i++) {
      const job = this.s.claim();
      if (!job) break;
      try {
        const tx = await this.p.rpc("getTransaction", [
          job.body.signature,
          {
            encoding: "jsonParsed",
            maxSupportedTransactionVersion: 0,
            commitment: "finalized",
          },
        ]);
        if (!tx) throw Error("Finalized transaction unavailable");
        const decoded = decode(tx, job.id, tx.slot);
        this.s.finish(job, () => {
          const affected = new Set();
          for (const o of [...decoded.trades, ...decoded.transfers])
            if (this.s.observe(o)) {
              affected.add(o.wallet);
              this.s.event(
                o.side === "transfer"
                  ? "INVENTORY_TRANSFER"
                  : "WALLET_" + o.side.toUpperCase(),
                o,
                o.id,
              );
            }
          for (const e of decoded.edges) this.s.entity("edge", hash(e), e);
          for (const wallet of affected) {
            const stats = walletScore(this.s.observations(wallet));
            const entity = { wallet, at: Date.now(), ...stats };
            this.s.entity("wallet", wallet, entity);
            this.s.event("WALLET_SCORE", entity);
          }
          this.s.set("ingestLastSuccess", Date.now());
          this.s.set("processingLagMs", Math.max(0, Date.now() - job.available));
          this.s.set(
            "lastBlockTime",
            Math.max(this.s.get("lastBlockTime", 0), tx.blockTime * 1000),
          );
          this.s.set("transactions", this.s.get("transactions", 0) + 1);
        });
      } catch (e) {
        this.s.retry(job, e.message);
      }
    }
  }
  async evaluate() {
    if (this.s.get("paused", false)) return;
    const now = Date.now();
    if (now - this.s.get("lastBlockTime", 0) > this.c.maxLagMs) {
      this.s.entity("health", "signal", {
        status: "STALE",
        reason: `Finalized ingestion older than ${Math.round(this.c.maxLagMs / 1000)}s`,
        at: now,
      });
      return;
    }
    const recent = this.s.db
      .prepare("SELECT body FROM observations WHERE at>=? ORDER BY at")
      .all(now - 300000)
      .map((r) => JSON.parse(r.body));
    const wallets = this.s.entities("wallet", 10000),
      edges = this.s.entities("edge", 10000),
      graph = relationshipGroups(
        wallets.map((w) => w.wallet),
        edges,
        recent,
      );
    this.s.entity("graph", "current", graph);
    for (const mint of [
      ...new Set(recent.filter((t) => t.side === "buy").map((t) => t.mint)),
    ].slice(-5)) {
      const contributors = recent.filter(
          (t) =>
            t.mint === mint &&
            t.side === "buy" &&
            wallets.find((w) => w.wallet === t.wallet)?.eligible,
        ),
        groups = [
          ...new Set(
            contributors.map((t) => graph.groups[t.wallet] ?? t.wallet),
          ),
        ];
      const key = "signal:" + mint + ":" + Math.floor(now / 60000);
      if (this.s.get(key)) continue;
      const risk = await inspect(mint, this.p, this.c);
      this.s.entity("token", mint, risk);
      const reasons = [...risk.reasons];
      if (groups.length < 3)
        reasons.push("Fewer than three eligible correlation groups");
      if (!this.c.jupiterKey) reasons.push("Router credentials missing");
      const signal = {
        id: key,
        mint,
        symbol: risk.symbol,
        at: now,
        score: Math.round(risk.score * 0.4 + Math.min(3, groups.length) * 20),
        action: reasons.length ? "REJECT" : "PAPER_BUY",
        reasons,
        policy: "convergence-v2",
        evidence: {
          risk,
          contributors,
          groups,
          wallets: wallets.filter((w) =>
            contributors.some((t) => t.wallet === w.wallet),
          ),
        },
      };
      this.s.tx(() => {
        this.s.entity("signal", key, signal);
        this.s.event(
          "SIGNAL_" + (reasons.length ? "REJECTED" : "CREATED"),
          signal,
          key,
        );
        this.s.set(key, true);
      });
      if (!reasons.length && !this.s.get("killed", false))
        await this.entry(signal);
    }
  }
  async entry(signal) {
    const pending = this.s
      .orders()
      .filter((o) => !["confirmed", "failed", "rejected"].includes(o.state));
    if (
      pending.some((o) => o.mint === signal.mint) ||
      this.s.get("liveDrawdownStop", false)
    )
      return;
    if (this.c.mode === "live") {
      const status = await this.signer("/status");
      this.s.entity("signer", "current", { ...status, at: Date.now() });
      if (!status.checks.every((x) => x[1]) || status.unresolved) return;
      const cost = Math.min(this.c.maxOrder, this.c.budget * 0.02);
      const i = {
        id: signal.id,
        signalId: signal.id,
        wallet: status.wallet,
        inputMint: USDC,
        outputMint: signal.mint,
        amount: String(Math.floor(cost * 1e6)),
        at: Date.now(),
      };
      const order = {
        id: i.id,
        mint: signal.mint,
        intent: i,
        state: "created",
        mode: "live",
        at: Date.now(),
        side: "buy",
      };
      this.s.saveOrder(order);
      await this.submit(order);
      return;
    }
    const portfolio = this.s.get("portfolio");
    if (portfolio.holdings[signal.mint]) return;
    const exposure = Object.values(portfolio.holdings).reduce(
        (s, h) => s + h.costRaw,
        0,
      ),
      reserved = pending
        .filter((o) => o.side === "buy" && o.mode === "paper")
        .reduce((s, o) => s + Number(o.amount), 0);
    const budget = Math.floor(
      Math.min(
        portfolio.cashRaw - reserved,
        portfolio.initialRaw * 0.02,
        portfolio.initialRaw * 0.15 - exposure - reserved,
      ),
    );
    if (budget <= 0) return;
    this.s.saveOrder({
      id: signal.id,
      mint: signal.mint,
      signalId: signal.id,
      amount: String(budget),
      state: "created",
      mode: "paper",
      side: "buy",
      at: Date.now(),
      due: Date.now() + 1500,
    });
  }
  async submit(order) {
    try {
      const r = await this.signer("/execute", "POST", order.intent);
      this.s.saveOrder({ ...order, ...r });
    } catch {
      this.s.saveOrder({ ...order, state: "unknown" });
      this.s.event("LIVE_ORDER_UNCERTAIN", { id: order.id });
    }
  }
  async liveReconcile() {
    if (this.c.mode !== "live") return;
    const status = await this.signer("/status");
    this.s.entity("signer", "current", { ...status, at: Date.now() });
    for (const o of this.s
      .orders()
      .filter(
        (o) =>
          o.mode === "live" &&
          !["confirmed", "failed", "rejected"].includes(o.state),
      )) {
      const remote = status.orders.find((r) => r.id === o.id);
      if (remote) {
        this.s.tx(() => {
          this.s.saveOrder({ ...o, ...remote });
          if (["confirmed", "failed"].includes(remote.state))
            this.s.event(
              "LIVE_" + remote.state.toUpperCase(),
              { ...remote, mode: "live" },
              "result:" + o.id,
            );
        });
      } else if (o.state === "unknown") {
        this.s.entity("health", "unresolved", {
          at: Date.now(),
          status: "BLOCKED",
          reason: "Unknown intent requires operator reconciliation",
          id: o.id,
        });
      }
    }
    if (
      status.unresolved ||
      this.s
        .orders()
        .some(
          (o) =>
            o.mode === "live" &&
            ["unknown", "created", "queued", "signed", "submitted"].includes(o.state),
        )
    )
      return;
    const cashAccounts = await this.p.rpc("getTokenAccountsByOwner", [
      status.wallet,
      { mint: USDC },
      { encoding: "jsonParsed", commitment: "finalized" },
    ]);
    let equityRaw = cashAccounts.value.reduce(
      (n, a) => n + Number(a.account.data.parsed.info.tokenAmount.amount),
      0,
    );
    for (const [mint, h] of Object.entries(status.holdings)) {
      const quote = await this.p.quote(mint, USDC, h.raw);
      equityRaw += Number(positiveRaw(quote.otherAmountThreshold));
    }
    const peak = Math.max(this.s.get("livePeakRaw", equityRaw), equityRaw);
    this.s.set("livePeakRaw", peak);
    if (peak > 0 && equityRaw < peak * 0.9)
      this.s.set("liveDrawdownStop", true);
    this.s.entity("liveEquity", "current", {
      at: Date.now(),
      equityUSDC: equityRaw / 1e6,
      peakUSDC: peak / 1e6,
      drawdown: peak > 0 ? (peak - equityRaw) / peak : 0,
    });
    for (const [mint, h] of Object.entries(status.holdings)) {
      const pair = (await this.p.pairs(mint))[0],
        price = Number(pair?.priceUsd);
      if (!Number.isFinite(price) || price <= 0) continue;
      const info = await this.p.rpc("getAccountInfo", [
        mint,
        { encoding: "jsonParsed", commitment: "finalized" },
      ]);
      const decimals = info.value?.data?.parsed?.info?.decimals;
      if (!Number.isInteger(decimals)) continue;
      const estimated = (Number(h.raw) / 10 ** decimals) * price;
      const entryValue = h.costRaw / 1e6;
      const opened =
        this.s
          .orders()
          .filter(
            (o) =>
              o.mint === mint && o.side === "buy" && o.state === "confirmed",
          )
          .at(-1)?.at ?? Date.now();
      if (
        this.s.get("liveDrawdownStop", false) ||
        estimated <= entryValue * 0.9 ||
        estimated >= entryValue * 1.2 ||
        Date.now() - opened >= 3600000
      ) {
        const id = "exit:" + mint + ":" + h.raw + ":" + opened,
          order = {
            id,
            mint,
            side: "sell",
            mode: "live",
            at: Date.now(),
            state: "created",
            intent: {
              id,
              signalId: "exit-policy-v2",
              wallet: status.wallet,
              inputMint: mint,
              outputMint: USDC,
              amount: h.raw,
              at: Date.now(),
            },
          };
        if (this.s.order(id)) continue;
        this.s.saveOrder(order);
        await this.submit(order);
      }
    }
  }
  async paper() {
    const portfolio = this.s.get("portfolio");
    for (const o of this.s
      .orders()
      .filter(
        (o) =>
          o.mode === "paper" && o.state === "created" && o.due <= Date.now(),
      )) {
      if (this.s.get("killed", false) && o.side === "buy") {
        this.s.saveOrder({ ...o, state: "rejected", reason: "Kill switch" });
        continue;
      }
      try {
        const buy = o.side === "buy",
          q = await this.p.quote(
            buy ? USDC : o.mint,
            buy ? o.mint : USDC,
            o.amount,
          );
        if (
          q.inputMint !== (buy ? USDC : o.mint) ||
          q.outputMint !== (buy ? o.mint : USDC) ||
          String(q.inAmount) !== o.amount ||
          Date.now() - q.observedAt > this.c.quoteAgeMs ||
          !Number.isFinite(q.priceImpact) ||
          Math.abs(q.priceImpact) > 1 ||
          q.slippageBps > this.c.slippageBps
        )
          throw Error("Paper route rejected");
        const received = positiveRaw(q.otherAmountThreshold),
          spent = positiveRaw(q.inAmount);
        if (received > positiveRaw(q.outAmount))
          throw Error("Invalid route output");
        const nativeFee =
          Number(q.signatureFeeLamports ?? 5000) +
          Number(q.prioritizationFeeLamports ?? 0) +
          Number(q.rentFeeLamports ?? 0);
        if (!Number.isFinite(nativeFee) || nativeFee > this.c.maxLamports)
          throw Error("Native costs exceed cap");
        const solPair = (
          await this.p.pairs("So11111111111111111111111111111111111111112")
        )[0];
        const solPrice = Number(solPair?.priceUsd);
        if (!Number.isFinite(solPrice) || solPrice <= 0)
          throw Error("Native fee valuation unavailable");
        const feeRaw = Math.ceil((nativeFee / 1e9) * solPrice * 1e6);
        this.s.tx(() => {
          let pnl = 0;
          if (buy) {
            if (Number(spent) + feeRaw > portfolio.cashRaw)
              throw Error("Insufficient paper cash");
            portfolio.cashRaw -= Number(spent) + feeRaw;
            portfolio.holdings[o.mint] = {
              raw: received.toString(),
              costRaw: Number(spent) + feeRaw,
              openedAt: Date.now(),
              markRaw: Number(spent),
              markAt: Date.now(),
            };
          } else {
            const h = portfolio.holdings[o.mint];
            if (!h || h.raw !== o.amount)
              throw Error("Paper inventory mismatch");
            pnl = Number(received) - feeRaw - h.costRaw;
            portfolio.cashRaw += Number(received) - feeRaw;
            portfolio.realizedRaw += pnl;
            delete portfolio.holdings[o.mint];
          }
          this.s.set("portfolio", portfolio);
          const fill = {
            ...o,
            state: "confirmed",
            at: Date.now(),
            result: {
              spent: spent.toString(),
              received: received.toString(),
              feeRaw,
              pnlUSDC: pnl / 1e6,
            },
            quote: q,
          };
          this.s.saveOrder(fill);
          this.s.event("PAPER_" + o.side.toUpperCase(), fill);
        });
      } catch (e) {
        this.s.saveOrder({ ...o, state: "failed", reason: e.message });
        this.s.event("PAPER_REJECTED", { id: o.id, reason: e.message });
      }
    }
    for (const [mint, h] of Object.entries(portfolio.holdings)) {
      try {
        const q = await this.p.quote(mint, USDC, h.raw);
        const mark = Number(positiveRaw(q.otherAmountThreshold));
        h.markRaw = mark;
        h.markAt = Date.now();
        if (
          mark < h.costRaw * 0.9 ||
          mark > h.costRaw * 1.2 ||
          Date.now() - h.openedAt > 3600000 ||
          this.s.get("killed", false)
        ) {
          const id = "paper-exit:" + mint + ":" + h.openedAt;
          if (!this.s.order(id))
            this.s.saveOrder({
              id,
              mint,
              side: "sell",
              mode: "paper",
              amount: h.raw,
              at: Date.now(),
              due: Date.now() + 1500,
              state: "created",
            });
        }
      } catch {
        h.stale = true;
      }
    }
    const equity =
      portfolio.cashRaw +
      Object.values(portfolio.holdings).reduce((n, h) => n + h.markRaw, 0);
    portfolio.peakRaw = Math.max(portfolio.peakRaw, equity);
    if (equity < portfolio.peakRaw * 0.9) this.s.set("killed", true);
    this.s.tx(() => {
      this.s.set("portfolio", portfolio);
      this.s.event("EQUITY", {
        mode: "paper",
        at: Date.now(),
        equity: equity / 1e6,
        cash: portfolio.cashRaw / 1e6,
        realized: portfolio.realizedRaw / 1e6,
        stale: Object.values(portfolio.holdings).some(
          (h) => Date.now() - h.markAt > 60000,
        ),
      });
    });
  }
  async cycle() {
    if (this.busy || this.stop) return;
    this.busy = true;
    const start = Date.now();
    try {
      if (!this.s.get("paused", false)) {
        if (!this.c.disableDiscovery) await this.discovery();
        await this.ingest();
        await this.evaluate();
      }
      if (this.c.mode === "paper") await this.paper();
      else await this.liveReconcile();
      this.s.set("lastCycle", {
        at: Date.now(),
        latencyMs: Date.now() - start,
        status: "ok",
      });
    } catch (e) {
      this.s.set("lastCycle", {
        at: Date.now(),
        latencyMs: Date.now() - start,
        status: "error",
        reason: e.message,
      });
      this.s.event("PIPELINE_ERROR", { reason: e.message });
    } finally {
      this.busy = false;
    }
  }
  state() {
    const portfolio = this.s.get("portfolio"),
      wallets = this.s.entities("wallet"),
      tokens = this.s.entities("token"),
      signals = this.s.entities("signal"),
      trades = this.s.orders(),
      events = this.s.db
        .prepare(
          "SELECT seq,at,kind,body FROM events ORDER BY seq DESC LIMIT 100",
        )
        .all()
        .map((e) => ({
          id: String(e.seq),
          at: e.at,
          type: e.kind,
          message: JSON.stringify(JSON.parse(e.body)),
        })),
      equity = this.s.db
        .prepare(
          "SELECT at,body FROM events WHERE kind='EQUITY' ORDER BY seq DESC LIMIT 500",
        )
        .all()
        .reverse()
        .map((r) => JSON.parse(r.body));
    const finalizedDataAgeMs = Date.now() - this.s.get("lastBlockTime", 0);
    return {
      mode: this.c.mode,
      state: {
        running: !this.s.get("paused", false),
        haltReason: this.s.get("killed", false)
          ? "Operator or drawdown stop"
          : null,
        cash: portfolio.cashRaw / 1e6,
        initial: portfolio.initialRaw / 1e6,
        peak: portfolio.peakRaw / 1e6,
        realized: portfolio.realizedRaw / 1e6,
        positions: Object.entries(portfolio.holdings).map(([mint, h]) => ({
          mint,
          qty: 1,
          mark: h.markRaw / 1e6,
          cost: h.costRaw / 1e6,
        })),
        transactions: this.s.get("transactions", 0),
        provider: this.s.get("lastCycle")?.status ?? "Starting",
        lastSuccess: this.s.get("ingestLastSuccess"),
        lastTick: this.s.get("lastCycle")?.at,
      },
      wallets,
      tokens,
      signals,
      trades,
      events,
      equity,
      edges: this.s.entities("edge"),
      experiments: this.s.entities("experiment"),
      graph: this.s.entities("graph")[0],
      signer: this.s.entities("signer")[0],
      liveEquity: this.s.entities("liveEquity")[0],
      health: {
        cycle: this.s.get("lastCycle"),
        processingLagMs: this.s.get("processingLagMs", 0),
        finalizedDataAgeMs,
        lagMs: finalizedDataAgeMs,
        maxFinalizedAgeMs: this.c.maxLagMs,
        jobs: this.s.db
          .prepare("SELECT state,COUNT(*) AS count FROM jobs GROUP BY state")
          .all(),
      },
      statistics: {
        closed: trades.filter(
          (o) => o.side === "sell" && o.state === "confirmed",
        ).length,
        hitRate: null,
        expectancy: null,
        profitFactor: null,
      },
      liveChecks: liveConfiguration(this.c),
    };
  }
}
