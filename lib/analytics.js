// Phase 2 / Part 5: analytics helpers. Pure: SQL returns sparse per-day rows, these make them chart-ready and safe.
export const DAYS = 14;

/** Day string YYYY-MM-DD for `n` days before `today` (also YYYY-MM-DD), calendar arithmetic in UTC so DST never shifts it. */
export function dayBefore(today, n) {
  const [y, m, d] = String(today).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d - n)).toISOString().slice(0, 10);
}

/** rows: [{ day, ...fields }] -> exactly `days` entries, oldest first, missing days filled with zeros. */
export function fillDays(rows, today, fields, days = DAYS) {
  const by = new Map((rows || []).map(r => [String(r.day).slice(0, 10), r]));
  return Array.from({ length: days }, (_, i) => {
    const day = dayBefore(today, days - 1 - i), r = by.get(day) || {};
    return { day, ...Object.fromEntries(fields.map(f => [f, Number(r[f] || 0)])) };
  });
}

export const pct = (part, whole) => (Number(whole) > 0 ? Math.round((Number(part) / Number(whole)) * 1000) / 10 : null);

/** Retention: "of users who joined at least N days ago, how many were seen again N or more days after joining". null = nobody old enough yet. */
export const retention = (r) => ({ d1: pct(r.d1_back, r.d1_base), d7: pct(r.d7_back, r.d7_base), d1_base: Number(r.d1_base), d7_base: Number(r.d7_base) });
export const conversion = (r) => ({ invited: Number(r.invited), qualified: Number(r.qualified), rate: pct(r.qualified, r.invited) });

/** Scales values to bar heights 0..max (integers) for the SVG chart. A flat-zero series draws no bars. */
export function barHeights(values, max = 100) {
  const top = Math.max(0, ...values.map(Number));
  return values.map(v => (top > 0 ? Math.round((Number(v) / top) * max) : 0));
}
