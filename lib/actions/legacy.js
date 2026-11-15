// Starter actions carried over from v1 with safety fixes. Withdraw/deposit moved to finance.js in Part 4.
import { sql } from "../db.js";
import { HttpError } from "../http.js";
import { credit, debit } from "../ledger.js";

const bad = (msg, code = "bad_request", status = 400) => new HttpError(status, code, msg);
const posInt = (v) => { const n = Number(v); return Number.isSafeInteger(n) && n > 0 ? n : null; };

export const leaderboard = async ({ id }) => {
  const top = await sql`SELECT telegram_id,username,first_name,points FROM users WHERE is_blocked=FALSE ORDER BY points DESC, created_at ASC LIMIT 10`;
  const rank = await sql`SELECT COUNT(*)::int+1 rank FROM users WHERE points>(SELECT points FROM users WHERE telegram_id=${id})`;
  return { top, rank: rank[0].rank };
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

