import { sql } from "./db.js";
import { HttpError } from "./http.js";

// action -> [max requests, window seconds] per user (fixed window, stored in Postgres)
const LIMITS = {
  default: [60, 60],
  daily: [5, 60], taskStart: [20, 60], taskComplete: [10, 60], withdraw: [3, 60],
  referralVerify: [5, 60], depositSubmit: [5, 60], campaignCreate: [5, 60], channelBotCheck: [15, 60],
  withdrawQuote: [30, 60], withdrawCancel: [5, 60], depositRecheck: [6, 60],
  leaderboard: [30, 60], proofList: [30, 60], campaignList: [20, 60], campaignCancel: [5, 60], communityInfo: [20, 60],
  engagement: [20, 60], referralList: [30, 60], promoRedeem: [5, 60],
  games: [30, 60], gamePlay: [10, 60], drawBuy: [10, 60], boosterBuy: [5, 60],
  taskProofSubmit: [5, 60], contests: [20, 60],
  adWatchStart: [10, 60], adWatchClaim: [10, 60],
  missions: [20, 60], missionClaim: [10, 60], terms: [20, 60], termsAccept: [5, 60],
  autoMiner: [30, 60], autoMinerBuy: [5, 60], autoMinerClaim: [5, 60],
  setLang: [10, 60], adminExport: [10, 60], adminFraudScan: [6, 60], adminHealthRun: [6, 60], adminRoleSet: [10, 60], adminRoleRemove: [10, 60],
  promoFail: [20, 43200], // internal bucket: wrong promo codes per 12 h (see actions/engage.js)
};
export async function rateLimit(userId, action) {
  const [max, win] = LIMITS[action] || (action.startsWith("admin") ? [120, 60] : LIMITS.default);
  const rows = await sql`
    INSERT INTO rate_limits(bucket,window_start,hits)
    VALUES(${userId + ":" + action}, to_timestamp((floor(extract(epoch FROM now())/${win}::int)*${win}::int)::double precision), 1)
    ON CONFLICT(bucket,window_start) DO UPDATE SET hits=rate_limits.hits+1
    RETURNING hits`;
  if (rows[0].hits > max) throw new HttpError(429, "rate_limited", "Too many requests, please slow down");
  if (Math.random() < 0.01) await sql`DELETE FROM rate_limits WHERE window_start < NOW() - INTERVAL '1 day'`;
}
