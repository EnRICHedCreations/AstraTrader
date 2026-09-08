import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/db.mjs";
import { Signer } from "../src/signer.mjs";
import { config, liveConfiguration } from "../src/config.mjs";
test("zero-budget configuration cannot activate signing", async () => {
  const s = new Store(":memory:"),
    c = config({}),
    signer = new Signer(c, s);
  assert.ok(liveConfiguration(c).some((x) => !x[1]));
  await assert.rejects(() => signer.execute({ id: "a" }), /readiness/);
  assert.equal(s.orders().length, 0);
  s.close();
});
test("an unknown persisted transaction is returned, never reconstructed", async () => {
  const s = new Store(":memory:");
  s.saveOrder({
    id: "a",
    intent: { id: "a" },
    state: "unknown",
    signature: "existing",
  });
  const signer = new Signer(config({}), s, {
    provider: {
      connection: {},
      quote: () => {
        throw Error("Must not quote again");
      },
    },
  });
  const r = await signer.execute({ id: "a" });
  assert.equal(r.state, "unknown");
  assert.equal(r.signature, "existing");
  await assert.rejects(
    () => signer.execute({ id: "a", amount: "different" }),
    /conflicts/,
  );
  s.close();
});
test("missing transaction status preserves uncertainty across reconciliation", async () => {
  const s = new Store(":memory:");
  s.saveOrder({ id: "a", state: "unknown", signature: "existing" });
  const signer = new Signer(config({}), s, {
    provider: { connection: {}, rpc: async () => ({ value: [null] }) },
  });
  await signer.reconcile();
  assert.equal(s.order("a").state, "unknown");
  s.close();
});
