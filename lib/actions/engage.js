// Phase 2 / Part 2: Engagement & Retention - My Referrals, milestones, levels & badges, promo codes.
// (The daily streak itself lives in lib/actions/earn.js because it must be part of the same atomic claim statement.)
import { sql } from "../db.js";
import { HttpError } from "../http.js";
import { audit } from "../audit.js";
import { getConfig } from "../runtime.js";
import { rateLimit } from "../ratelimit.js";
import { maskName } from "../community.js";
import { dailyState } from "./earn.js";
import { syncBadges, listBadges, payMilestones } from "../badges.js";
import { MILESTONES, thresholds, milestoneReward, normalizePromo, validatePromoInput, promoFailure, pageNum, REF_PAGE } from "../engagement.js";

const bad = (msg, code = "bad_request", status = 400) => new HttpError(status, code, msg);
const posInt = (v) => { const n = Number(v); return Number.isSafeInteger(n) && n > 0 ? n : null; };
const FILTERS = ["all", "qualified", "pending"];

/** Everything the Rewards screen needs in one call. Also pays milestones that became payable (idempotent) and awards badges. */
export const engagement = async ({ id }) => {
  const c = await getConfig();
  let paidNow = [];
  try { paidNow = await payMilestones(id); } catch (e) { console.error("milestone catch-up failed:", e.message); }
  const { level, stats } = await syncBadges(id);
  const [badges, paid, streakState] = await Promise.all([
    listBadges(id),
    sql`SELECT milestone, paid_at FROM milestones_paid WHERE referrer_id=${String(id)}::bigint`,
    dailyState(id),
  ]);
  const paidMap = new Map(paid.map(p => [Number(p.milestone), p.paid_at]));
  return {
    level, lifetime_earned: stats.earned,
    streak: streakState.streak, claimed_today: streakState.claimed,
    badges,
    milestones: {
      enabled: c.milestonesEnabled, qualified: stats.qualified, paid_now: paidNow,
      items: MILESTONES.map(n => ({ milestone: n, reward: milestoneReward(c, n), reached: stats.qualified >= n, paid: paidMap.has(n), paid_at: paidMap.get(n) || null })),
    },
    promo_enabled: c.promoEnabled,
    levels: { silver: thresholds(c).silver, gold: thresholds(c).gold },
  };
};

/** Paginated "My Referrals": masked names, qualified vs pending. page >= 1, filter = all | qualified | pending. */
export const referralList = async ({ id, body }) => {
  const page = pageNum(body.page), f = FILTERS.includes(body.filter) ? body.filter : "all", offset = (page - 1) * REF_PAGE;
  const [rows, tot] = await Promise.all([
    sql`SELECT u.first_name, u.username, u.created_at, (e.referred_id IS NOT NULL) AS qualified
        FROM users u LEFT JOIN referral_events e ON e.referred_id=u.telegram_id
        WHERE u.referrer_id=${String(id)}::bigint
          AND (${f}::text='all' OR (${f}::text='qualified' AND e.referred_id IS NOT NULL) OR (${f}::text='pending' AND e.referred_id IS NULL))
        ORDER BY u.created_at DESC, u.telegram_id DESC LIMIT ${REF_PAGE + 1} OFFSET ${offset}`,
    sql`SELECT COUNT(*) FILTER (WHERE e.referred_id IS NOT NULL)::int AS qualified, COUNT(*)::int AS total
        FROM users u LEFT JOIN referral_events e ON e.referred_id=u.telegram_id WHERE u.referrer_id=${String(id)}::bigint`,
  ]);
  return {
    page, filter: f, has_more: rows.length > REF_PAGE,
    qualified: tot[0].qualified, pending: tot[0].total - tot[0].qualified, total: tot[0].total,
    items: rows.slice(0, REF_PAGE).map(r => ({ name: maskName(r.first_name, r.username), qualified: r.qualified, joined: r.created_at })),
  };
};

// ---------------- promo codes ----------------
const FAIL_CAP_BUCKET = "promoFail"; // rate-limit bucket: 20 wrong codes per 12 h per user (see lib/ratelimit.js)
async function failuresSoFar(id) {
  const r = await sql`SELECT hits FROM rate_limits WHERE bucket=${id + ":" + FAIL_CAP_BUCKET}
    AND window_start = to_timestamp((floor(extract(epoch FROM now())/43200)*43200)::double precision)`;
  return r.length ? Number(r[0].hits) : 0;
}

/**
 * Redeem a promo code. Redemption row + code counter + balance + ledger entry are ONE atomic statement.
 *  - per-user limit: UNIQUE(code, telegram_id, n) - two parallel requests cannot take the same slot
 *  - total limit: promo_codes CHECK (redeemed <= total_limit) - the statement fails instead of over-paying
 *  - guessing: 20 wrong codes per 12 h, checked BEFORE the attempt, on top of the normal 5/min rate limit
 */
export const promoRedeem = async ({ id, body }) => {
  const c = await getConfig();
  if (!c.promoEnabled) throw bad("Promo codes are not available right now", "promo_disabled", 403);
  if ((await failuresSoFar(id)) >= 20) throw bad("Too many wrong codes. Please try again later.", "promo_locked", 429);
  const code = normalizePromo(body.code);
  if (!code) { await rateLimit(id, FAIL_CAP_BUCKET).catch(() => {}); throw bad("Invalid promo code", "promo_invalid"); }

  let r;
  try {
    r = await sql`
      WITH p AS (
        SELECT code, reward, per_user_limit FROM promo_codes
        WHERE code=${code}::text AND active=TRUE AND (expires_at IS NULL OR expires_at > NOW()) AND redeemed < total_limit),
      r AS (
        INSERT INTO promo_redemptions(code,telegram_id,n,reward)
        SELECT p.code, ${id}::bigint, m.n + 1, p.reward
        FROM p CROSS JOIN LATERAL (SELECT COUNT(*)::int AS n FROM promo_redemptions x WHERE x.code=p.code AND x.telegram_id=${id}::bigint) m
        WHERE m.n < p.per_user_limit AND EXISTS(SELECT 1 FROM users WHERE telegram_id=${id}::bigint AND is_blocked=FALSE)
        ON CONFLICT DO NOTHING RETURNING code, n, reward),
      pc AS (UPDATE promo_codes SET redeemed=redeemed+1 FROM r WHERE promo_codes.code=r.code RETURNING promo_codes.code),
      u AS (
        UPDATE users SET points=points+r.reward FROM r WHERE users.telegram_id=${id}::bigint
        RETURNING users.points, r.code, r.n, r.reward)
      INSERT INTO transactions(telegram_id,type,points_change,balance_after,description,reference)
      SELECT ${id}::bigint,'Promo Code',u.reward,u.points,'Promo code '||u.code,'promo:'||u.code||':'||${id}::text||':'||u.n::text FROM u
      RETURNING balance_after, points_change`;
  } catch (e) {
    if (e && e.code === "23514") throw bad("This promo code has been fully redeemed", "promo_exhausted"); // CHECK: a parallel redeem took the last slot
    throw e;
  }
  if (!r.length) {
    const p = (await sql`SELECT active, expires_at, redeemed, total_limit, per_user_limit,
        (SELECT COUNT(*)::int FROM promo_redemptions x WHERE x.code=p.code AND x.telegram_id=${id}::bigint) AS mine
        FROM promo_codes p WHERE code=${code}::text`)[0] || null;
    const f = promoFailure(p);
    if (["promo_invalid", "promo_inactive", "promo_expired"].includes(f.code)) await rateLimit(id, FAIL_CAP_BUCKET).catch(() => {});
    throw bad(f.message, f.code);
  }
  try { await syncBadges(id); } catch (e) { console.error("badge sync failed:", e.message); }
  return { code, reward: Number(r[0].points_change), balance: Number(r[0].balance_after) };
};

// ---------------- admin: promo codes ----------------
export const adminPromoList = async () => ({
  items: await sql`SELECT code, reward, per_user_limit, total_limit, redeemed, expires_at, active, note, created_at,
      (expires_at IS NOT NULL AND expires_at <= NOW()) AS expired
    FROM promo_codes ORDER BY created_at DESC LIMIT 100`,
});

export const adminPromoCreate = async ({ id, body }) => {
  const v = validatePromoInput(body);
  if (!v.ok) throw bad(v.error);
  const { code, reward, perUserLimit, totalLimit, expiresDays, note } = v.value;
  const r = await sql`
    INSERT INTO promo_codes(code,reward,per_user_limit,total_limit,expires_at,note,created_by)
    VALUES(${code}::text, ${reward}::bigint, ${perUserLimit}::int, ${totalLimit}::int,
           CASE WHEN ${expiresDays}::int > 0 THEN NOW() + make_interval(days => ${expiresDays}::int) END, ${note || null}::text, ${id}::bigint)
    ON CONFLICT(code) DO NOTHING RETURNING code, expires_at`;
  if (!r.length) throw bad("That code already exists", "duplicate");
  await audit({ actorId: id, action: "promo.create", targetType: "promo", targetId: code, after: { reward, perUserLimit, totalLimit, expiresDays, max_liability: reward * totalLimit } });
  return { code, expires_at: r[0].expires_at, max_liability: reward * totalLimit };
};

export const adminPromoSetActive = async ({ id, body }) => {
  const code = normalizePromo(body.code);
  if (!code || typeof body.active !== "boolean") throw bad("Invalid request");
  const r = await sql`UPDATE promo_codes SET active=${body.active}::boolean WHERE code=${code}::text RETURNING code, active`;
  if (!r.length) throw bad("Promo code not found", "not_found", 404);
  await audit({ actorId: id, action: body.active ? "promo.enable" : "promo.disable", targetType: "promo", targetId: code, reason: String(body.reason || "").slice(0, 200) || null });
  return r[0];
};
