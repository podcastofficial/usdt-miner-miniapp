import { sql } from "./db.js";
import { HttpError } from "./http.js";

// action -> [max requests, window seconds] per user (fixed window, stored in Postgres)
const LIMITS = {
  default: [60, 60],
  daily: [5, 60], taskStart: [20, 60], taskComplete: [10, 60], withdraw: [3, 60],
  depositSubmit: [5, 60], campaignCreate: [5, 60],
};
export async function rateLimit(userId, action) {
  const [max, win] = LIMITS[action] || (action.startsWith("admin") ? [30, 60] : LIMITS.default);
  const rows = await sql`
    INSERT INTO rate_limits(bucket,window_start,hits)
    VALUES(${userId + ":" + action}, to_timestamp((floor(extract(epoch FROM now())/${win}::int)*${win}::int)::double precision), 1)
    ON CONFLICT(bucket,window_start) DO UPDATE SET hits=rate_limits.hits+1
    RETURNING hits`;
  if (rows[0].hits > max) throw new HttpError(429, "rate_limited", "Too many requests, please slow down");
  if (Math.random() < 0.01) await sql`DELETE FROM rate_limits WHERE window_start < NOW() - INTERVAL '1 day'`;
}
