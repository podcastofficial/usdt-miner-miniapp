// Phase 2 / Part 5: health alerts. Telegram messages to the admins (ADMIN_TELEGRAM_IDS) when something needs a human.
// Rules: (1) never throws - an alert problem must never break the request that triggered it, (2) never floods:
// one message per kind per time bucket (DB dedupe_key, with an in-memory fallback if the database itself is the problem),
// (3) never contains secrets, stack traces or user data - only the action name and a short, escaped message.
import { sql } from "./db.js";
import { enqueue, processQueue } from "./notify.js";
import { sendMessage } from "./telegram.js";
import { escapeHtml } from "./notifyText.js";

export const adminIds = () => (process.env.ADMIN_TELEGRAM_IDS || "").split(",").map(x => x.trim()).filter(x => /^\d{1,15}$/.test(x));

/** Same bucket number for every call inside the same `minutes` window -> the dedupe key repeats -> one message per window. */
export const bucketOf = (now, minutes) => Math.floor(Number(now) / (Math.max(1, minutes) * 60000));

// Never leak anything secret-looking into a Telegram message (bot token, long hex / base64-ish strings, connection strings).
export function scrub(s) {
  return String(s ?? "").replace(/\b\d{6,}:[A-Za-z0-9_-]{20,}\b/g, "[token]").replace(/postgres(?:ql)?:\/\/\S+/gi, "[db-url]")
    .replace(/\b0x[a-fA-F0-9]{40,}\b/g, "[hex]").replace(/\s+/g, " ").trim().slice(0, 160);
}

export const apiErrorText = (action, message) => `🚨 <b>API error</b>\nAction: <code>${escapeHtml(String(action || "?").slice(0, 40))}</code>\n${escapeHtml(scrub(message))}\nSee the Vercel logs for details.`;
export const ledgerText = (n) => `⚠️ <b>Ledger mismatch</b>\n${Number(n)} user balance(s) do not match their ledger. Open Admin > Home > Ledger check. Do not approve payouts until it is understood.`;
export const withdrawalsText = (n, limit) => `⏳ <b>Many open withdrawals</b>\n${Number(n)} requests are waiting (alert level ${Number(limit)}). Open Admin > Withdraw.`;
export const fraudText = (n) => `🛡 <b>New fraud flags</b>\n${Number(n)} new flag(s) need review in Admin > Safety.`;
export const shouldAlertWithdrawals = (open, limit) => Number(limit) > 0 && Number(open) >= Number(limit);

const seen = new Set();
/** Send one alert to every admin. Returns { sent } and never throws. */
export async function sendAlert({ kind, text, minutes = 60, now = Date.now() }) {
  try {
    const admins = adminIds();
    if (!admins.length || !process.env.BOT_TOKEN) return { sent: 0, skipped: "not_configured" };
    const bucket = bucketOf(now, minutes), mem = `${kind}:${bucket}`;
    if (seen.has(mem)) return { sent: 0, skipped: "throttled" };
    seen.add(mem); if (seen.size > 200) seen.delete(seen.values().next().value);
    try {
      const ids = [];
      for (const a of admins) { const id = await enqueue({ userId: a, kind: "alert", key: `alert:${kind}:${bucket}:${a}`, text }); if (id) ids.push(id); }
      if (ids.length) await processQueue({ limit: ids.length, budgetMs: 4000, ids });
      return { sent: ids.length };
    } catch {
      let n = 0; // the database may be the very thing that is down: send directly, still once per bucket thanks to `seen`
      for (const a of admins) { const r = await sendMessage(a, text); if (r.status === 200) n++; }
      return { sent: n, direct: true };
    }
  } catch { return { sent: 0, skipped: "error" }; }
}

/** Called from the API error handler. `enabled` comes from Settings (defaults to true if settings cannot be read). */
export const reportApiError = (action, err, enabled = true) => enabled ? sendAlert({ kind: "api:" + String(action || "?").slice(0, 30), text: apiErrorText(action, err && err.message), minutes: 30 }) : Promise.resolve({ sent: 0, skipped: "disabled" });

/** Read-only checks. Returns numbers; `alertIfNeeded` decides whether to message the admins. */
export async function checkHealth(cfg) {
  const [m, w, f, q] = await Promise.all([
    sql`SELECT COUNT(*)::int AS n FROM (SELECT u.telegram_id FROM users u LEFT JOIN transactions t ON t.telegram_id=u.telegram_id
        GROUP BY u.telegram_id, u.points HAVING u.points <> COALESCE(SUM(t.points_change),0) LIMIT 50) x`,
    sql`SELECT COUNT(*)::int AS n FROM withdrawals WHERE status IN ('pending','approved')`,
    sql`SELECT COUNT(*)::int AS n FROM fraud_flags WHERE status='open'`.catch(() => [{ n: 0 }]),
    sql`SELECT COUNT(*)::int AS n FROM notification_queue WHERE status='failed' AND created_at > NOW() - INTERVAL '24 hours'`,
  ]);
  return { ledger_mismatches: m[0].n, open_withdrawals: w[0].n, open_flags: f[0].n, failed_messages_24h: q[0].n,
    withdrawals_over_limit: shouldAlertWithdrawals(w[0].n, cfg.alertOpenWithdrawals) };
}

export async function runHealth(cfg, { alert = true } = {}) {
  const h = await checkHealth(cfg), sent = [];
  if (alert && cfg.healthAlerts) {
    if (h.ledger_mismatches > 0) sent.push(["ledger", (await sendAlert({ kind: "ledger", text: ledgerText(h.ledger_mismatches), minutes: 360 })).sent]);
    if (h.withdrawals_over_limit) sent.push(["withdrawals", (await sendAlert({ kind: "withdrawals", text: withdrawalsText(h.open_withdrawals, cfg.alertOpenWithdrawals), minutes: 360 })).sent]);
  }
  return { ...h, alerts: Object.fromEntries(sent) };
}
