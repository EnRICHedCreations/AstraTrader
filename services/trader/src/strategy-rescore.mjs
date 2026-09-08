import { walletScore } from './intelligence.mjs';

export function rescoreWallets(store, source = 'strategy-change') {
  const wallets = store.entities('wallet', 100000);
  const at = Date.now();
  let eligible = 0;
  const persistedRows = [];
  const upsert = store.db.prepare("INSERT INTO entities(kind,id,at,body) VALUES('wallet',?,?,?) ON CONFLICT(kind,id) DO UPDATE SET at=excluded.at,body=excluded.body");

  // Rescoring thousands of wallets must not enqueue one remote Supabase request per
  // wallet. That made startup remain on the bootstrap page while flush() serialized
  // thousands of HTTP calls. Recompute locally in one SQLite transaction, then mirror
  // the complete set with one PostgREST bulk upsert.
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

  if (persistedRows.length && store.persistence) {
    store.mirror(() => store.persistence.upsert('entities', persistedRows, 'kind,id'));
  }
  return { wallets: wallets.length, eligible, at };
}
