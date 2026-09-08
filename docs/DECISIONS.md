# Decisions
1. Paper balance starts at an explicitly hypothetical $1,000. No actual balance or return is implied.
2. Use Solana finalized blocks and USDC quote candidates first. Exclude SOL balance interpretation until rent, fees, wrapping and multiple-instruction effects are reconciled.
3. Treat unknown risk as rejection. Avoid inferring absence of mint authority from a failed RPC response.
4. Preserve weak transfer relationships; do not claim common ownership based on one transfer.
5. Require observed history before eligibility. Scores and confidence are separate.
6. Keep policies fixed at convergence-v1. No automatic parameter tuning based on recent wins/losses.
7. Use D1 persistence and private access for the initial terminal. An always-on collector is a separate operational dependency.
8. Label snapshot-based execution as a model. Do not describe a DEX market price as an executable fill.
