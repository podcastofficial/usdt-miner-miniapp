// Part 2: Daily reward, timer-proof tasks, history, ledger reconciliation.
import { sql } from "../db.js";
import { HttpError } from "../http.js";
import { audit } from "../audit.js";
import { getSetting } from "../settings.js";

const bad = (msg, code = "bad_request", status = 400) => new HttpError(status, code, msg);
const posInt = (v) => { const n = Number(v); return Number.isSafeInteger(n) && n > 0 ? n : null; };
const MEMBER = ["member", "administrator", "creator"];

async function dailyConfig() {
  const r = Number(await getSetting("daily_reward", 100)), tz = await getSetting("daily_timezone", "Asia/Kolkata");
  return { reward: Number.isSafeInteger(r) && r > 0 ? r : 100, tz: typeof tz === "string" && tz ? tz : "Asia/Kolkata" };
}

/** Has this user claimed in the current reward period, and when does the next period start? */
export async function dailyState(id) {
  const { reward, tz } = await dailyConfig();
  const r = await sql`
    SELECT EXISTS(SELECT 1 FROM daily_claims WHERE telegram_id=${String(id)}::bigint AND claim_date=(NOW() AT TIME ZONE ${tz}::text)::date) AS claimed,
           CEIL(EXTRACT(EPOCH FROM (((((NOW() AT TIME ZONE ${tz}::text)::date + 1)::timestamp) AT TIME ZONE ${tz}::text) - NOW())))::int AS seconds_left`;
  return { reward, claimed: r[0].claimed, seconds_left: r[0].seconds_left };
}

/** Daily claim: claim row + balance + ledger entry in ONE atomic statement; one claim per period (PK). */
export const daily = async ({ id }) => {
  const { reward, tz } = await dailyConfig();
  const r = await sql`
    WITH today AS (SELECT (NOW() AT TIME ZONE ${tz}::text)::date AS d),
    c AS (
      INSERT INTO daily_claims(telegram_id,claim_date,reward)
      SELECT ${id}::bigint, today.d, ${reward}::bigint FROM today
      WHERE EXISTS(SELECT 1 FROM users WHERE telegram_id=${id}::bigint AND is_blocked=FALSE)
      ON CONFLICT DO NOTHING RETURNING telegram_id, claim_date),
    u AS (
      UPDATE users SET points=points+${reward}::bigint FROM c
      WHERE users.telegram_id=c.telegram_id
      RETURNING users.telegram_id, users.points, c.claim_date)
    INSERT INTO transactions(telegram_id,type,points_change,balance_after,description,reference)
    SELECT telegram_id,'Daily Reward',${reward}::bigint,points,'Daily reward '||claim_date::text,'daily:'||telegram_id::text||':'||claim_date::text FROM u
    RETURNING balance_after`;
  if (!r.length) throw bad("Daily reward already claimed", "already_claimed");
  return { reward, balance: Number(r[0].balance_after) };
};

/** Timer tasks: the server records the start time; completion is only accepted after timer_seconds. */
export const taskStart = async ({ id, body }) => {
  const tid = posInt(body.taskId);
  if (!tid) throw bad("Task unavailable");
  const t = await sql`SELECT id,type,timer_seconds FROM tasks WHERE id=${tid} AND active=TRUE AND (target=0 OR completed<target)`;
  if (!t.length) throw bad("Task unavailable");
  if (t[0].type === "channel") return { started: false, seconds_left: 0 };
  if ((await sql`SELECT 1 FROM task_completions WHERE task_id=${tid} AND telegram_id=${id}::bigint`).length) throw bad("Already completed", "already_completed");
  await sql`INSERT INTO task_attempts(task_id,telegram_id) VALUES(${tid},${id}::bigint) ON CONFLICT DO NOTHING`; // keeps the FIRST start time
  return { started: true, seconds_left: await secondsLeft(tid, id, t[0].timer_seconds) };
};

async function secondsLeft(tid, id, timer) {
  const a = await sql`SELECT GREATEST(0, CEIL(${timer}::int - EXTRACT(EPOCH FROM (NOW() - started_at))))::int AS left, started_at
                      FROM task_attempts WHERE task_id=${tid} AND telegram_id=${id}::bigint`;
  return a.length ? a[0].left : null;
}

export const taskComplete = async ({ id, body }) => {
  const tid = posInt(body.taskId);
  if (!tid) throw bad("Task unavailable");
  const t = await sql`SELECT id,type,title,reward,telegram_channel,timer_seconds FROM tasks WHERE id=${tid} AND active=TRUE`;
  if (!t.length) throw bad("Task unavailable");
  const task = t[0];
  let evidence, needTimer = false;

  if (task.type === "channel") {
    if (!/^@[A-Za-z0-9_]{5,32}$/.test(task.telegram_channel || "")) throw bad("Task is not configured correctly", "task_misconfigured", 503);
    const z = await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/getChatMember?chat_id=${encodeURIComponent(task.telegram_channel)}&user_id=${id}`,
      { signal: AbortSignal.timeout(8000) }).then(r => r.json()).catch(() => null);
    if (!z || !z.ok) throw bad("Verification is temporarily unavailable", "verification_unavailable", 503); // e.g. bot not admin in channel
    const status = z.result?.status;
    if (!MEMBER.includes(status)) throw bad("Join the channel first", "not_joined");
    evidence = { mode: "channel", channel: task.telegram_channel, status };
  } else {
    needTimer = true;
    const left = await secondsLeft(tid, id, task.timer_seconds);
    if (left === null) throw bad("Start the task first", "not_started");
    if (left > 0) throw bad(`Please wait ${left}s before claiming`, "timer_running");
    evidence = { mode: "timer", timer_seconds: task.timer_seconds };
  }

  // Completion + task counter + balance + ledger in ONE atomic statement. The timer is re-checked here (authoritative).
  const r = await sql`
    WITH t AS (
      SELECT id,title,reward FROM tasks
      WHERE id=${tid} AND active=TRUE AND (target=0 OR completed<target)
        AND (NOT ${needTimer}::boolean OR EXISTS(
              SELECT 1 FROM task_attempts a WHERE a.task_id=${tid} AND a.telegram_id=${id}::bigint
                AND a.started_at <= NOW() - make_interval(secs => tasks.timer_seconds)))),
    c AS (
      INSERT INTO task_completions(task_id,telegram_id,reward,evidence)
      SELECT id,${id}::bigint,reward,${JSON.stringify(evidence)}::jsonb FROM t
      WHERE EXISTS(SELECT 1 FROM users WHERE telegram_id=${id}::bigint AND is_blocked=FALSE)
      ON CONFLICT DO NOTHING RETURNING task_id, reward),
    tu AS (UPDATE tasks SET completed=completed+1 FROM c WHERE tasks.id=c.task_id RETURNING tasks.id),
    u AS (
      UPDATE users SET points=points+c.reward FROM c WHERE users.telegram_id=${id}::bigint
      RETURNING users.points, c.reward, c.task_id)
    INSERT INTO transactions(telegram_id,type,points_change,balance_after,description,reference)
    SELECT ${id}::bigint,'Task Reward',u.reward,u.points,(SELECT title FROM t),'task:'||u.task_id::text||':'||${id}::text FROM u
    RETURNING balance_after, points_change`;
  if (!r.length) {
    const d = await sql`SELECT 1 FROM task_completions WHERE task_id=${tid} AND telegram_id=${id}::bigint`;
    throw d.length ? bad("Already completed", "already_completed") : bad("Task is no longer available", "task_unavailable");
  }
  return { reward: Number(r[0].points_change), balance: Number(r[0].balance_after) };
};

/** Paginated ledger history (newest first). Pass `before` = last id to load older rows. */
export const history = async ({ id, body }) => {
  const before = posInt(body.before);
  const rows = await sql`
    SELECT id,type,points_change,balance_after,description,status,created_at FROM transactions
    WHERE telegram_id=${id}::bigint AND (${before}::bigint IS NULL OR id < ${before}::bigint)
    ORDER BY id DESC LIMIT 26`;
  const items = rows.slice(0, 25);
  return { items, next: rows.length > 25 ? items[items.length - 1].id : null };
};

// ---------- admin ----------
const TASK_TYPES = ["channel", "bot", "website"];
export const adminCreateTask = async ({ id, body }) => {
  const reward = posInt(body.reward), title = String(body.title || "").trim().slice(0, 100);
  const target = Number.isSafeInteger(Number(body.target)) && Number(body.target) >= 0 ? Number(body.target) : 0;
  const timer = body.timerSeconds === undefined ? 30 : Number(body.timerSeconds);
  const channel = body.telegramChannel ? String(body.telegramChannel).trim() : null;
  if (!TASK_TYPES.includes(body.type) || !title || !reward || !/^https?:\/\//.test(String(body.link || ""))) throw bad("Invalid task");
  if (!Number.isInteger(timer) || timer < 10 || timer > 600) throw bad("Timer must be 10-600 seconds");
  if (body.type === "channel" && !/^@[A-Za-z0-9_]{5,32}$/.test(channel || "")) throw bad("Channel tasks need telegramChannel like @MyChannel");
  const q = await sql`INSERT INTO tasks(type,title,description,link,reward,target,telegram_channel,timer_seconds)
    VALUES(${body.type},${title},${String(body.description || "").slice(0, 300)},${body.link},${reward},${target},${channel},${timer}) RETURNING id`;
  await audit({ actorId: id, action: "task.create", targetType: "task", targetId: q[0].id, after: { title, type: body.type, reward, target, timer } });
  return { id: q[0].id };
};

export const adminSetTaskActive = async ({ id, body }) => {
  const tid = posInt(body.taskId);
  if (!tid || typeof body.active !== "boolean") throw bad("Invalid request");
  const q = await sql`UPDATE tasks SET active=${body.active} WHERE id=${tid} RETURNING id, active`;
  if (!q.length) throw bad("Task not found", "not_found", 404);
  await audit({ actorId: id, action: body.active ? "task.enable" : "task.disable", targetType: "task", targetId: tid, reason: String(body.reason || "").slice(0, 200) || null });
  return q[0];
};

/** Ledger reconciliation: users.points must equal the sum of that user's ledger entries. */
export const adminReconcile = async () => {
  const m = await sql`
    SELECT u.telegram_id, u.points, COALESCE(SUM(t.points_change),0)::bigint AS ledger_sum
    FROM users u LEFT JOIN transactions t ON t.telegram_id=u.telegram_id
    GROUP BY u.telegram_id, u.points HAVING u.points <> COALESCE(SUM(t.points_change),0) LIMIT 50`;
  const tot = await sql`SELECT COALESCE(SUM(points),0)::bigint AS liability_points, COUNT(*)::int AS users FROM users`;
  return { ok: m.length === 0, mismatches: m, liability_points: Number(tot[0].liability_points), users: tot[0].users };
};
