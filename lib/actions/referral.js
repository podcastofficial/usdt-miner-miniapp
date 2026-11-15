// Part 3: referral link/stats, required-channel verification, exactly-once reward, abuse logging.
import { sql } from "../db.js";
import { HttpError } from "../http.js";
import { getSetting } from "../settings.js";
import { getConfig } from "../runtime.js";
import { chatMemberStatus, isMemberStatus, isChannelName, channelTitles } from "../telegram.js";
import { notifyReferral } from "../notify.js";
import { payMilestones, syncBadges } from "../badges.js";

const BURST_LIMIT = 10; // qualified referrals within one hour that get flagged for admin review (logged only, not blocked)

/** Referral link opens the BOT chat (Start button). The webhook records the inviter on /start (lib/actions/notify.js), then offers the Open button. */
export function referralLink(code, c) {
  return `https://t.me/${c.botUsername}?start=ref_${code}`;
}

export const referral = async ({ id, row }) => {
  const [c, reward, cfg] = await Promise.all([
    sql`SELECT COUNT(*) FILTER (WHERE e.referred_id IS NOT NULL)::int AS qualified, COUNT(*)::int AS total
        FROM users u LEFT JOIN referral_events e ON e.referred_id=u.telegram_id WHERE u.referrer_id=${id}::bigint`,
    getSetting("referral_reward", 1000),
    getConfig(),
  ]);
  return {
    link: referralLink(row.referral_code, cfg), code: row.referral_code,
    qualified: c[0].qualified, pending: c[0].total - c[0].qualified, reward: Number(reward) || 1000,
  };
};

/**
 * The referred user proves membership of every required channel. Only then the inviter gets the reward — once.
 * Reward = event row (UNIQUE referred_id) + balance + ledger entry in ONE atomic statement.
 */
export const referralVerify = async ({ id }) => {
  const st = (await sql`SELECT u.membership_verified, u.referrer_id,
      EXISTS(SELECT 1 FROM referral_events e WHERE e.referred_id=u.telegram_id) AS rewarded
      FROM users u WHERE u.telegram_id=${id}::bigint`)[0];
  if (st.membership_verified && (!st.referrer_id || st.rewarded)) return { verified: true, missing: [], reward_granted: st.rewarded };

  const cfg = await getSetting("required_channels", ["@USDTMinerUpdates", "@USDTMinerPayments"]);
  const channels = (Array.isArray(cfg) ? cfg : []).filter(isChannelName);
  if (!channels.length) throw new HttpError(503, "task_misconfigured", "Required channels are not configured");

  const missing = [];
  for (const ch of channels) if (!isMemberStatus(await chatMemberStatus(ch, id))) missing.push(ch);
  if (missing.length) return { verified: false, missing, titles: await channelTitles(missing) };

  await sql`UPDATE users SET membership_verified=TRUE WHERE telegram_id=${id}::bigint`;
  let granted = false;
  if (st.referrer_id && !st.rewarded) {
    const reward = Number(await getSetting("referral_reward", 1000)) || 1000;
    const v = JSON.stringify({ channels, verified_at: new Date().toISOString() });
    const r = await sql`
      WITH me AS (SELECT telegram_id, referrer_id FROM users WHERE telegram_id=${id}::bigint AND is_blocked=FALSE AND referrer_id IS NOT NULL),
      ev AS (
        INSERT INTO referral_events(referrer_id,referred_id,reward,verification)
        SELECT me.referrer_id, me.telegram_id, ${reward}::bigint, ${v}::jsonb FROM me
        WHERE EXISTS(SELECT 1 FROM users r WHERE r.telegram_id=me.referrer_id AND r.is_blocked=FALSE)
        ON CONFLICT(referred_id) DO NOTHING RETURNING referrer_id, referred_id),
      u AS (
        UPDATE users SET points=points+${reward}::bigint FROM ev WHERE users.telegram_id=ev.referrer_id
        RETURNING users.telegram_id, users.points, ev.referred_id)
      INSERT INTO transactions(telegram_id,type,points_change,balance_after,description,reference)
      SELECT telegram_id,'Referral Reward',${reward}::bigint,points,'Referral reward','referral:'||referred_id::text FROM u
      RETURNING telegram_id`;
    granted = r.length > 0;
    if (granted) {
      await notifyReferral({ referrerId: st.referrer_id, referredId: id, reward }); // never throws
      try { await payMilestones(st.referrer_id); await syncBadges(st.referrer_id); } // milestone bonus (if ON) + badges; never undoes the referral reward
      catch (e) { console.error("milestone/badge update failed:", e.message); }
      const n = await sql`SELECT COUNT(*)::int AS n FROM referral_events WHERE referrer_id=${String(st.referrer_id)}::bigint AND qualified_at > NOW() - INTERVAL '1 hour'`;
      if (n[0].n >= BURST_LIMIT)
        await sql`INSERT INTO abuse_events(user_id,kind,detail) VALUES(${String(st.referrer_id)}::bigint,'referral_burst',${JSON.stringify({ last_hour: n[0].n, latest_referred: String(id) })}::jsonb)`;
    }
  }
  return { verified: true, missing: [], reward_granted: granted };
};

export const adminAbuseEvents = async () => ({
  events: await sql`SELECT id,user_id,kind,detail,created_at FROM abuse_events ORDER BY id DESC LIMIT 50`,
});
