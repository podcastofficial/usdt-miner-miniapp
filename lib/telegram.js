import { HttpError } from "./http.js";
const MEMBER = ["member", "administrator", "creator"];
export const isChannelName = (c) => /^@[A-Za-z0-9_]{5,32}$/.test(String(c || ""));

/** Returns the user's membership status in a channel. Throws 503 if Telegram cannot verify (e.g. bot is not a channel admin). */
export async function chatMemberStatus(channel, userId) {
  const z = await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/getChatMember?chat_id=${encodeURIComponent(channel)}&user_id=${userId}`,
    { signal: AbortSignal.timeout(8000) }).then(r => r.json()).catch(() => null);
  if (!z || !z.ok) throw new HttpError(503, "verification_unavailable", "Verification is temporarily unavailable");
  return z.result?.status || "left";
}
export const isMemberStatus = (s) => MEMBER.includes(s);
