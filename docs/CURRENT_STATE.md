# Current state — v0.2

Implemented and locally tested: continuously running Node trader, durable SQLite queue and audit journal, scoped finalized transaction discovery, transfer-aware historical wallet scoring, conservative correlation grouping, holder-owner concentration analysis, operator-reviewed deployer/supply policy, router-quote paper execution, isolated constrained signer, persistent signed-order submission state, finalized reconciliation, spending/exposure gates, operations dashboard, Docker Compose definition and GitHub CI.

The original Sites/D1 terminal remains a paper research prototype. The new always-on runtime is in services/trader and has its own dashboard and database. It is not silently connected to or activated by the existing Site.

Local validation: 24 runtime tests passed, including synthetic signing/submission timeout and finalized recovery, malicious transaction rejection, idempotent orders, stale lease fencing, durable restarts, HTTP authorization and audit-chain integrity. Existing quant tests and backend checks cover the paper prototype. No live-money transaction was attempted. Docker is unavailable in this build environment; the container itself has not been run here.

External completion gates: host and persistent disks, provider credentials/capacity, dedicated trading wallet, operator capital limits, reviewed asset evidence, representative paper/out-of-sample results, provider integration tests, and independent security review. No claim of full-chain real-time throughput or profitable trading is made.
