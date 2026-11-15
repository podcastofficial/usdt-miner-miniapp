// Phase 2 / Part 4: pure helpers for referral contests (no DB, no network -> unit-testable).
import { cleanText } from "./community.js";

export const KINDS = { weekly: 7, monthly: 30, custom: null }; // days; "monthly" = 30 days (a fixed length, not a calendar month)
export const MAX_PRIZES = 10, MAX_PRIZE = 10_000_000, STANDINGS_LIMIT = 200;
const DAY = 86_400_000;

const toInt = (v) => { const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v; return Number.isSafeInteger(n) ? n : NaN; };

/** "5000, 3000 1000" or [5000,3000,1000] -> whole Points per rank (rank 1 first, never increasing). */
export function parsePrizes(v) {
  const a = Array.isArray(v) ? v : typeof v === "string" ? v.split(/[\s,]+/).filter(Boolean) : null;
  if (!a || a.length < 1 || a.length > MAX_PRIZES) return { ok: false, error: `Give 1 to ${MAX_PRIZES} prizes, rank 1 first` };
  const n = a.map(toInt);
  if (!n.every((x) => x >= 1 && x <= MAX_PRIZE)) return { ok: false, error: `Each prize must be a whole number from 1 to ${MAX_PRIZE.toLocaleString("en-US")} Points` };
  for (let i = 1; i < n.length; i++) if (n[i] > n[i - 1]) return { ok: false, error: "Prizes must not increase with rank (rank 1 gets the most)" };
  return { ok: true, value: n };
}

/** Validates the admin's "create contest" form. `now` is injectable for tests. Dates are UTC instants. */
export function validateContestInput(b, now = new Date()) {
  b = b && typeof b === "object" ? b : {};
  if (!Object.prototype.hasOwnProperty.call(KINDS, b.kind)) return { ok: false, error: "Choose weekly, monthly or custom" };
  const title = cleanText(b.title, 60);
  if (title.length < 3) return { ok: false, error: "Title must be at least 3 characters" };
  const p = parsePrizes(b.prizes); if (!p.ok) return p;
  const min = b.minReferrals === undefined || b.minReferrals === "" ? 1 : toInt(b.minReferrals);
  if (!(min >= 1 && min <= 1000)) return { ok: false, error: "Minimum referrals must be 1 to 1,000" };
  let days = KINDS[b.kind];
  if (b.kind === "custom") { days = toInt(b.days); if (!(days >= 1 && days <= 90)) return { ok: false, error: "A custom contest runs 1 to 90 days" }; }
  const starts = new Date(now.getTime()), ends = new Date(starts.getTime() + days * DAY);
  return { ok: true, value: { kind: b.kind, title, prizes: p.value, minReferrals: min, days, startsAt: starts.toISOString(), endsAt: ends.toISOString() } };
}

/**
 * Ranking. rows = [{ telegram_id, referrals, last_at }] (one row per inviter, qualified referrals INSIDE the window).
 *  1. more qualified referrals first
 *  2. tie -> whoever REACHED that number first (earlier last_at) ranks higher
 *  3. still tied (same instant) -> lower Telegram id. So ranks are always unique and a prize is never split.
 * Only users with at least `minReferrals` are ranked; prize = prizes[rank-1] or 0.
 */
export function rankStandings(rows, { prizes = [], minReferrals = 1 } = {}) {
  const t = (x) => (x instanceof Date ? x.getTime() : Date.parse(x));
  const ok = (rows || []).filter((r) => Number(r.referrals) >= minReferrals);
  ok.sort((a, b) => (Number(b.referrals) - Number(a.referrals)) || (t(a.last_at) - t(b.last_at)) || (BigInt(a.telegram_id) < BigInt(b.telegram_id) ? -1 : BigInt(a.telegram_id) > BigInt(b.telegram_id) ? 1 : 0));
  return ok.map((r, i) => ({ ...r, referrals: Number(r.referrals), rank: i + 1, prize: prizes[i] || 0 }));
}

export const totalPrizes = (prizes) => (prizes || []).reduce((s, x) => s + x, 0);

/** Time left as whole seconds (never negative) - the app shows a countdown from it. */
const ms = (x) => (x instanceof Date ? x.getTime() : Date.parse(x));
export const secondsLeft = (endsAt, now = Date.now()) => Math.max(0, Math.ceil((ms(endsAt) - now) / 1000));
export const isOver = (endsAt, now = Date.now()) => ms(endsAt) <= now;
