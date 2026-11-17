// Part 17.2: Auto-Miner - pure helpers (no DB, no network -> unit-testable).
// A machine mines `rate_per_hour` Points every hour until `ends_at`. Earnings pile up inside the machine (storage) and the
// user claims them. The SQL in lib/actions/autominer.js mirrors accrue() below; tests/autominer.test.js pins both.
//
// All times here are BigInt MICROSECONDS (Postgres timestamp precision), so the maths is exact:
//   t_end   = min(now, ends_at)
//   t_start = max(last_claim, t_end - storage)          <- the machine only stores `storage` hours of earnings
//   micros  = max(0, t_end - t_start)
//   pts     = floor(rate * micros / 3_600_000_000)      <- whole Points only, rounded DOWN (never over-pays)
//   new_last = ends_at                                   if the machine has ended (fraction of a Point is dropped)
//            = t_start + floor(pts * 3_600_000_000 / rate)   otherwise (the unpaid fraction stays in the machine)

export const US_PER_HOUR = 3_600_000_000n;
export const PLAN_MAX_PRICE = 10_000_000;
export const PLAN_MAX_RATE = 100_000;      // Points per hour
export const PLAN_MAX_DAYS = 365;
export const PLAN_MAX_PER_USER = 1000;
export const MAX_ACTIVE_PLANS = 12;        // keeps the Auto-Miner screen readable on a phone

const big = (v) => (typeof v === "bigint" ? v : BigInt(v));
const intIn = (v, min, max) => { const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN; return Number.isSafeInteger(n) && n >= min && n <= max ? n : null; };
const clean = (s, max) => String(s ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

/**
 * What one machine pays right now. rate = Points/hour (integer >= 1); lastClaim / now / ends = BigInt microseconds; storageHours >= 1.
 * Returns { pts, newLast, finished }. Mirror of the `calc` / `pay` CTEs in autoMinerClaim().
 */
export function accrue({ rate, lastClaim, now, ends, storageHours }) {
  const r = big(rate), last = big(lastClaim), n = big(now), e = big(ends), store = big(storageHours) * US_PER_HOUR;
  if (r < 1n) throw new RangeError("rate must be >= 1");
  const tEnd = n < e ? n : e;
  const floorStart = tEnd - store;
  const tStart = last > floorStart ? last : floorStart;
  const micros = tEnd - tStart > 0n ? tEnd - tStart : 0n;
  const pts = (r * micros) / US_PER_HOUR;                       // BigInt division floors (non-negative operands)
  const finished = e <= n;
  const newLast = finished ? e : tStart + (pts * US_PER_HOUR) / r;
  return { pts: Number(pts), newLast, finished };
}

/** Total a plan can pay over its life, and whether it pays back. Display + admin sanity check. */
export function planStats({ price, rate_per_hour, duration_days }) {
  const p = Number(price), rate = Number(rate_per_hour), days = Number(duration_days);
  const perDay = rate * 24, total = perDay * days;
  return {
    per_day: perDay, total_return: total, profit: total - p,
    roi_pct: p > 0 ? Math.round((total / p) * 1000) / 10 : null,
    payback_days: p > 0 ? Math.round((p / perDay) * 10) / 10 : 0,
    pays_more_than_price: total > p,
  };
}

/** Admin input for a plan -> { ok:true, value } | { ok:false, error }. */
export function validatePlanInput(b) {
  b = b && typeof b === "object" ? b : {};
  const name = clean(b.name, 30);
  if (!name) return { ok: false, error: "Name is required (max 30 characters)" };
  const price = intIn(b.price, 0, PLAN_MAX_PRICE);
  if (price == null) return { ok: false, error: `Price must be 0-${PLAN_MAX_PRICE.toLocaleString("en-US")} Points (0 = free)` };
  const rate = intIn(b.rate_per_hour, 1, PLAN_MAX_RATE);
  if (rate == null) return { ok: false, error: `Points per hour must be 1-${PLAN_MAX_RATE.toLocaleString("en-US")}` };
  const days = intIn(b.duration_days, 1, PLAN_MAX_DAYS);
  if (days == null) return { ok: false, error: `Lifetime must be 1-${PLAN_MAX_DAYS} days` };
  const max = intIn(b.max_per_user, 1, PLAN_MAX_PER_USER);
  if (max == null) return { ok: false, error: `Max per user must be 1-${PLAN_MAX_PER_USER}` };
  return { ok: true, value: { name, price, rate_per_hour: rate, duration_days: days, max_per_user: max } };
}
