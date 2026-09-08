# Operator-owned next actions

1. Supply an always-on host with durable trader/signer disks and an HTTPS endpoint.
2. Configure dedicated RPC and Jupiter credentials as documented in PRODUCTION.md; do not send keys through chat.
3. Set the operator's capital, daily spending/loss policy and dedicated trading wallet only when ready for independent live-readiness review.
4. Collect representative paper outcomes; investigate rejected signals and provider/route failures. Do not fill an approval artifact with invented values.
5. Review token/deployer evidence and security controls, run provider integration and recovery exercises on the actual host, and verify the Docker deployment.
6. Keep live signing disabled until these real operational and evidence gates are satisfied.
