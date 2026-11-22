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

// ---- Part 28: photos (broadcast with a picture) + posting to channels. Same never-throw contract as sendMessage. ----
/** First send of a picture: uploads the bytes. The reply holds a file_id that every later send reuses (see photoFileId). */
export async function sendPhotoUpload(chatId, bytes, mime, caption, extra = {}) {
  try {
    const f = new FormData();
    f.append("chat_id", String(chatId));
    if (caption) { f.append("caption", caption); f.append("parse_mode", "HTML"); }
    if (extra.reply_markup) f.append("reply_markup", JSON.stringify(extra.reply_markup));
    f.append("photo", new Blob([bytes], { type: mime }), mime === "image/png" ? "broadcast.png" : "broadcast.jpg");
    const r = await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendPhoto`, { method: "POST", body: f, signal: AbortSignal.timeout(20000) });
    return { status: r.status, json: await r.json().catch(() => null) };
  } catch (e) { return { status: 0, json: null }; }
}
export const sendPhotoById = (chatId, fileId, caption, extra = {}) =>
  tgCall("sendPhoto", { chat_id: chatId, photo: fileId, ...(caption ? { caption, parse_mode: "HTML" } : {}), ...extra });
/** file_id of the biggest size of a sendPhoto reply, or null. */
export const photoFileId = (json) => {
  const p = json && json.ok && json.result && json.result.photo;
  return Array.isArray(p) && p.length ? String(p[p.length - 1].file_id || "") || null : null;
};

/** Can the bot post in this channel? -> { ok, title, reason }. Never throws. Works for "@name" and "-100..." ids. */
export async function channelPostCheck(chat) {
  const info = await tgCall("getChat", { chat_id: chat }, 8000);
  if (!info.json) return { ok: false, reason: "Could not reach Telegram, try again in a moment." };
  if (!info.json.ok) {
    const d = String(info.json.description || "").toLowerCase();
    return { ok: false, reason: d.includes("chat not found") ? `Telegram cannot find ${chat}. Check the spelling (public @name or the -100… id) and add the bot to the channel first.` : "Telegram said: " + String(info.json.description || "error").slice(0, 120) };
  }
  const type = info.json.result && info.json.result.type;
  if (type !== "channel" && type !== "supergroup" && type !== "group") return { ok: false, reason: "This is not a channel or a group." };
  const me = await tgCall("getChatMember", { chat_id: chat, user_id: Number(botIdFromToken()) }, 8000);
  const m = me.json && me.json.ok ? me.json.result : null;
  const isAdmin = m && (m.status === "creator" || (m.status === "administrator" && (type !== "channel" || m.can_post_messages !== false)));
  if (!isAdmin) return { ok: false, reason: `Make the bot an ADMIN of ${chat} with the right to post messages, then add it again.` };
  return { ok: true, title: String(info.json.result.title || "").slice(0, 80) || null };
}

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

// ---- bot-as-admin helpers (channel campaigns / channel tasks need the bot to be an administrator) ----
const botIdFromToken = () => String(process.env.BOT_TOKEN || "").split(":")[0];
/** "@name" from "@name", "t.me/name" or "https://t.me/name" - or null. */
export function channelFromLink(v) {
  const s = String(v ?? "").trim();
  const m = /^(?:@|(?:https?:\/\/)?(?:www\.)?(?:t|telegram)\.me\/)([A-Za-z0-9_]{5,32})\/?$/i.exec(s);
  return m ? "@" + m[1] : null;
}
/** One-tap link: opens Telegram's "add bot as administrator to a channel" screen with the rights pre-selected. */
export const botAdminLink = (botUsername) => `https://t.me/${botUsername}?startchannel=true&admin=post_messages+edit_messages+invite_users`;
/** Is the bot an administrator of `channel`? -> { admin:boolean, reason:null|"not_found"|"not_admin"|"unavailable" }. Never throws. */
export async function botAdminStatus(channel) {
  if (!isChannelName(channel)) return { admin: false, reason: "not_found" };
  const bid = botIdFromToken();
  const z = await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/getChatMember?chat_id=${encodeURIComponent(channel)}&user_id=${bid}`,
    { signal: AbortSignal.timeout(8000) }).then(r => r.json()).catch(() => null);
  if (z && z.ok) return ["administrator", "creator"].includes(z.result?.status) ? { admin: true, reason: null } : { admin: false, reason: "not_admin" };
  const d = String((z && z.description) || "").toLowerCase();
  if (!z) return { admin: false, reason: "unavailable" };
  if (d.includes("chat not found")) return { admin: false, reason: "not_found" };
  if (z.error_code === 400 || z.error_code === 403) return { admin: false, reason: "not_admin" }; // bot is not even a member
  return { admin: false, reason: "unavailable" };
}
/** Words for each reason (shown to the person adding the campaign / task). */
export const botAdminMessage = (channel, reason) =>
  reason === "not_found" ? `Telegram cannot find ${channel}. It must be a PUBLIC channel and the link spelled exactly.`
  : reason === "unavailable" ? "Could not check the channel right now, please try again in a moment."
  : `First make the bot an ADMIN in ${channel}: tap “Make bot admin”, choose your channel, confirm, then try again.`;
