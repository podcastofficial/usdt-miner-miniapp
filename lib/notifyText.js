// Phase 2 / Part 1: pure helpers for bot notifications (no DB, no network -> unit-testable).
import crypto from "node:crypto";
import { cleanText, maskName, txUrl, money2 } from "./community.js";

export const SEGMENTS = ["all", "active7", "balance", "new24", "me"];
export const SEGMENT_LABELS = { all: "All users", active7: "Active in last 7 days", balance: "Users with Points", new24: "New in last 24 hours", me: "Only me (test)" };
export const BROADCAST_MAX = 1000;
export const MAX_ATTEMPTS = 3;

/** Telegram HTML parse mode: only these 3 characters need escaping. Every user-controlled value goes through this. */
export const escapeHtml = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const pts = (n) => Number(n).toLocaleString("en-US");

/** https://t.me link that opens the Mini App from a bot chat. */
export const appLink = ({ botUsername, miniappShortName }) =>
  miniappShortName ? `https://t.me/${botUsername}/${miniappShortName}` : `https://t.me/${botUsername}?startapp`;

export function withdrawalMessage(kind, w) {
  const id = Number(w.id), net = money2(w.net);
  if (kind === "approved") return `✅ <b>Withdrawal #${id} approved</b>\nYour payout of <b>${net} MINER</b> is approved and will be sent soon.`;
  if (kind === "paid") {
    const url = txUrl(w.txHash);
    return `💸 <b>Withdrawal #${id} paid</b>\n<b>${net} MINER</b> was sent to your wallet.` + (url ? `\n<a href="${url}">View transaction</a>` : "");
  }
  if (kind === "rejected") return `❌ <b>Withdrawal #${id} rejected</b>\nReason: ${escapeHtml(cleanText(w.reason, 200)) || "not given"}\nYour Points were refunded to your balance.`;
  throw new Error("unknown withdrawal notification: " + kind);
}
export const referralMessage = ({ name, reward }) =>
  `🎉 <b>New referral!</b>\n${escapeHtml(cleanText(name, 30) || "A friend")} joined with your link and verified.\n<b>+${pts(reward)} Points</b> added to your balance.`;
export const reminderMessage = ({ reward }) =>
  `⏰ <b>Your daily reward is waiting</b>\nOpen the app and claim <b>${pts(reward)} Points</b> today.`;
export const proofMessage = ({ net, firstName, username, txHash }) => {
  const url = txUrl(txHash);
  return `✅ <b>Withdrawal paid</b>\n💸 <b>${money2(net)} MINER</b> → ${escapeHtml(maskName(firstName, username))}` + (url ? `\n<a href="${url}">View on BscScan</a>` : "");
};

/** Admin broadcast input -> { ok, value:{ text (already HTML-escaped), segment } } | { ok:false, error }. Admin text is plain text, never HTML. */
export function validateBroadcast(body) {
  const b = body && typeof body === "object" ? body : {};
  const raw = String(b.text ?? "").replace(/\r\n/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, "").trim();
  if (raw.length < 3) return { ok: false, error: "Message must be at least 3 characters" };
  if (raw.length > BROADCAST_MAX) return { ok: false, error: `Message is too long (max ${BROADCAST_MAX} characters)` };
  const segment = SEGMENTS.includes(b.segment) ? b.segment : null;
  if (!segment) return { ok: false, error: "Choose who receives the message" };
  return { ok: true, value: { text: escapeHtml(raw), segment } };
}

/** Telegram sendMessage result -> what to do with the queue row. */
export function classifySend(status, json) {
  if (status === 200 && json && json.ok) return { kind: "ok" };
  const code = Number(json?.error_code ?? status), desc = String(json?.description || "").slice(0, 200);
  if (code === 429) return { kind: "retry", retryAfter: Math.min(Math.max(Number(json?.parameters?.retry_after) || 5, 1), 3600), error: desc };
  if (code === 403) return { kind: "blocked", error: desc };                     // user blocked the bot / never started it
  if (code === 400 && /chat not found|user_is_deactivated|PEER_ID_INVALID/i.test(desc)) return { kind: "blocked", error: desc };
  return { kind: "fail", error: desc || `http ${status}` };
}
/** Seconds to wait before retry number `attempts` (1-based). */
export const retryDelay = (attempts) => 60 * Math.min(Math.max(attempts, 1), 5);

/** Constant-time check of Telegram's X-Telegram-Bot-Api-Secret-Token header. */
export function secretMatches(given, expected) {
  if (!expected || typeof given !== "string") return false;
  const a = Buffer.from(given), b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Telegram update -> the one thing we care about, or { type:"ignore" }. Only private chats; never trusts anything but ids. */
export function summarizeUpdate(u) {
  const m = u && u.message;
  if (m && m.chat?.type === "private" && Number.isSafeInteger(m.from?.id) && !m.from.is_bot) {
    const t = typeof m.text === "string" ? m.text.trim() : "";
    return { type: /^\/start(@\w+)?(\s|$)/.test(t) ? "start" : "message", userId: m.from.id };
  }
  const c = u && u.my_chat_member;
  if (c && c.chat?.type === "private" && Number.isSafeInteger(c.from?.id)) {
    const s = c.new_chat_member?.status;
    if (s === "kicked" || s === "left") return { type: "blocked", userId: c.from.id };
    if (s === "member") return { type: "unblocked", userId: c.from.id };
  }
  return { type: "ignore" };
}

/** Whitelist for the host used to build the webhook URL. */
export const validHost = (h) => typeof h === "string" && /^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?(:\d{1,5})?$/i.test(h) && h.includes(".");
export const webhookUrl = (host) => `https://${host}/api?action=tgWebhook`;
