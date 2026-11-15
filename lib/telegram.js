import { HttpError } from "./http.js";
const MEMBER = ["member", "administrator", "creator"];
export const isChannelName = (c) => /^@[A-Za-z0-9_]{5,32}$/.test(String(c || ""));

/** Plain-words reason for an admin when Telegram cannot check a channel (z = Telegram's JSON reply, or null on a network error). */
export function adminHint(channel, z) {
  const d = String((z && z.description) || "").toLowerCase();
  if (!z) return "Admin: could not reach Telegram (network / timeout). Try again.";
  if (z.error_code === 401) return "Admin: BOT_TOKEN is wrong or revoked. Check the BOT_TOKEN environment variable.";
  if (d.includes("chat not found")) return `Admin: Telegram cannot find ${channel}. The @username must be a PUBLIC channel and spelled exactly (private / invite-link channels cannot be verified).`;
  if (d.includes("member list is inaccessible") || d.includes("not enough rights") || d.includes("not a member") || d.includes("forbidden") || d.includes("administrator"))
    return `Admin: add the bot as an ADMINISTRATOR in ${channel} (Channel > Administrators > Add Admin > your bot), then try again.`;
  return "Admin: Telegram said: " + String(z.description || "unknown error").slice(0, 120);
}

/** Returns the user's membership status in a channel. Throws 503 if Telegram cannot verify (e.g. bot is not a channel admin). `hint` = caller is an admin: say why. */
export async function chatMemberStatus(channel, userId, hint = false) {
  const z = await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/getChatMember?chat_id=${encodeURIComponent(channel)}&user_id=${userId}`,
    { signal: AbortSignal.timeout(8000) }).then(r => r.json()).catch(() => null);
  if (!z || !z.ok) throw new HttpError(503, "verification_unavailable", hint ? adminHint(channel, z) : "Verification is temporarily unavailable");
  return z.result?.status || "left";
}
export const isMemberStatus = (s) => MEMBER.includes(s);

// ---- Phase 2 / Part 1: bot messages. These never throw: the caller decides what to do with the outcome. ----
async function tgCall(method, payload, timeoutMs = 8000) {
  try {
    const r = await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/${method}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: AbortSignal.timeout(timeoutMs) });
    const json = await r.json().catch(() => null);
    return { status: r.status, json };
  } catch (e) { return { status: 0, json: null }; } // network error / timeout -> treated as a retryable failure
}
export const sendMessage = (chatId, text, extra = {}) =>
  tgCall("sendMessage", { chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true, ...extra });
export const setWebhook = (url, secret) =>
  tgCall("setWebhook", { url, secret_token: secret, allowed_updates: ["message", "my_chat_member", "callback_query"], drop_pending_updates: false, max_connections: 10 });
export const getWebhookInfo = () => tgCall("getWebhookInfo", {});

export const answerCallback = (id, text, alert = false) => tgCall("answerCallbackQuery", { callback_query_id: id, text, show_alert: alert });

// Channel display names (title) for "@username" channels. Cached 6 h in memory; any failure just falls back to the @username.
const titleCache = new Map();
export async function channelTitles(channels) {
  const out = {}, now = Date.now();
  await Promise.all((channels || []).filter(isChannelName).map(async (ch) => {
    const hit = titleCache.get(ch);
    if (hit && now - hit.at < 6 * 3600 * 1000) { if (hit.title) out[ch] = hit.title; return; }
    const z = await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/getChat?chat_id=${encodeURIComponent(ch)}`, { signal: AbortSignal.timeout(3000) }).then(r => r.json()).catch(() => null);
    const title = z && z.ok && typeof z.result?.title === "string" ? z.result.title.slice(0, 80) : null;
    titleCache.set(ch, { title, at: now });
    if (title) out[ch] = title;
  }));
  return out;
}
