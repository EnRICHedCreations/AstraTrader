import { Trader } from './trader.mjs';
import { installMultiEngine } from './multi-engine-v9.mjs';
installMultiEngine(Trader);
await import('./start.mjs');
