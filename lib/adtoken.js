// Signed one-time-slot token for "Watch & Earn" (pure: no DB, unit-tested). Bound to user id + daily slot + start time.
import crypto from "node:crypto";

const key = () => crypto.createHmac("sha256", "adwatch").update(process.env.BOT_TOKEN || "").digest();
const sig = (id, slot, ts, net = "") => crypto.createHmac("sha256", key()).update(`${id}.${slot}.${ts}${net ? "." + net : ""}`).digest("hex").slice(0, 32);
/** net (optional, e.g. "monetag") is signed into the token, so a user cannot start an ad on one network and claim the reward of another. */
export const makeToken = (id, slot, ts, net = "") => (net ? `${slot}.${ts}.${net}.${sig(id, slot, ts, net)}` : `${slot}.${ts}.${sig(id, slot, ts)}`);
/** -> { slot, ts[, net] } for a token that is genuinely ours and belongs to this user, otherwise null. */
export function readToken(id, token) {
  const m = /^(\d{1,4})\.(\d{10,14})\.(?:([a-z]{3,12})\.)?([0-9a-f]{32})$/.exec(String(token || ""));
  if (!m) return null;
  const slot = Number(m[1]), ts = Number(m[2]), net = m[3] || "";
  const want = Buffer.from(sig(id, slot, ts, net)), got = Buffer.from(m[4]);
  return want.length === got.length && crypto.timingSafeEqual(want, got) ? (net ? { slot, ts, net } : { slot, ts }) : null;
}

