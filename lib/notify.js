// Phase 2 / Part 1: notification queue (DB + Telegram). Pure text/validation lives in notifyText.js.
// Design: every message is a row in notification_queue with a UNIQUE dedupe_key -> an event can never message a user twice,
// even if an admin button is clicked twice or Vercel retries. Sending is at-least-once per row, claimed with SKIP LOCKED.
import { sql } from "./db.js";
import { sendMessage } from "./telegram.js";
import { getConfig } from "./runtime.js";
import { classifySend, retryDelay, MAX_ATTEMPTS, withdrawalMessage, referralMessage, reminderMessage, proofMessage } from "./notifyText.js";

const BATCH = 25, GROUP = 5, STALE_MIN = 5;

/** Queue one message. Returns the row id, or null when this event was already queued. */
export async function enqueue({ userId, kind, text, key }) {
  const r = await sql`INSERT INTO notification_queue(telegram_id,kind,text,dedupe_key) VALUES(${String(userId)}::bigint,${kind}::text,${text}::text,${key}::text)
    ON CONFLICT(dedupe_key) DO NOTHING RETURNING id`;
  return r.length ? Number(r[0].id) : null;
}

async function settle(row, out) {
  if (out.kind === "ok") {
    await sql`UPDATE notification_queue SET status='sent', sent_at=NOW(), attempts=attempts+1, last_error=NULL WHERE id=${row.id}::bigint`;
    return "sent";
  }
  if (out.kind === "blocked") {
    await sql`UPDATE notification_queue SET status='skipped', attempts=attempts+1, last_error=${out.error}::text WHERE id=${row.id}::bigint`;
    await sql`UPDATE users SET bot_blocked=TRUE WHERE telegram_id=${row.telegram_id}::bigint`; // /start through the webhook clears this again
    return "skipped";
  }
  if (out.kind === "retry") {
    await sql`UPDATE notification_queue SET status='pending', claimed_at=NULL, last_error=${out.error}::text, send_after=NOW()+(${out.retryAfter}::int * INTERVAL '1 second') WHERE id=${row.id}::bigint`;
    return "retry";
  }
  const attempts = Number(row.attempts) + 1;
  if (attempts >= MAX_ATTEMPTS) {
    await sql`UPDATE notification_queue SET status='failed', attempts=${attempts}::int, last_error=${out.error}::text WHERE id=${row.id}::bigint`;
    return "failed";
  }
  await sql`UPDATE notification_queue SET status='pending', claimed_at=NULL, attempts=${attempts}::int, last_error=${out.error}::text, send_after=NOW()+(${retryDelay(attempts)}::int * INTERVAL '1 second') WHERE id=${row.id}::bigint`;
  return "retry";
}

/**
 * Send due messages. `ids` limits it to specific rows (used right after an event so the user is told immediately).
 * Stops early on a Telegram 429 or when the time budget is used (serverless functions are short-lived).
 */
export async function processQueue({ limit = BATCH, budgetMs = 7000, ids = null } = {}) {
  const t0 = Date.now(), res = { sent: 0, skipped: 0, failed: 0, retry: 0 };
  await sql`UPDATE notification_queue SET status='pending', claimed_at=NULL WHERE status='sending' AND claimed_at < NOW() - (${STALE_MIN}::int * INTERVAL '1 minute')`;
  while (Date.now() - t0 < budgetMs) {
    const rows = await sql`
      UPDATE notification_queue SET status='sending', claimed_at=NOW()
      WHERE id IN (SELECT id FROM notification_queue WHERE status='pending' AND send_after <= NOW()
                   AND (${ids}::bigint[] IS NULL OR id = ANY(${ids}::bigint[]))
                   ORDER BY id LIMIT ${Math.min(GROUP, limit - (res.sent + res.skipped + res.failed + res.retry))}::int FOR UPDATE SKIP LOCKED)
      RETURNING id, telegram_id, text, attempts`;
    if (!rows.length) break;
    let stop = false;
    const outs = await Promise.all(rows.map(async (row) => {
      const { status, json } = await sendMessage(row.telegram_id, row.text);
      const out = classifySend(status, json);
      if (out.kind === "retry") stop = true;
      return settle(row, out);
    }));
    for (const o of outs) res[o]++;
    if (stop || res.sent + res.skipped + res.failed + res.retry >= limit) break;
  }
  const left = await sql`SELECT COUNT(*)::int AS n FROM notification_queue WHERE status IN ('pending','sending')`;
  return { ...res, remaining: left[0].n };
}

const safe = async (label, fn) => { try { return await fn(); } catch (e) { console.error(`notify ${label} failed:`, e.message); return null; } };
/** Queue + send right away. Never throws: a notification problem must never break a withdrawal or referral. */
async function now(items) {
  const ids = [];
  for (const it of items) { const id = await enqueue(it); if (id) ids.push(id); }
  if (ids.length) await processQueue({ limit: ids.length, budgetMs: 4000, ids });
}

// ---------------- events ----------------
export const notifyWithdrawal = (wid, kind) => safe("withdrawal", async () => {
  const c = await getConfig();
  if (!c.notifyWithdrawal) return;
  const w = (await sql`SELECT w.id, w.telegram_id, w.net_usdt::text AS net, w.tx_hash, w.reject_reason FROM withdrawals w WHERE w.id=${wid}::bigint`)[0];
  if (!w) return;
  await now([{ userId: w.telegram_id, kind: "withdrawal", key: `wd:${w.id}:${kind}`, text: withdrawalMessage(kind, { id: w.id, net: w.net, txHash: w.tx_hash, reason: w.reject_reason }) }]);
});

export const notifyReferral = ({ referrerId, referredId, reward }) => safe("referral", async () => {
  const c = await getConfig();
  if (!c.notifyReferral) return;
  const u = (await sql`SELECT first_name, username FROM users WHERE telegram_id=${String(referredId)}::bigint`)[0];
  await now([{ userId: referrerId, kind: "referral", key: `ref:${referredId}`, text: referralMessage({ name: u?.first_name || u?.username, reward }) }]);
});

/** Post a masked proof of a paid withdrawal to the payments channel, once. */
export const postProof = (wid) => safe("proof", async () => {
  const c = await getConfig();
  if (!c.proofAutopost || !c.paymentsChannel) return;
  const claim = await sql`UPDATE withdrawals SET proof_posted_at=NOW() WHERE id=${wid}::bigint AND status='paid' AND tx_hash IS NOT NULL AND proof_hidden=FALSE AND proof_posted_at IS NULL RETURNING id, net_usdt::text AS net, tx_hash, telegram_id`;
  if (!claim.length) return;
  const u = (await sql`SELECT first_name, username FROM users WHERE telegram_id=${claim[0].telegram_id}::bigint`)[0] || {};
  const { status, json } = await sendMessage(c.paymentsChannel, proofMessage({ net: claim[0].net, firstName: u.first_name, username: u.username, txHash: claim[0].tx_hash }));
  if (!(status === 200 && json && json.ok)) {
    await sql`UPDATE withdrawals SET proof_posted_at=NULL WHERE id=${wid}::bigint`; // allow a later retry
    console.error("proof post failed:", json?.description || status);
  }
});

/** Daily cron: remind users who have not claimed today. Deduped per user per day. */
export async function queueReminders() {
  const c = await getConfig();
  if (!c.notifyReminder) return { queued: 0, skipped: "disabled" };
  const tz = c.dailyTimezone, reward = c.dailyReward;
  const r = await sql`
    WITH d AS (SELECT (NOW() AT TIME ZONE ${tz}::text)::date AS day)
    INSERT INTO notification_queue(telegram_id,kind,text,dedupe_key)
    SELECT u.telegram_id, 'reminder', ${reminderMessage({ reward })}::text, 'rem:'||u.telegram_id::text||':'||d.day::text
    FROM users u, d
    WHERE u.is_blocked=FALSE AND u.bot_blocked=FALSE AND u.last_active_at > NOW() - INTERVAL '30 days'
      AND NOT EXISTS(SELECT 1 FROM daily_claims dc WHERE dc.telegram_id=u.telegram_id AND dc.claim_date=d.day)
    ORDER BY u.last_active_at DESC LIMIT 5000
    ON CONFLICT(dedupe_key) DO NOTHING RETURNING id`;
  return { queued: r.length };
}
