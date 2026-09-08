# Operations runbook

## Monitor
- `/healthz`: process liveness only; it does not imply live readiness.
- `/api/ready`: authenticated configuration and signer gate status.
- `/metrics`: authenticated Prometheus metrics for ingestion lag, processed transaction count and kill state.
- `/api/state`: pipeline status, dead/pending jobs, ledger, holdings and recent evidence.
- `/api/events?after=<seq>` and `/api/export?after=<seq>`: stable ascending cursors, 500 records per page, hash-chain fields for audit verification.

Alert on growing backlog, dead jobs, stale ingestion, repeated provider errors, unresolved signed transactions, stale portfolio marks and any reconciliation mismatch. The application records these states; configure your monitoring platform to deliver notifications. No external alert recipient was configured or messaged.

## Pause versus kill
Pause stops discovery and new signal evaluation. Existing paper positions continue exit monitoring; live reconciliation continues. Resume does not clear the kill switch.

Kill sets the trader stop flag and, in live mode, requests a signer stop. If that request fails, the endpoint returns an explicit unconfirmed-stop error. Stop the signer service at the host immediately. A transaction already submitted cannot be cancelled by setting this flag. The signer kill switch blocks all new signatures, including automatic exits; reconciliation continues. This is a signing stop, not guaranteed liquidation.

There is no web endpoint to clear a live kill switch. Investigate and resolve the cause before an operator changes durable policy/state. Do not edit order records to fabricate confirmations.

## Unknown transaction
1. Keep the trading stop in place. Record the order ID and signature.
2. Inspect finalized signature status and transaction details using an archival RPC and an independent chain source.
3. The service automatically settles the order only when finalized on-chain balances match its expected input and minimum output.
4. An RPC timeout or missing signature is not proof of nonexecution. Do not construct a new transaction to replace it.
5. If the blockhash expires with no authoritative outcome, preserve the journal for operator investigation. Automated force-clear/replacement is intentionally absent.

## Backups
Run the backup utility separately for trader and signer volumes:

```sh
docker compose exec trader node src/backup.mjs /data/trader-backup.sqlite
docker compose --profile live exec signer node src/backup.mjs /data/signer-backup.sqlite
```

`VACUUM INTO` creates a consistent snapshot and the utility runs `PRAGMA integrity_check`. Copy backups to encrypted durable storage. Signer backups can contain signed transaction bytes and wallet history; protect them. Signed transactions do not contain the private key, but may remain broadcastable during their validity window.

Restore only while the corresponding service is stopped. Restore the matching database for the same wallet and deployment. Reconcile all outstanding signatures before allowing further orders. Never restore an old signer snapshot and immediately resume signing: it may omit spending reservations or confirmed transactions.

## Upgrades
Back up both volumes. Stop trading, stop services, pull the reviewed commit, run tests and rebuild. Database schema initialization is additive and versioned with SQLite `user_version=1`; any future destructive schema change needs an explicit migration and backup. Run the trader in paper mode first, verify health and provider compatibility, then perform the operator's existing activation process.

## Key incident
Stop the signer service. Rotate API/service credentials at their providers and host. Move remaining funds using an independently secured wallet workflow, not through an untrusted running service. This application has no withdrawal endpoint.
