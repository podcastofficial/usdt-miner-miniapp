import { verifyInitData, AuthError } from "../lib/auth.js";
import { ensureUser } from "../lib/users.js";
import { rateLimit } from "../lib/ratelimit.js";
import { sql } from "../lib/db.js";
import { HttpError, send } from "../lib/http.js";
import { INITDATA_MAX_AGE } from "../lib/config.js";
import * as core from "../lib/actions/core.js";
import * as com from "../lib/actions/community.js";
import * as earn from "../lib/actions/earn.js";
import * as ref from "../lib/actions/referral.js";
import * as fin from "../lib/actions/finance.js";
import * as adm from "../lib/actions/admin.js";
import { getConfig } from "../lib/runtime.js";
import { captureReferrer } from "../lib/referral.js";
import * as ntf from "../lib/actions/notify.js";
import * as eng from "../lib/actions/engage.js";
import * as adw from "../lib/actions/adwatch.js";
import * as gam from "../lib/actions/games.js";
import * as tsk from "../lib/actions/tasks.js";
import * as cts from "../lib/actions/contests.js";
import * as saf from "../lib/actions/safety.js";
import * as mis from "../lib/actions/missions.js";
import * as trm from "../lib/actions/terms.js";
import * as amn from "../lib/actions/autominer.js";
import * as p19 from "../lib/actions/parts19.js";
import * as p20 from "../lib/actions/parts20.js";
import * as p21 from "../lib/actions/parts21.js";
import * as p22 from "../lib/actions/parts22.js";
import * as p23 from "../lib/actions/parts23.js";
import * as p24 from "../lib/actions/parts24.js";
import * as p25 from "../lib/actions/parts25.js";
import * as p26 from "../lib/actions/parts26.js";
import * as p27 from "../lib/actions/parts27.js";
import { roleOf, can } from "../lib/roles.js";
import { reportApiError } from "../lib/health.js";
import { adsgramReward } from "../lib/adsgram.js";

// Action registry. write=true -> POST only; admin=true -> server-side admin check on every call.
const ACTIONS = {
  bootstrap: { fn: core.bootstrap },
  referral: { fn: ref.referral },
  referralVerify: { fn: ref.referralVerify, write: true },
  leaderboard: { fn: com.leaderboard },
  communityInfo: { fn: com.communityInfo },
  proofList: { fn: com.proofList },
  daily: { fn: earn.daily, write: true },
  taskStart: { fn: earn.taskStart, write: true },
  taskComplete: { fn: earn.taskComplete, write: true },
  history: { fn: earn.history },
  financeInfo: { fn: fin.financeInfo },
  withdrawQuote: { fn: fin.withdrawQuote },
  withdraw: { fn: fin.withdraw, write: true },
  withdrawList: { fn: fin.withdrawList },
  withdrawCancel: { fn: fin.withdrawCancel, write: true },
  depositSubmit: { fn: fin.depositSubmit, write: true },
  depositRecheck: { fn: fin.depositRecheck, write: true },
  depositList: { fn: fin.depositList },
  campaignList: { fn: com.campaignList },
  channelBotCheck: { fn: com.channelBotCheck, write: true },
  campaignCreate: { fn: com.campaignCreate, write: true },
  campaignCancel: { fn: com.campaignCancel, write: true },
  adminOverview: { fn: core.adminOverview, admin: true },
  adminDiagnostics: { fn: core.adminDiagnostics, admin: true },
  adminCreateTask: { fn: earn.adminCreateTask, admin: true, write: true },
  adminSetTaskActive: { fn: earn.adminSetTaskActive, admin: true, write: true },
  adminReconcile: { fn: earn.adminReconcile, admin: true },
  adminAbuseEvents: { fn: ref.adminAbuseEvents, admin: true },
  adminWithdrawals: { fn: fin.adminWithdrawals, admin: true },
  adminWithdrawalApprove: { fn: fin.adminWithdrawalApprove, admin: true, write: true },
  adminWithdrawalReject: { fn: fin.adminWithdrawalReject, admin: true, write: true },
  adminWithdrawalPaid: { fn: fin.adminWithdrawalPaid, admin: true, write: true },
  adminDeposits: { fn: fin.adminDeposits, admin: true },
  adminDepositApprove: { fn: fin.adminDepositApprove, admin: true, write: true },
  adminDepositReject: { fn: fin.adminDepositReject, admin: true, write: true },
  adminDashboard: { fn: adm.adminDashboard, admin: true },
  adminUsers: { fn: adm.adminUsers, admin: true },
  adminUser: { fn: adm.adminUser, admin: true },
  adminUserBlock: { fn: adm.adminUserBlock, admin: true, write: true },
  adminUserAdjust: { fn: adm.adminUserAdjust, admin: true, write: true },
  adminTasks: { fn: adm.adminTasks, admin: true },
  adminUpdateTask: { fn: adm.adminUpdateTask, admin: true, write: true },
  adminCampaigns: { fn: adm.adminCampaigns, admin: true },
  adminCampaignApprove: { fn: adm.adminCampaignApprove, admin: true, write: true },
  adminCampaignClose: { fn: adm.adminCampaignClose, admin: true, write: true },
  adminSettings: { fn: adm.adminSettings, admin: true },
  adminSettingsUpdate: { fn: adm.adminSettingsUpdate, admin: true, write: true },
  adminAudit: { fn: adm.adminAudit, admin: true },
  adminProofList: { fn: com.adminProofList, admin: true },
  adminProofHide: { fn: com.adminProofHide, admin: true, write: true },
  adminNotifyStatus: { fn: ntf.adminNotifyStatus, admin: true },
  adminNotifyProcess: { fn: ntf.adminNotifyProcess, admin: true, write: true },
  adminWebhookSetup: { fn: ntf.adminWebhookSetup, admin: true, write: true },
  adminBroadcastCreate: { fn: ntf.adminBroadcastCreate, admin: true, write: true },
  adminBroadcastCancel: { fn: ntf.adminBroadcastCancel, admin: true, write: true },
  adminBcChannelAdd: { fn: ntf.adminBcChannelAdd, admin: true, write: true },
  adminBcChannelRemove: { fn: ntf.adminBcChannelRemove, admin: true, write: true },
  adminBcChannelToggle: { fn: ntf.adminBcChannelToggle, admin: true, write: true },
  engagement: { fn: eng.engagement },
  // Parts 19-21 (cumulative compatibility routes).
  checkinCalendar: { fn: p19.checkinCalendar },
  mysteryBoxInfo: { fn: p19.mysteryBoxInfo },
  mysteryBoxClaim: { fn: p19.mysteryBoxClaim, write: true },
  vipInfo: { fn: p20.vipInfo },
  shareCardInfo: { fn: p21.shareCardInfo },
  supportTicketCreate: { fn: p21.supportTicketCreate, write: true },
  supportTicketList: { fn: p21.supportTicketList },
  achievementsInfo: { fn: p21.achievementsInfo },
  seasonPassInfo: { fn: p21.seasonPassInfo },
  adminSupportTickets: { fn: p21.adminSupportTickets, admin: true },
  adminSupportTicketReply: { fn: p21.adminSupportTicketReply, admin: true, write: true },
  referralList: { fn: eng.referralList },
  promoRedeem: { fn: eng.promoRedeem, write: true },
  adWatchInfo: { fn: adw.adWatchInfo },
  adWatchStart: { fn: adw.adWatchStart, write: true },
  adWatchClaim: { fn: adw.adWatchClaim, write: true },
  adminPromoList: { fn: eng.adminPromoList, admin: true },
  adminPromoCreate: { fn: eng.adminPromoCreate, admin: true, write: true },
  adminPromoSetActive: { fn: eng.adminPromoSetActive, admin: true, write: true },
  games: { fn: gam.games },
  gamePlay: { fn: gam.gamePlay, write: true },
  drawBuy: { fn: gam.drawBuy, write: true },
  boosterBuy: { fn: gam.boosterBuy, write: true },
  adminGamesReport: { fn: gam.adminGamesReport, admin: true },
  adminGamePrizeSave: { fn: gam.adminGamePrizeSave, admin: true, write: true },
  adminGamePrizeSetActive: { fn: gam.adminGamePrizeSetActive, admin: true, write: true },
  adminDrawList: { fn: gam.adminDrawList, admin: true },
  adminDrawCreate: { fn: gam.adminDrawCreate, admin: true, write: true },
  adminDrawPick: { fn: gam.adminDrawPick, admin: true, write: true },
  adminDrawCancel: { fn: gam.adminDrawCancel, admin: true, write: true },
  taskProofSubmit: { fn: tsk.taskProofSubmit, write: true },
  adminTaskProofs: { fn: tsk.adminTaskProofs, admin: true },
  adminTaskProofApprove: { fn: tsk.adminTaskProofApprove, admin: true, write: true },
  adminTaskProofReject: { fn: tsk.adminTaskProofReject, admin: true, write: true },
  contests: { fn: cts.contests },
  adminContestList: { fn: cts.adminContestList, admin: true },
  adminContestCreate: { fn: cts.adminContestCreate, admin: true, write: true },
  adminContestCancel: { fn: cts.adminContestCancel, admin: true, write: true },
  adminContestPay: { fn: cts.adminContestPay, admin: true, write: true },
  // Phase 2 / Part 5: safety, roles, export, analytics, language
  adminFraudList: { fn: saf.adminFraudList, admin: true },
  adminFraudReview: { fn: saf.adminFraudReview, admin: true, write: true },
  adminFraudScan: { fn: saf.adminFraudScan, admin: true, write: true },
  adminRoles: { fn: saf.adminRoles, admin: true },
  adminRoleSet: { fn: saf.adminRoleSet, admin: true, write: true },
  adminRoleRemove: { fn: saf.adminRoleRemove, admin: true, write: true },
  adminExport: { fn: saf.adminExport, admin: true, write: true },
  adminAnalytics: { fn: saf.adminAnalytics, admin: true },
  adminHealth: { fn: saf.adminHealth, admin: true },
  adminHealthRun: { fn: saf.adminHealthRun, admin: true, write: true },
  setLang: { fn: saf.setLang, write: true },
  // Part 14: weekly missions, terms & privacy
  missions: { fn: mis.missions },
  missionClaim: { fn: mis.missionClaim, write: true },
  terms: { fn: trm.terms },
  termsAccept: { fn: trm.termsAccept, write: true },
  // Part 17.2: Auto-Miner
  autoMiner: { fn: amn.autoMiner },
  autoMinerBuy: { fn: amn.autoMinerBuy, write: true },
  autoMinerClaim: { fn: amn.autoMinerClaim, write: true },
  adminAutoMinerOverview: { fn: amn.adminAutoMinerOverview, admin: true },
  adminAutoMinerPlanSave: { fn: amn.adminAutoMinerPlanSave, admin: true, write: true },
  adminAutoMinerPlanSetActive: { fn: amn.adminAutoMinerPlanSetActive, admin: true, write: true },
  // Parts 22-27: operations, risk scoring, premium, mining reports, referral challenges, analytics.
  adminUserNotes: { fn: p22.adminUserNotes, admin: true },
  adminUserNoteAdd: { fn: p22.adminUserNoteAdd, admin: true, write: true },
  adminSegments: { fn: p22.adminSegments, admin: true },
  adminSegmentUsers: { fn: p22.adminSegmentUsers, admin: true },
  adminSegmentSave: { fn: p22.adminSegmentSave, admin: true, write: true },
  adminSegmentDelete: { fn: p22.adminSegmentDelete, admin: true, write: true },
  adminRiskOverview: { fn: p23.adminRiskOverview, admin: true },
  adminRiskRecalculate: { fn: p23.adminRiskRecalculate, admin: true, write: true },
  premiumInfo: { fn: p24.premiumInfo },
  premiumBuy: { fn: p24.premiumBuy, write: true },
  adminPremiumTiers: { fn: p24.adminPremiumTiers, admin: true },
  adminPremiumTierSave: { fn: p24.adminPremiumTierSave, admin: true, write: true },
  miningInsights: { fn: p25.miningInsights },
  adminMiningReport: { fn: p25.adminMiningReport, admin: true, write: true },
  referralChallenges: { fn: p26.referralChallenges },
  referralChallengeClaim: { fn: p26.referralChallengeClaim, write: true },
  adminReferralChallenges: { fn: p26.adminReferralChallenges, admin: true },
  adminReferralChallengeSave: { fn: p26.adminReferralChallengeSave, admin: true, write: true },
  adminAnalyticsRange: { fn: p27.adminAnalyticsRange, admin: true, write: true },
  adminAnalyticsReportList: { fn: p27.adminAnalyticsReportList, admin: true },
};

const query_action = (req) => String((req.query && req.query.action) || (req.body && req.body.action) || "bootstrap");
const alertsOn = async () => { try { return (await getConfig()).healthAlerts !== false; } catch { return true; } };

export default async function handler(req, res) {
  try {
    if (req.method === "OPTIONS") { res.statusCode = 204; return res.end(); }
    const query = req.query || {};
    if (query.action === "health") {
      let db = false; try { await sql`SELECT 1`; db = true; } catch {}
      return send(res, db ? 200 : 503, { ok: db, db });
    }
    if (query.action === "adsgramReward") { const r = adsgramReward(req.method, query); return send(res, r.status, r.body); } // AdsGram server callback (no initData)
    let body = req.body || {};
    if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
    if (typeof body !== "object") body = {};

    // Server-to-server entry points: NOT Mini App calls, so no initData. Each has its own secret check (see lib/actions/notify.js).
    if (query.action === "tgWebhook") return send(res, 200, await ntf.tgWebhook({ req, body }));
    if (query.action === "cron") return send(res, 200, await ntf.cron({ req }));

    const tg = verifyInitData(req.headers["x-telegram-init-data"] || body.initData,
      { botToken: process.env.BOT_TOKEN, maxAgeSeconds: INITDATA_MAX_AGE });
    const row = await ensureUser(tg.user, tg.startParam);
    if (tg.startParam && (row.created || (!row.referrer_id && !row.membership_verified))) { try { row.referrer_id = (await captureReferrer(tg.user.id, tg.startParam, { late: !row.created })) ?? row.referrer_id; } catch (e) { console.error("referral capture failed:", e.message); } }
    if (row.is_blocked) throw new HttpError(403, "account_blocked", "Account unavailable");

    const id = String(tg.user.id), role = await roleOf(id), isAdmin = role !== null; // "super" (env) | "support" | "finance" | null
    const cfg = await getConfig();
    if (cfg.maintenanceMode && !isAdmin) throw new HttpError(503, "maintenance", cfg.announcement || "Under maintenance, please come back soon");
    const action = query.action || body.action || "bootstrap";
    const def = Object.prototype.hasOwnProperty.call(ACTIONS, action) ? ACTIONS[action] : null;
    if (!def) throw new HttpError(404, "unknown_action", "Unknown action");
    if (def.write && req.method !== "POST") throw new HttpError(405, "method_not_allowed", "POST required");
    if (def.admin && !isAdmin) throw new HttpError(403, "admin_only", "Admin only");
    if (def.admin && !can(role, action)) throw new HttpError(403, "forbidden_role", "Your admin role cannot do this"); // fail closed: an action with no entry in ACTION_PERMS is denied to everyone

    await rateLimit(id, action, { memory: !def.write && !def.admin }); // reads: in-memory counter, writes/admin: Postgres counter
    return send(res, 200, await def.fn({ id, row, isAdmin, role, body, query, startParam: tg.startParam, host: req.headers["x-forwarded-host"] || req.headers.host }));
  } catch (e) {
    if (e instanceof AuthError) return send(res, e.code === "server_misconfigured" ? 500 : 401, { error: e.message, code: e.code });
    if (e instanceof HttpError) return send(res, e.status, { error: e.message, code: e.code });
    console.error("API error:", e); // details stay in server logs, never sent to the client
    await reportApiError(query_action(req), e, await alertsOn()); // Telegram message to the admins (throttled, never throws)
    return send(res, 500, { error: "Server error, please try again", code: "server_error" });
  }
}
