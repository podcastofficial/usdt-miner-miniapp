// Signed one-time-slot token for "Watch & Earn" (pure: no DB, unit-tested). Bound to user id + daily slot + start time.
import crypto from "node:crypto";

const key = () => crypto.createHmac("sha256", "adwatch").update(process.env.BOT_TOKEN || "").digest();
const sig = (id, slot, ts) => crypto.createHmac("sha256", key()).update(`${id}.${slot}.${ts}`).digest("hex").slice(0, 32);
export const makeToken = (id, slot, ts) => `${slot}.${ts}.${sig(id, slot, ts)}`;
/** -> { slot, ts } for a token that is genuinely ours and belongs to this user, otherwise null. */
export function readToken(id, token) {
  const m = /^(\d{1,4})\.(\d{10,14})\.([0-9a-f]{32})$/.exec(String(token || ""));
  if (!m) return null;
  const slot = Number(m[1]), ts = Number(m[2]);
  const want = Buffer.from(sig(id, slot, ts)), got = Buffer.from(m[3]);
  return want.length === got.length && crypto.timingSafeEqual(want, got) ? { slot, ts } : null;
}

