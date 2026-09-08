const TABLES = {
  meta: "astratrader_meta",
  events: "astratrader_events",
  jobs: "astratrader_jobs",
  observations: "astratrader_observations",
  orders: "astratrader_orders",
  entities: "astratrader_entities",
  reservations: "astratrader_reservations",
};

export class SupabasePersistence {
  constructor(url, key, fetcher = fetch) {
    this.base = new URL("/rest/v1/", url);
    this.key = key;
    this.fetcher = fetcher;
  }

  headers(extra = {}) {
    return {
      apikey: this.key,
      authorization: `Bearer ${this.key}`,
      "content-type": "application/json",
      ...extra,
    };
  }

  async request(path, options = {}) {
    const response = await this.fetcher(new URL(path, this.base), {
      ...options,
      headers: this.headers(options.headers),
      signal: AbortSignal.timeout(15000),
      redirect: "error",
    });
    if (response.status === 416 && (!options.method || options.method === "GET")) return [];
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw Error(`Supabase persistence HTTP ${response.status}${text ? `: ${text.slice(0, 240)}` : ""}`);
    }
    if (response.status === 204) return null;
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }

  async rows(table, {order = "", filters = {}, maxRows = 10000} = {}) {
    const out = [];
    for (let offset = 0; offset < maxRows; offset += 1000) {
      const params = new URLSearchParams({select: "*"});
      if (order) params.set("order", order);
      for (const [key, value] of Object.entries(filters)) params.set(key, value);
      const pageSize = Math.min(1000, maxRows - offset);
      const page = await this.request(`${TABLES[table]}?${params.toString()}`, {
        headers: { Range: `${offset}-${offset + pageSize - 1}` },
      });
      if (!Array.isArray(page)) throw Error(`Unexpected Supabase ${table} response`);
      out.push(...page);
      if (page.length < pageSize) break;
    }
    return out;
  }

  async upsert(table, row, conflict) {
    const suffix = conflict ? `?on_conflict=${encodeURIComponent(conflict)}` : "";
    await this.request(TABLES[table] + suffix, {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(row),
    });
  }

  async insertEvent(row) {
    const params = new URLSearchParams({select: "seq"});
    const created = await this.request(`${TABLES.events}?${params.toString()}`, {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({id: row.id, at: row.at, kind: row.kind, body: row.body, prev: row.prev, hash: row.hash}),
    });
    if (!Array.isArray(created) || !created[0]?.seq) throw Error("Unexpected Supabase event insert response");
    return Number(created[0].seq);
  }

  async hydrate(store) {
    const [meta, eventsDesc, jobs, observationsDesc, orders, entities, reservations] = await Promise.all([
      this.rows("meta", {order: "key.asc", maxRows: 2000}),
      this.rows("events", {order: "seq.desc", maxRows: 10000}),
      this.rows("jobs", {order: "available.desc", filters: {state: "in.(pending,running)"}, maxRows: 5000}),
      this.rows("observations", {order: "at.desc,id.desc", maxRows: 25000}),
      this.rows("orders", {order: "updated.desc", maxRows: 10000}),
      this.rows("entities", {order: "at.desc", maxRows: 20000}),
      this.rows("reservations", {order: "day.desc,id.desc", maxRows: 2000}),
    ]);
    store.hydrate({
      meta,
      events: eventsDesc.reverse(),
      jobs,
      observations: observationsDesc.reverse(),
      orders,
      entities,
      reservations,
    });
  }
}
