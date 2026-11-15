// Runtime configuration = settings table (managed from the admin panel) over env/default fallbacks.
import { sql } from "./db.js";
import { resolveConfig } from "./settingsDefs.js";
let cache = null, at = 0;
export async function getConfig() {
  if (cache && Date.now() - at < 3000) return cache; // tiny cache: one settings query per ~3 s per instance
  cache = resolveConfig(await sql`SELECT key,value FROM settings`); at = Date.now();
  return cache;
}
export const invalidateConfig = () => { cache = null; };
