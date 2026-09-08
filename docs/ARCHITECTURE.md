# ACTOR architecture

## Chain decision and research
Solana is the first chain: finalized JSON-RPC blocks expose signer accounts, pre/post token balances and mint account state. A direct `getSlot` request succeeded in this environment on 2026-09-07 (slot 445193791). This establishes RPC connectivity, not production capacity. Public RPC is explicitly not intended for production applications: https://solana.com/docs/references/clusters . Method schemas: https://solana.com/docs/rpc/http .

DEX Screener provides current pair price/liquidity snapshots via token-pairs/v1/solana/{mint}; these are indicative market observations, not guaranteed executable quotes: https://docs.dexscreener.com/api/reference . Helius is an optional dedicated RPC replacement (no account or purchase created): https://www.helius.dev/docs/quickstart .

Ethereum mainnet has readily accessible finalized data but greater transaction costs for small positions. Solana's fast block cadence is useful for the experiment and simultaneously creates a throughput challenge. This selection is engineering judgment, not a claim that Solana has higher trading returns.

## Components
- React terminal with server routes running in a Worker. No model calls in the trading path.
- D1 `records`: versioned observations, wallet score histories, token snapshots, relationship evidence, signals, decisions, paper fills, equity and experiments. Indexed by kind/time; deterministic observation IDs deduplicate repeated blocks.
- D1 `state`: durable portfolio, policy version, ingestion cursor and health.
- D1 `locks`: one collector cycle at a time; state-changing controls share the same lock.
- Finalized block ingestion discovers signer-owned token balance changes. Only a USDC delta opposed to exactly one token delta is a trade candidate. Token gifts, failed transactions and ambiguous multi-token routes are excluded.
- Historical wallet estimates use observed inventory, average cost and explicit assumed costs. Sells without sufficient observed inventory contribute no profit. All results are limited to the collected cohort and window.
- Transfer graph stores weak edges and provenance. Union-find supports strongly evidenced clusters; weak transfer edges are never automatically promoted to ownership claims.
- Risk analysis obtains mint and freeze authority, token program, top-ten token-account concentration, price and liquidity. Token account concentration is not ultimate beneficial ownership.
- Signals freeze inputs, score, reason list and policy version for reconstruction.
- Simulator requires later post-latency observations, charges fees/spread/impact and rejects stale/missing/illiquid quotes. Risk controls cap position and portfolio exposure and block new entries at drawdown threshold.
- No signer, private key input or transaction broadcast implementation exists.

## Operating boundaries
The hosted terminal advances the collector while open. `scripts/collector.mjs` supplies the separate always-on process but is not itself a provisioned scheduler. Private Site authentication still applies to that process. The present collector advances one full block per cycle; it cannot keep up with Solana at 30-second intervals and shows lag explicitly. It preserves sequential history instead of silently skipping old blocks. Recent-signal creation stops when observations are older than five minutes.

Public RPC access is a prototype path. A dedicated indexer/stream, swap decoders, holder-owner resolution, deployer history, router simulation, and sustained observations are required to reach the original autonomous platform objective. Fail-closed checks deliberately prevent current incomplete evidence from producing paper entries.

## v0.2 production runtime
The separately runnable Node 24 service in services/trader supersedes browser-driven collection for self-hosted deployments. It uses SQLite WAL/full synchronous mode, scoped DEX signature polling plus authenticated webhook enqueueing, lease-fenced durable jobs and transaction-bound state changes. The signer runs on a private container network with its own durable journal and a separately mounted key file. It obtains provider transactions itself and validates their effects; the intelligence service cannot submit arbitrary bytes for signing. See PRODUCTION.md for its current operational limits. The earlier sections describe the original Sites/D1 prototype, which remains paper-only.
