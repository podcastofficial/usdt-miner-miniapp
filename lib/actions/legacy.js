// Starter actions carried over from v1 with safety fixes. Parts 2-6 replace these one by one.
import { sql, isUniqueViolation } from "../db.js";
import { HttpError } from "../http.js";
import { credit, debit } from "../ledger.js";
import { audit } from "../audit.js";
import { PPU, MIN, FEE, DEPOSITS_ENABLED, ALLOW_UNVERIFIED_TASKS } from "../config.js";

const bad = (msg, code = "bad_request", status = 400) => new HttpError(status, code, msg);
const ist = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const posInt = (v) => { const n = Number(v); return Number.isSafeInteger(n) && n > 0 ? n : null; };

export const referral = async ({ id }) => {
  const q = await sql`SELECT COUNT(*)::int n FROM referral_events WHERE referrer_id=${id}`;
  return { link: `https://t.me/${process.env.BOT_USERNAME || "USDTMinerOfficialBot"}?start=ref_${id}`, qualified: q[0].n, reward: 1000 };
};

export const leaderboard = async ({ id }) => {
  const top = await sql`SELECT telegram_id,username,first_name,points FROM users WHERE is_blocked=FALSE ORDER BY points DESC, created_at ASC LIMIT 10`;
  const rank = await sql`SELECT COUNT(*)::int+1 rank FROM users WHERE points>(SELECT points FROM users WHERE telegram_id=${id})`;
  return { top, rank: rank[0].rank };
};

export const daily = async ({ id }) => {
  const d = ist();
  const q = await sql`INSERT INTO daily_claims VALUES(${id},${d},500) ON CONFLICT DO NOTHING RETURNING telegram_id`;
  if (!q.length) throw bad("Daily reward already claimed", "already_claimed");
  try {
    return { reward: 500, balance: await credit(id, 500, "Daily Reward", "Daily reward " + d, `daily:${id}:${d}`) };
  } catch (e) { // credit failed -> release the claim so the user can retry
    await sql`DELETE FROM daily_claims WHERE telegram_id=${id} AND claim_date=${d}`; throw e;
  }
};

export const taskComplete = async ({ id, body }) => {
  const tid = posInt(body.taskId);
  if (!tid) throw bad("Task unavailable");
  const t = await sql`SELECT * FROM tasks WHERE id=${tid} AND active=TRUE`;
  if (!t.length) throw bad("Task unavailable");
  if (t[0].type === "channel") {
    const z = await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/getChatMember?chat_id=${encodeURIComponent(t[0].telegram_channel)}&user_id=${id}`).then(r => r.json());
    if (!z.ok || !["member", "administrator", "creator"].includes(z.result?.status)) throw bad("Join channel first", "not_joined");
  } else if (!ALLOW_UNVERIFIED_TASKS) {
    // A click is not proof of completion. Real verification arrives in Part 2.
    throw bad("This task type needs verification and is not available yet", "verification_required", 403);
  }
  const q = await sql`INSERT INTO task_completions(task_id,telegram_id,reward) VALUES(${tid},${id},${t[0].reward}) ON CONFLICT DO NOTHING RETURNING id`;
  if (!q.length) throw bad("Already completed", "already_completed");
  try {
    const balance = await credit(id, Number(t[0].reward), "Task Reward", t[0].title, `task:${tid}:${id}`);
    await sql`UPDATE tasks SET completed=completed+1 WHERE id=${tid}`;
    return { reward: t[0].reward, balance };
  } catch (e) {
    await sql`DELETE FROM task_completions WHERE task_id=${tid} AND telegram_id=${id}`; throw e;
  }
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

export const adminCreateTask = async ({ id, body }) => {
  const reward = posInt(body.reward), target = Number(body.target) || 0, title = String(body.title || "").trim();
  if (!["channel", "bot", "website"].includes(body.type) || !title || !reward || !/^https?:\/\//.test(String(body.link || ""))) throw bad("Invalid task");
  const q = await sql`INSERT INTO tasks(type,title,description,link,reward,target,telegram_channel) VALUES(${body.type},${title},${body.description || ""},${body.link},${reward},${target},${body.telegramChannel || null}) RETURNING id`;
  await audit({ actorId: id, action: "task.create", targetType: "task", targetId: q[0].id, after: { title, type: body.type, reward, target } });
  return { id: q[0].id };
};
