// Phase 2 / Part 5: admin roles. Pure rules (no DB) so the permission matrix is unit-testable.
//   super   = Telegram IDs in ADMIN_TELEGRAM_IDS (env). Everything. Cannot be changed from the app.
//   support = users, tasks, campaigns, proofs, fraud review. No money, no settings.
//   finance = withdrawals, deposits, ledger, exports, analytics, audit. No settings, no Points adjust.
// Every admin action in api/index.js MUST appear in ACTION_PERMS (a test fails otherwise), and the server checks it on every call.
import { isAdminId } from "./auth.js";
import { sql } from "./db.js";

export const ROLES = ["super", "support", "finance"];
export const GRANTABLE = ["support", "finance"]; // the only roles the app can hand out; super stays in the env
export const PERMS = ["dashboard", "finance", "users_read", "users_block", "users_adjust", "tasks", "campaigns", "proofs_review", "rewards",
  "notify", "settings", "audit", "fraud", "analytics", "csv", "roles", "system", "proof", "ops", "risk", "premium", "mining"];

export const ROLE_PERMS = {
  super: new Set(PERMS),
  support: new Set(["dashboard", "users_read", "users_block", "tasks", "campaigns", "proofs_review", "fraud", "proof", "ops", "risk"]),
  finance: new Set(["dashboard", "finance", "users_read", "fraud", "analytics", "csv", "audit", "mining"]),
};

export const ACTION_PERMS = {
  adminOverview: "dashboard", adminDashboard: "dashboard",
  adminDiagnostics: "system", adminHealth: "system", adminHealthRun: "system",
  adminReconcile: "finance", adminAbuseEvents: "fraud",
  adminCreateTask: "tasks", adminSetTaskActive: "tasks", adminTasks: "tasks", adminUpdateTask: "tasks",
  adminWithdrawals: "finance", adminWithdrawalApprove: "finance", adminWithdrawalReject: "finance", adminWithdrawalPaid: "finance",
  adminDeposits: "finance", adminDepositApprove: "finance", adminDepositReject: "finance",
  adminUsers: "users_read", adminUser: "users_read", adminUserBlock: "users_block", adminUserAdjust: "users_adjust",
  adminCampaigns: "campaigns", adminCampaignApprove: "campaigns", adminCampaignClose: "campaigns",
  adminSettings: "settings", adminSettingsUpdate: "settings",
  adminAudit: "audit",
  adminProofList: "proof", adminProofHide: "proof",
  adminNotifyStatus: "notify", adminNotifyProcess: "notify", adminWebhookSetup: "notify", adminBroadcastCreate: "notify", adminBroadcastCancel: "notify",
  adminPromoList: "rewards", adminPromoCreate: "rewards", adminPromoSetActive: "rewards",
  adminGamesReport: "rewards", adminGamePrizeSave: "rewards", adminGamePrizeSetActive: "rewards",
  adminDrawList: "rewards", adminDrawCreate: "rewards", adminDrawPick: "rewards", adminDrawCancel: "rewards",
  adminTaskProofs: "proofs_review", adminTaskProofApprove: "proofs_review", adminTaskProofReject: "proofs_review",
  adminContestList: "rewards", adminContestCreate: "rewards", adminContestCancel: "rewards", adminContestPay: "rewards",
  adminAutoMinerOverview: "rewards", adminAutoMinerPlanSave: "rewards", adminAutoMinerPlanSetActive: "rewards",
  // Part 5
  adminFraudList: "fraud", adminFraudReview: "fraud", adminFraudScan: "fraud",
  adminRoles: "roles", adminRoleSet: "roles", adminRoleRemove: "roles",
  adminExport: "csv", adminAnalytics: "analytics",
  adminSupportTickets: "ops", adminSupportTicketReply: "ops",
  adminUserNotes: "ops", adminUserNoteAdd: "ops", adminSegments: "ops", adminSegmentUsers: "ops", adminSegmentSave: "ops", adminSegmentDelete: "ops",
  adminRiskOverview: "risk", adminRiskRecalculate: "risk",
  adminPremiumTiers: "premium", adminPremiumTierSave: "premium",
  adminMiningReport: "mining",
  adminReferralChallenges: "rewards", adminReferralChallengeSave: "rewards",
  adminAnalyticsRange: "analytics", adminAnalyticsReportList: "analytics",
};

/** Permission check. Unknown action, unknown role or no role -> denied (fail closed). */
export function can(role, action) {
  const perm = Object.prototype.hasOwnProperty.call(ACTION_PERMS, action) ? ACTION_PERMS[action] : null;
  const set = role && Object.prototype.hasOwnProperty.call(ROLE_PERMS, role) ? ROLE_PERMS[role] : null;
  return Boolean(perm && set && set.has(perm));
}
export const permsOf = (role) => (role && ROLE_PERMS[role] ? [...ROLE_PERMS[role]] : []);

// ---- DB-backed role lookup (small table -> one cached read per ~5 s per instance) ----
let cache = null, at = 0;
async function table() {
  if (cache && Date.now() - at < 5000) return cache;
  try { cache = new Map((await sql`SELECT telegram_id::text AS id, role FROM admin_roles`).map(r => [r.id, r.role])); }
  catch { cache = new Map(); } // migration 011 not run yet: env super admins keep working, nobody else is an admin
  at = Date.now();
  return cache;
}
export const invalidateRoles = () => { cache = null; };

/** The role of a Telegram ID: "super" (env), "support" / "finance" (table) or null. */
export async function roleOf(id) {
  if (isAdminId(id)) return "super";
  const r = (await table()).get(String(id));
  return GRANTABLE.includes(r) ? r : null;
}
