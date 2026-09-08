import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/server.mjs";
import { Store } from "../src/db.mjs";
import { Trader } from "../src/trader.mjs";
import { config } from "../src/config.mjs";
test("HTTP requires auth, persists kill switch and paginates evidence", async () => {
  const c = {
      ...config({}),
      apiToken: "a".repeat(32),
      webhookToken: "b".repeat(32),
    },
    s = new Store(":memory:"),
    trader = new Trader(c, s),
    server = createApp(c, s, trader);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = "http://127.0.0.1:" + server.address().port;
  try {
    assert.equal((await fetch(url + "/api/state")).status, 401);
    let r = await fetch(url + "/api/control", {
      method: "POST",
      headers: {
        authorization: "Bearer " + c.apiToken,
        "content-type": "application/json",
      },
      body: JSON.stringify({ action: "kill" }),
    });
    assert.equal(r.status, 200);
    assert.equal(s.get("killed"), true);
    r = await fetch(url + "/api/events", {
      headers: { authorization: "Bearer " + c.apiToken },
    });
    const data = await r.json();
    assert.equal(data.events.length, 1);
    assert.ok(data.next > 0);
    r = await fetch(url + "/api/events?after=" + data.next, {
      headers: { authorization: "Bearer " + c.apiToken },
    });
    assert.equal((await r.json()).events.length, 0);
    assert.equal((await fetch(url + "/")).status, 200);
  } finally {
    await new Promise((r) => server.close(r));
    s.close();
  }
});

test('pull signer authenticates separately, preserves paper orders, and propagates kill', async () => {
  const c={...config({}),apiToken:'a'.repeat(32),signerToken:'s'.repeat(32),signerTransport:'pull'};
  const s=new Store(':memory:');const trader=new Trader(c,s);const server=createApp(c,s,trader);
  s.saveOrder({id:'live1',mode:'live',state:'queued',intent:{id:'live1'},at:Date.now()});
  s.saveOrder({id:'paper1',mode:'paper',state:'confirmed',at:Date.now()});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port;
  try {
    assert.equal((await fetch(url+'/internal/signer/commands',{headers:{authorization:'Bearer '+c.apiToken}})).status,401);
    const headers={authorization:'Bearer '+c.signerToken,'content-type':'application/json'};
    let data=await (await fetch(url+'/internal/signer/commands',{headers})).json();assert.deepEqual(data.orders,[{id:'live1'}]);
    const report={checks:[['Kill switch clear',true]],holdings:{},orders:[{id:'live1',state:'unknown'},{id:'paper1',state:'failed'}]};
    assert.equal((await fetch(url+'/internal/signer/report',{method:'POST',headers,body:JSON.stringify(report)})).status,200);
    assert.equal(s.order('live1').state,'unknown');assert.equal(s.order('paper1').state,'confirmed');
    data=await (await fetch(url+'/internal/signer/commands',{headers})).json();assert.deepEqual(data.orders,[]);
    s.set('killed',true);data=await (await fetch(url+'/internal/signer/commands',{headers})).json();assert.equal(data.kill,true);
  } finally {await new Promise(r=>server.close(r));s.close();}
});
