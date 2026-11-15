import { verifyInitData, AuthError, isAdminId } from "../lib/auth.js";
import { ensureUser } from "../lib/users.js";
import { rateLimit } from "../lib/ratelimit.js";
import { sql } from "../lib/db.js";
import { HttpError, send } from "../lib/http.js";
import { INITDATA_MAX_AGE } from "../lib/config.js";
import * as core from "../lib/actions/core.js";
import * as legacy from "../lib/actions/legacy.js";
import * as earn from "../lib/actions/earn.js";
import * as ref from "../lib/actions/referral.js";
import * as fin from "../lib/actions/finance.js";
import { captureReferrer } from "../lib/referral.js";

// Action registry. write=true -> POST only; admin=true -> server-side admin check on every call.
const ACTIONS = {
  bootstrap: { fn: core.bootstrap },
  referral: { fn: ref.referral },
  referralVerify: { fn: ref.referralVerify, write: true },
  leaderboard: { fn: legacy.leaderboard },
  daily: { fn: earn.daily, write: true },
  taskStart: { fn: earn.taskStart, write: true },
  taskComplete: { fn: earn.taskComplete, write: true },
  history: { fn: earn.history },
  financeInfo: { fn: fin.financeInfo },
  withdrawQuote: { fn: fin.withdrawQuote },
  withdraw: { fn: fin.withdraw, write: true },
  withdrawList: { fn: fin.withdrawList },
  withdrawCancel: { fn: fin.withdrawCancel, write: true },
  depositSubmit: { fn: fin.depositSubmit, write: true },
  depositRecheck: { fn: fin.depositRecheck, write: true },
  depositList: { fn: fin.depositList },
  campaignCreate: { fn: legacy.campaignCreate, write: true },
  adminOverview: { fn: core.adminOverview, admin: true },
  adminDiagnostics: { fn: core.adminDiagnostics, admin: true },
  adminCreateTask: { fn: earn.adminCreateTask, admin: true, write: true },
  adminSetTaskActive: { fn: earn.adminSetTaskActive, admin: true, write: true },
  adminReconcile: { fn: earn.adminReconcile, admin: true },
  adminAbuseEvents: { fn: ref.adminAbuseEvents, admin: true },
  adminWithdrawals: { fn: fin.adminWithdrawals, admin: true },
  adminWithdrawalApprove: { fn: fin.adminWithdrawalApprove, admin: true, write: true },
  adminWithdrawalReject: { fn: fin.adminWithdrawalReject, admin: true, write: true },
  adminWithdrawalPaid: { fn: fin.adminWithdrawalPaid, admin: true, write: true },
  adminDeposits: { fn: fin.adminDeposits, admin: true },
  adminDepositApprove: { fn: fin.adminDepositApprove, admin: true, write: true },
  adminDepositReject: { fn: fin.adminDepositReject, admin: true, write: true },
};

export default async function handler(req, res) {
  try {
    if (req.method === "OPTIONS") { res.statusCode = 204; return res.end(); }
    const query = req.query || {};
    if (query.action === "health") {
      let db = false; try { await sql`SELECT 1`; db = true; } catch {}
      return send(res, db ? 200 : 503, { ok: db, db });
    }
    let body = req.body || {};
    if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
    if (typeof body !== "object") body = {};

    const tg = verifyInitData(req.headers["x-telegram-init-data"] || body.initData,
      { botToken: process.env.BOT_TOKEN, maxAgeSeconds: INITDATA_MAX_AGE });
    const row = await ensureUser(tg.user, tg.startParam);
    if (row.created) { try { row.referrer_id = (await captureReferrer(tg.user.id, tg.startParam)) ?? row.referrer_id; } catch (e) { console.error("referral capture failed:", e.message); } }
    if (row.is_blocked) throw new HttpError(403, "account_blocked", "Account unavailable");

    const id = String(tg.user.id), isAdmin = isAdminId(id);
    const action = query.action || body.action || "bootstrap";
    const def = Object.prototype.hasOwnProperty.call(ACTIONS, action) ? ACTIONS[action] : null;
    if (!def) throw new HttpError(404, "unknown_action", "Unknown action");
    if (def.write && req.method !== "POST") throw new HttpError(405, "method_not_allowed", "POST required");
    if (def.admin && !isAdmin) throw new HttpError(403, "admin_only", "Admin only");

    await rateLimit(id, action);
    return send(res, 200, await def.fn({ id, row, isAdmin, body, query, startParam: tg.startParam }));
  } catch (e) {
    if (e instanceof AuthError) return send(res, e.code === "server_misconfigured" ? 500 : 401, { error: e.message, code: e.code });
    if (e instanceof HttpError) return send(res, e.status, { error: e.message, code: e.code });
    console.error("API error:", e); // details stay in server logs, never sent to the client
    return send(res, 500, { error: "Server error, please try again", code: "server_error" });
  }
}
