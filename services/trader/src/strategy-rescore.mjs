import { walletScore } from './intelligence.mjs';

export function rescoreWallets(store, source = 'strategy-change') {
  const wallets = store.entities('wallet', 100000);
  const at = Date.now();
  let eligible = 0;
  store.tx(() => {
    for (const old of wallets) {
      if (!old?.wallet) continue;
      const next = { wallet: old.wallet, at, ...walletScore(store.observations(old.wallet), at) };
      if (next.eligible) eligible++;
      store.entity('wallet', old.wallet, next);
    }
    store.event('WALLET_RESCORE', { at, source, wallets: wallets.length, eligible });
  });
  return { wallets: wallets.length, eligible, at };
}
