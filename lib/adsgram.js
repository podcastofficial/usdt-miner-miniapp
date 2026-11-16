// AdsGram "Reward" blocks call a URL from AdsGram's server (GET) when a user finishes a rewarded ad; [userId] is replaced by the Telegram ID.
// This endpoint only ACKNOWLEDGES the callback (HTTP 200). It never credits Points: Points are paid by the app's own signed-token flow
// (lib/actions/adwatch.js), so a forged call to this URL can't create money. Optional shared secret keeps random callers out.
import crypto from "node:crypto";

const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

/** @returns {{status:number, body:object}} */
export function adsgramReward(method, query, env = process.env) {
  if (method !== "GET") return { status: 405, body: { error: "GET only" } };
  const secret = env.ADSGRAM_REWARD_SECRET || "";
  if (secret && !same(query.secret || "", secret)) return { status: 403, body: { error: "forbidden" } };
  // AdsGram's URL check may send a placeholder instead of a real ID, so a non-numeric userid is still answered 200 (nothing is credited either way).
  const uid = String(query.userid ?? query.userId ?? "");
  return { status: 200, body: /^\d{1,15}$/.test(uid) ? { ok: true } : { ok: true, ignored: true } };
}
