# AstraTrader operator guide

## What is delivered

A Node 24 web runtime, persistent SQLite journal, Solana discovery worker, paper execution engine, and optional isolated transaction signer. The older React/Sites terminal is retained in this repository; Deploy Hatch runs `services/trader`, whose dashboard is the runtime's operational interface.

Deployment alone does not enable trading. The web service displays a locked setup page until its operator token and durable storage are configured. The worker refuses to start without its required environment. Live signing defaults off. No trading wallet, provider credentials, verified strategy edge, or real-money execution history is supplied. Automated tests validate selected safeguards; they do not certify a profitable or production-proven trading system.

## Deploy Hatch configuration

Use the two connected repositories on branch `main`:

| Setting | AstraTrader web | AstraTrader Worker |
|---|---|---|
| Repository | EnRICHedCreations/AstraTrader | EnRICHedCreations/astratraderworker |
| Runtime | nodejs, version 24 | nodejs, version 24 |
| Service type | web | worker |
| Install | `npm ci --prefix services/trader --ignore-scripts` | `npm ci --ignore-scripts` |
| Build | `npm test --prefix services/trader` | `npm test` |
| Start | `node services/trader/src/start.mjs` | `npm start` |

Configure environment variables in each project's Deploy Hatch settings. The connected deployment API does not expose a secret editor or persistent-volume provisioning. These must be configured through your account's supported controls. A disk quota or writable container directory is not proof of persistence. Confirm a volume survives a restart and a redeployment before setting `PERSISTENCE_CONFIRMED=true`. If your hosting plan cannot provide durable volumes, move these stateful processes to a host that does; do not bypass the storage check. The included Docker Compose configuration declares separate local named volumes for this alternative.

The web process binds `0.0.0.0` and honors platform `PORT` (default 8080). The worker has no public HTTP listener. Do not configure an HTTP health check for the worker.

## First configure paper operation

Generate three independent secrets on your own computer, running this command separately for each token:

```sh
openssl rand -hex 32
```

Store them in a password manager and the appropriate project environment. Do not put them in GitHub, screenshots, URLs, or chat. Example environment files in the repositories contain no credentials.

| Variable | Project | Value / how to obtain it |
|---|---|---|
| `ADMIN_TOKEN` | Web only | First random token. Enter it into the dashboard's operator-token field. It grants operator control. |
| `INGEST_TOKEN` | Both | Second random token, identical on both projects. Authenticates transaction ingestion. |
| `SIGNER_TOKEN` | Both, required for optional signer | Third random token, identical on both projects; never reuse the admin token. |
| `SOLANA_RPC_URL` | Both | Dedicated HTTPS Solana mainnet RPC URL from your provider, such as Helius. Treat the whole URL as secret if it embeds an API key. |
| `JUPITER_API_KEY` | Web; worker when signing | Create an API key in the Jupiter developer portal. Required for executable quote-based paper fills and live order/execute requests. |
| `DATABASE_PATH` | Web | Absolute SQLite file path on the actual durable volume, e.g. `/data/trader.sqlite` only if `/data` is your confirmed mount. |
| `WORKER_STATE_PATH` | Worker | Durable checkpoint file, e.g. `/data/worker-state.json` on the worker's own confirmed mount. |
| `PERSISTENCE_CONFIRMED` | Both | `true` only after verifying durable storage. |
| `ASTRATRADER_URL` | Worker | The actual HTTPS URL returned by the web deployment; no dashboard/admin path. |
| `TRADING_MODE` | Both | `paper` initially. |
| `SIGNER_ENABLE_LIVE` | Both | `false` initially. No wallet is needed for paper mode. |
| `DISABLE_DISCOVERY` | Web | `true` when the separate worker supplies signatures. |
| `SIGNER_TRANSPORT` | Web | `pull` for the separate Deploy Hatch worker. |
| `ASSET_POLICY_FILE` | Both | `config/approved-assets.json`, relative to repository root, or an absolute mounted policy path. The default `/config/...` is intended for Compose. |
| `PAPER_BALANCE_USDC` | Web | Virtual starting balance, default `1000`; no money is deposited. |
| `DISCOVERY_PROGRAMS` | Worker | Comma-separated program addresses. Default is Jupiter v6. This scopes discovery; it does not imply complete chain coverage. |
| `POLL_MS` | Web | Default `1000`, valid 250–60000 milliseconds. Worker polling has its own fixed interval. |
| `MAX_SLIPPAGE_BPS` | Both | Default `50` (0.5%); maximum accepted is `100`. |
| `MAX_NATIVE_COST_LAMPORTS` | Both | Default `5000000`, limits simulated native debit per transaction. |
| `MIN_SOL_RESERVE_LAMPORTS` | Both | Default `10000000`, native balance reserve enforced by the signer. |

Provider setup:

1. Register at [Helius dashboard](https://dashboard.helius.dev/) or another Solana RPC provider. Select mainnet, copy the HTTPS RPC URL, and choose capacity sufficient for discovery, transaction reads, account checks, and simulation. See [Helius quickstart](https://www.helius.dev/docs/quickstart).
2. Create a key at [Jupiter developer portal](https://portal.jup.ag/). This runtime uses Swap v2 `/order` and `/execute`, restricted to supported Metis routes. Check the current [order/execute documentation](https://developers.jup.ag/docs/swap/order-and-execute) and your account's access/rate limits.
3. Set the variables, restart/redeploy the web app, copy its actual HTTPS address into the worker, and restart/redeploy the worker. Provider failures appear in operational status; they must not be interpreted as zero market activity.

## Use the dashboard

Open the deployed web URL. If you see Setup, configure the listed variables first. Once operational, enter `ADMIN_TOKEN` in the dashboard. It is kept in browser memory, not local storage; refresh requires entering it again.

Check ingestion lag, queue backlog, wallet samples, signal rejection reasons, open positions, order states, and audit events. Wallet ranking needs sufficient observed closed round trips; a cold start will not produce an instantly useful wallet universe. Discovery begins with a recent sample and resumes using checkpoints; it is not a historical full-chain import. Slow ingestion, stale quotes, insufficient samples, correlated wallets, missing asset reviews, and provider errors can all prevent entries.

The reviewed-asset list starts empty intentionally. Each policy record requires a mint, reviewer, future expiry in Unix **milliseconds**, and meaningful review evidence of at least 20 characters. For example, the schema is:

```json
[{"mint":"OPERATOR_REVIEWED_MINT","reviewedBy":"YOUR_REVIEWER_ID","expiresAt":0,"evidence":"Document actual ownership, authority, liquidity and risk review here."}]
```

This example is deliberately invalid and authorizes nothing. Replace it only after an actual review, keep both projects' policies synchronized, and do not commit confidential evidence. Automated mint authority, liquidity, concentration and transaction checks supplement that review. They do not prove deployer identity or eliminate token risk.

Paper positions use delayed executable quotes and modeled fees. The dashboard's evaluation action reports insufficient evidence unless supported by real records; it does not manufacture an approval artifact. Audit export is paginated and includes the event hash chain. Save exports and database backups outside the application volume.

Pause stops new strategy entries; continue monitoring existing orders and positions. Resume restores strategy processing when other gates permit. Kill is a persistent signing stop, including exits; it is not liquidation. With pull transport, a remote signer acknowledges the stop on its next successful connection. During a network outage, do not assume remote acknowledgement. Review the signer journal before any restart or manual recovery. An unknown transaction blocks new signatures pending reconciliation; never retry it with a new order ID just to force execution.

## Create a dedicated wallet locally, only if preparing live operation

Paper mode requires no wallet. For a dedicated software signing wallet, install the Solana CLI using the [official installation instructions](https://solana.com/docs/intro/installation) (Windows may use WSL). Follow [Solana CLI wallet guidance](https://solana.com/docs/intro/installation/solana-cli-basics).

Run these commands on a trusted local computer, not inside a public repository or this chat:

```sh
umask 077
mkdir -p secrets
solana-keygen new --outfile secrets/trading-key.json
chmod 600 secrets/trading-key.json
solana-keygen pubkey secrets/trading-key.json
```

Back up the recovery phrase offline. The keypair file itself can sign; the seed phrase passphrase does not encrypt that file. Never share either. The printed public key is the wallet address you can share for deposits.

For Deploy Hatch, encode the 64 keypair bytes locally:

```sh
node -e "const fs=require('fs'); const k=JSON.parse(fs.readFileSync('secrets/trading-key.json','utf8')); if(k.length!==64) throw Error('Expected 64-byte Solana keypair'); console.log(Buffer.from(k).toString('base64'))"
```

The output is a private key, not encryption. Place it only in the worker's secret `SIGNER_KEYPAIR_BASE64`, then clear clipboard/terminal exposure. Alternatively mount the JSON file securely and set worker-only `SIGNER_KEYPAIR_FILE` to its path. Never set either key variable on the web project. Do not use your main savings wallet. This runtime does not implement hardware-wallet signing or a browser-wallet connection flow.

If you choose to fund the wallet yourself, use the correct Solana mainnet address/network and retain native SOL for transaction costs and the configured reserve. Quotes and trades are USDC-based; the native Solana USDC mint used here is `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`. Bridged assets and other networks are not interchangeable. Funding, transfers and withdrawals remain your actions in your wallet tooling. There is no deposit/withdrawal custody service in this app.

## Live readiness is a separate, evidence-based step

Do not enable live mode merely because a deployment is running. The current code has not been independently audited or verified against funded live routes. Validate real provider behavior, restart recovery, uncertain submission reconciliation, monitoring, backups and out-of-sample paper results first. No profit guarantee is made.

Additional variables:

| Variable | Location and meaning |
|---|---|
| `SIGNER_DATABASE_PATH` | Worker-only SQLite file on durable storage, separate from web DB and collector JSON. |
| `SIGNER_KEYPAIR_BASE64` or `SIGNER_KEYPAIR_FILE` | Worker-only private signing material as described above; use one mechanism. |
| `LIVE_BUDGET_USDC` | Both: operator-chosen positive whole-USDC capital budget. Default 0 blocks live. |
| `LIVE_MAX_ORDER_USDC` | Both: positive whole-USDC order cap, at most 2% of budget. |
| `LIVE_DAILY_BUY_LIMIT_USDC` | Both: positive whole-USDC daily buy reservation cap. |
| `LIVE_DAILY_LOSS_LIMIT_USDC` | Both: positive whole-USDC daily realized-loss stop, at most 10% of budget. Native SOL fees are not included in this USDC loss measure. |
| `LIVE_APPROVAL_SHA256` | Both: SHA-256 of the exact reviewed approval file bytes. |
| `LIVE_APPROVAL_BASE64` or `LIVE_APPROVAL_FILE` | Worker: exact reviewed artifact encoded as base64 or a mounted file path. |
| `TRADING_MODE=live`, `SIGNER_ENABLE_LIVE=true` | Both: explicit activation flags; all other safeguards must still pass. |

The approval artifact is an operator-reviewed JSON record requiring `operatorApproved: true`, `closedPaperTrades >= 100`, `outOfSampleReturn > 0`, `maxDrawdown <= 0.1`, `successfulReconciliationTests: true`, `routeSimulationValidated: true`, `generatedAt` in Unix milliseconds within the previous seven days, and a 64-character hexadecimal `datasetHash`. These fields must describe actual evidence; setting booleans is not a substitute for performing the tests. Compute the file hash locally with `sha256sum` (macOS: `shasum -a 256`). Encode the exact same bytes for `LIVE_APPROVAL_BASE64`; changing whitespace changes the hash. Keep evidence, exported dataset and approval together for review.

Only after an operator has validated and approved that evidence should they configure their caps and activate the flags. Check every readiness item in the dashboard. The signer independently obtains quotes, verifies transaction accounts and simulated asset deltas, persists signed transactions before submission, and reconciles finalized RPC results. Any unresolved submission blocks subsequent signing. At most 15% of configured capital may be represented by tracked exposure. Daily budget reservations remain conservative after uncertain/failed attempts.

These checks have limits: they are not a formal verification of Jupiter or Solana programs, paper fees and liquidity behavior are approximations, discovery is scoped and capacity-bound, and wallet clustering is probabilistic. Replacing missing strategy validation with a live wallet does not complete validation.

## Operations and recovery

Back up each SQLite database with the runtime backup utility; do not copy an active SQLite main file alone while ignoring its WAL. Verify restores in isolation before relying on backups. Worker checkpoint JSON is separate and must also be retained. Preserve the signing journal across every redeployment.

Use `/healthz` for web process health and authenticated `/api/ready` for readiness. A setup response with `configured:false` proves only the process is alive. Inspect the worker logs for missing configuration, discovery failures, and signer transport/reconciliation failures. Protect metrics and audit exports as operational data. Rotate tokens consistently on both projects.

For a failed deployment, inspect its exact Deploy Hatch diagnostics before retrying. Missing credentials or durable storage require account configuration, not a source-code workaround. For an uncertain live transaction, inspect finalized chain status and the durable signer journal before taking any manual action. Never clear or replace the journal to make readiness green.
