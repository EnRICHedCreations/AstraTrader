import { walletScore } from './intelligence.mjs';

const PERSIST_BATCH_SIZE = 250;

export function rescoreWallets(store, source = 'strategy-change') {
  const wallets = store.entities('wallet', 100000);
  const at = Date.now();
  let eligible = 0;
  const persistedRows = [];
  const upsert = store.db.prepare("INSERT INTO entities(kind,id,at,body) VALUES('wallet',?,?,?) ON CONFLICT(kind,id) DO UPDATE SET at=excluded.at,body=excluded.body");

  // Recompute locally in one SQLite transaction. This is the authoritative in-process
  // score set used by signal evaluation immediately after startup/strategy changes.
  store.tx(() => {
    for (const old of wallets) {
      if (!old?.wallet) continue;
      const next = { wallet: old.wallet, at, ...walletScore(store.observations(old.wallet), at) };
      if (next.eligible) eligible++;
      const body = JSON.stringify(next);
      upsert.run(old.wallet, at, body);
      persistedRows.push({ kind: 'wallet', id: old.wallet, at, body });
    }
    store.event('WALLET_RESCORE', { at, source, wallets: wallets.length, eligible });
  });

  // Cold start must never depend on rewriting every derived wallet score to Supabase.
  // Scores are recomputed locally on every boot from durable observations. Runtime
  // strategy changes do need persistence, but write them in bounded batches so no
  // single PostgREST statement carries thousands of rows.
  if (source !== 'startup' && persistedRows.length && store.persistence) {
    store.mirror(async () => {
      for (let i = 0; i < persistedRows.length; i += PERSIST_BATCH_SIZE) {
        await store.persistence.upsert('entities', persistedRows.slice(i, i + PERSIST_BATCH_SIZE), 'kind,id');
      }
    });
  }
  return { wallets: wallets.length, eligible, at };
}
