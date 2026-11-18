// Runtime configuration = settings table (managed from the admin panel) over env/default fallbacks.
import { sql } from "./db.js";
import { resolveConfig } from "./settingsDefs.js";
let cache = null, rows = null, at = 0;
const TTL = 20000; // one settings query per ~20 s per instance (admin saves on the same instance still apply at once via invalidateConfig)
async function load() {
  if (cache && Date.now() - at < TTL) return;
  rows = await sql`SELECT key,value FROM settings`; cache = resolveConfig(rows); at = Date.now();
}
export async function getConfig() { await load(); return cache; }
/** Raw settings rows from the same cache (bootstrap reuses them instead of querying again). */
export async function getSettingRows() { await load(); return rows; }
export const invalidateConfig = () => { cache = null; rows = null; };
