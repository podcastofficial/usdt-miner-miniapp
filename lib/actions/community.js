// Part 6: Community - paginated leaderboard, Advertise (campaigns), Official Channel info, Payment Proof, admin proof moderation.
import { sql } from "../db.js";
import { HttpError } from "../http.js";
import { audit } from "../audit.js";
import { getConfig } from "../runtime.js";
import {
  LB_PAGE_SIZE, LB_MAX_PAGES, PROOF_PAGE_SIZE, publicName, maskName, pageWindow, channelUrl, supportUrl, txUrl, money2, validateCampaign,
} from "../community.js";
import { closeCampaign } from "../campaigns.js";
import { channelFromLink, botAdminStatus, botAdminLink, botAdminMessage } from "../telegram.js";
import { notifyAdmins, campaignText } from "../adminNotify.js";

const bad = (msg, code = "bad_request", status = 400) => new HttpError(status, code, msg);
const posInt = (v) => { const n = Number(v); return Number.isSafeInteger(n) && n > 0 ? n : null; };

// ---------------- community info (Official Channel + How to Use use the live numbers) ----------------
export const communityInfo = async () => {
  const c = await getConfig();
  return {
    bot: c.botUsername,
    officialChannel: { name: c.officialChannel, url: channelUrl(c.officialChannel) },
    paymentsChannel: { name: c.paymentsChannel, url: channelUrl(c.paymentsChannel) },
    support: supportUrl(c.supportLink),
    requiredChannels: c.requiredChannels,
    proofPublic: c.proofPublic,
    rates: {
      pointsPerUsdt: c.pointsPerUsdt, minWithdraw: c.minWithdrawUsdt, feePercent: c.withdrawFeePercent, maxOpenWithdrawals: c.maxOpenWithdrawals,
      dailyReward: c.dailyReward, referralReward: c.referralReward, withdrawalsEnabled: c.withdrawalsEnabled,
      depositsEnabled: c.depositsEnabled && Boolean(c.depositWallet), minDeposit: c.minDepositUsdt,
    },
    ads: { enabled: c.adsEnabled, minReward: c.adMinReward, minTarget: c.adMinTarget, maxPending: c.adMaxPending, userSharePct: c.adUserSharePct },
    games: { enabled: c.gamesEnabled, drawEnabled: c.luckyDrawEnabled, boosterEnabled: c.boosterEnabled },
  };
};

// ---------------- leaderboard (paginated, top 200) ----------------
export const leaderboard = async ({ id, body, query }) => {
  const { page, offset, size } = pageWindow(body.page ?? query.page);
  const [cfg, rows, me, total] = await Promise.all([
    getConfig(),
    sql`SELECT u.telegram_id, u.first_name, u.username, u.points,
               (SELECT COUNT(*)::int FROM referral_events r WHERE r.referrer_id = u.telegram_id) AS refs
        FROM users u WHERE u.is_blocked=FALSE
        ORDER BY u.points DESC, u.created_at ASC, u.telegram_id ASC LIMIT ${size + 1}::int OFFSET ${offset}::int`,
    sql`SELECT m.points, (SELECT COUNT(*)::int + 1 FROM users u
          WHERE u.is_blocked=FALSE AND (u.points > m.points
            OR (u.points = m.points AND (u.created_at < m.created_at OR (u.created_at = m.created_at AND u.telegram_id < m.telegram_id))))) AS rank
        FROM users m WHERE m.telegram_id=${id}::bigint`,
    sql`SELECT COUNT(*)::int AS n FROM users WHERE is_blocked=FALSE`,
  ]);
  const items = rows.slice(0, size).map((u, i) => {
    const mine = String(u.telegram_id) === String(id);
    // Other users are masked (e.g. "Ra***"); a user always sees their own name in full.
    const name = cfg.leaderboardMaskNames && !mine ? maskName(u.first_name, u.username) : publicName(u.first_name, u.username);
    const item = { rank: offset + i + 1, name, points: Number(u.points), me: mine };
    if (cfg.leaderboardShowReferrals) item.refs = Number(u.refs) || 0;
    return item;
  });
  const shown = Math.min(total[0].n, LB_PAGE_SIZE * LB_MAX_PAGES);
  return {
    items, page, pages: Math.max(1, Math.ceil(shown / size)), total: total[0].n, hasMore: rows.length > size && page < LB_MAX_PAGES,
    me: me.length ? { rank: me[0].rank, points: Number(me[0].points) } : null,
  };
};

// ---------------- Advertise ----------------
export const campaignList = async ({ id, row }) => {
  const [c, items] = await Promise.all([getConfig(), sql`
    SELECT c.id, c.type, c.title, c.link, c.reward, c.target, c.status, c.reject_reason, c.created_at, COALESCE(t.completed, 0)::int AS completed,
           c.spent, GREATEST(c.reward*c.target - c.spent, 0) AS unused
    FROM campaigns c LEFT JOIN tasks t ON t.id=c.task_id
    WHERE c.owner_id=${id}::bigint ORDER BY c.id DESC LIMIT 30`]);
  return {
    items,
    info: { enabled: c.adsEnabled, minReward: c.adMinReward, minTarget: c.adMinTarget, maxPending: c.adMaxPending, userSharePct: c.adUserSharePct,
            pending: items.filter(x => x.status === "pending").length, points: Number(row.points) },
  };
};

/** Debit budget + create campaign + ledger entry in ONE atomic statement (no lost Points if anything fails). */
/** Is the bot an admin of the channel in this link? Also returns the one-tap "Make bot admin" link. Used by the campaign form and the admin task form. */
export const channelBotCheck = async ({ body }) => {
  const c = await getConfig();
  const ch = channelFromLink(body.link || body.channel);
  const addUrl = botAdminLink(c.botUsername);
  if (!ch) return { channel: null, admin: false, reason: "no_channel", addUrl, message: "Enter your public channel link first (https://t.me/YourChannel)." };
  const r = await botAdminStatus(ch);
  return { channel: ch, admin: r.admin, reason: r.reason, addUrl, message: r.admin ? "✅ Bot is admin in " + ch : botAdminMessage(ch, r.reason) };
};

export const campaignCreate = async ({ id, row, body }) => {
  const c = await getConfig();
  if (!c.adsEnabled) throw bad("Advertising is temporarily paused", "ads_paused", 503);
  const v = validateCampaign(body, c);
  if (!v.ok) throw bad(v.error);
  const { type, title, link, reward, target, budget } = v.value;
  if (type === "channel") { // the bot must already be admin in the channel, otherwise nobody's join can be verified
    const ch = channelFromLink(link), st = await botAdminStatus(ch);
    if (!st.admin) throw bad(botAdminMessage(ch, st.reason), st.reason === "unavailable" ? "verification_unavailable" : "bot_not_admin", st.reason === "unavailable" ? 503 : 409);
  }
  const r = await sql`
    WITH u AS (
      UPDATE users SET points=points-${budget}::bigint
      WHERE telegram_id=${id}::bigint AND is_blocked=FALSE AND points>=${budget}::bigint
        AND (SELECT COUNT(*) FROM campaigns WHERE owner_id=${id}::bigint AND status='pending') < ${c.adMaxPending}::int
      RETURNING telegram_id, points),
    c AS (
      INSERT INTO campaigns(owner_id,type,title,link,reward,target,status)
      SELECT telegram_id, ${type}::text, ${title}::text, ${link}::text, ${reward}::bigint, ${target}::int, 'pending' FROM u RETURNING id),
    t AS (
      INSERT INTO transactions(telegram_id,type,points_change,balance_after,description,reference)
      SELECT u.telegram_id, 'Campaign Budget', -${budget}::bigint, u.points, 'Campaign #'||c.id::text, 'cmpbudget:'||c.id::text FROM u, c RETURNING 1)
    SELECT c.id, u.points AS balance FROM c, u`;
  if (r.length) {
    await notifyAdmins("cmp_new", r[0].id, campaignText("new", { id: r[0].id, title, type, link, reward, target }, row, type === "channel" ? "Bot admin check: ✅ passed" : ""));
    return { id: r[0].id, status: "pending", budget, balance: Number(r[0].balance) };
  }
  // Nothing was written: work out why, so the user gets a useful message.
  const st = (await sql`SELECT points, (SELECT COUNT(*) FROM campaigns WHERE owner_id=${id}::bigint AND status='pending')::int AS pending FROM users WHERE telegram_id=${id}::bigint`)[0];
  if (st && st.pending >= c.adMaxPending) throw bad(`You can have at most ${c.adMaxPending} campaigns waiting for review`, "too_many_pending", 409);
  if (st && Number(st.points) < budget) throw bad("Insufficient Points for this budget", "insufficient_points");
  throw bad("Campaign could not be created, please try again", "conflict", 409);
};

/** Owner stops a campaign: pending -> cancelled (full budget back), active -> cancelled (the unused part back). Refunded exactly once (ref cmprefund:<id>). */
export const campaignCancel = async ({ id, row, body }) => {
  const cid = posInt(body.id);
  if (!cid) throw bad("Invalid request");
  const cur = (await sql`SELECT id, status, title, type, link, reward, target FROM campaigns WHERE id=${cid}::bigint AND owner_id=${id}::bigint AND status IN ('pending','active')`)[0];
  if (!cur) throw bad("Only campaigns that are waiting for review or running can be stopped", "invalid_state", 409);
  const r = await closeCampaign({ cid, from: cur.status, to: "cancelled", reason: "Cancelled by owner", reviewer: null, ownerId: id });
  await notifyAdmins("cmp_cancel", cid, campaignText("cancelled", cur, row, "Refunded to owner: " + Number(r.refunded_points).toLocaleString("en-US") + " Points"));
  return { id: cid, status: "cancelled", refunded_points: r.refunded_points };
};

// ---------------- Payment Proof ----------------
export const proofList = async ({ body }) => {
  const c = await getConfig();
  const channel = channelUrl(c.paymentsChannel);
  if (!c.proofPublic) return { enabled: false, items: [], next: null, stats: null, channel };
  const before = posInt(body.before);
  const [rows, stats] = await Promise.all([
    sql`SELECT w.id, w.net_usdt::text AS net, w.paid_at, w.tx_hash, u.first_name, u.username
        FROM withdrawals w JOIN users u ON u.telegram_id=w.telegram_id
        WHERE w.status='paid' AND w.tx_hash IS NOT NULL AND w.proof_hidden=FALSE AND (${before}::bigint IS NULL OR w.id < ${before}::bigint)
        ORDER BY w.id DESC LIMIT ${PROOF_PAGE_SIZE + 1}::int`,
    before ? Promise.resolve(null) : sql`SELECT COALESCE(SUM(net_usdt),0)::text AS paid, COUNT(*)::int AS payouts, (SELECT COUNT(*) FROM users)::int AS members
        FROM withdrawals WHERE status='paid'`,
  ]);
  const page = rows.slice(0, PROOF_PAGE_SIZE);
  return {
    enabled: true, channel,
    stats: stats ? { paid_usdt: money2(stats[0].paid), payouts: stats[0].payouts, members: stats[0].members } : null,
    items: page.map(w => ({ id: w.id, name: maskName(w.first_name, w.username), amount: money2(w.net), paid_at: w.paid_at, tx: w.tx_hash, url: txUrl(w.tx_hash) })),
    next: rows.length > PROOF_PAGE_SIZE ? page[page.length - 1].id : null,
  };
};

// ---------------- admin: proof moderation ----------------
export const adminProofList = async ({ body }) => {
  const before = posInt(body.before);
  const rows = await sql`
    SELECT w.id, w.net_usdt::text AS net, w.paid_at, w.tx_hash, w.proof_hidden, u.first_name, u.username
    FROM withdrawals w JOIN users u ON u.telegram_id=w.telegram_id
    WHERE w.status='paid' AND (${before}::bigint IS NULL OR w.id < ${before}::bigint)
    ORDER BY w.id DESC LIMIT 31`;
  const items = rows.slice(0, 30).map(w => ({ id: w.id, name: maskName(w.first_name, w.username), amount: money2(w.net), paid_at: w.paid_at, tx: w.tx_hash, hidden: w.proof_hidden }));
  return { items, next: rows.length > 30 ? items[items.length - 1].id : null };
};

export const adminProofHide = async ({ id, body }) => {
  const wid = posInt(body.id);
  if (!wid || typeof body.hidden !== "boolean") throw bad("Invalid request");
  const r = await sql`UPDATE withdrawals SET proof_hidden=${body.hidden}::boolean WHERE id=${wid}::bigint AND status='paid' RETURNING id, proof_hidden`;
  if (!r.length) throw bad("Only paid withdrawals can be shown as proof", "invalid_state", 409);
  await audit({ actorId: id, action: body.hidden ? "proof.hide" : "proof.show", targetType: "withdrawal", targetId: wid });
  return r[0];
};
