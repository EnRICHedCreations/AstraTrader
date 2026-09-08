const TABLES = {
  meta: "astratrader_meta",
  events: "astratrader_events",
  jobs: "astratrader_jobs",
  observations: "astratrader_observations",
  orders: "astratrader_orders",
  entities: "astratrader_entities",
  reservations: "astratrader_reservations",
};

const ACTIVE_JOB_MAX_AGE_MS = 60000;
const TERMINAL_JOB_STATES = new Set(["done", "dead"]);

export class SupabasePersistence {
  constructor(url, key, fetcher = fetch) { this.base = new URL("/rest/v1/", url); this.key = key; this.fetcher = fetcher; }
  headers(extra = {}) { return {apikey:this.key,authorization:`Bearer ${this.key}`,"content-type":"application/json",...extra}; }
  async request(path, options = {}) {
    const response = await this.fetcher(new URL(path, this.base), {...options,headers:this.headers(options.headers),signal:AbortSignal.timeout(15000),redirect:"error"});
    if (response.status === 416 && (!options.method || options.method === "GET")) return [];
    if (!response.ok) { const text=await response.text().catch(()=>""); throw Error(`Supabase persistence HTTP ${response.status}${text?`: ${text.slice(0,240)}`:""}`); }
    if (response.status===204) return null; const text=await response.text(); return text?JSON.parse(text):null;
  }
  async rows(table,{order="",filters={},maxRows=10000}={}) {
    const out=[]; for(let offset=0;offset<maxRows;offset+=1000){const params=new URLSearchParams({select:"*"});if(order)params.set("order",order);for(const[key,value]of Object.entries(filters))params.set(key,value);const pageSize=Math.min(1000,maxRows-offset),page=await this.request(`${TABLES[table]}?${params.toString()}`,{headers:{Range:`${offset}-${offset+pageSize-1}`}});if(!Array.isArray(page))throw Error(`Unexpected Supabase ${table} response`);out.push(...page);if(page.length<pageSize)break}return out;
  }
  async deleteJobs(filters){const params=new URLSearchParams(filters);await this.request(`${TABLES.jobs}?${params.toString()}`,{method:"DELETE",headers:{Prefer:"return=minimal"}});}
  async pruneJobs(now=Date.now()){
    const cutoff=now-ACTIVE_JOB_MAX_AGE_MS;
    await Promise.all([
      this.deleteJobs({state:"in.(done,dead)"}),
      this.deleteJobs({state:"eq.pending",available:`lt.${cutoff}`}),
      this.deleteJobs({state:"eq.running",lease_until:`lt.${now}`}),
    ]);
  }
  async upsert(table,row,conflict){
    if(table==="jobs"&&!Array.isArray(row)&&TERMINAL_JOB_STATES.has(row?.state)){
      await this.deleteJobs({id:`eq.${row.id}`});
      return;
    }
    const suffix=conflict?`?on_conflict=${encodeURIComponent(conflict)}`:"";await this.request(TABLES[table]+suffix,{method:"POST",headers:{Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify(row)});
  }
  async insertEvent(row){for(let attempt=0;attempt<8;attempt+=1){const latestQuery=new URLSearchParams({select:"seq",order:"seq.desc",limit:"1"}),latest=await this.request(`${TABLES.events}?${latestQuery.toString()}`),seq=Number(latest?.[0]?.seq??0)+1,insertQuery=new URLSearchParams({select:"seq"});const response=await this.fetcher(new URL(`${TABLES.events}?${insertQuery.toString()}`,this.base),{method:"POST",headers:this.headers({Prefer:"return=representation"}),body:JSON.stringify({seq,id:row.id,at:row.at,kind:row.kind,body:row.body,prev:row.prev,hash:row.hash}),signal:AbortSignal.timeout(15000),redirect:"error"});if(response.ok){const text=await response.text(),created=text?JSON.parse(text):null;if(!Array.isArray(created)||Number(created[0]?.seq)!==seq)throw Error("Unexpected Supabase event insert response");return seq}const text=await response.text().catch(()=>"");if(response.status!==409)throw Error(`Supabase persistence HTTP ${response.status}${text?`: ${text.slice(0,240)}`:""}`);const existingQuery=new URLSearchParams({select:"seq",id:`eq.${row.id}`,limit:"1"}),existing=await this.request(`${TABLES.events}?${existingQuery.toString()}`);if(existing?.[0]?.seq!=null)return Number(existing[0].seq)}throw Error("Supabase event sequence allocation contention");}
  async hydrate(store) {
    const now=Date.now(),cutoff=now-ACTIVE_JOB_MAX_AGE_MS;
    await this.pruneJobs(now);
    // Wallets are durable strategy evidence. Hydrate them independently from volatile
    // signal/relationship entities so a busy entity table cannot evict qualified wallets.
    const [meta,eventsDesc,jobs,observationsDesc,orders,walletEntities,otherEntities,reservations]=await Promise.all([
      this.rows("meta",{order:"key.asc",maxRows:2000}),
      this.rows("events",{order:"seq.desc",maxRows:10000}),
      this.rows("jobs",{order:"available.desc",filters:{state:"in.(pending,running)",available:`gte.${cutoff}`},maxRows:5000}),
      this.rows("observations",{order:"at.desc,id.desc",maxRows:100000}),
      this.rows("orders",{order:"updated.desc",maxRows:20000}),
      this.rows("entities",{order:"at.desc",filters:{kind:"eq.wallet"},maxRows:100000}),
      this.rows("entities",{order:"at.desc",filters:{kind:"neq.wallet"},maxRows:100000}),
      this.rows("reservations",{order:"day.desc,id.desc",maxRows:2000}),
    ]);
    const entities=[...walletEntities,...otherEntities];
    store.hydrate({meta,events:eventsDesc.reverse(),jobs,observations:observationsDesc.reverse(),orders,entities,reservations});
  }
}
