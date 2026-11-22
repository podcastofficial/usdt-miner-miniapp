// Part 28: dedicated Admin Panel API - users directory, full user profile + activity timeline, global activity feed.
// Read-only. Every action needs the "users_read" permission (checked server-side in api/index.js via lib/roles.js).
import { sql } from "../db.js";
import { HttpError } from "../http.js";
import { getConfig } from "../runtime.js";

const bad = (m, c = "bad_request", s = 400) => new HttpError(s, c, m);
const uid = (v) => { const s = String(v ?? "").trim(); return /^\d{1,15}$/.test(s) && Number(s) > 0 ? s : null; };
const FILTERS = ["all", "active24h", "active7d", "new24h", "new7d", "blocked", "withdrew", "referrers", "miners", "admins", "botblocked"];
const SORTS = ["newest", "oldest", "active", "points"];
const PAGE = 20;
const safe = async (p, fallback) => { try { return await p; } catch (e) { console.error("admin panel (optional section failed):", e.message); return fallback; } };

// ---------------- users directory (search + filter + sort + pages) ----------------
export const adminUsersDirectory = async ({ body }) => {
  const raw = String(body.q || "").trim().replace(/^@/, "").slice(0, 64);
  const num = /^\d{1,15}$/.test(raw) ? raw : null;
  const like = "%" + raw.replace(/[\\%_]/g, "\\$&") + "%";
  const f = FILTERS.includes(body.filter) ? body.filter : "all";
  const sort = SORTS.includes(body.sort) ? body.sort : "newest";
  const page = Math.min(Math.max(Number.isInteger(Number(body.page)) ? Number(body.page) : 0, 0), 5000);
  const offset = page * PAGE;

  const rows = await sql`
    SELECT p.*,
      (SELECT COUNT(*) FROM users r WHERE r.referrer_id=p.telegram_id)::int AS invited,
      (SELECT COUNT(*) FROM referral_events e WHERE e.referrer_id=p.telegram_id)::int AS qualified,
      (SELECT COALESCE(SUM(w.net_usdt),0) FROM withdrawals w WHERE w.telegram_id=p.telegram_id AND w.status='paid')::text AS withdrawn_usdt,
      (SELECT COALESCE(SUM(d.amount_usdt),0) FROM deposits d WHERE d.telegram_id=p.telegram_id AND d.status='confirmed')::text AS deposited_usdt,
      (SELECT COUNT(*) FROM transactions t WHERE t.telegram_id=p.telegram_id)::int AS tx_count
    FROM (
      SELECT u.telegram_id, u.username, u.first_name, u.last_name, u.points, u.is_blocked, u.is_admin, u.bot_blocked,
             u.membership_verified, u.referrer_id, u.language_code, u.created_at, u.last_active_at,
             (COUNT(*) OVER())::int AS total
      FROM users u
      WHERE (${raw}::text = '' OR (${num}::text IS NOT NULL AND u.telegram_id=${num}::bigint)
             OR u.username ILIKE ${like}::text OR u.first_name ILIKE ${like}::text OR u.referral_code = ${raw}::text)
        AND (${f}::text = 'all'
          OR (${f}::text = 'active24h' AND u.last_active_at > NOW() - INTERVAL '24 hours')
          OR (${f}::text = 'active7d' AND u.last_active_at > NOW() - INTERVAL '7 days')
          OR (${f}::text = 'new24h' AND u.created_at > NOW() - INTERVAL '24 hours')
          OR (${f}::text = 'new7d' AND u.created_at > NOW() - INTERVAL '7 days')
          OR (${f}::text = 'blocked' AND u.is_blocked)
          OR (${f}::text = 'admins' AND u.is_admin)
          OR (${f}::text = 'botblocked' AND u.bot_blocked)
          OR (${f}::text = 'withdrew' AND EXISTS(SELECT 1 FROM withdrawals w WHERE w.telegram_id=u.telegram_id AND w.status='paid'))
          OR (${f}::text = 'referrers' AND EXISTS(SELECT 1 FROM referral_events e WHERE e.referrer_id=u.telegram_id))
          OR (${f}::text = 'miners' AND EXISTS(SELECT 1 FROM auto_miners m WHERE m.telegram_id=u.telegram_id)))
      ORDER BY (CASE WHEN ${sort}::text = 'points' THEN u.points END) DESC NULLS LAST,
               (CASE WHEN ${sort}::text = 'active' THEN u.last_active_at END) DESC NULLS LAST,
               (CASE WHEN ${sort}::text = 'oldest' THEN u.created_at END) ASC NULLS LAST,
               u.created_at DESC
      LIMIT ${PAGE} OFFSET ${offset}::int
    ) p`;
  const total = rows.length ? rows[0].total : 0;
  const items = rows.map(({ total: _t, ...r }) => r);
  // keep the SQL order (the outer SELECT may reorder): sort again in JS the same way
  const cmp = { points: (a, b) => Number(b.points) - Number(a.points), active: (a, b) => new Date(b.last_active_at) - new Date(a.last_active_at), oldest: (a, b) => new Date(a.created_at) - new Date(b.created_at), newest: (a, b) => new Date(b.created_at) - new Date(a.created_at) }[sort];
  items.sort(cmp);
  return { items, total, page, pageSize: PAGE, hasMore: offset + items.length < total };
};

// ---------------- summary numbers for the panel's Dashboard ----------------
export const adminPanelSummary = async () => {
  const [s] = await sql`
    SELECT (SELECT COUNT(*) FROM users)::int AS users,
      (SELECT COUNT(*) FROM users WHERE created_at > NOW()-INTERVAL '24 hours')::int AS new_24h,
      (SELECT COUNT(*) FROM users WHERE created_at > NOW()-INTERVAL '7 days')::int AS new_7d,
      (SELECT COUNT(*) FROM users WHERE last_active_at > NOW()-INTERVAL '24 hours')::int AS active_24h,
      (SELECT COUNT(*) FROM users WHERE last_active_at > NOW()-INTERVAL '7 days')::int AS active_7d,
      (SELECT COUNT(*) FROM users WHERE is_blocked)::int AS blocked,
      (SELECT COUNT(*) FROM users WHERE bot_blocked)::int AS bot_blocked,
      (SELECT COALESCE(SUM(points),0) FROM users)::text AS points_total,
      (SELECT COUNT(*) FROM transactions WHERE created_at > NOW()-INTERVAL '24 hours')::int AS tx_24h,
      (SELECT COUNT(*) FROM withdrawals WHERE status IN ('pending','approved'))::int AS open_withdrawals,
      (SELECT COALESCE(SUM(net_usdt),0) FROM withdrawals WHERE status='paid')::text AS paid_usdt,
      (SELECT COUNT(*) FROM deposits WHERE status='verified')::int AS deposits_waiting,
      (SELECT COALESCE(SUM(amount_usdt),0) FROM deposits WHERE status='confirmed')::text AS deposited_usdt,
      (SELECT COUNT(*) FROM task_proofs WHERE status='pending')::int AS proofs_pending,
      (SELECT COUNT(*) FROM support_tickets WHERE status='open')::int AS tickets_open,
      (SELECT COUNT(*) FROM referral_events)::int AS referrals_qualified`;
  const joins = await safe(sql`
    SELECT d::date::text AS day, COUNT(u.telegram_id)::int AS new_users
    FROM generate_series((NOW() - INTERVAL '6 days')::date, NOW()::date, INTERVAL '1 day') d
    LEFT JOIN users u ON u.created_at::date = d::date
    GROUP BY d ORDER BY d`, []);
  return { ...s, daily_joins: joins };
};

// ---------------- full profile of ONE user + timeline ----------------
export const adminUserFull = async ({ body }) => {
  const id = uid(body.userId);
  if (!id) throw bad("Invalid user id");
  const limit = Math.min(Math.max(Number(body.limit) || 40, 10), 100);
  const before = body.before && !Number.isNaN(Date.parse(body.before)) ? new Date(body.before).toISOString() : new Date(Date.now() + 864e5).toISOString();

  const u = await sql`
    SELECT telegram_id,username,first_name,last_name,language_code,user_lang,points,ad_credits,referrer_id,referral_code,
           membership_verified,is_blocked,blocked_reason,blocked_at,is_admin,bot_blocked,booster_until,booster_pct,
           terms_version_accepted,terms_accepted_at,signup_start_param,created_at,last_active_at
    FROM users WHERE telegram_id=${id}::bigint`;
  if (!u.length) throw bad("User not found", "not_found", 404);

  const [stats, referrer, referrals, wallets, miners, notes, risk, timeline] = await Promise.all([
    sql`SELECT
      (SELECT COALESCE(SUM(points_change),0) FROM transactions WHERE telegram_id=${id}::bigint AND points_change>0)::text AS earned,
      (SELECT COALESCE(-SUM(points_change),0) FROM transactions WHERE telegram_id=${id}::bigint AND points_change<0)::text AS spent,
      (SELECT COUNT(*) FROM transactions WHERE telegram_id=${id}::bigint)::int AS tx_count,
      (SELECT COUNT(*) FROM task_completions WHERE telegram_id=${id}::bigint)::int AS tasks_done,
      (SELECT COUNT(*) FROM game_plays WHERE telegram_id=${id}::bigint)::int AS games_played,
      (SELECT COUNT(*) FROM promo_redemptions WHERE telegram_id=${id}::bigint)::int AS promos_used,
      (SELECT COUNT(*) FROM transactions WHERE telegram_id=${id}::bigint AND type='Ad Reward')::int AS ads_watched,
      (SELECT COUNT(*) FROM transactions WHERE telegram_id=${id}::bigint AND type='Ad Reward' AND created_at >= (date_trunc('day', NOW() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'))::int AS ads_today,
      (SELECT COUNT(*) FROM daily_claims WHERE telegram_id=${id}::bigint)::int AS daily_claims,
      (SELECT COUNT(*) FROM users WHERE referrer_id=${id}::bigint)::int AS invited,
      (SELECT COUNT(*) FROM referral_events WHERE referrer_id=${id}::bigint)::int AS qualified,
      (SELECT COALESCE(SUM(net_usdt),0) FROM withdrawals WHERE telegram_id=${id}::bigint AND status='paid')::text AS withdrawn_usdt,
      (SELECT COALESCE(SUM(net_usdt),0) FROM withdrawals WHERE telegram_id=${id}::bigint AND status IN ('pending','approved'))::text AS pending_withdraw_usdt,
      (SELECT COUNT(*) FROM withdrawals WHERE telegram_id=${id}::bigint)::int AS withdraw_count,
      (SELECT COALESCE(SUM(amount_usdt),0) FROM deposits WHERE telegram_id=${id}::bigint AND status='confirmed')::text AS deposited_usdt,
      (SELECT COUNT(*) FROM deposits WHERE telegram_id=${id}::bigint)::int AS deposit_count,
      (SELECT COUNT(*) FROM task_proofs WHERE telegram_id=${id}::bigint)::int AS proofs,
      (SELECT COUNT(*) FROM support_tickets WHERE telegram_id=${id}::bigint)::int AS tickets`,
    u[0].referrer_id ? sql`SELECT telegram_id,username,first_name FROM users WHERE telegram_id=${String(u[0].referrer_id)}::bigint` : Promise.resolve([]),
    sql`SELECT x.telegram_id,x.username,x.first_name,x.created_at,x.last_active_at,(e.referred_id IS NOT NULL) AS qualified
        FROM users x LEFT JOIN referral_events e ON e.referred_id=x.telegram_id
        WHERE x.referrer_id=${id}::bigint ORDER BY x.created_at DESC LIMIT 20`,
    safe(sql`SELECT address,first_seen_at FROM wallet_addresses WHERE telegram_id=${id}::bigint ORDER BY first_seen_at DESC LIMIT 10`, []),
    safe(sql`SELECT id,plan_name,price_paid,rate_per_hour,started_at,ends_at,total_claimed FROM auto_miners WHERE telegram_id=${id}::bigint ORDER BY id DESC LIMIT 10`, []),
    safe(sql`SELECT id,author_id,note,created_at FROM admin_user_notes WHERE telegram_id=${id}::bigint ORDER BY id DESC LIMIT 10`, []),
    safe(sql`SELECT score,band,signals,calculated_at FROM user_risk_scores WHERE telegram_id=${id}::bigint`, []),
    // Unified timeline. The ledger (transactions) already holds every Points movement (tasks, games, promo, daily, miner...);
    // the other branches add the events the ledger does not show (money requests, proofs, tickets, referrals, joining).
    sql`SELECT * FROM (
      SELECT 'ledger'::text AS kind, t.type AS title, COALESCE(t.description,'') AS detail, t.points_change::text AS amount, NULL::text AS status, t.created_at AS happened_at
        FROM transactions t WHERE t.telegram_id=${id}::bigint AND t.created_at < ${before}::timestamptz
      UNION ALL
      SELECT 'withdraw', 'Withdrawal #' || w.id, COALESCE(w.net_usdt::text,'') || ' USDT net · wallet ' || COALESCE(left(w.wallet_address,8) || '…' || right(w.wallet_address,6),'-'), w.amount_usdt::text, w.status, w.created_at
        FROM withdrawals w WHERE w.telegram_id=${id}::bigint AND w.created_at < ${before}::timestamptz
      UNION ALL
      SELECT 'deposit', 'Deposit #' || d.id, COALESCE(left(d.tx_hash,10) || '…','manual'), d.amount_usdt::text, d.status, d.created_at
        FROM deposits d WHERE d.telegram_id=${id}::bigint AND d.created_at < ${before}::timestamptz
      UNION ALL
      SELECT 'proof', 'Task proof #' || p.id, COALESCE(p.reject_reason,''), p.reward::text, p.status, p.created_at
        FROM task_proofs p WHERE p.telegram_id=${id}::bigint AND p.created_at < ${before}::timestamptz
      UNION ALL
      SELECT 'support', 'Support: ' || s.subject, left(s.message,120), NULL, s.status, s.created_at
        FROM support_tickets s WHERE s.telegram_id=${id}::bigint AND s.created_at < ${before}::timestamptz
      UNION ALL
      SELECT 'referral', 'Invited friend qualified', 'Friend ID ' || e.referred_id, NULL, NULL, e.qualified_at
        FROM referral_events e WHERE e.referrer_id=${id}::bigint AND e.qualified_at < ${before}::timestamptz
      UNION ALL
      SELECT 'join', 'Joined the app', COALESCE('start param: ' || u2.signup_start_param,''), NULL, NULL, u2.created_at
        FROM users u2 WHERE u2.telegram_id=${id}::bigint AND u2.created_at < ${before}::timestamptz
    ) x ORDER BY happened_at DESC LIMIT ${limit}::int`,
  ]);
  return {
    user: u[0], stats: stats[0], referrer: referrer[0] || null, referrals, wallets, miners, notes, risk: risk[0] || null,
    timeline, nextBefore: timeline.length === limit ? timeline[timeline.length - 1].happened_at : null,
  };
};

// ---------------- global activity feed (all users, newest first) ----------------
const KINDS = ["all", "ledger", "join", "withdraw", "deposit", "proof", "support"];
export const adminActivityFeed = async ({ body }) => {
  const kind = KINDS.includes(body.kind) ? body.kind : "all";
  const limit = Math.min(Math.max(Number(body.limit) || 40, 10), 100);
  const before = body.before && !Number.isNaN(Date.parse(body.before)) ? new Date(body.before).toISOString() : new Date(Date.now() + 864e5).toISOString();
  const items = await sql`
    SELECT x.*, u.username, u.first_name FROM (
      SELECT * FROM (
        SELECT 'ledger'::text AS kind, t.telegram_id, t.type AS title, COALESCE(t.description,'') AS detail, t.points_change::text AS amount, NULL::text AS status, t.created_at AS happened_at
          FROM transactions t WHERE ${kind}::text IN ('all','ledger') AND t.created_at < ${before}::timestamptz ORDER BY t.created_at DESC LIMIT ${limit}::int) a
      UNION ALL
      SELECT * FROM (
        SELECT 'join', u1.telegram_id, 'New user joined', COALESCE('start param: ' || u1.signup_start_param,''), NULL, NULL, u1.created_at
          FROM users u1 WHERE ${kind}::text IN ('all','join') AND u1.created_at < ${before}::timestamptz ORDER BY u1.created_at DESC LIMIT ${limit}::int) b
      UNION ALL
      SELECT * FROM (
        SELECT 'withdraw', w.telegram_id, 'Withdrawal #' || w.id, COALESCE(w.net_usdt::text,'') || ' USDT net', w.amount_usdt::text, w.status, w.created_at
          FROM withdrawals w WHERE ${kind}::text IN ('all','withdraw') AND w.created_at < ${before}::timestamptz ORDER BY w.created_at DESC LIMIT ${limit}::int) c
      UNION ALL
      SELECT * FROM (
        SELECT 'deposit', d.telegram_id, 'Deposit #' || d.id, COALESCE(left(d.tx_hash,10) || '…','manual'), d.amount_usdt::text, d.status, d.created_at
          FROM deposits d WHERE ${kind}::text IN ('all','deposit') AND d.created_at < ${before}::timestamptz ORDER BY d.created_at DESC LIMIT ${limit}::int) d2
      UNION ALL
      SELECT * FROM (
        SELECT 'proof', p.telegram_id, 'Task proof #' || p.id, COALESCE(p.reject_reason,''), p.reward::text, p.status, p.created_at
          FROM task_proofs p WHERE ${kind}::text IN ('all','proof') AND p.created_at < ${before}::timestamptz ORDER BY p.created_at DESC LIMIT ${limit}::int) e
      UNION ALL
      SELECT * FROM (
        SELECT 'support', s.telegram_id, 'Support: ' || s.subject, left(s.message,120), NULL, s.status, s.created_at
          FROM support_tickets s WHERE ${kind}::text IN ('all','support') AND s.created_at < ${before}::timestamptz ORDER BY s.created_at DESC LIMIT ${limit}::int) f
    ) x LEFT JOIN users u ON u.telegram_id = x.telegram_id
    ORDER BY x.happened_at DESC LIMIT ${limit}::int`;
  return { items, nextBefore: items.length === limit ? items[items.length - 1].happened_at : null };
};

// ---------------- Watch & Earn ads: daily numbers + who watched ----------------
// Source: the ledger (type "Ad Reward"). One row = one rewarded ad that was fully watched and paid. Days are UTC, same as the app's daily limit.
export const adminAdStats = async ({ body }) => {
  const days = [7, 14, 30].includes(Number(body.days)) ? Number(body.days) : 14;
  const today = new Date().toISOString().slice(0, 10);
  const day = /^\d{4}-\d{2}-\d{2}$/.test(String(body.day || "")) && !Number.isNaN(Date.parse(body.day)) ? String(body.day) : today;
  const c = await getConfig();
  const [daily, totals, viewers] = await Promise.all([
    sql`SELECT to_char(d,'YYYY-MM-DD') AS day, COUNT(t.id)::int AS watches, COUNT(DISTINCT t.telegram_id)::int AS viewers, COALESCE(SUM(t.points_change),0)::text AS points
        FROM generate_series(((NOW() AT TIME ZONE 'UTC')::date - (${days}::int - 1)), (NOW() AT TIME ZONE 'UTC')::date, INTERVAL '1 day') d
        LEFT JOIN transactions t ON t.type='Ad Reward' AND t.created_at >= NOW() - ((${days}::int + 1) * INTERVAL '1 day') AND (t.created_at AT TIME ZONE 'UTC')::date = d::date
        GROUP BY d ORDER BY d DESC`,
    sql`SELECT COUNT(*)::int AS watches, COUNT(DISTINCT telegram_id)::int AS viewers, COALESCE(SUM(points_change),0)::text AS points FROM transactions WHERE type='Ad Reward'`,
    sql`SELECT t.telegram_id, u.username, u.first_name, COUNT(*)::int AS watches, COALESCE(SUM(t.points_change),0)::text AS points,
          MIN(t.created_at) AS first_at, MAX(t.created_at) AS last_at,
          (SELECT COUNT(*) FROM transactions a WHERE a.telegram_id=t.telegram_id AND a.type='Ad Reward')::int AS all_time
        FROM transactions t JOIN users u ON u.telegram_id=t.telegram_id
        WHERE t.type='Ad Reward' AND t.created_at >= (${day}::date::timestamp AT TIME ZONE 'UTC') AND t.created_at < ((${day}::date + 1)::timestamp AT TIME ZONE 'UTC')
        GROUP BY t.telegram_id, u.username, u.first_name ORDER BY watches DESC, last_at DESC LIMIT 200`,
  ]);
  return {
    enabled: !!c.watchAdEnabled, reward: c.watchAdReward, dailyLimit: c.watchAdDailyLimit, network: c.watchAdNetwork || null,
    days, day, today, daily, totals: totals[0], viewers,
  };
};
