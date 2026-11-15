// Phase 2 / Part 1: Telegram webhook, daily cron, admin broadcast + notification tools.
import crypto from "node:crypto";
import { sql } from "../db.js";
import { HttpError } from "../http.js";
import { audit } from "../audit.js";
import { getConfig } from "../runtime.js";
import { sendMessage, setWebhook, getWebhookInfo } from "../telegram.js";
import { processQueue, queueReminders } from "../notify.js";
import { secretMatches, summarizeUpdate, validateBroadcast, validHost, webhookUrl, appLink, SEGMENT_LABELS } from "../notifyText.js";

const bad = (msg, code = "bad_request", status = 400) => new HttpError(status, code, msg);
const posInt = (v) => { const n = Number(v); return Number.isSafeInteger(n) && n > 0 ? n : null; };

// ---------------- Telegram webhook (no initData: authenticated by the secret token header) ----------------
export async function tgWebhook({ req, body }) {
  if (req.method !== "POST") throw bad("POST required", "method_not_allowed", 405);
  const secret = process.env.TG_WEBHOOK_SECRET;
  if (!secret) throw bad("Webhook is not configured", "server_misconfigured", 503);
  if (!secretMatches(req.headers["x-telegram-bot-api-secret-token"], secret)) throw bad("Forbidden", "forbidden", 403);

  const ev = summarizeUpdate(body);
  if (ev.type === "ignore") return { ok: true };
  const uid = String(ev.userId);
  if (ev.type === "blocked") await sql`UPDATE users SET bot_blocked=TRUE WHERE telegram_id=${uid}::bigint`;
  else await sql`UPDATE users SET bot_blocked=FALSE WHERE telegram_id=${uid}::bigint AND bot_blocked=TRUE`; // start / message / unblocked: we may message them again
  if (ev.type === "start") {
    const c = await getConfig();
    await sendMessage(uid, "👋 <b>Welcome to USDT Miner!</b>\nTap the button below to open the app, claim your daily reward and start earning.",
      { reply_markup: { inline_keyboard: [[{ text: "⛏ Open USDT Miner", url: appLink(c) }]] } });
  }
  return { ok: true };
}

// ---------------- Vercel cron (daily): reminders + drain the queue ----------------
export async function cron({ req }) {
  const secret = process.env.CRON_SECRET;
  if (!secret) throw bad("Cron is not configured", "server_misconfigured", 503);
  const given = String(req.headers.authorization || "");
  const want = `Bearer ${secret}`;
  const a = Buffer.from(given), b = Buffer.from(want);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw bad("Forbidden", "forbidden", 403);
  const reminders = await queueReminders();
  const sent = await processQueue({ limit: 100, budgetMs: 8000 });
  return { ok: true, reminders, ...sent };
}

// ---------------- admin ----------------
export const adminNotifyStatus = async () => {
  const [q, b, wh] = await Promise.all([
    sql`SELECT status, COUNT(*)::int AS n FROM notification_queue WHERE created_at > NOW() - INTERVAL '7 days' OR status IN ('pending','sending') GROUP BY status`,
    sql`SELECT b.id, b.segment, b.text, b.total, b.cancelled, b.created_at,
          COUNT(*) FILTER (WHERE q.status='sent')::int AS sent,
          COUNT(*) FILTER (WHERE q.status IN ('pending','sending'))::int AS waiting,
          COUNT(*) FILTER (WHERE q.status='failed')::int AS failed,
          COUNT(*) FILTER (WHERE q.status='skipped')::int AS skipped
        FROM broadcasts b LEFT JOIN notification_queue q ON q.broadcast_id=b.id GROUP BY b.id ORDER BY b.id DESC LIMIT 10`,
    process.env.BOT_TOKEN ? getWebhookInfo() : Promise.resolve({ json: null }),
  ]);
  const w = wh.json && wh.json.ok ? wh.json.result : null;
  return {
    queue: Object.fromEntries(q.map(r => [r.status, r.n])),
    broadcasts: b.map(x => ({ ...x, preview: String(x.text).slice(0, 120), label: SEGMENT_LABELS[x.segment] })),
    webhook: w ? { url: w.url || "", pending: w.pending_update_count ?? 0, last_error: w.last_error_message || null } : null,
    secrets: { webhook: Boolean(process.env.TG_WEBHOOK_SECRET), cron: Boolean(process.env.CRON_SECRET) },
  };
};

export const adminNotifyProcess = async () => ({ ...(await processQueue({ limit: 25, budgetMs: 7000 })) });

export const adminWebhookSetup = async ({ id, host }) => {
  const secret = process.env.TG_WEBHOOK_SECRET;
  if (!secret) throw bad("Set TG_WEBHOOK_SECRET in Vercel first (any long random string), then redeploy", "server_misconfigured", 400);
  if (!validHost(host)) throw bad("Could not detect the app address");
  const url = webhookUrl(host);
  const { json } = await setWebhook(url, secret);
  if (!json || !json.ok) throw bad("Telegram refused the webhook: " + String(json?.description || "no answer").slice(0, 120), "telegram_error", 502);
  await audit({ actorId: id, action: "notify.webhook_set", targetType: "settings", after: { url } });
  return { ok: true, url };
};

export const adminBroadcastCreate = async ({ id, body }) => {
  const c = await getConfig();
  if (!c.broadcastEnabled) throw bad("Broadcast is turned off in Settings", "broadcast_disabled", 403);
  const v = validateBroadcast(body);
  if (!v.ok) throw bad(v.error);
  const { text, segment } = v.value;
  const open = await sql`SELECT COUNT(*)::int AS n FROM notification_queue WHERE broadcast_id IS NOT NULL AND status IN ('pending','sending')`;
  if (open[0].n > 0) throw bad("Another broadcast is still sending. Finish or cancel it first.", "broadcast_busy", 409);

  const b = (await sql`INSERT INTO broadcasts(created_by,text,segment) VALUES(${id}::bigint,${text}::text,${segment}::text) RETURNING id`)[0];
  try {
    const q = await sql`
      INSERT INTO notification_queue(telegram_id,kind,text,dedupe_key,broadcast_id)
      SELECT u.telegram_id,'broadcast',${text}::text,'bc:'||${b.id}::text||':'||u.telegram_id::text,${b.id}::bigint
      FROM users u
      WHERE u.is_blocked=FALSE AND u.bot_blocked=FALSE AND (
            ${segment}::text='all'
         OR (${segment}::text='active7' AND u.last_active_at > NOW() - INTERVAL '7 days')
         OR (${segment}::text='balance' AND u.points > 0)
         OR (${segment}::text='new24' AND u.created_at > NOW() - INTERVAL '24 hours')
         OR (${segment}::text='me' AND u.telegram_id=${id}::bigint))
      ON CONFLICT(dedupe_key) DO NOTHING RETURNING id`;
    await sql`UPDATE broadcasts SET total=${q.length}::int WHERE id=${b.id}::bigint`;
    await audit({ actorId: id, action: "broadcast.create", targetType: "broadcast", targetId: b.id, after: { segment, recipients: q.length, chars: text.length } });
    return { id: Number(b.id), recipients: q.length };
  } catch (e) {
    await sql`UPDATE broadcasts SET cancelled=TRUE WHERE id=${b.id}::bigint`;
    throw e;
  }
};

export const adminBroadcastCancel = async ({ id, body }) => {
  const bid = posInt(body.id);
  if (!bid) throw bad("Invalid request");
  const r = await sql`UPDATE notification_queue SET status='skipped', last_error='cancelled by admin' WHERE broadcast_id=${bid}::bigint AND status='pending' RETURNING id`;
  await sql`UPDATE broadcasts SET cancelled=TRUE WHERE id=${bid}::bigint`;
  await audit({ actorId: id, action: "broadcast.cancel", targetType: "broadcast", targetId: bid, after: { cancelled_messages: r.length } });
  return { id: bid, cancelled: r.length };
};
