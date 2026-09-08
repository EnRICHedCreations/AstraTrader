import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID, createHash } from "node:crypto";

export class Store {
  constructor(path, persistence = null) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.persistence = persistence;
    this.pending = Promise.resolve();
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,at INTEGER NOT NULL,kind TEXT NOT NULL,body TEXT NOT NULL,prev TEXT NOT NULL,hash TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS events_kind_seq ON events(kind,seq);
 CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,body TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,available INTEGER NOT NULL,lease TEXT,lease_until INTEGER);
 CREATE INDEX IF NOT EXISTS jobs_pending ON jobs(state,available);
 CREATE TABLE IF NOT EXISTS observations(id TEXT PRIMARY KEY,wallet TEXT NOT NULL,mint TEXT NOT NULL,at INTEGER NOT NULL,body TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS observations_wallet_at ON observations(wallet,at);
 CREATE INDEX IF NOT EXISTS observations_mint_at ON observations(mint,at);
 CREATE TABLE IF NOT EXISTS orders(id TEXT PRIMARY KEY,state TEXT NOT NULL,body TEXT NOT NULL,updated INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS entities(kind TEXT NOT NULL,id TEXT NOT NULL,at INTEGER NOT NULL,body TEXT NOT NULL,PRIMARY KEY(kind,id));
 CREATE INDEX IF NOT EXISTS entities_kind_at ON entities(kind,at);
 CREATE TABLE IF NOT EXISTS reservations(id TEXT PRIMARY KEY,day TEXT NOT NULL,amount INTEGER NOT NULL);
 PRAGMA user_version=1;`);
  }
  mirror(fn) {
    if (!this.persistence) return;
    this.pending = this.pending.then(fn);
  }
  async flush() { await this.pending; }
  hydrate(data) {
    this.tx(() => {
      for (const r of data.meta) this.db.prepare("INSERT OR REPLACE INTO meta VALUES(?,?)").run(r.key,r.value);
      for (const r of data.events) this.db.prepare("INSERT OR IGNORE INTO events(seq,id,at,kind,body,prev,hash) VALUES(?,?,?,?,?,?,?)").run(r.seq,r.id,r.at,r.kind,r.body,r.prev,r.hash);
      for (const r of data.jobs) this.db.prepare("INSERT OR REPLACE INTO jobs(id,body,state,attempts,available,lease,lease_until) VALUES(?,?,?,?,?,?,?)").run(r.id,r.body,r.state,r.attempts,r.available,r.lease,r.lease_until);
      for (const r of data.observations) this.db.prepare("INSERT OR IGNORE INTO observations VALUES(?,?,?,?,?)").run(r.id,r.wallet,r.mint,r.at,r.body);
      for (const r of data.orders) this.db.prepare("INSERT OR REPLACE INTO orders VALUES(?,?,?,?)").run(r.id,r.state,r.body,r.updated);
      for (const r of data.entities) this.db.prepare("INSERT OR REPLACE INTO entities VALUES(?,?,?,?)").run(r.kind,r.id,r.at,r.body);
      for (const r of data.reservations) this.db.prepare("INSERT OR REPLACE INTO reservations VALUES(?,?,?)").run(r.id,r.day,r.amount);
    });
  }
  tx(fn) { this.db.exec("BEGIN IMMEDIATE"); try { const r=fn(); this.db.exec("COMMIT"); return r; } catch(e){ this.db.exec("ROLLBACK"); throw e; } }
  get(key,fallback=null){const r=this.db.prepare("SELECT value FROM meta WHERE key=?").get(key);return r?JSON.parse(r.value):fallback}
  set(key,value){const encoded=JSON.stringify(value);this.db.prepare("INSERT INTO meta VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(key,encoded);this.mirror(()=>this.persistence.upsert("meta",{key,value:encoded},"key"));}
  event(kind,body,id=randomUUID()){const prev=this.db.prepare("SELECT hash FROM events ORDER BY seq DESC LIMIT 1").get()?.hash??"genesis",at=Date.now(),encoded=JSON.stringify(body),hash=createHash("sha256").update(JSON.stringify({prev,at,kind,id,body:encoded})).digest("hex");const result=this.db.prepare("INSERT OR IGNORE INTO events(id,at,kind,body,prev,hash) VALUES(?,?,?,?,?,?)").run(id,at,kind,encoded,prev,hash);if(result.changes)this.mirror(()=>this.persistence.upsert("events",{id,at,kind,body:encoded,prev,hash},"id"));}
  events(after=0,limit=200){return this.db.prepare("SELECT * FROM events WHERE seq>? ORDER BY seq LIMIT ?").all(after,limit).map(x=>({...x,body:JSON.parse(x.body)}))}
  enqueue(id,body){const encoded=JSON.stringify(body),available=Date.now(),r=this.db.prepare("INSERT OR IGNORE INTO jobs(id,body,available) VALUES(?,?,?)").run(id,encoded,available);if(r.changes)this.mirror(()=>this.persistence.upsert("jobs",{id,body:encoded,state:"pending",attempts:0,available,lease:null,lease_until:null},"id"));return r.changes>0}
  claim(now=Date.now()){return this.tx(()=>{const r=this.db.prepare("SELECT * FROM jobs WHERE (state='pending' AND available<=?) OR (state='running' AND lease_until<?) ORDER BY available DESC LIMIT 1").get(now,now);if(!r)return null;const lease=randomUUID(),lease_until=now+120000,attempts=r.attempts+1;this.db.prepare("UPDATE jobs SET state='running',lease=?,lease_until=?,attempts=attempts+1 WHERE id=?").run(lease,lease_until,r.id);this.mirror(()=>this.persistence.upsert("jobs",{id:r.id,body:r.body,state:"running",attempts,available:r.available,lease,lease_until},"id"));return{...r,body:JSON.parse(r.body),lease,attempts}})}
  finish(job,fn){return this.tx(()=>{const r=this.db.prepare("SELECT lease FROM jobs WHERE id=? AND state='running'").get(job.id);if(r?.lease!==job.lease)throw Error("Stale job lease");fn();this.db.prepare("UPDATE jobs SET state='done',lease=NULL,lease_until=NULL WHERE id=?").run(job.id);const row=this.db.prepare("SELECT * FROM jobs WHERE id=?").get(job.id);this.mirror(()=>this.persistence.upsert("jobs",row,"id"));})}
  retry(job,reason){const state=job.attempts>=8?"dead":"pending",available=Date.now()+Math.min(300000,1000*2**job.attempts);this.db.prepare("UPDATE jobs SET state=?,available=?,lease=NULL,lease_until=NULL WHERE id=? AND lease=?").run(state,available,job.id,job.lease);const row=this.db.prepare("SELECT * FROM jobs WHERE id=?").get(job.id);this.mirror(()=>this.persistence.upsert("jobs",row,"id"));this.event("INGEST_RETRY",{id:job.id,attempts:job.attempts,reason})}
  observe(o){const encoded=JSON.stringify(o),r=this.db.prepare("INSERT OR IGNORE INTO observations VALUES(?,?,?,?,?)").run(o.id,o.wallet,o.mint,o.at,encoded);if(r.changes)this.mirror(()=>this.persistence.upsert("observations",{id:o.id,wallet:o.wallet,mint:o.mint,at:o.at,body:encoded},"id"));return r.changes>0}
  observations(wallet=null,before=Date.now()){const rows=wallet?this.db.prepare("SELECT body FROM observations WHERE wallet=? AND at<=? ORDER BY at,id").all(wallet,before):this.db.prepare("SELECT body FROM observations WHERE at<=? ORDER BY at,id").all(before);return rows.map(x=>JSON.parse(x.body))}
  entity(kind,id,body){const at=Date.now(),encoded=JSON.stringify(body);this.db.prepare("INSERT INTO entities VALUES(?,?,?,?) ON CONFLICT(kind,id) DO UPDATE SET at=excluded.at,body=excluded.body").run(kind,id,at,encoded);this.mirror(()=>this.persistence.upsert("entities",{kind,id,at,body:encoded},"kind,id"));}
  entities(kind,limit=500){return this.db.prepare("SELECT body FROM entities WHERE kind=? ORDER BY at DESC LIMIT ?").all(kind,limit).map(x=>JSON.parse(x.body))}
  order(id){const r=this.db.prepare("SELECT * FROM orders WHERE id=?").get(id);return r?{...JSON.parse(r.body),state:r.state}:null}
  orders(){return this.db.prepare("SELECT * FROM orders ORDER BY updated DESC").all().map(r=>({...JSON.parse(r.body),state:r.state}))}
  saveOrder(o){const updated=Date.now(),encoded=JSON.stringify(o);this.db.prepare("INSERT INTO orders VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state,body=excluded.body,updated=excluded.updated").run(o.id,o.state,encoded,updated);this.mirror(()=>this.persistence.upsert("orders",{id:o.id,state:o.state,body:encoded,updated},"id"));}
  reserve(id,amount,cap){const day=new Date().toISOString().slice(0,10);return this.tx(()=>{const prior=this.db.prepare("SELECT amount,day FROM reservations WHERE id=?").get(id);if(prior){if(prior.amount!==amount||prior.day!==day)throw Error("Reservation id conflict");return}const used=this.db.prepare("SELECT COALESCE(SUM(amount),0) AS total FROM reservations WHERE day=?").get(day).total;if(used+amount>cap)throw Error("Daily spending limit");this.db.prepare("INSERT INTO reservations VALUES(?,?,?)").run(id,day,amount);this.mirror(()=>this.persistence.upsert("reservations",{id,day,amount},"id"));})}
  close(){this.db.close()}
}
