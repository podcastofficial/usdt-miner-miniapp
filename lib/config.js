// Central configuration. All values come from server environment variables.
const pos = (v, d) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : d; };
const flag = (v) => String(v || "").toLowerCase() === "true";

export const PPU = pos(process.env.POINTS_PER_USDT, 1);              // TOKEN MODE: 1 Point = 1 MINER
export const MIN = pos(process.env.MIN_WITHDRAW_USDT, 1000);     // minimum withdrawal (MINER)
export const FEE = pos(process.env.WITHDRAW_FEE_PERCENT, 10);     // withdrawal fee (%)
export const INITDATA_MAX_AGE = pos(process.env.INITDATA_MAX_AGE_SECONDS, 86400);
export const DEPOSITS_ENABLED = flag(process.env.DEPOSITS_ENABLED);               // default OFF

export const ENV_KEYS = ["DATABASE_URL", "BOT_TOKEN", "ADMIN_TELEGRAM_IDS", "BOT_USERNAME",
  "DEPOSIT_WALLET_ADDRESS", "BSC_RPC_URL", "USDT_BEP20_CONTRACT", "TG_WEBHOOK_SECRET", "CRON_SECRET"];
// Returns only true/false per variable, never the values.
export const envStatus = () => Object.fromEntries(ENV_KEYS.map(k => [k, Boolean(process.env[k])]));

// --- Part 4 (finance) ---
export const MIN_DEPOSIT = pos(process.env.MIN_DEPOSIT_USDT, 5);                 // minimum on-chain deposit (USDT)
export const DEPOSIT_CONFIRMATIONS = pos(process.env.DEPOSIT_CONFIRMATIONS, 15); // BSC blocks required before a deposit counts
export const DEPOSIT_AUTO_CREDIT = flag(process.env.DEPOSIT_AUTO_CREDIT);        // default OFF: verified deposits wait for admin approval
export const MAX_OPEN_WITHDRAWALS = pos(process.env.MAX_OPEN_WITHDRAWALS, 3);    // pending+approved requests per user
export const USDT_DECIMALS = pos(process.env.USDT_DECIMALS, 18);                 // BEP-20 USDT uses 18 decimals
