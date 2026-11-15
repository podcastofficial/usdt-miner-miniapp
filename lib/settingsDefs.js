// Part 5: every admin-manageable option in ONE place (pure, no DB -> unit-testable).
// Stored in the `settings` table (JSONB). A missing/invalid row falls back to the env value / default below.
import { PPU, MIN, FEE, DEPOSITS_ENABLED, DEPOSIT_AUTO_CREDIT, MIN_DEPOSIT, DEPOSIT_CONFIRMATIONS, MAX_OPEN_WITHDRAWALS } from "./config.js";

const num = (v) => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN);
const int = (min, max) => (v) => { const n = num(v); return Number.isSafeInteger(n) && n >= min && n <= max ? n : undefined; };
const dec = (min, max) => (v) => { const n = num(v); return Number.isFinite(n) && n >= min && n <= max ? Math.round(n * 100) / 100 : undefined; };
const bool = (v) => (typeof v === "boolean" ? v : v === "true" ? true : v === "false" ? false : undefined);
const text = (max, re = null) => (v) => { if (typeof v !== "string") return undefined; const s = v.trim(); return s.length <= max && (!re || re.test(s)) ? s : undefined; };
const tz = (v) => { if (typeof v !== "string" || !v) return undefined; try { new Intl.DateTimeFormat("en-US", { timeZone: v }); return v; } catch { return undefined; } };
const CH = /^@[A-Za-z0-9_]{5,32}$/;
const channels = (v) => {
  const a = Array.isArray(v) ? v : typeof v === "string" ? v.split(/[\s,]+/).filter(Boolean) : null;
  return a && a.length >= 1 && a.length <= 10 && a.every(c => CH.test(c)) ? [...new Set(a)] : undefined;
};

export const SETTING_DEFS = {
  // --- withdrawals ---
  withdrawals_enabled:  { group: "Withdrawals", label: "Withdrawals enabled", type: "bool", def: true, parse: bool, help: "Turn off to pause new withdrawal requests." },
  points_per_usdt:      { group: "Withdrawals", label: "Points per 1 USDT", type: "int", def: PPU, parse: int(1, 1e9), help: "Also used to turn deposits into Points." },
  min_withdraw_usdt:    { group: "Withdrawals", label: "Minimum withdrawal (USDT)", type: "dec", def: MIN, parse: dec(0.01, 1e6) },
  withdraw_fee_percent: { group: "Withdrawals", label: "Withdrawal fee (%)", type: "dec", def: FEE, parse: dec(0, 50) },
  max_open_withdrawals: { group: "Withdrawals", label: "Max open requests per user", type: "int", def: MAX_OPEN_WITHDRAWALS, parse: int(1, 20) },
  // --- deposits ---
  deposits_enabled:     { group: "Deposits", label: "Deposits enabled", type: "bool", def: DEPOSITS_ENABLED, parse: bool, help: "Needs a deposit wallet address below." },
  deposit_wallet:       { group: "Deposits", label: "Deposit wallet (BEP-20)", type: "text", def: process.env.DEPOSIT_WALLET_ADDRESS || "", parse: text(42, /^(0x[a-fA-F0-9]{40})?$/), help: "Your BSC address that receives USDT." },
  deposit_auto_credit:  { group: "Deposits", label: "Auto-credit verified deposits", type: "bool", def: DEPOSIT_AUTO_CREDIT, parse: bool, help: "OFF = admin approves each verified deposit." },
  min_deposit_usdt:     { group: "Deposits", label: "Minimum deposit (USDT)", type: "dec", def: MIN_DEPOSIT, parse: dec(0.01, 1e6) },
  deposit_confirmations:{ group: "Deposits", label: "Confirmations required", type: "int", def: DEPOSIT_CONFIRMATIONS, parse: int(1, 200) },
  // --- rewards ---
  daily_reward:         { group: "Rewards", label: "Daily reward (Points)", type: "int", def: 100, parse: int(1, 1e7) },
  referral_reward:      { group: "Rewards", label: "Referral reward (Points)", type: "int", def: 1000, parse: int(1, 1e7) },
  daily_timezone:       { group: "Rewards", label: "Daily reset timezone", type: "text", def: "Asia/Kolkata", parse: tz, help: "IANA name, e.g. Asia/Kolkata" },
  // --- channels / bot ---
  required_channels:    { group: "Channels & Bot", label: "Required channels", type: "list", def: ["@USDTMinerUpdates", "@USDTMinerPayments"], parse: channels, help: "One per line. Bot must be admin in each." },
  bot_username:         { group: "Channels & Bot", label: "Bot username (no @)", type: "text", def: process.env.BOT_USERNAME || "USDTMinerOfficialBot", parse: text(32, /^[A-Za-z0-9_]{5,32}$/) },
  miniapp_short_name:   { group: "Channels & Bot", label: "Mini App short name", type: "text", def: process.env.MINIAPP_SHORT_NAME || "", parse: text(32, /^[A-Za-z0-9_]{0,32}$/), help: "Leave empty for the bot's Main Mini App." },
  // --- Part 6: community & advertising ---
  ads_enabled:          { group: "Community & Ads", label: "Advertising enabled", type: "bool", def: true, parse: bool, help: "Turn off to stop new campaigns (existing ones keep running)." },
  ad_min_reward:        { group: "Community & Ads", label: "Min reward per completion (Points)", type: "int", def: 10, parse: int(1, 1e6) },
  ad_min_target:        { group: "Community & Ads", label: "Min completions per campaign", type: "int", def: 10, parse: int(1, 1e6) },
  ad_max_pending:       { group: "Community & Ads", label: "Max pending campaigns per user", type: "int", def: 3, parse: int(1, 20) },
  official_channel:     { group: "Community & Ads", label: "Official channel", type: "text", def: "@USDTMinerUpdates", parse: text(33, CH), help: "Shown on the Official Channel screen." },
  payments_channel:     { group: "Community & Ads", label: "Payments channel", type: "text", def: "@USDTMinerPayments", parse: text(33, CH), help: "Where payment proofs are posted." },
  support_link:         { group: "Community & Ads", label: "Support contact", type: "text", def: "", parse: text(100, /^(|@[A-Za-z0-9_]{5,32}|https:\/\/t\.me\/[A-Za-z0-9_+\/]{3,64})$/), help: "@username or https://t.me/... link. Empty = hidden." },
  proof_public:         { group: "Community & Ads", label: "Show Payment Proof to users", type: "bool", def: true, parse: bool, help: "Public list of paid withdrawals (names are masked). Hide single items in Admin > Proof." },
  // --- general ---
  maintenance_mode:     { group: "General", label: "Maintenance mode", type: "bool", def: false, parse: bool, help: "Blocks everyone except admins." },
  announcement:         { group: "General", label: "Announcement banner", type: "text", def: "", parse: text(200), help: "Shown at the top of the app. Empty = hidden." },
};

export const camel = (k) => k.replace(/_([a-z])/g, (_, c) => c.toUpperCase());

/** { ok:true, value } | { ok:false, error } for one admin-submitted value. */
export function validateSetting(key, raw) {
  const d = Object.prototype.hasOwnProperty.call(SETTING_DEFS, key) ? SETTING_DEFS[key] : null;
  if (!d) return { ok: false, error: `Unknown setting: ${key}` };
  const v = d.parse(raw);
  return v === undefined ? { ok: false, error: `Invalid value for "${d.label}"` } : { ok: true, value: v };
}

/** settings rows [{key,value}] -> effective config object (camelCase keys); bad/missing rows use the default. */
export function resolveConfig(rows) {
  const stored = Object.fromEntries((rows || []).map(r => [r.key, r.value]));
  const cfg = {};
  for (const [k, d] of Object.entries(SETTING_DEFS)) {
    const v = k in stored ? d.parse(stored[k]) : undefined;
    cfg[camel(k)] = v === undefined ? d.def : v;
  }
  return cfg;
}
