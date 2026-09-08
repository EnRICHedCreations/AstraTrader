# Experiments

## RPC connectivity (2026-09-07)
Public mainnet getSlot returned finalized/current cluster slot data; observed response slot 445193791. This is a connectivity check, not a latency benchmark.

## Quant invariants
Twelve tests verify: absent-inventory exclusion, cost-basis accounting, sample-size eligibility, graph edge conservatism, fail-closed token risk, latency/stale quote rejection, fee and impact charges, free-token receipt exclusion, and exclusion of future entries.

## Strategy results
No profitability result exists. Replays record a SHA-256 dataset hash, policy version, sample counts, time range, available post-latency fills and cash baseline. Insufficient evidence is a valid outcome. The replay uses expanding training windows and three nonoverlapping test folds, with complete position accounting. Snapshot prices do not prove executable returns.

## v0.2 runtime validation
24 runtime tests passed on Node 24.19.0. Tests include an entirely synthetic Jupiter transaction fixture to verify persist-before-submit, uncertain submission, idempotent retry and finalized settlement. This validates lifecycle control flow, not mainnet route compatibility or profitability. Runtime HTTP authorization, queue fencing, restart durability and audit chaining also passed.
