// "Watch an ad, earn Points" (Monetag / Adsgram rewarded ads).
// Server rules (the ad network cannot be trusted by itself): daily limit, cooldown, minimum watch time, one signed token per ad,
// and one ledger slot per (user, day, n) so two parallel requests can never pay the same slot twice. No new tables: the ledger is the record.
import { sql } from "../db.js";
import { HttpError } from "../http.js";
import { getConfig } from "../runtime.js";
import { rateLimit } from "../ratelimit.js";
import { creditEx } from "../ledger.js";
import { makeToken, readToken } from "../adtoken.js";

const bad = (msg, code = "bad_request", status = 400) => new HttpError(status, code, msg);
const TYPE = "Ad Reward";
const NETS = {
  adsgram:  { cfg: "adsgramBlockId",  ok: (v) => !!v,                          rw: "watchAdRewardAdsgram" },
  monetag:  { cfg: "monetagZoneId",   ok: (v) => /^\d{1,15}$/.test(v || ""),   rw: "watchAdRewardMonetag" },
  gigapub:  { cfg: "gigapubProjectId", ok: (v) => !!v,                         rw: "watchAdRewardGigapub" },
  onclicka: { cfg: "onclickaId",      ok: (v) => !!v,                          rw: "watchAdRewardOnclicka" },
};
/** Networks that get a button: chosen by watch_ad_network, only those with an ID filled. Each has its own reward (0 = default). */
export function watchNetworks(c) {
  const want = c.watchAdNetwork === "all" ? Object.keys(NETS) : c.watchAdNetwork === "both" ? ["adsgram", "monetag"] : NETS[c.watchAdNetwork] ? [c.watchAdNetwork] : ["monetag"];
  return want.filter((n) => NETS[n].ok(c[NETS[n].cfg]))
    .map((n) => ({ id: n, reward: Number(c[NETS[n].rw]) > 0 ? Number(c[NETS[n].rw]) : c.watchAdReward }));
}
const MAX_AGE_MS = 15 * 60 * 1000; // a token older than this must be restarted

async function state(id, c) {
  const r = (await sql`
    SELECT to_char(NOW() AT TIME ZONE 'UTC','YYYYMMDD') AS day,
      (SELECT COUNT(*)::int FROM transactions WHERE telegram_id=${id}::bigint AND type=${TYPE}::text
         AND created_at >= (date_trunc('day', NOW() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')) AS used,
      (SELECT EXTRACT(EPOCH FROM (NOW() - MAX(created_at)))::float FROM transactions WHERE telegram_id=${id}::bigint AND type=${TYPE}::text) AS since`)[0];
  const used = Number(r.used), since = r.since == null ? null : Number(r.since);
  const cooldownLeft = since == null ? 0 : Math.max(0, Math.ceil(c.watchAdCooldown - since));
  return { day: r.day, used, left: Math.max(0, c.watchAdDailyLimit - used), cooldownLeft };
}
async function guard(id) {
  const c = await getConfig();
  if (!c.watchAdEnabled) throw bad("Watch & Earn is not available right now", "adwatch_disabled", 403);
  const s = await state(id, c);
  if (s.left <= 0) throw bad("Daily ad limit reached. Come back tomorrow.", "adwatch_limit", 429);
  if (s.cooldownLeft > 0) throw bad(`Next ad in ${s.cooldownLeft} seconds`, "adwatch_cooldown", 429);
  return { c, s };
}

export const adWatchInfo = async ({ id }) => {
  const c = await getConfig();
  if (!c.watchAdEnabled) return { enabled: false };
  const s = await state(id, c);
  return { enabled: true, networks: watchNetworks(c), reward: c.watchAdReward, limit: c.watchAdDailyLimit, used: s.used, left: s.left, cooldown_left: s.cooldownLeft };
};

export const adWatchStart = async ({ id, body }) => {
  await rateLimit(id, "adWatchStart");
  const { c, s } = await guard(id);
  const list = watchNetworks(c);
  const net = String((body && body.network) || (list[0] && list[0].id) || "");
  const pick = list.find((x) => x.id === net);
  if (!pick) throw bad("This ad network is not available", "adwatch_network");
  return { token: makeToken(id, s.used + 1, Date.now(), pick.id), min_seconds: c.watchAdMinSeconds, reward: pick.reward, network: pick.id };
};

export const adWatchClaim = async ({ id, body }) => {
  await rateLimit(id, "adWatchClaim");
  const { c, s } = await guard(id);
  const t = readToken(id, body && body.token);
  const age = t ? Date.now() - t.ts : 0;
  if (!t || age < 0 || age > MAX_AGE_MS || t.slot !== s.used + 1) throw bad("This ad has expired. Please watch again.", "adwatch_expired");
  if (age < c.watchAdMinSeconds * 1000) throw bad("Please watch the full ad to earn Points.", "adwatch_early");
  const pick = t.net ? watchNetworks(c).find((x) => x.id === t.net) : null;
  if (t.net && !pick) throw bad("This ad network is not available", "adwatch_network");
  const reward = pick ? pick.reward : c.watchAdReward;
  const r = await creditEx(id, reward, TYPE, t.net ? `Watched an ad (${t.net})` : "Watched an ad", `adwatch:${id}:${s.day}:${t.slot}`);
  if (r.duplicate) throw bad("Please try again in a moment.", "adwatch_busy", 409);
  return { reward, balance: r.balance, left: Math.max(0, c.watchAdDailyLimit - t.slot) };
};
