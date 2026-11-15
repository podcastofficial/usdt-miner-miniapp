// Phase 2 / Part 5: safety & growth admin API - fraud flags, admin roles, CSV export, analytics, health, language.
// Permissions are enforced centrally in api/index.js (lib/roles.js ACTION_PERMS); every change is audited here.
import { sql } from "../db.js";
import { HttpError } from "../http.js";
import { audit } from "../audit.js";
import { getConfig } from "../runtime.js";
import { isAdminId } from "../auth.js";
import { RULES, runFraudScan } from "../fraud.js";
import { GRANTABLE, ROLE_PERMS, invalidateRoles } from "../roles.js";
import { DATASETS, EXPORT_MAX_ROWS, isDataset, toCsv } from "../csv.js";
import { DAYS, fillDays, retention, conversion } from "../analytics.js";
import { runHealth, sendAlert, fraudText } from "../health.js";
import { LANGS } from "../i18n.js";

const bad = (msg, code = "bad_request", status = 400) => new HttpError(status, code, msg);
const posInt = (v) => { const n = Number(v); return Number.isSafeInteger(n) && n > 0 ? n : null; };
const uid = (v) => { const s = String(v ?? "").trim(); return /^\d{1,15}$/.test(s) && Number(s) > 0 ? s : null; };
const note = (v) => String(v || "").trim().slice(0, 200);

// ---------------- fraud flags ----------------
export const adminFraudList = async ({ body }) => {
  const st = ["open", "reviewed", "dismissed"].includes(body.status) ? body.status : "open";
  const rule = RULES.includes(body.rule) ? body.rule : "";
  const before = posInt(body.before);
  const rows = await sql`
    SELECT f.id,f.rule,f.telegram_id,f.severity,f.details,f.status,f.review_note,f.reviewed_by,f.reviewed_at,f.created_at,
           u.username,u.first_name,u.is_blocked
    FROM fraud_flags f LEFT JOIN users u ON u.telegram_id=f.telegram_id
    WHERE f.status=${st}::text AND (${rule}::text='' OR f.rule=${rule}::text) AND (${before}::bigint IS NULL OR f.id < ${before}::bigint)
    ORDER BY f.id DESC LIMIT 31`;
  const items = rows.slice(0, 30);
  const c = await sql`SELECT COUNT(*) FILTER (WHERE status='open')::int AS open, COUNT(*)::int AS total FROM fraud_flags`;
  return { items, next: rows.length > 30 ? items[items.length - 1].id : null, open: c[0].open, total: c[0].total };
};

/** A human decision on a flag. It changes the flag only; the user is untouched (blocking is a separate, deliberate Users action). */
export const adminFraudReview = async ({ id, body }) => {
  const fid = posInt(body.id), status = body.status, why = note(body.note);
  if (!fid || !["open", "reviewed", "dismissed"].includes(status)) throw bad("Invalid request");
  if (status !== "open" && why.length < 3) throw bad("A note (min 3 characters) is required");
  const before = (await sql`SELECT status FROM fraud_flags WHERE id=${fid}::bigint`)[0];
  if (!before) throw bad("Flag not found", "not_found", 404);
  const r = await sql`UPDATE fraud_flags SET status=${status}::text, review_note=${status === "open" ? null : why}::text,
      reviewed_by=${status === "open" ? null : String(id)}::bigint, reviewed_at=${status === "open" ? null : new Date().toISOString()}::timestamptz
    WHERE id=${fid}::bigint RETURNING id,status`;
  await audit({ actorId: id, action: "fraud.review", targetType: "fraud_flag", targetId: fid, reason: why || null, before: { status: before.status }, after: { status } });
  return r[0];
};

export const adminFraudScan = async ({ id }) => {
  const r = await runFraudScan(await getConfig());
  await audit({ actorId: id, action: "fraud.scan", targetType: "fraud_flag", after: r });
  return r;
};

// ---------------- roles ----------------
export const adminRoles = async () => {
  const rows = await sql`SELECT r.telegram_id,r.role,r.created_at,u.username,u.first_name FROM admin_roles r LEFT JOIN users u ON u.telegram_id=r.telegram_id ORDER BY r.created_at DESC LIMIT 100`;
  const envAdmins = (process.env.ADMIN_TELEGRAM_IDS || "").split(",").map(x => x.trim()).filter(Boolean);
  return { items: rows, super_admins: envAdmins.length, grantable: GRANTABLE, matrix: Object.fromEntries(Object.entries(ROLE_PERMS).map(([k, v]) => [k, [...v]])) };
};

export const adminRoleSet = async ({ id, body }) => {
  const target = uid(body.userId), role = body.role;
  if (!target || !GRANTABLE.includes(role)) throw bad("Pick a user ID and a role: " + GRANTABLE.join(" or "));
  if (isAdminId(target)) throw bad("This person is already a super admin (ADMIN_TELEGRAM_IDS)", "forbidden", 403);
  const u = (await sql`SELECT is_blocked FROM users WHERE telegram_id=${target}::bigint`)[0];
  if (!u) throw bad("User not found - they must open the app once first", "not_found", 404);
  if (u.is_blocked) throw bad("Unblock this user first", "forbidden", 403);
  const before = (await sql`SELECT role FROM admin_roles WHERE telegram_id=${target}::bigint`)[0] || null;
  await sql`INSERT INTO admin_roles(telegram_id,role,set_by) VALUES(${target}::bigint,${role}::text,${String(id)}::bigint)
    ON CONFLICT(telegram_id) DO UPDATE SET role=EXCLUDED.role, set_by=EXCLUDED.set_by, updated_at=NOW()`;
  invalidateRoles();
  await audit({ actorId: id, action: "role.set", targetType: "user", targetId: target, before: before ? { role: before.role } : null, after: { role } });
  return { userId: target, role };
};

export const adminRoleRemove = async ({ id, body }) => {
  const target = uid(body.userId);
  if (!target) throw bad("Invalid user id");
  const r = await sql`DELETE FROM admin_roles WHERE telegram_id=${target}::bigint RETURNING role`;
  if (!r.length) throw bad("This user has no role", "not_found", 404);
  invalidateRoles();
  await audit({ actorId: id, action: "role.remove", targetType: "user", targetId: target, before: { role: r[0].role } });
  return { userId: target, removed: true };
};

// ---------------- CSV export ----------------
export const adminExport = async ({ id, body }) => {
  const ds = String(body.dataset || "");
  if (!isDataset(ds)) throw bad("Unknown dataset");
  const days = ds === "users" ? null : Math.min(365, Math.max(1, posInt(body.days) || 30));
  const lim = EXPORT_MAX_ROWS + 1;
  const rows = ds === "users" ? await sql`SELECT telegram_id,username,first_name,points,is_blocked,membership_verified,referrer_id,user_lang,created_at,last_active_at FROM users ORDER BY created_at DESC LIMIT ${lim}::int`
    : ds === "withdrawals" ? await sql`SELECT id,telegram_id,amount_usdt,fee_usdt,net_usdt,wallet_address,status,tx_hash,created_at,reviewed_at FROM withdrawals WHERE created_at > NOW() - (${days}::int * INTERVAL '1 day') ORDER BY id DESC LIMIT ${lim}::int`
    : ds === "deposits" ? await sql`SELECT id,telegram_id,amount_usdt,from_address,tx_hash,status,created_at,reviewed_at FROM deposits WHERE created_at > NOW() - (${days}::int * INTERVAL '1 day') ORDER BY id DESC LIMIT ${lim}::int`
    : await sql`SELECT id,telegram_id,type,points_change,balance_after,description,reference,created_at FROM transactions WHERE created_at > NOW() - (${days}::int * INTERVAL '1 day') ORDER BY id DESC LIMIT ${lim}::int`;
  const truncated = rows.length > EXPORT_MAX_ROWS, out = rows.slice(0, EXPORT_MAX_ROWS);
  await audit({ actorId: id, action: "export.csv", targetType: "export", targetId: ds, after: { dataset: ds, rows: out.length, days, truncated } });
  const today = new Date().toISOString().slice(0, 10);
  return { dataset: ds, filename: `usdt-miner-${DATASETS[ds].file}-${today}.csv`, rows: out.length, truncated, csv: toCsv(DATASETS[ds].cols, out) };
};

// ---------------- analytics ----------------
export const adminAnalytics = async () => {
  const tz = (await getConfig()).dailyTimezone;
  const [t, dau, nu, flow, ret, conv, live] = await Promise.all([
    sql`SELECT (NOW() AT TIME ZONE ${tz}::text)::date::text AS today`,
    sql`SELECT (created_at AT TIME ZONE ${tz}::text)::date::text AS day, COUNT(DISTINCT telegram_id)::int AS active FROM transactions WHERE created_at > NOW() - INTERVAL '16 days' GROUP BY 1`,
    sql`SELECT (created_at AT TIME ZONE ${tz}::text)::date::text AS day, COUNT(*)::int AS new_users FROM users WHERE created_at > NOW() - INTERVAL '16 days' GROUP BY 1`,
    sql`SELECT (created_at AT TIME ZONE ${tz}::text)::date::text AS day,
          COALESCE(SUM(CASE WHEN points_change>0 THEN points_change ELSE 0 END),0)::text AS points_in,
          COALESCE(SUM(CASE WHEN points_change<0 THEN -points_change ELSE 0 END),0)::text AS points_out
        FROM transactions WHERE created_at > NOW() - INTERVAL '16 days' GROUP BY 1`,
    sql`SELECT COUNT(*) FILTER (WHERE created_at <= NOW() - INTERVAL '1 day')::int AS d1_base,
          COUNT(*) FILTER (WHERE created_at <= NOW() - INTERVAL '1 day' AND last_active_at >= created_at + INTERVAL '1 day')::int AS d1_back,
          COUNT(*) FILTER (WHERE created_at <= NOW() - INTERVAL '7 days')::int AS d7_base,
          COUNT(*) FILTER (WHERE created_at <= NOW() - INTERVAL '7 days' AND last_active_at >= created_at + INTERVAL '7 days')::int AS d7_back
        FROM users WHERE created_at > NOW() - INTERVAL '60 days'`,
    sql`SELECT COUNT(*)::int AS invited, COUNT(e.referred_id)::int AS qualified FROM users u LEFT JOIN referral_events e ON e.referred_id=u.telegram_id
        WHERE u.referrer_id IS NOT NULL AND u.created_at > NOW() - INTERVAL '30 days'`,
    sql`SELECT COUNT(*) FILTER (WHERE last_active_at > NOW() - INTERVAL '24 hours')::int AS d1, COUNT(*) FILTER (WHERE last_active_at > NOW() - INTERVAL '7 days')::int AS d7,
          COUNT(*) FILTER (WHERE last_active_at > NOW() - INTERVAL '30 days')::int AS d30, COUNT(*)::int AS total FROM users`,
  ]);
  const today = t[0].today;
  const a = fillDays(dau, today, ["active"]), n = fillDays(nu, today, ["new_users"]), f = fillDays(flow, today, ["points_in", "points_out"]);
  return {
    days: a.map((x, i) => ({ day: x.day, active: x.active, new_users: n[i].new_users, points_in: f[i].points_in, points_out: f[i].points_out })),
    retention: retention(ret[0]), conversion: conversion(conv[0]), live: live[0], range_days: DAYS,
    notes: { active: "Users with any Points activity that day (ledger rows).", retention: "Share of users who came back at least 1 / 7 days after joining. Based on last-seen time, so it is an estimate.", conversion: "Invited users from the last 30 days who joined and verified the channels." },
  };
};

// ---------------- health ----------------
export const adminHealth = async () => runHealth(await getConfig(), { alert: false });
export const adminHealthRun = async ({ id }) => {
  const r = await runHealth(await getConfig(), { alert: true });
  await audit({ actorId: id, action: "health.run", targetType: "system", after: { ledger_mismatches: r.ledger_mismatches, open_withdrawals: r.open_withdrawals, alerts: r.alerts } });
  return r;
};

/** Called by the daily cron (never throws): fraud scan when enabled + health alerts. */
export async function cronSafety() {
  const out = {};
  try {
    const cfg = await getConfig();
    if (cfg.fraudEnabled) {
      out.fraud = await runFraudScan(cfg);
      if (out.fraud.new_flags > 0 && cfg.healthAlerts) await sendAlert({ kind: "fraud", text: fraudText(out.fraud.new_flags), minutes: 720 });
    } else out.fraud = { skipped: "disabled" };
    out.health = await runHealth(cfg, { alert: true });
  } catch (e) { console.error("cron safety failed:", e.message); out.error = "failed"; }
  return out;
}

// ---------------- user language ----------------
export const setLang = async ({ id, body }) => {
  const lang = String(body.lang || "");
  if (!LANGS.includes(lang)) throw bad("Unknown language");
  await sql`UPDATE users SET user_lang=${lang}::text WHERE telegram_id=${id}::bigint`;
  return { lang };
};
