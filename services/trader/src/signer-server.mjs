import { createServer } from "node:http";
import { config } from "./config.mjs";
import { Store } from "./db.mjs";
import { Signer } from "./signer.mjs";
import { authorized, body, send, log, safeMessage } from "./http.mjs";
const c = config(),
  store = new Store(c.db),
  signer = new Signer(c, store);
if (c.signerToken.length < 32)
  throw Error("SIGNER_TOKEN must be at least 32 characters");
const server = createServer(async (req, res) => {
  try {
    if (req.url === "/healthz")
      return send(res, 200, { service: "astratrader-signer", alive: true });
    if (!authorized(req, c.signerToken))
      return send(res, 401, { error: "Unauthorized" });
    if (req.method === "GET" && req.url === "/status")
      return send(res, 200, {
        ...signer.readiness(),
        holdings: store.get("holdings", {}),
        orders: store.orders().map((o) => signer.public(o)),
      });
    if (req.method === "POST" && req.url === "/execute")
      return send(res, 200, await signer.execute(await body(req, 16384)));
    if (req.method === "POST" && req.url === "/kill") {
      store.set("killed", true);
      store.event("OPERATOR_KILL", {});
      return send(res, 200, { killed: true });
    }
    return send(res, 404, { error: "Not found" });
  } catch (e) {
    log("signer_rejected", { reason: safeMessage(e) });
    send(res, 409, { error: safeMessage(e) });
  }
});
server.requestTimeout = 20000;
server.headersTimeout = 10000;
server.listen(c.port, "0.0.0.0", () =>
  log("signer_started", { port: c.port, enabled: c.signerEnabled }),
);
const timer = setInterval(
  () => signer.reconcile().catch(() => log("reconciliation_unavailable")),
  5000,
);
async function stop() {
  clearInterval(timer);
  server.close(() => {
    store.close();
    process.exit(0);
  });
}
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
