# Remaining completion gates

The implementation now includes a live-capable signer and continuous runtime. It is not certified for real capital merely because those modules compile or tests pass.

- No always-on deployment host, credentials, wallet, budget or actual paper-results approval was supplied.
- Full-chain throughput is not established. Broad Jupiter polling can exceed configured capacity; stale data blocks signals. Use scoped ingestion and an appropriately provisioned indexer/RPC.
- Attribution covers explicit Jupiter calls with one signer-owned USDC/token delta pair. Native SOL, Token-2022, ambiguous routes and transfer-tainted inventory are excluded.
- Correlation groups do not establish beneficial ownership. Deployer and bundled supply evidence remains operator-reviewed; no automated forensic oracle is claimed.
- The signer has not been validated against a live provider-built route with a funded account. Tests of the order lifecycle use synthetic fixtures and never broadcast.
- The live approval checks bind an operator-reviewed evidence file; they do not authenticate the truth of its claims. Independent review remains essential.
- Single-instance deployment only. SQLite is durable but not a multi-region consensus or high-availability system.
- Uncertain orders block indefinitely until authoritative reconciliation. No forced replacement path is provided.
- SOL network costs are capped per transaction but excluded from the daily USDC realized-loss calculation.
- Docker image execution, production secret isolation, TLS and external alert delivery were not validated in this environment.

See PRODUCTION.md and RUNBOOK.md for concrete setup and operating boundaries.
