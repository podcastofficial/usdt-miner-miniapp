// Part 14: a NEW withdrawal wallet address has to age before it can be used (account-takeover protection). Pure helpers.
export const normAddr = (a) => String(a || "").trim().toLowerCase();

/** Milliseconds still to wait. 0 = allowed. hours <= 0 (or not a number) switches the rule off. */
export function cooldownLeftMs(firstSeen, nowMs, hours) {
  if (!Number.isFinite(hours) || hours <= 0) return 0;
  if (firstSeen === null || firstSeen === undefined) return hours * 3600e3; // no record = brand new
  const t = new Date(firstSeen).getTime();
  if (!Number.isFinite(t)) return hours * 3600e3; // unreadable date: treat as brand new, never as trusted
  return Math.max(0, t + hours * 3600e3 - nowMs);
}

/** 90000 -> "2 minutes", 5400000 -> "1h 30m". Always rounds UP so the user never retries too early. */
export function fmtWait(ms) {
  const m = Math.max(1, Math.ceil(ms / 60000));
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"}`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h}h ${r}m` : `${h}h`;
}
