// Part 5: every admin-manageable option in ONE place (pure, no DB -> unit-testable).
// Stored in the `settings` table (JSONB). A missing/invalid row falls back to the env value / default below.
import { DEFAULT_TERMS, DEFAULT_PRIVACY } from "./terms.js";
import { PPU, MIN, FEE, DEPOSITS_ENABLED, DEPOSIT_AUTO_CREDIT, MIN_DEPOSIT, DEPOSIT_CONFIRMATIONS, MAX_OPEN_WITHDRAWALS } from "./config.js";

const num = (v) => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN);
const int = (min, max) => (v) => { const n = num(v); return Number.isSafeInteger(n) && n >= min && n <= max ? n : undefined; };
const dec = (min, max) => (v) => { const n = num(v); return Number.isFinite(n) && n >= min && n <= max ? Math.round(n * 100) / 100 : undefined; };
const bool = (v) => (typeof v === "boolean" ? v : v === "true" ? true : v === "false" ? false : undefined);
const text = (max, re = null) => (v) => { if (typeof v !== "string") return undefined; const s = v.trim(); return s.length <= max && (!re || re.test(s)) ? s : undefined; };
const longtext = (max) => (v) => { if (typeof v !== "string") return undefined; const s = v.replace(/\r\n/g, "\n").trim(); return s.length <= max ? s : undefined; };
const tz = (v) => { if (typeof v !== "string" || !v) return undefined; try { new Intl.DateTimeFormat("en-US", { timeZone: v }); return v; } catch { return undefined; } };
const CH = /^@[A-Za-z0-9_]{5,32}$/;
const oneOf = (...a) => (v) => (typeof v === "string" && a.includes(v.trim().toLowerCase()) ? v.trim().toLowerCase() : undefined);
const LINK = /^(|(https?:\/\/|t\.me\/|telegram\.me\/|@)\S{3,290})$/;
// Streak ladder: exactly 7 whole-number rewards (one per day). Accepts an array or a comma/space/newline separated string.
const ladder = (v) => {
  const a = Array.isArray(v) ? v : typeof v === "string" ? v.split(/[\s,]+/).filter(Boolean) : null;
  if (!a || a.length !== 7) return undefined;
  const n = a.map(num);
  return n.every(x => Number.isSafeInteger(x) && x >= 1 && x <= 1e6) ? n : undefined;
};
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
  wallet_cooldown_hours:{ group: "Withdrawals", label: "New wallet waiting time (hours)", type: "int", def: 24, parse: int(0, 720), help: "A wallet address the user has never used must wait this long before a withdrawal can go to it. 0 = off." },
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
  ad_user_share_pct:    { group: "Community & Ads", label: "Advertise: % of the reward the joiner gets (rest goes to the platform)", type: "int", def: 50, parse: int(1, 100), help: "Only user campaigns (Advertise). Admin tasks always pay their full reward. Applies to campaigns approved after you change it." },
  ad_max_pending:       { group: "Community & Ads", label: "Max pending campaigns per user", type: "int", def: 3, parse: int(1, 20) },
  official_channel:     { group: "Community & Ads", label: "Official channel", type: "text", def: "@USDTMinerUpdates", parse: text(33, CH), help: "Shown on the Official Channel screen." },
  payments_channel:     { group: "Community & Ads", label: "Payments channel", type: "text", def: "@USDTMinerPayments", parse: text(33, CH), help: "Where payment proofs are posted." },
  support_link:         { group: "Community & Ads", label: "Support contact", type: "text", def: "", parse: text(100, /^(|@[A-Za-z0-9_]{5,32}|https:\/\/t\.me\/[A-Za-z0-9_+\/]{3,64})$/), help: "@username or https://t.me/... link. Empty = hidden." },
  proof_public:         { group: "Community & Ads", label: "Show Payment Proof to users", type: "bool", def: true, parse: bool, help: "Public list of paid withdrawals (names are masked). Hide single items in Admin > Proof." },
  // --- Phase 2 / Part 1: notifications ---
  notify_withdrawal:    { group: "Notifications", label: "Notify users about withdrawals", type: "bool", def: true, parse: bool, help: "Approved / paid / rejected messages from the bot." },
  notify_referral:      { group: "Notifications", label: "Notify inviter when a referral joins", type: "bool", def: true, parse: bool },
  notify_reminder:      { group: "Notifications", label: "Daily reward reminder", type: "bool", def: false, parse: bool, help: "Sent by the daily cron to users who have not claimed yet. Starts OFF." },
  proof_autopost:       { group: "Notifications", label: "Auto-post paid withdrawals to Payments channel", type: "bool", def: false, parse: bool, help: "Bot must be admin in the payments channel. Names are masked. Starts OFF." },
  admin_campaign_alerts: { group: "Notifications", label: "Alert admins about campaign / task activity", type: "bool", def: true, parse: bool, help: "The bot messages every admin when a campaign is created, cancelled, approved or rejected, and when a task is added." },
  task_alerts_enabled:  { group: "Notifications", label: "Announce new tasks in a channel", type: "bool", def: true, parse: bool, help: "When a task is added (or a campaign is approved) the bot posts it in the channel below. Bot must be admin there (post rights)." },
  task_alert_channel:   { group: "Notifications", label: "Channel for new-task announcements", type: "text", def: "", parse: text(33, /^(|@[A-Za-z0-9_]{5,32})$/), help: "@channel. Empty = the Official channel." },
  broadcast_enabled:    { group: "Notifications", label: "Admin broadcast enabled", type: "bool", def: true, parse: bool, help: "Turn off to block new broadcasts." },
  // --- Phase 2 / Part 2: engagement ---
  streak_enabled:       { group: "Engagement", label: "Daily streak ladder", type: "bool", def: false, parse: bool, help: "OFF = everyone gets the flat daily reward. ON = reward follows the 7-day ladder below. Starts OFF." },
  streak_ladder:        { group: "Engagement", label: "Streak ladder (7 numbers, day 1 to day 7)", type: "list", def: [100, 120, 140, 160, 180, 200, 300], parse: ladder, help: "One number per line. After day 7 the ladder starts again. A missed day resets to day 1." },
  milestones_enabled:   { group: "Engagement", label: "Referral milestone bonuses", type: "bool", def: false, parse: bool, help: "Pays inviters once at 5 / 10 / 50 qualified referrals. Turning it ON also pays milestones already reached. Starts OFF." },
  milestone_reward_5:   { group: "Engagement", label: "Milestone bonus: 5 referrals (Points)", type: "int", def: 500, parse: int(1, 1e7), help: "Starter value - confirm before enabling." },
  milestone_reward_10:  { group: "Engagement", label: "Milestone bonus: 10 referrals (Points)", type: "int", def: 1500, parse: int(1, 1e7), help: "Starter value - confirm before enabling." },
  milestone_reward_50:  { group: "Engagement", label: "Milestone bonus: 50 referrals (Points)", type: "int", def: 10000, parse: int(1, 1e7), help: "Starter value - confirm before enabling." },
  level_silver_at:      { group: "Engagement", label: "Silver level at (lifetime earned Points)", type: "int", def: 10000, parse: int(1, 1e9), help: "Bronze starts at 0. Levels are cosmetic and pay nothing." },
  level_gold_at:        { group: "Engagement", label: "Gold level at (lifetime earned Points)", type: "int", def: 50000, parse: int(1, 1e9), help: "Must be higher than Silver." },
  promo_enabled:        { group: "Engagement", label: "Promo codes", type: "bool", def: false, parse: bool, help: "Lets users redeem codes created in Admin > Promo. Starts OFF." },
  // --- Phase 2 / Part 3: games & boosters (Points only; everything that pays Points ships OFF) ---
  games_enabled:        { group: "Games & Boosters", label: "Games (Spin / Scratch / Lucky Box)", type: "bool", def: false, parse: bool, help: "Master switch. Free plays pay real Points, so check the prize tables in Admin > Games first. Starts OFF." },
  game_spin_enabled:    { group: "Games & Boosters", label: "Spin Wheel on", type: "bool", def: true, parse: bool, help: "Only works while the master switch is ON." },
  game_scratch_enabled: { group: "Games & Boosters", label: "Scratch Card on", type: "bool", def: true, parse: bool, help: "Only works while the master switch is ON." },
  game_box_enabled:     { group: "Games & Boosters", label: "Lucky Box on", type: "bool", def: true, parse: bool, help: "Only works while the master switch is ON." },
  game_free_plays:      { group: "Games & Boosters", label: "Free plays per game per day", type: "int", def: 1, parse: int(0, 20), help: "Counted per game, resets at midnight in the daily reward time zone." },
  game_entry_fee:       { group: "Games & Boosters", label: "Entry fee after the free plays (Points)", type: "int", def: 0, parse: int(0, 1e6), help: "0 = no extra plays. A fee above 0 lets users keep playing, up to the daily maximum below." },
  game_max_plays:       { group: "Games & Boosters", label: "Max plays per game per day (free + paid)", type: "int", def: 5, parse: int(1, 100), help: "Only used when an entry fee is set." },
  game_win_cap:         { group: "Games & Boosters", label: "Max prize per user per game per day (Points)", type: "int", def: 500, parse: int(1, 1e7), help: "Prizes are cut down to what is left of this cap. Applies to each game separately." },
  lucky_draw_enabled:   { group: "Games & Boosters", label: "Lucky Draw", type: "bool", def: false, parse: bool, help: "Lets users buy tickets for the open draw created in Admin > Games. Starts OFF." },
  booster_enabled:      { group: "Games & Boosters", label: "Mining Boosters", type: "bool", def: false, parse: bool, help: "Users spend Points for a time-limited multiplier on the daily reward. Starts OFF." },
  booster_cost:         { group: "Games & Boosters", label: "Booster price (Points)", type: "int", def: 2000, parse: int(1, 1e7), help: "Starter value - confirm before enabling." },
  booster_percent:      { group: "Games & Boosters", label: "Booster multiplier (%)", type: "int", def: 150, parse: int(101, 500), help: "150 = daily reward x1.5. Whole Points, rounded down." },
  booster_hours:        { group: "Games & Boosters", label: "Booster length (hours)", type: "int", def: 24, parse: int(1, 168), help: "Only one booster can be active at a time." },
  // --- Phase 2 / Part 4: tasks with proof, ads, contests (anything that pays Points ships OFF) ---
  task_proof_enabled:   { group: "Tasks, Ads & Contests", label: "Tasks that need a proof", type: "bool", def: false, parse: bool, help: "Lets users submit proofs for bot / website tasks marked \"proof required\"; approving a proof pays Points. New bot / website campaigns then need a proof too. Starts OFF." },
  task_proof_max_pending: { group: "Tasks, Ads & Contests", label: "Max proofs waiting per user", type: "int", def: 5, parse: int(1, 50), help: "Stops one user from flooding the review queue." },
  task_proof_max_tries: { group: "Tasks, Ads & Contests", label: "Attempts per task after rejections", type: "int", def: 3, parse: int(1, 10), help: "After this many rejected proofs the user cannot try that task again." },
  contests_enabled:     { group: "Tasks, Ads & Contests", label: "Referral contests", type: "bool", def: false, parse: bool, help: "Shows the contest in More > Contests. Create and pay contests in Admin > Contests. Starts OFF." },
  // --- Phase 2 / Part 5: safety, alerts (flags only ever ask a human; nothing here blocks or pays anyone) ---
  fraud_enabled:        { group: "Safety & Alerts", label: "Automatic fraud scan (daily cron)", type: "bool", def: false, parse: bool, help: "Creates flags for Admin > Safety. Flags never block anyone. \"Scan now\" in Admin > Safety always works. Starts OFF." },
  fraud_wallet_min_users: { group: "Safety & Alerts", label: "Flag a wallet used by this many accounts", type: "int", def: 2, parse: int(2, 20) },
  fraud_burst_count:    { group: "Safety & Alerts", label: "Referral burst: referrals in one window", type: "int", def: 10, parse: int(2, 1000) },
  fraud_burst_minutes:  { group: "Safety & Alerts", label: "Referral burst: window length (minutes)", type: "int", def: 30, parse: int(1, 1440) },
  fraud_claims_count:   { group: "Safety & Alerts", label: "Rapid claims: tasks done in one window", type: "int", def: 15, parse: int(2, 1000) },
  fraud_claims_minutes: { group: "Safety & Alerts", label: "Rapid claims: window length (minutes)", type: "int", def: 10, parse: int(1, 1440) },
  health_alerts:        { group: "Safety & Alerts", label: "Health alerts to admins on Telegram", type: "bool", def: true, parse: bool, help: "API errors, ledger mismatch, many open withdrawals. At most one message per problem per 30 min - 6 h. Admins must have started the bot." },
  alert_open_withdrawals: { group: "Safety & Alerts", label: "Alert when open withdrawals reach", type: "int", def: 20, parse: int(1, 100000) },
  // --- Popup ads (shown when a user opens Tasks / Ads / Games) ---
  popup_ad_enabled:     { group: "Popup Ads", label: "Popup ads", type: "bool", def: false, parse: bool, help: "Master switch. Shows a popup ad when a user opens Tasks, Ads or Games. Starts OFF." },
  popup_ad_on_tasks:    { group: "Popup Ads", label: "Show in Tasks", type: "bool", def: true, parse: bool },
  popup_ad_on_ads:      { group: "Popup Ads", label: "Show in Ads", type: "bool", def: true, parse: bool },
  popup_ad_on_games:    { group: "Popup Ads", label: "Show in Games", type: "bool", def: true, parse: bool },
  popup_ad_type:        { group: "Popup Ads", label: "Popup type (own / adsgram / monetag / both)", type: "text", def: "own", parse: oneOf("own", "adsgram", "monetag", "both"), help: "own = your popup below. adsgram / monetag = that network only. both = Adsgram, then Monetag, then your own popup (each one is used only if its ID is filled and it has an ad)." },
  popup_ad_cooldown:    { group: "Popup Ads", label: "Gap between popups (seconds)", type: "int", def: 120, parse: int(10, 86400), help: "A user sees at most one popup per this many seconds." },
  popup_ad_wait:        { group: "Popup Ads", label: "Close button after (seconds)", type: "int", def: 3, parse: int(0, 15), help: "Own popup only." },
  popup_ad_title:       { group: "Popup Ads", label: "Own popup: title", type: "text", def: "", parse: text(60) },
  popup_ad_text:        { group: "Popup Ads", label: "Own popup: text", type: "text", def: "", parse: text(300) },
  popup_ad_image:       { group: "Popup Ads", label: "Own popup: image link (https)", type: "text", def: "", parse: text(300, LINK), help: "Optional. Direct link to a picture." },
  popup_ad_link:        { group: "Popup Ads", label: "Own popup: button link", type: "text", def: "", parse: text(300, LINK), help: "Optional. https link or t.me link. Empty = no button." },
  popup_ad_button:      { group: "Popup Ads", label: "Own popup: button text", type: "text", def: "Open", parse: text(30) },
  adsgram_block_id:     { group: "Popup Ads", label: "Adsgram block ID", type: "text", def: "", parse: text(30, /^[A-Za-z0-9-]*$/), help: "From partner.adsgram.ai (use an Interstitial block, e.g. int-1234). Needed for adsgram / both." },
  monetag_zone_id:      { group: "Popup Ads", label: "Monetag zone ID", type: "text", def: "", parse: text(15, /^\d*$/), help: "Main zone ID of a Rewarded Interstitial zone from Monetag (numbers only). Needed for monetag / both." },
  // --- Watch an ad, earn Points ---
  watch_ad_enabled:     { group: "Watch Ads", label: "Watch & Earn (ad for Points)", type: "bool", def: false, parse: bool, help: "Home gets a card: the user watches a Monetag / Adsgram ad and earns Points. Starts OFF." },
  watch_ad_reward:      { group: "Watch Ads", label: "Points per ad", type: "int", def: 5, parse: int(1, 100000) },
  watch_ad_daily_limit: { group: "Watch Ads", label: "Max ads per user per day (UTC)", type: "int", def: 10, parse: int(1, 100) },
  watch_ad_cooldown:    { group: "Watch Ads", label: "Gap between ads (seconds)", type: "int", def: 60, parse: int(10, 3600) },
  watch_ad_min_seconds: { group: "Watch Ads", label: "Minimum watch time (seconds)", type: "int", def: 10, parse: int(3, 120), help: "Points are refused if claimed sooner than this after the ad started." },
  watch_ad_network:     { group: "Watch Ads", label: "Ad network (monetag / adsgram / both)", type: "text", def: "monetag", parse: oneOf("monetag", "adsgram", "both"), help: "Uses the Monetag zone ID / Adsgram block ID from Popup Ads. Use a REWARDED block for Adsgram." },
  // --- Part 14: weekly missions ---
  missions_enabled:       { group: "Weekly Missions", label: "Weekly Missions enabled", type: "bool", def: false, parse: bool, help: "Goals counted from Monday 00:00 (daily reward time zone). Each reward is paid once per week through the ledger. Starts OFF." },
  mission_daily_target:   { group: "Weekly Missions", label: "Daily streak: days to claim", type: "int", def: 5, parse: int(1, 7) },
  mission_daily_reward:   { group: "Weekly Missions", label: "Daily streak: reward (Points)", type: "int", def: 200, parse: int(1, 1e6) },
  mission_tasks_target:   { group: "Weekly Missions", label: "Task master: tasks to complete", type: "int", def: 10, parse: int(1, 500) },
  mission_tasks_reward:   { group: "Weekly Missions", label: "Task master: reward (Points)", type: "int", def: 300, parse: int(1, 1e6) },
  mission_refs_target:    { group: "Weekly Missions", label: "Invite friends: qualified referrals", type: "int", def: 3, parse: int(1, 100) },
  mission_refs_reward:    { group: "Weekly Missions", label: "Invite friends: reward (Points)", type: "int", def: 1000, parse: int(1, 1e6) },
  mission_bonus_reward:   { group: "Weekly Missions", label: "Bonus for claiming all three (Points)", type: "int", def: 500, parse: int(0, 1e6), help: "0 = no bonus." },
  // --- Part 14: Terms & Privacy ---
  terms_required:         { group: "Legal", label: "Require accepting Terms before withdrawing", type: "bool", def: false, parse: bool, help: "ON = a user must tap I agree on the Terms & Privacy screen before the first withdrawal. Starts OFF." },
  terms_version:          { group: "Legal", label: "Terms version", type: "int", def: 1, parse: int(1, 1e6), help: "Raise this number after you change the texts: everybody has to accept again (only matters when the option above is ON)." },
  terms_text:             { group: "Legal", label: "Terms text", type: "longtext", def: DEFAULT_TERMS, parse: longtext(8000), help: "Plain text. Leave an empty line between paragraphs. The default is a template, not legal advice." },
  privacy_text:           { group: "Legal", label: "Privacy text", type: "longtext", def: DEFAULT_PRIVACY, parse: longtext(8000), help: "Plain text. Leave an empty line between paragraphs." },
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
