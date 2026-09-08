// Paper liquidation policy: entry price-impact limits must never strand an existing position.
// A token->USDC quote is itself the conservative liquidation mark because paper fills use
// otherAmountThreshold. We still enforce route identity, amount, freshness and slippage.
export function installPaperExitPolicy(Trader, USDC) {
  const original = Trader.prototype.routeReason;
  Trader.prototype.routeReason = function routeReason(q, inputMint, outputMint, amount, st) {
    const isPaperLiquidation = this.c?.mode === 'paper' && inputMint !== USDC && outputMint === USDC;
    if (!isPaperLiquidation) return original.call(this, q, inputMint, outputMint, amount, st);
    if (q.inputMint !== inputMint) return 'Route input mint mismatch';
    if (q.outputMint !== outputMint) return 'Route output mint mismatch';
    if (String(q.inAmount) !== amount) return 'Route input amount mismatch';
    if (Date.now() - q.observedAt > st.quoteMaxAgeMs) return 'Route quote stale';
    if (!Number.isFinite(q.priceImpact)) return 'Route price impact invalid';
    if (q.slippageBps > st.maxSlippageBps) return 'Route slippage exceeds limit';
    return null;
  };
}
