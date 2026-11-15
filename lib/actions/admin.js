// Part 5: admin panel API - dashboard, users, tasks, campaigns, settings, audit viewer.
// (Withdrawal/deposit queues live in finance.js.) Every mutating action is written to admin_audit_logs.
import crypto from "node:crypto";
import { sql } from "../db.js";
import { HttpError } from "../http.js";
import { audit } from "../audit.js";
import { isAdminId } from "../auth.js";
import { creditEx, debit } from "../ledger.js";
import { envStatus } from "../config.js";
import { getConfig, invalidateConfig } from "../runtime.js";
import { SETTING_DEFS, validateSetting, camel } from "../settingsDefs.js";
import { closeCampaign } from "../campaigns.js";
import { autoCreditBlocked } from "../safetyRules.js";

const bad = (msg, code = "bad_request", status = 400) => new HttpError(status, code, msg);
const posInt = (v) => { const n = Number(v); return Number.isSafeInteger(n) && n > 0 ? n : null; };
const reasonText = (v) => String(v || "").trim().slice(0, 200);
const userId = (v) => { const s = String(v ?? "").trim(); return /^\d{1,15}$/.test(s) && Number(s) > 0 ? s : null; };
const MAX_ADJUST = 100_000_000;

// ---------------- dashboard ----------------
export const adminDashboard = async () => {
  const [c, q] = await Promise.all([getConfig(), sql`
    SELECT (SELECT COUNT(*) FROM users)::int AS users,
      (SELECT COUNT(*) FROM users WHERE created_at > NOW()-INTERVAL '24 hours')::int AS new_24h,
      (SELECT COUNT(*) FROM users WHERE last_active_at > NOW()-INTERVAL '24 hours')::int AS active_24h,
      (SELECT COUNT(*) FROM users WHERE is_blocked)::int AS blocked,
      (SELECT COALESCE(SUM(points),0) FROM users)::text AS points_total,
      (SELECT COUNT(*) FROM withdrawals WHERE status IN ('pending','approved'))::int AS open_withdrawals,
      (SELECT COALESCE(SUM(net_usdt),0) FROM withdrawals WHERE status IN ('pending','approved'))::text AS owed_usdt,
      (SELECT COALESCE(SUM(net_usdt),0) FROM withdrawals WHERE status='paid')::text AS paid_usdt,
      (SELECT COUNT(*) FROM deposits WHERE status='verified')::int AS deposits_waiting,
      (SELECT COALESCE(SUM(amount_usdt),0) FROM deposits WHERE status='confirmed')::text AS deposited_usdt,
      (SELECT COUNT(*) FROM campaigns WHERE status='pending')::int AS campaigns_pending,
      (SELECT COUNT(*) FROM task_proofs WHERE status='pending')::int AS proofs_pending,
      (SELECT COUNT(*) FROM tasks WHERE active)::int AS tasks_active,
      (SELECT COUNT(*) FROM referral_events)::int AS referrals_qualified,
      (SELECT COUNT(*) FROM abuse_events WHERE created_at > NOW()-INTERVAL '24 hours')::int AS abuse_24h,
      (SELECT COUNT(*) FROM fraud_flags WHERE status='open')::int AS flags_open`]);
  const d = q[0];
  return { ...d, points_total_usdt: (Number(d.points_total) / c.pointsPerUsdt).toFixed(2), maintenance: c.maintenanceMode };
};

// ---------------- users ----------------
export const adminUsers = async ({ body }) => {
  const raw = String(body.q || "").trim().replace(/^@/, "").slice(0, 64);
  const num = /^\d{1,15}$/.test(raw) ? raw : null;
  const like = "%" + raw.replace(/[\\%_]/g, "\\$&") + "%";
  const items = await sql`
    SELECT telegram_id,username,first_name,points,is_blocked,created_at,last_active_at FROM users
    WHERE ${raw}::text = '' OR (${num}::text IS NOT NULL AND telegram_id=${num}::bigint) OR username ILIKE ${like}::text OR first_name ILIKE ${like}::text
    ORDER BY created_at DESC LIMIT 25`;
  return { items };
};

export const adminUser = async ({ body }) => {
  const uid = userId(body.userId);
  if (!uid) throw bad("Invalid user id");
  const [u, tx, wd, dp, rf] = await Promise.all([
    sql`SELECT telegram_id,username,first_name,last_name,language_code,points,ad_credits,referrer_id,referral_code,membership_verified,is_blocked,blocked_reason,created_at,last_active_at FROM users WHERE telegram_id=${uid}::bigint`,
    sql`SELECT id,type,points_change,balance_after,description,created_at FROM transactions WHERE telegram_id=${uid}::bigint ORDER BY id DESC LIMIT 15`,
    sql`SELECT id,net_usdt,status,created_at FROM withdrawals WHERE telegram_id=${uid}::bigint ORDER BY id DESC LIMIT 5`,
    sql`SELECT id,amount_usdt,status,created_at FROM deposits WHERE telegram_id=${uid}::bigint ORDER BY id DESC LIMIT 5`,
    sql`SELECT COUNT(*)::int AS invited, COUNT(e.referred_id)::int AS qualified FROM users x LEFT JOIN referral_events e ON e.referred_id=x.telegram_id WHERE x.referrer_id=${uid}::bigint`,
  ]);
  if (!u.length) throw bad("User not found", "not_found", 404);
  return { user: u[0], transactions: tx, withdrawals: wd, deposits: dp, referrals: rf[0] };
};

export const adminUserBlock = async ({ id, body }) => {
  const uid = userId(body.userId), reason = reasonText(body.reason);
  if (!uid || typeof body.blocked !== "boolean") throw bad("Invalid request");
  if (body.blocked && (isAdminId(uid) || uid === String(id))) throw bad("Admins cannot be blocked", "forbidden", 403);
  if (body.blocked && reason.length < 3) throw bad("A reason (min 3 characters) is required");
  const r = await sql`UPDATE users SET is_blocked=${body.blocked}::boolean, blocked_reason=${body.blocked ? reason : null}::text, blocked_at=${body.blocked ? new Date().toISOString() : null}::timestamptz
    WHERE telegram_id=${uid}::bigint RETURNING telegram_id,is_blocked`;
  if (!r.length) throw bad("User not found", "not_found", 404);
  await audit({ actorId: id, action: body.blocked ? "user.block" : "user.unblock", targetType: "user", targetId: uid, reason: reason || null });
  return r[0];
};

/** Manual Points correction (signed). Goes through the ledger like everything else: balance + ledger row, atomic. */
export const adminUserAdjust = async ({ id, body }) => {
  const uid = userId(body.userId), n = Number(body.points), reason = reasonText(body.reason);
  if (!uid || !Number.isSafeInteger(n) || n === 0 || Math.abs(n) > MAX_ADJUST) throw bad(`Points must be a non-zero whole number (max ${MAX_ADJUST.toLocaleString()})`);
  if (reason.length < 3) throw bad("A reason (min 3 characters) is required");
  const cur = await sql`SELECT points,is_blocked FROM users WHERE telegram_id=${uid}::bigint`;
  if (!cur.length) throw bad("User not found", "not_found", 404);
  const ref = `adj:${crypto.randomUUID()}`;
  const balance = n > 0 ? (await creditEx(uid, n, "Admin Adjustment", reason, ref)).balance : await debit(uid, -n, "Admin Adjustment", reason, ref);
  await audit({ actorId: id, action: "user.adjust_points", targetType: "user", targetId: uid, reason, before: { points: Number(cur[0].points) }, after: { points: balance, change: n } });
  return { balance, change: n };
};

// ---------------- tasks ----------------
export const adminTasks = async () => ({
  items: await sql`SELECT id,type,title,description,link,reward,target,completed,active,telegram_channel,timer_seconds,proof_required,proof_hint,created_at FROM tasks ORDER BY id DESC LIMIT 100`,
});

export const adminUpdateTask = async ({ id, body }) => {
  const tid = posInt(body.taskId);
  if (!tid) throw bad("Invalid task");
  const f = {};
  if (body.title !== undefined) { f.title = String(body.title).trim().slice(0, 100); if (!f.title) throw bad("Title required"); }
  if (body.description !== undefined) f.description = String(body.description).slice(0, 300);
  if (body.link !== undefined) { f.link = String(body.link).trim(); if (!/^https?:\/\//.test(f.link) || f.link.length > 500) throw bad("Valid https:// link required"); }
  if (body.reward !== undefined) { f.reward = posInt(body.reward); if (!f.reward) throw bad("Reward must be a positive whole number"); }
  if (body.target !== undefined) { f.target = Number(body.target); if (!Number.isSafeInteger(f.target) || f.target < 0) throw bad("Target must be 0 (unlimited) or more"); }
  if (body.timerSeconds !== undefined) { f.timer = Number(body.timerSeconds); if (!Number.isInteger(f.timer) || f.timer < 10 || f.timer > 600) throw bad("Timer must be 10-600 seconds"); }
  if (body.telegramChannel !== undefined) { f.channel = String(body.telegramChannel).trim(); if (f.channel && !/^@[A-Za-z0-9_]{5,32}$/.test(f.channel)) throw bad("Channel must look like @MyChannel"); }
  if (body.proofRequired !== undefined) { if (typeof body.proofRequired !== "boolean") throw bad("proofRequired must be true or false"); f.proofRequired = body.proofRequired; }
  if (body.proofHint !== undefined) f.proofHint = String(body.proofHint).trim().slice(0, 150);
  if (!Object.keys(f).length) throw bad("Nothing to update");
  const before = (await sql`SELECT title,description,link,reward,target,timer_seconds,telegram_channel,proof_required,proof_hint FROM tasks WHERE id=${tid}::bigint`)[0];
  if (!before) throw bad("Task not found", "not_found", 404);
  const cur = (await sql`SELECT type FROM tasks WHERE id=${tid}::bigint`)[0];
  if (f.proofRequired === true && cur.type === "channel") throw bad("Channel tasks are verified by Telegram, they cannot need a proof");
  const r = await sql`UPDATE tasks SET
      title=COALESCE(${f.title ?? null}::text,title), description=COALESCE(${f.description ?? null}::text,description), link=COALESCE(${f.link ?? null}::text,link),
      reward=COALESCE(${f.reward ?? null}::bigint,reward), target=COALESCE(${f.target ?? null}::int,target), timer_seconds=COALESCE(${f.timer ?? null}::int,timer_seconds),
      telegram_channel=CASE WHEN ${f.channel === undefined}::boolean THEN telegram_channel ELSE NULLIF(${f.channel ?? ""}::text,'') END,
      proof_required=COALESCE(${f.proofRequired ?? null}::boolean,proof_required),
      proof_hint=CASE WHEN ${f.proofHint === undefined}::boolean THEN proof_hint ELSE NULLIF(${f.proofHint ?? ""}::text,'') END
    WHERE id=${tid}::bigint RETURNING id,title,reward,target,timer_seconds,telegram_channel,proof_required`;
  await audit({ actorId: id, action: "task.update", targetType: "task", targetId: tid, before, after: f });
  return r[0];
};

// ---------------- campaigns ----------------
export const adminCampaigns = async ({ body }) => {
  const st = ["pending", "active", "rejected", "cancelled", "finished"].includes(body.status) ? body.status : "pending";
  return { items: await sql`
    SELECT c.id,c.owner_id,u.username,u.first_name,c.type,c.title,c.link,c.reward,c.target,c.status,c.reject_reason,c.task_id,c.created_at,
           COALESCE(t.completed,0) AS completed, c.spent, GREATEST(c.reward*c.target - c.spent, 0) AS unused
    FROM campaigns c LEFT JOIN users u ON u.telegram_id=c.owner_id LEFT JOIN tasks t ON t.id=c.task_id
    WHERE c.status=${st}::text ORDER BY c.id ASC LIMIT 50` };
};

/** Approve a pending campaign: it becomes a live task users can complete. */
export const adminCampaignApprove = async ({ id, body }) => {
  const cid = posInt(body.id);
  if (!cid) throw bad("Invalid request");
  const c = (await sql`SELECT id,type,title,link,reward,target FROM campaigns WHERE id=${cid}::bigint AND status='pending'`)[0];
  if (!c) throw bad("Campaign is not pending", "invalid_state", 409);
  let channel = null;
  if (c.type === "channel") {
    const m = /^https?:\/\/t\.me\/([A-Za-z0-9_]{5,32})\/?$/.exec(c.link);
    if (!m) throw bad("Channel campaigns need a plain https://t.me/<channel> link (reject it or ask the owner to fix it)");
    channel = "@" + m[1];
  }
  const claimed = await sql`UPDATE campaigns SET status='active', reviewed_by=${id}::bigint, reviewed_at=NOW() WHERE id=${cid}::bigint AND status='pending' RETURNING id`;
  if (!claimed.length) throw bad("Campaign is not pending", "invalid_state", 409);
  try {
    // Part 4: with task proofs ON, bot / website campaigns are verified by an admin-reviewed proof (a timer alone proves nothing). Channel campaigns use getChatMember.
    const proof = c.type !== "channel" && (await getConfig()).taskProofEnabled === true;
    const t = await sql`INSERT INTO tasks(type,title,description,link,reward,target,telegram_channel,timer_seconds,proof_required,proof_hint)
      VALUES(${c.type}::text,${c.title}::text,'Sponsored',${c.link}::text,${c.reward}::bigint,${c.target}::int,${channel}::text,30,${proof}::boolean,${proof ? (c.type === "bot" ? "Send the @username you used in the bot" : "Send the code or your @username shown on the site") : null}::text) RETURNING id`;
    await sql`UPDATE campaigns SET task_id=${t[0].id}::bigint WHERE id=${cid}::bigint`;
    await audit({ actorId: id, action: "campaign.approve", targetType: "campaign", targetId: cid, after: { status: "active", task_id: t[0].id } });
    return { id: cid, status: "active", taskId: t[0].id };
  } catch (e) {
    await sql`UPDATE campaigns SET status='pending', reviewed_by=NULL, reviewed_at=NULL WHERE id=${cid}::bigint AND task_id IS NULL`;
    throw e;
  }
};

/** Reject a pending campaign OR cancel an active one. The unspent budget (reward x target - spent) is refunded to the owner atomically (ref cmprefund:<id>). */
export const adminCampaignClose = async ({ id, body }) => {
  const cid = posInt(body.id), reason = reasonText(body.reason);
  if (!cid || reason.length < 3) throw bad("A reason (min 3 characters) is required");
  const cur = (await sql`SELECT status FROM campaigns WHERE id=${cid}::bigint AND status IN ('pending','active')`)[0];
  if (!cur) throw bad("Campaign is already closed", "invalid_state", 409);
  const to = cur.status === "pending" ? "rejected" : "cancelled";
  const r = await closeCampaign({ cid, from: cur.status, to, reason, reviewer: String(id) });
  await audit({ actorId: id, action: "campaign." + (to === "rejected" ? "reject" : "cancel"), targetType: "campaign", targetId: cid, reason, after: { status: to, refunded_points: r.refunded_points } });
  return r;
};

// ---------------- settings (every option is managed here) ----------------
export const adminSettings = async () => {
  const [c, rows] = await Promise.all([getConfig(), sql`SELECT key FROM settings`]);
  const stored = new Set(rows.map(r => r.key));
  return {
    items: Object.entries(SETTING_DEFS).map(([key, d]) => ({ key, group: d.group, label: d.label, type: d.type, help: d.help || null, value: c[camel(key)], default: d.def, custom: stored.has(key) })),
    env: envStatus(), // true/false only - secrets (BOT_TOKEN, DATABASE_URL, ADMIN_TELEGRAM_IDS) stay in Vercel env
  };
};

export const adminSettingsUpdate = async ({ id, body }) => {
  const changes = body.changes;
  if (!changes || typeof changes !== "object" || Array.isArray(changes) || !Object.keys(changes).length) throw bad("Nothing to update");
  if (Object.keys(changes).length > 30) throw bad("Too many changes");
  const clean = {};
  for (const [k, v] of Object.entries(changes)) { const r = validateSetting(k, v); if (!r.ok) throw bad(r.error); clean[k] = r.value; }
  const before = await getConfig();
  if (clean.deposit_auto_credit === true && !before.depositAutoCredit) { // Part 5: auto-credit needs one real, manually approved deposit first
    const ok = await sql`SELECT COUNT(*)::int AS n FROM deposits WHERE status='confirmed'`;
    const why = autoCreditBlocked(ok[0].n);
    if (why) throw bad(why, "autocredit_locked", 409);
  }
  await sql`INSERT INTO settings(key,value) SELECT k, v FROM jsonb_each(${JSON.stringify(clean)}::jsonb) AS t(k,v)
    ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`; // one statement -> all-or-nothing
  invalidateConfig();
  const after = await getConfig();
  await audit({ actorId: id, action: "settings.update", targetType: "settings", before: Object.fromEntries(Object.keys(clean).map(k => [k, before[camel(k)]])), after: clean });
  const warnings = [];
  if (after.depositsEnabled && !after.depositWallet) warnings.push("Deposits are ON but no deposit wallet is set - users cannot deposit.");
  if (after.depositAutoCredit && after.depositsEnabled) warnings.push("Auto-credit is ON: verified deposits are credited without admin review.");
  if (after.levelGoldAt <= after.levelSilverAt) warnings.push("Gold level must be above Silver - Gold is treated as Silver + 1 until you fix it.");
  if (after.streakEnabled && after.streakLadder[0] !== after.dailyReward) warnings.push(`Streak ladder is ON: day 1 pays ${after.streakLadder[0]} Points, not the flat daily reward (${after.dailyReward}).`);
  if (after.milestonesEnabled && !before.milestonesEnabled) warnings.push("Milestones are ON: inviters who already reached 5 / 10 / 50 referrals are paid the next time they open the app.");
  if (after.promoEnabled && !before.promoEnabled) warnings.push("Promo codes are ON: only active codes from Admin > Promo can be redeemed.");
  if (after.gamesEnabled && !before.gamesEnabled) warnings.push("Games are ON: every free play can pay real Points. Check the prize tables and expected payout in Admin > Games.");
  if (after.gamesEnabled && after.gameFreePlays === 0 && after.gameEntryFee === 0) warnings.push("Games are ON but there are 0 free plays and no entry fee, so nobody can play.");
  if (after.gamesEnabled && after.gameEntryFee > 0 && after.gameMaxPlays <= after.gameFreePlays) warnings.push("Entry fee is set but the daily maximum is not above the free plays, so the fee is never charged.");
  if (after.luckyDrawEnabled && !before.luckyDrawEnabled) warnings.push("Lucky Draw is ON: users can buy tickets for the open draw. Create one in Admin > Games.");
  if (after.boosterEnabled && !before.boosterEnabled) warnings.push(`Boosters are ON: ${after.boosterCost} Points buys the daily reward x${(after.boosterPercent / 100).toFixed(2)} for ${after.boosterHours}h.`);
  return { ok: true, changed: Object.keys(clean), warnings };
};

// ---------------- audit viewer ----------------
export const adminAudit = async ({ body }) => {
  const before = posInt(body.before), act = String(body.action || "").trim().slice(0, 40);
  const rows = await sql`
    SELECT id,actor_id,action,target_type,target_id,reason,before_data,after_data,created_at FROM admin_audit_logs
    WHERE (${before}::bigint IS NULL OR id < ${before}::bigint) AND (${act}::text = '' OR action LIKE ${act.replace(/[\\%_]/g, "\\$&") + "%"}::text)
    ORDER BY id DESC LIMIT 31`;
  const items = rows.slice(0, 30);
  return { items, next: rows.length > 30 ? items[items.length - 1].id : null };
};
