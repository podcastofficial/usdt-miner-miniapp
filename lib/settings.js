import { sql } from "./db.js";
export async function getSetting(key, fallback) {
  const r = await sql`SELECT value FROM settings WHERE key=${key}`;
  return r.length ? r[0].value : fallback;
}
