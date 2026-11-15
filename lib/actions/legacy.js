// Starter actions carried over from v1 with safety fixes. Parts 2-6 replace these one by one.
import { sql, isUniqueViolation } from "../db.js";
import { HttpError } from "../http.js";
import { credit, debit } from "../ledger.js";
import { PPU, MIN, FEE, DEPOSITS_ENABLED } from "../config.js";

const bad = (msg, code = "bad_request", status = 400) => new HttpError(status, code, msg);
const posInt = (v) => { const n = Number(v); return Number.isSafeInteger(n) && n > 0 ? n : null; };

export const leaderboard = async ({ id }) => {
  const top = await sql`SELECT telegram_id,username,first_name,points FROM users WHERE is_blocked=FALSE ORDER BY points DESC, created_at ASC LIMIT 10`;
  const rank = await sql`SELECT COUNT(*)::int+1 rank FROM users WHERE points>(SELECT points FROM users WHERE telegram_id=${id})`;
  return { top, rank: rank[0].rank };
};

export const withdraw = async ({ id, body }) => {
  const raw = String(body.amount ?? ""), wallet = String(body.wallet || "");
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) throw bad("Enter a valid USDT amount (max 2 decimals)");
  const amount = Number(raw);
  if (amount < MIN || !/^0x[a-fA-F0-9]{40}$/.test(wallet)) throw bad(`Minimum is ${MIN} USDT; valid BEP-20 address required`);
  const points = Math.round(amount * PPU);
  await debit(id, points, "Withdrawal", "Withdrawal request");
  const fee = +(amount * FEE / 100).toFixed(8), net = +(amount - fee).toFixed(8);
  try {
    const q = await sql`INSERT INTO withdrawals(telegram_id,amount_usdt,fee_usdt,net_usdt,wallet_address) VALUES(${id},${amount},${fee},${net},${wallet}) RETURNING id`;
    return { id: q[0].id, fee, net };
  } catch (e) { // request failed -> give the Points back
    await credit(id, points, "Withdrawal Refund", "Withdrawal request failed", `wdfail:${id}:${Date.now()}`); throw e;
  }
};

export const depositSubmit = async ({ id, body }) => {
  if (!DEPOSITS_ENABLED) throw bad("Deposits are not enabled yet", "deposits_disabled", 503);
  const amount = Number(body.amount), hash = String(body.txHash || "");
  if (!/^0x[a-fA-F0-9]{64}$/.test(hash) || !Number.isFinite(amount) || amount <= 0) throw bad("Valid BSC tx hash and amount required");
  try {
    const q = await sql`INSERT INTO deposits(telegram_id,tx_hash,amount_usdt) VALUES(${id},${hash.toLowerCase()},${amount}) RETURNING id`;
    return { id: q[0].id, status: "pending" };
  } catch (e) { if (isUniqueViolation(e)) throw bad("This transaction hash was already submitted", "duplicate_tx", 409); throw e; }
};

export const campaignCreate = async ({ id, body }) => {
  const reward = posInt(body.reward), target = posInt(body.target), title = String(body.title || "").trim().slice(0, 100);
  if (!["channel", "bot", "website"].includes(body.type) || !/^https?:\/\//.test(String(body.link || "")) || String(body.link).length > 500 || !reward || !target || !title)
    throw bad("Invalid campaign");
  const budget = reward * target;
  await debit(id, budget, "Campaign Budget", title);
  try {
    const q = await sql`INSERT INTO campaigns(owner_id,type,title,link,reward,target) VALUES(${id},${body.type},${title},${body.link},${reward},${target}) RETURNING id`;
    return { id: q[0].id, status: "pending" };
  } catch (e) { await credit(id, budget, "Campaign Refund", "Campaign creation failed", `cmpfail:${id}:${Date.now()}`); throw e; }
};

