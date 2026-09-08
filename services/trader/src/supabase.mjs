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
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw Error(`Supabase persistence HTTP ${response.status}${text ? `: ${text.slice(0, 240)}` : ""}`);
    }
    if (response.status === 204) return null;
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }

  async rows(table, order = "") {
    const out = [];
    for (let offset = 0; ; offset += 1000) {
      const query = `?select=*${order ? `&order=${encodeURIComponent(order)}` : ""}`;
      const page = await this.request(TABLES[table] + query, {
        headers: { Range: `${offset}-${offset + 999}` },
      });
      if (!Array.isArray(page)) throw Error(`Unexpected Supabase ${table} response`);
      out.push(...page);
      if (page.length < 1000) break;
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

  async hydrate(store) {
    const [meta, events, jobs, observations, orders, entities, reservations] = await Promise.all([
      this.rows("meta", "key.asc"),
      this.rows("events", "seq.asc"),
      this.rows("jobs", "available.asc"),
      this.rows("observations", "at.asc,id.asc"),
      this.rows("orders", "updated.asc"),
      this.rows("entities", "at.asc"),
      this.rows("reservations", "day.asc,id.asc"),
    ]);
    store.hydrate({ meta, events, jobs, observations, orders, entities, reservations });
  }
}
