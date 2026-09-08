# AstraTrader

Solana wallet intelligence, continuous paper research, and an isolated live-execution service. **Live trading is disabled by default.** This repository contains executable trading code, but deployment with real credentials, independent security review, representative out-of-sample evidence, and operator-set capital limits remain required before live use. No profitability is claimed.

## Project layout

- `services/trader/`: Node 24 trading runtime, SQLite WAL persistence, discovery/retry queue, wallet analysis, correlation graph, token policy, Jupiter route-based paper execution, HTTP operations dashboard, and isolated signer.
- `compose.yaml`: restartable trader service with persistent volume; signer is an explicit `live` profile on the private container network.
- `app/`, `lib/`, `db/`: original private Sites research terminal and D1-backed paper prototype. Its existing deployment remains paper-only. It is not the live runtime.
- `config/approved-assets.json`: operator-reviewed asset evidence. Empty by default.
- `docs/PRODUCTION.md`: credentials, deployment, supported scope, and activation requirements.
- `docs/RUNBOOK.md`: incident response, recovery, backup and monitoring.

## Start continuous paper collection

Use Node 24+ or Docker Compose. From the repository root:

```sh
cp .env.runtime.example .env.runtime
# Set ADMIN_TOKEN, INGEST_TOKEN, SIGNER_TOKEN and provider credentials securely.
# Generate independent tokens with: openssl rand -hex 32
# Keep TRADING_MODE=paper and SIGNER_ENABLE_LIVE=false.
docker compose up -d --build trader
```

Open `http://localhost:8080` on the host, or put an HTTPS reverse proxy in front of the loopback port. Enter the operator token in the dashboard. API calls require `Authorization: Bearer <ADMIN_TOKEN>`. Collection continues without a browser tab. The signer is not started by this command.

Without Docker:

```sh
cd services/trader
npm ci --ignore-scripts
# Export runtime environment; DATABASE_PATH must point to a writable durable disk.
npm start
```

The runtime deliberately does not auto-load a root `.env` file; Compose injects `.env.runtime`, or the process manager must set environment variables.

## Verify

```sh
npm ci --prefix services/trader --ignore-scripts
npm test --prefix services/trader
npm ci --ignore-scripts
npx tsc --noEmit
npm run build
node --experimental-strip-types --test tests/quant.test.mjs tests/backend.test.mjs
```

The runtime tests use synthetic chain/provider fixtures for transaction rejection and crash recovery. They do not broadcast transactions and are not a mainnet certification. A GitHub Actions workflow runs runtime and terminal checks on pushes and pull requests.

## Live execution design

The trader sends an intent, never a private key or arbitrary transaction, to a separate signer. The signer obtains its own Jupiter quote, validates the program set, payer, account effects, minimum output, fees and spending policy, simulates the transaction, and persists signed bytes before submission. It waits for finalized on-chain reconciliation before changing holdings. Unknown submission outcomes block new orders and are never blindly reconstructed.

Live activation requirements and unsupported cases are explicit in [docs/PRODUCTION.md](docs/PRODUCTION.md). Do not fund or activate the system based solely on unit tests or backtests.
