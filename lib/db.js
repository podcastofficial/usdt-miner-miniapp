import { neon } from "@neondatabase/serverless";
import { HttpError } from "./http.js";
let client;
// Lazy tagged-template wrapper: importing this file never needs DATABASE_URL.
export function sql(strings, ...values) {
  if (!client) {
    if (!process.env.DATABASE_URL) throw new HttpError(500, "server_misconfigured", "Database is not configured");
    client = neon(process.env.DATABASE_URL);
  }
  return client(strings, ...values);
}
export const isUniqueViolation = (e) => e && e.code === "23505";
