import crypto from "node:crypto";

export class AuthError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

/**
 * Verifies Telegram Mini App initData (HMAC-SHA256 with a bot-token-derived key).
 * Pure function (no DB / network) so it can be unit-tested.
 * Never trust a raw user id from the browser: the id returned here is signed by Telegram.
 */
export function verifyInitData(raw, { botToken, maxAgeSeconds = 86400, now = Date.now() / 1000 } = {}) {
  if (!botToken) throw new AuthError("server_misconfigured", "Server authentication is not configured");
  if (!raw || typeof raw !== "string") throw new AuthError("missing_init_data", "Telegram authentication required");
  if (raw.length > 4096) throw new AuthError("invalid_init_data", "Invalid initData");

  const params = new URLSearchParams(raw);
  const hash = params.get("hash");
  if (!hash || !/^[a-f0-9]{64}$/i.test(hash)) throw new AuthError("invalid_init_data", "Invalid initData");
  params.delete("hash");

  const checkString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`).join("\n");
  const secret = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
  const expected = crypto.createHmac("sha256", secret).update(checkString).digest();
  if (!crypto.timingSafeEqual(expected, Buffer.from(hash, "hex"))) {
    throw new AuthError("bad_signature", "Telegram authentication failed");
  }

  const authDate = Number(params.get("auth_date"));
  if (!Number.isInteger(authDate) || authDate <= 0) throw new AuthError("invalid_init_data", "Invalid initData");
  if (authDate > now + 60) throw new AuthError("invalid_init_data", "Invalid initData");
  if (now - authDate > maxAgeSeconds) throw new AuthError("expired", "Session expired, please reopen the app");

  let user;
  try { user = JSON.parse(params.get("user") || ""); } catch { throw new AuthError("invalid_init_data", "Invalid initData"); }
  if (!user || !Number.isSafeInteger(user.id) || user.id <= 0) throw new AuthError("invalid_init_data", "User missing");

  return { user, startParam: params.get("start_param") || null, authDate };
}

export const isAdminId = (id) =>
  (process.env.ADMIN_TELEGRAM_IDS || "").split(",").map(x => x.trim()).filter(Boolean).includes(String(id));
