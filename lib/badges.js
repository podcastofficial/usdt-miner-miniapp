// Phase 2 / Part 2: DB side of levels, badges and referral milestones. Every payout is ONE atomic SQL statement.
import { sql } from "./db.js";
import { getConfig } from "./runtime.js";
import { EARN_TYPES, badgesFor, levelFor, dueMilestones, MILESTONES, BADGES, thresholds, milestoneReward } from "./engagement.js";

/** Qualified referrals, lifetime earned Points and best streak for one user. */
export async function userStats(id) {
  const r = await sql`
    SELECT (SELECT COUNT(*) FROM referral_events WHERE referrer_id=${String(id)}::bigint)::int AS qualified,
           (SELECT COALESCE(SUM(points_change),0) FROM transactions
             WHERE telegram_id=${String(id)}::bigint AND points_change>0
               AND type IN (SELECT jsonb_array_elements_text(${JSON.stringify(EARN_TYPES)}::jsonb)))::bigint AS earned,
           (SELECT best_streak FROM streaks WHERE telegram_id=${String(id)}::bigint) AS best_streak`;
  return { qualified: r[0].qualified, earned: Number(r[0].earned), bestStreak: Number(r[0].best_streak || 0) };
}

/** Insert the badges the stats entitle the user to (idempotent). Returns the level too. */
export async function syncBadges(id, stats = null) {
  const c = await getConfig();
  const s = stats || await userStats(id);
  const level = levelFor(s.earned, thresholds(c));
  const want = badgesFor({ bestStreak: s.bestStreak, qualified: s.qualified, levelIndex: level.index });
  if (want.length) await sql`INSERT INTO badges(telegram_id,code) SELECT ${String(id)}::bigint, t.c FROM jsonb_array_elements_text(${JSON.stringify(want)}::jsonb) AS t(c) ON CONFLICT DO NOTHING`;
  return { level, stats: s };
}

export async function listBadges(id) {
  const rows = await sql`SELECT code, earned_at FROM badges WHERE telegram_id=${String(id)}::bigint`;
  const got = new Map(rows.map(r => [r.code, r.earned_at]));
  return Object.entries(BADGES).map(([code, b]) => ({ code, icon: b.icon, name: b.name, help: b.help, earned: got.has(code), earned_at: got.get(code) || null }));
}

/**
 * Pay every referral milestone the inviter has reached and not been paid for. Safe to call any number of times:
 * the milestones_paid PRIMARY KEY + the ledger reference make each milestone pay exactly once.
 * Does nothing while `milestones_enabled` is OFF. Returns [{ milestone, reward }] of what was paid by THIS call.
 */
export async function payMilestones(referrerId) {
  const c = await getConfig();
  if (!c.milestonesEnabled) return [];
  const id = String(referrerId);
  const q = await sql`SELECT (SELECT COUNT(*) FROM referral_events WHERE referrer_id=${id}::bigint)::int AS qualified,
                             COALESCE((SELECT jsonb_agg(milestone) FROM milestones_paid WHERE referrer_id=${id}::bigint),'[]'::jsonb) AS paid`;
  const paid = (q[0].paid || []).map(Number);
  const out = [];
  for (const n of dueMilestones(q[0].qualified, paid)) {
    const reward = milestoneReward(c, n);
    if (!Number.isSafeInteger(reward) || reward <= 0) continue;
    const r = await sql`
      WITH m AS (
        INSERT INTO milestones_paid(referrer_id,milestone,reward)
        SELECT telegram_id, ${n}::int, ${reward}::bigint FROM users WHERE telegram_id=${id}::bigint AND is_blocked=FALSE
        ON CONFLICT DO NOTHING RETURNING referrer_id, milestone, reward),
      u AS (
        UPDATE users SET points=points+m.reward FROM m WHERE users.telegram_id=m.referrer_id
        RETURNING users.telegram_id, users.points, m.milestone, m.reward)
      INSERT INTO transactions(telegram_id,type,points_change,balance_after,description,reference)
      SELECT telegram_id,'Milestone Reward',reward,points,'Referral milestone: '||milestone::text||' referrals','milestone:'||telegram_id::text||':'||milestone::text FROM u
      RETURNING points_change`;
    if (r.length) out.push({ milestone: n, reward });
  }
  return out;
}
