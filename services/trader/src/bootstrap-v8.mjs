import { Trader } from './trader.mjs';
import { installMultiEngine } from './multi-engine-v8.mjs';
installMultiEngine(Trader);
await import('./start.mjs');
