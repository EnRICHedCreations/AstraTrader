# Production deployment and activation

## Status

Source implementation: continuous trader, operations dashboard, durable retry queue, audit chain, router-quote paper execution, controlled Jupiter signing and submission, finalized balance reconciliation, Docker configuration and CI.

Operational status: not deployed to an always-on production host during this session. No production RPC/Jupiter credentials, funded trading wallet, capital policy, approved asset list or reviewed paper-results artifact were supplied. No real-money transaction was attempted. The Docker image could not be built in this environment because Docker is unavailable; Node runtime tests ran locally.

This is not an audited trading system or evidence of a profitable strategy. A configuration file alone cannot establish either property.

## Required environment

| Variable | Service / where to obtain | Why | Minimum access |
|---|---|---|---|
| `SOLANA_RPC_URL` | Dedicated Solana mainnet endpoint from https://dashboard.helius.dev/ or another archival RPC provider | Discovery, transaction reads, token inspection, simulations and confirmation history | RPC read and simulation methods; Jupiter handles submission |
| `JUPITER_API_KEY` | https://portal.jup.ag/ | Jupiter Swap API v2 quotes and execution | Swap API access; does not itself authorize wallet signing |
| `ADMIN_TOKEN` | Generate locally with `openssl rand -hex 32` | Authenticate operations UI/API | Operator access to this deployment only |
| `INGEST_TOKEN` | Generate a separate 32-byte token | Authenticate `/webhooks/solana` | Enqueue transaction signatures only |
| `SIGNER_TOKEN` | Generate a third independent 32-byte token | Trader-to-signer authentication | Private signer API; never send to the browser |
| `SIGNER_KEYPAIR_FILE` | Mount a dedicated Solana CLI keypair as `/run/secrets/trading-key.json` | Isolated signer key material | Only this dedicated trading wallet; no primary wallet or seed phrase in chat |
| `LIVE_BUDGET_USDC` | Operator supplies | Bound the deployed capital policy | Integer USDC; zero blocks live execution |
| `LIVE_MAX_ORDER_USDC` | Operator supplies | Bound each buy | Must be <=2% of configured budget |
| `LIVE_DAILY_BUY_LIMIT_USDC` | Operator supplies | Daily cumulative reservations, including uncertain attempts | Integer USDC; zero blocks live execution |
| `LIVE_DAILY_LOSS_LIMIT_USDC` | Operator supplies | Daily realized-loss circuit breaker | Positive and <=10% of budget |
| `LIVE_APPROVAL_SHA256` | SHA-256 of the actual reviewed `config/live-approval.json` | Bind activation to one evidence artifact | No placeholder hashes |
| `TRADING_MODE` | Operator deployment setting | Select paper or live coordinator | Defaults to paper |
| `SIGNER_ENABLE_LIVE` | Operator deployment setting | Enable key loading and live readiness | Defaults to false |

The keypair file must be readable by the container's `node` user (UID 1000), owned appropriately, and mode `0400` or `0600`. The signer rejects group/world-readable key files. `secrets/`, populated environment files, SQLite databases and the live approval file are gitignored. Never paste a private key into ChatGPT, GitHub, an issue, a build log or the web dashboard.

The two services share no database or key volume. The current Compose file uses one shared environment file for deployment simplicity, so both receive service tokens; the key file exists only in the signer. For stronger separation, inject separate per-service secret sets from your deployment platform.

## Hosting

Run exactly one trader instance and one signer instance per wallet/database. Both require durable volumes; ephemeral serverless disks are unsuitable. The trader is exposed only on `127.0.0.1:8080`; terminate TLS with a reverse proxy. The signer has no host port. Do not expose it publicly.

Start in paper mode with `docker compose up -d --build trader`. Use a dedicated RPC plan appropriate for the configured DEX scope. Polling is sequential and bounded; it is not a full-chain throughput promise. Configure provider webhooks to `/webhooks/solana` with `Authorization: Bearer <INGEST_TOKEN>` where supported; events are verified against RPC before decoding. The webhook accepts an array of records containing real transaction signatures.

Monitor ingestion lag and queue depth. The signal engine rejects stale ingestion (>15 seconds). A paid/indexed streaming service may be necessary to keep up with broad Jupiter traffic. No paid capacity was provisioned or authorized here.

## Reviewed asset evidence

`config/approved-assets.json` is a list with entries shaped as:

```json
{
  "mint": "REAL_MINT_ADDRESS",
  "reviewedBy": "OPERATOR_NAME",
  "expiresAt": 0,
  "evidence": "Actual deployer, bundled supply and distribution findings with source references"
}
```

The example is deliberately invalid until real evidence and a future expiry are supplied. This is a human-reviewed deployer/supply policy, not an automated ownership oracle. Active mint/freeze authorities, unsupported programs, excessive concentration, missing holder owners and low liquidity still reject an approved asset. Token-2022, fee-on-transfer tokens, native-SOL routes and arbitrary transaction signing are unsupported. Correlation clusters reduce confirmation counts; they do not prove ownership.

## Paper evidence approval

`config/live-approval.json` must refer to real reviewed evidence and contain:

- `operatorApproved: true`
- `closedPaperTrades >= 100`
- `outOfSampleReturn > 0`
- `maxDrawdown <= 0.1`
- `successfulReconciliationTests: true`
- `routeSimulationValidated: true`
- `generatedAt`: actual review timestamp in milliseconds, no more than seven days old
- `datasetHash`: actual 64-character SHA-256 evidence hash

The signer checks these fields and the file hash. It does not prove that an operator-authored attestation is truthful. Independently verify the underlying evidence; never fabricate or fill these fields merely to clear a gate. The runtime evaluation endpoint explicitly emits an unapproved report and cannot auto-activate live trading.

After the operator has supplied credentials, reviewed evidence, capital limits and a dedicated wallet, the operator can choose the `live` Compose profile and corresponding environment settings. This repository does not automatically activate that profile or fund the wallet. `/api/ready` and authenticated signer `/status` expose the remaining checks.

## Execution limitations requiring validation before capital

- Transaction validation uses allowlisted top-level programs and simulated account effects. This is not formal verification of Jupiter/DEX program code or upgrade authorities.
- The signer rejects a route containing unsupported instructions even if Jupiter considers it valid. This sacrifices route coverage to constrain signing.
- The live signer uses a mounted key file. An external HSM or vault integration is not implemented; isolate and restrict the funded wallet accordingly.
- Uncertain submission outcomes are conservatively blocked. There is no force-clear API. Follow the runbook for investigation; do not issue a fresh transaction to replace an unknown one.
- Daily realized-loss accounting is in USDC and excludes SOL-denominated fees. Fees have per-transaction native caps and SOL reserve checks, but a complete daily USD gas-loss limit is not implemented.
- Exit triggers use indicative prices before requesting a route. Trigger price and fill price can differ. Stop-loss and kill switches cannot guarantee an exit from an illiquid or failed market.
- Cold start observes a recent bounded cohort, not all historical wallets. Transfer-tainted or unmatched inventory is ineligible. Native SOL trades and ambiguous multi-token routes are excluded.
- No representative out-of-sample dataset, adverse-regime results or live financial reconciliation evidence was supplied. These cannot be manufactured during a build.

## Provider references

Jupiter v2 order/execute contract: https://developers.jup.ag/docs/swap/order-and-execute

Jupiter order schema and fee/slippage fields: https://developers.jup.ag/docs/api-reference/swap/order

Solana simulation contract: https://solana.com/docs/rpc/http/simulatetransaction

Solana transaction confirmation: https://solana.com/docs/rpc/http/getsignaturestatuses

Helius setup and webhooks: https://www.helius.dev/docs/quickstart and https://www.helius.dev/docs/webhooks
