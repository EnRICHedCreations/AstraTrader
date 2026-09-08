import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";
const input = process.env.DATABASE_PATH ?? "/data/trader.sqlite",
  output = process.argv[2];
if (!output) throw Error("Pass the absolute backup destination");
const db = new DatabaseSync(input);
const path = resolve(output);
db.prepare("VACUUM INTO ?").run(path);
const check = new DatabaseSync(path, { readOnly: true });
const r = check.prepare("PRAGMA integrity_check").get();
check.close();
db.close();
if (Object.values(r)[0] !== "ok") throw Error("Backup integrity check failed");
console.log(JSON.stringify({ backup: path, integrity: "ok" }));
