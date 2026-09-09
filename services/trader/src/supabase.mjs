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
const READ_TIMEOUT_MS = 60000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const transientHydrationError = (error) => {
  const message = String(error?.message ?? error ?? "");
  return /statement timeout|57014|HTTP 5\d\d|transport unavailable|timeout|aborted/i.test(message);
};

export class SupabasePersistence {
  constructor(url, key, fetcher = fetch) { this.base = new URL("/rest/v1/", url); this.key = key; this.fetcher = fetcher; }
  headers(extra = {}) { return {apikey:this.key,authorization:`Bearer ${this.key}`,"content-type":"application/json",...extra}; }
  async request(path, options = {}) {
    const method = options.method ?? "GET";
    const retryable = method === "GET";
    let lastError;
    for (let attempt = 0; attempt < (retryable ? 3 : 1); attempt += 1) {
      try {
        const response = await this.fetcher(new URL(path, this.base), {
          ...options,
          method,
          headers:this.headers(options.headers),
          signal:AbortSignal.timeout(retryable ? READ_TIMEOUT_MS : 15000),
          redirect:"error",
        });
        if (response.status === 416 && method === "GET") return [];
        if (!response.ok) {
          const text=await response.text().catch(()=>"");
          const error=Error(`Supabase persistence HTTP ${response.status}${text?`: ${text.slice(0,240)}`:""}`);
          if (retryable && transientHydrationError(error) && attempt < 2) {
            lastError=error;
            await sleep(500 * 2 ** attempt);
            continue;
          }
          throw error;
        }
        if (response.status===204) return null;
        const text=await response.text();
        return text?JSON.parse(text):null;
      } catch (error) {
        lastError=error;
        if (!retryable || !transientHydrationError(error) || attempt === 2) throw error;
        await sleep(500 * 2 ** attempt);
      }
    }
    throw lastError;
  }
  async rows(table,{select="*",order="",filters={},maxRows=10000,pageSize=1000}={}) {
    const out=[],size=Math.max(1,Math.min(1000,pageSize));
    for(let offset=0;offset<maxRows;offset+=size){
      const params=new URLSearchParams({select});
      if(order)params.set("order",order);
      for(const[key,value]of Object.entries(filters))params.set(key,value);
      const wanted=Math.min(size,maxRows-offset),page=await this.request(`${TABLES[table]}?${params.toString()}`,{headers:{Range:`${offset}-${offset+wanted-1}`}});
      if(!Array.isArray(page))throw Error(`Unexpected Supabase ${table} response`);
      out.push(...page);
      if(page.length<wanted)break;
    }
    return out;
  }
  async observationRows({maxRows=100000,pageSize=500}={}) {
    const out=[],size=Math.max(1,Math.min(1000,pageSize));
    let cursor=null;
    while(out.length<maxRows){
      const wanted=Math.min(size,maxRows-out.length);
      const params=new URLSearchParams({select:"*",order:"at.desc,id.desc",limit:String(wanted)});
      if(cursor)params.set("or",`(at.lt.${cursor.at},and(at.eq.${cursor.at},id.lt.${cursor.id}))`);
      const page=await this.request(`${TABLES.observations}?${params.toString()}`);
      if(!Array.isArray(page))throw Error("Unexpected Supabase observations response");
      out.push(...page);
      if(page.length<wanted)break;
      const last=page.at(-1);
      if(!last||last.at==null||!last.id)break;
      cursor={at:last.at,id:last.id};
    }
    return out;
  }
  async eventRows({maxRows=10000,pageSize=500}={}) {
    const out=[],size=Math.max(1,Math.min(1000,pageSize));
    let beforeSeq=null;
    while(out.length<maxRows){
      const wanted=Math.min(size,maxRows-out.length);
      const params=new URLSearchParams({select:"*",order:"seq.desc",limit:String(wanted)});
      if(beforeSeq!==null)params.set("seq",`lt.${beforeSeq}`);
      const page=await this.request(`${TABLES.events}?${params.toString()}`);
      if(!Array.isArray(page))throw Error("Unexpected Supabase events response");
      out.push(...page);
      if(page.length<wanted)break;
      const last=page.at(-1);
      if(last?.seq==null)break;
      beforeSeq=last.seq;
    }
    return out;
  }
  async entityRows(kind,{maxRows=10000,pageSize=500}={}) {
    const out=[],size=Math.max(1,Math.min(1000,pageSize));
    let cursor=null;
    while(out.length<maxRows){
      const wanted=Math.min(size,maxRows-out.length);
      const params=new URLSearchParams({select:"*",kind:`eq.${kind}`,order:"at.desc,id.desc",limit:String(wanted)});
      if(cursor)params.set("or",`(at.lt.${cursor.at},and(at.eq.${cursor.at},id.lt.${cursor.id}))`);
      const page=await this.request(`${TABLES.entities}?${params.toString()}`);
      if(!Array.isArray(page))throw Error(`Unexpected Supabase ${kind} entities response`);
      out.push(...page);
      if(page.length<wanted)break;
      const last=page.at(-1);
      if(!last||last.at==null||!last.id)break;
      cursor={at:last.at,id:last.id};
    }
    return out;
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
    const suffix=conflict?`?on_conflict=${encodeURIComponent(conflict)}`:"";
    await this.request(TABLES[table]+suffix,{method:"POST",headers:{Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify(row)});
  }
  async insertEvent(row){for(let attempt=0;attempt<8;attempt+=1){const latestQuery=new URLSearchParams({select:"seq",order:"seq.desc",limit:"1"}),latest=await this.request(`${TABLES.events}?${latestQuery.toString()}`),seq=Number(latest?.[0]?.seq??0)+1,insertQuery=new URLSearchParams({select:"seq"});const response=await this.fetcher(new URL(`${TABLES.events}?${insertQuery.toString()}`,this.base),{method:"POST",headers:this.headers({Prefer:"return=representation"}),body:JSON.stringify({seq,id:row.id,at:row.at,kind:row.kind,body:row.body,prev:row.prev,hash:row.hash}),signal:AbortSignal.timeout(15000),redirect:"error"});if(response.ok){const text=await response.text(),created=text?JSON.parse(text):null;if(!Array.isArray(created)||Number(created[0]?.seq)!==seq)throw Error("Unexpected Supabase event insert response");return seq}const text=await response.text().catch(()=>"");if(response.status!==409)throw Error(`Supabase persistence HTTP ${response.status}${text?`: ${text.slice(0,240)}`:""}`);const existingQuery=new URLSearchParams({select:"seq",id:`eq.${row.id}`,limit:"1"}),existing=await this.request(`${TABLES.events}?${existingQuery.toString()}`);if(existing?.[0]?.seq!=null)return Number(existing[0].seq)}throw Error("Supabase event sequence allocation contention");}
  async hydrateOnce(store) {
    const now=Date.now(),cutoff=now-ACTIVE_JOB_MAX_AGE_MS;
    await this.pruneJobs(now);

    const [meta,jobs,orders,reservations]=await Promise.all([
      this.rows("meta",{order:"key.asc",maxRows:2000}),
      this.rows("jobs",{order:"available.desc",filters:{state:"in.(pending,running)",available:`gte.${cutoff}`},maxRows:5000,pageSize:500}),
      this.rows("orders",{order:"updated.desc",maxRows:20000,pageSize:500}),
      this.rows("reservations",{order:"day.desc,id.desc",maxRows:2000,pageSize:500}),
    ]);

    // Cold-start only restores durable state that affects safety, scoring, execution or
    // operator visibility. Large graph entities are recomputed by the next evaluation
    // cycle and are intentionally excluded from startup hydration.
    const eventsDesc=await this.eventRows({maxRows:10000,pageSize:500});
    const observationsDesc=await this.observationRows({maxRows:100000,pageSize:500});
    const walletEntities=await this.entityRows("wallet",{maxRows:20000,pageSize:500});
    const edgeEntities=await this.entityRows("edge",{maxRows:10000,pageSize:500});
    const signalEntities=await this.entityRows("signal",{maxRows:2000,pageSize:250});
    const tokenEntities=await this.entityRows("token",{maxRows:1000,pageSize:250});
    const smallKinds=["signer","health","liveEquity","experiment"];
    const smallEntities=(await Promise.all(smallKinds.map(kind=>this.entityRows(kind,{maxRows:100,pageSize:100})))).flat();
    const entities=[...walletEntities,...edgeEntities,...signalEntities,...tokenEntities,...smallEntities];
    store.hydrate({meta,events:eventsDesc.reverse(),jobs,observations:observationsDesc.reverse(),orders,entities,reservations});
  }
  async hydrate(store) {
    let lastError;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try { return await this.hydrateOnce(store); }
      catch (error) {
        lastError = error;
        if (!transientHydrationError(error) || attempt === 1) throw error;
        await sleep(1000);
      }
    }
    throw lastError;
  }
}
