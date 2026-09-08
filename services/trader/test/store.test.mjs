import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/db.mjs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
test("queue deduplicates and rejects stale worker leases", () => {
  const s = new Store(":memory:");
  s.enqueue("a", { value: 1 });
  assert.equal(s.enqueue("a", { value: 2 }), false);
  const now = Date.now(),
    first = s.claim(now + 1),
    second = s.claim(now + 130000);
  assert.throws(() => s.finish(first, () => s.set("bad", true)), /Stale/);
  s.finish(second, () => s.set("good", true));
  assert.equal(s.get("bad"), null);
  assert.equal(s.get("good"), true);
  assert.equal(s.claim(now + 200000), null);
  s.close();
});
test("transaction rollback leaves neither ledger nor state committed", () => {
  const s = new Store(":memory:");
  assert.throws(() =>
    s.tx(() => {
      s.set("cash", 10);
      s.event("BUY", { qty: 1 });
      throw Error("crash");
    }),
  );
  assert.equal(s.get("cash"), null);
  assert.equal(s.events().length, 0);
  s.close();
});
test("order journal survives restart and preserves signed uncertainty", () => {
  const dir = mkdtempSync(join(tmpdir(), "astra-"));
  try {
    let s = new Store(join(dir, "db.sqlite"));
    s.saveOrder({
      id: "a",
      state: "unknown",
      signature: "x",
      signed: "test-only",
    });
    s.close();
    s = new Store(join(dir, "db.sqlite"));
    assert.equal(s.order("a").state, "unknown");
    assert.equal(s.order("a").signature, "x");
    s.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("reservations include prior attempts and reject changed id amounts", () => {
  const s = new Store(":memory:");
  s.reserve("a", 60, 100);
  s.reserve("a", 60, 100);
  assert.throws(() => s.reserve("a", 70, 100), /conflict/);
  assert.throws(() => s.reserve("b", 41, 100), /limit/);
  s.reserve("b", 40, 100);
  s.close();
});
test("audit chain binds every persisted record to its predecessor", () => {
  const s = new Store(":memory:");
  s.event("A", { a: 1 });
  s.event("B", { a: 2 });
  const rows = s.db.prepare("SELECT * FROM events ORDER BY seq").all();
  let prev = "genesis";
  for (const row of rows) {
    assert.equal(row.prev, prev);
    assert.equal(
      row.hash,
      createHash("sha256")
        .update(
          JSON.stringify({
            prev,
            at: row.at,
            kind: row.kind,
            id: row.id,
            body: row.body,
          }),
        )
        .digest("hex"),
    );
    prev = row.hash;
  }
  s.close();
});
