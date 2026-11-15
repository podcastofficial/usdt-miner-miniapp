// Phase 2 / Part 2: pure helpers for streaks, levels, badges, milestones and promo codes (no DB, no network -> unit-testable).
// The SQL in lib/actions/engage.js and lib/actions/earn.js mirrors the streak rules below; tests/engagement.test.js pins them.
import crypto from "node:crypto";
import { camel } from "./settingsDefs.js";

export const LADDER_DEFAULT = [100, 120, 140, 160, 180, 200, 300]; // starter values from the roadmap - owner confirms in Admin > Settings
export const LADDER_LEN = 7;
export const MILESTONES = [5, 10, 50];                             // qualified referrals
export const LEVELS = [
  { code: "bronze", name: "Bronze", icon: "🥉" },
  { code: "silver", name: "Silver", icon: "🥈" },
  { code: "gold", name: "Gold", icon: "🥇" },
];
// Ledger types that count as "earned" for levels. Allow-list on purpose: deposits, refunds and admin adjustments never raise a level.
export const EARN_TYPES = ["Daily Reward", "Task Reward", "Referral Reward", "Milestone Reward", "Promo Code"];

export const BADGES = {
  streak_7:     { icon: "🔥", name: "7-day streak", help: "Claim the daily reward 7 days in a row" },
  streak_30:    { icon: "🌋", name: "30-day streak", help: "Claim the daily reward 30 days in a row" },
  ref_5:        { icon: "👥", name: "5 referrals", help: "5 friends joined and verified" },
  ref_10:       { icon: "🤝", name: "10 referrals", help: "10 friends joined and verified" },
  ref_50:       { icon: "👑", name: "50 referrals", help: "50 friends joined and verified" },
  level_silver: { icon: "🥈", name: "Silver miner", help: "Reach the Silver level" },
  level_gold:   { icon: "🥇", name: "Gold miner", help: "Reach the Gold level" },
};

/* ---------------- dates / streak ---------------- */
const DAY = 86400000;
const ymd = /^\d{4}-\d{2}-\d{2}$/;
/** Whole days from a to b for 'YYYY-MM-DD' strings (UTC maths, so no daylight-saving surprises). null if either is invalid. */
export function dayDiff(a, b) {
  if (!ymd.test(String(a)) || !ymd.test(String(b))) return null;
  return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / DAY);
}

/** Streak after claiming on `today`: +1 if the last claim was yesterday, same day = unchanged (already claimed), anything else = restart at 1. */
export function streakAfterClaim({ last, today, current }) {
  const d = last ? dayDiff(last, today) : null;
  if (d === 0) return Math.max(1, current | 0);
  if (d === 1) return (current | 0) + 1;
  return 1;
}
/** Streak a user can currently SEE: alive only if they claimed today or yesterday (otherwise it already broke). */
export function visibleStreak({ last, today, current }) {
  const d = last ? dayDiff(last, today) : null;
  return d === 0 || d === 1 ? Math.max(0, current | 0) : 0;
}
/** Position on the 7-day ladder (1..7) for a streak length; after day 7 the ladder starts again at day 1. */
export const ladderDay = (streak) => ((Math.max(1, streak | 0) - 1) % LADDER_LEN) + 1;
export const ladderReward = (ladder, streak) => Number(ladder[ladderDay(streak) - 1]);

/** What the home card shows: current streak, which ladder day is next and what it pays. */
export function streakView({ last, today, current, best, ladder, enabled, baseReward }) {
  const cur = visibleStreak({ last, today, current });
  const claimedToday = !!last && dayDiff(last, today) === 0;
  const upcoming = cur + 1; // the claim that continues the run (a broken run shows cur=0, so it restarts at day 1)
  return {
    enabled: !!enabled, current: cur, best: Math.max(best | 0, cur), claimed_today: claimedToday,
    next_day: ladderDay(upcoming), next_reward: enabled ? ladderReward(ladder, upcoming) : baseReward,
    ladder: enabled ? ladder : null,
  };
}

/* ---------------- config helpers (pure) ---------------- */
/** Gold must be above Silver even if an admin typed something odd. */
export const thresholds = (c) => ({ silver: c.levelSilverAt, gold: Math.max(c.levelGoldAt, c.levelSilverAt + 1) });
/** Bonus for a milestone from the resolved config (camel() keeps the digit: milestone_reward_5 -> milestoneReward_5). */
export const milestoneReward = (c, n) => Number(c[camel("milestone_reward_" + n)]);

/* ---------------- levels ---------------- */
/** thresholds: { silver, gold } Points of lifetime earnings. Returns the level plus progress to the next one. */
export function levelFor(earned, { silver, gold }) {
  const e = Math.max(0, Number(earned) || 0);
  const idx = e >= gold ? 2 : e >= silver ? 1 : 0;
  const next = idx === 2 ? null : idx === 1 ? gold : silver;
  const from = idx === 0 ? 0 : idx === 1 ? silver : gold;
  return {
    ...LEVELS[idx], index: idx, earned: e, next_at: next, next_name: next == null ? null : LEVELS[idx + 1].name,
    progress: next == null ? 100 : Math.min(100, Math.floor(((e - from) / Math.max(1, next - from)) * 100)),
  };
}

/* ---------------- badges ---------------- */
/** Which badge codes the user's stats entitle them to (the server inserts the missing ones, once). */
export function badgesFor({ bestStreak = 0, qualified = 0, levelIndex = 0 }) {
  const out = [];
  if (bestStreak >= 7) out.push("streak_7");
  if (bestStreak >= 30) out.push("streak_30");
  if (qualified >= 5) out.push("ref_5");
  if (qualified >= 10) out.push("ref_10");
  if (qualified >= 50) out.push("ref_50");
  if (levelIndex >= 1) out.push("level_silver");
  if (levelIndex >= 2) out.push("level_gold");
  return out;
}

/* ---------------- milestones ---------------- */
/** Milestones the user has reached (qualified >= n) but not been paid for yet. */
export const dueMilestones = (qualified, paid) => MILESTONES.filter(n => qualified >= n && !(paid || []).includes(n));
export const milestoneRef = (referrerId, n) => `milestone:${String(referrerId)}:${n}`;

/* ---------------- promo codes ---------------- */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I, easy to read out loud
export const PROMO_RE = /^[A-Z0-9]{4,20}$/;
/** User-typed code -> canonical upper-case code, or null when it cannot possibly be valid (saves a DB hit). */
export function normalizePromo(raw) {
  const s = String(raw ?? "").trim().replace(/[\s-]+/g, "").toUpperCase();
  return PROMO_RE.test(s) ? s : null;
}
export function generatePromoCode(len = 8) {
  let s = ""; for (const b of crypto.randomBytes(len)) s += CODE_ALPHABET[b % CODE_ALPHABET.length]; return s;
}
const intIn = (v, min, max) => { const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN; return Number.isSafeInteger(n) && n >= min && n <= max ? n : null; };
export const PROMO_MAX_REWARD = 10_000_000;

/** Admin input -> { ok, value:{code,reward,perUserLimit,totalLimit,expiresDays,note} } | { ok:false, error }. */
export function validatePromoInput(b) {
  b = b && typeof b === "object" ? b : {};
  const code = b.code == null || String(b.code).trim() === "" ? generatePromoCode() : normalizePromo(b.code);
  if (!code) return { ok: false, error: "Code must be 4-20 letters/numbers" };
  const reward = intIn(b.reward, 1, PROMO_MAX_REWARD);
  if (reward == null) return { ok: false, error: `Reward must be 1-${PROMO_MAX_REWARD.toLocaleString("en-US")} Points` };
  const perUserLimit = b.perUserLimit == null || b.perUserLimit === "" ? 1 : intIn(b.perUserLimit, 1, 10);
  if (perUserLimit == null) return { ok: false, error: "Per-user limit must be 1-10" };
  const totalLimit = intIn(b.totalLimit, 1, 1_000_000);
  if (totalLimit == null) return { ok: false, error: "Total limit must be 1-1,000,000 (a cap is required)" };
  const expiresDays = b.expiresDays == null || b.expiresDays === "" ? 0 : intIn(b.expiresDays, 0, 365);
  if (expiresDays == null) return { ok: false, error: "Expiry must be 0-365 days (0 = no expiry)" };
  const note = String(b.note ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 100);
  return { ok: true, value: { code, reward, perUserLimit, totalLimit, expiresDays, note } };
}

/** Why a redeem found nothing to credit, in priority order. `p` = promo row (or null) + the user's own redemption count. */
export function promoFailure(p, now = Date.now()) {
  if (!p) return { code: "promo_invalid", message: "Invalid promo code" };
  if (!p.active) return { code: "promo_inactive", message: "This promo code is no longer active" };
  if (p.expires_at && new Date(p.expires_at).getTime() <= now) return { code: "promo_expired", message: "This promo code has expired" };
  if (Number(p.redeemed) >= Number(p.total_limit)) return { code: "promo_exhausted", message: "This promo code has been fully redeemed" };
  if (Number(p.mine) >= Number(p.per_user_limit)) return { code: "promo_used", message: "You already used this promo code" };
  return { code: "promo_unavailable", message: "Promo code could not be redeemed, try again" };
}

/* ---------------- referral list ---------------- */
export const REF_PAGE = 20;
export const pageNum = (v) => { const n = Number(v); return Number.isSafeInteger(n) && n >= 1 && n <= 10000 ? n : 1; };
