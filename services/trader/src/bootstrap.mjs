import { Trader } from './trader.mjs';
import { installMultiEngine } from './multi-engine.mjs';

// Install shadow alpha engines before the normal runtime constructs Trader.
// Existing wallet signals and all execution/risk gates remain authoritative.
installMultiEngine(Trader);
await import('./start.mjs');
