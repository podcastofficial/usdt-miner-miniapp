// Part 2: Daily reward, timer-proof tasks, history, ledger reconciliation.
import { sql } from "../db.js";
import { HttpError } from "../http.js";
import { audit } from "../audit.js";
import { getConfig } from "../runtime.js";
import { streakView, ladderDay } from "../engagement.js";
import { syncBadges } from "../badges.js";
import { boostedReward, boosterLabel } from "../games.js";
import { normalizeTaskLink } from "../tasks.js";
import { adminHint, botAdminStatus, botAdminMessage } from "../telegram.js";
import { notifyAdmins, taskAdminText, announceTask } from "../adminNotify.js";

const bad = (msg, code = "bad_request", status = 400) => new HttpError(status, code, msg);
const posInt = (v) => { const n = Number(v); return Number.isSafeInteger(n) && n > 0 ? n : null; };
const MEMBER = ["member", "administrator", "creator"];

async function dailyConfig() {
  const c = await getConfig(); // validated settings with safe defaults
  return { reward: c.dailyReward, tz: c.dailyTimezone, on: c.streakEnabled, ladder: c.streakLadder };
}

/** Has this user claimed in the current reward period, when does the next one start, and where is their streak? */
export async function dailyState(id) {
  const { reward, tz, on, ladder } = await dailyConfig();
  const r = await sql`
    SELECT EXISTS(SELECT 1 FROM daily_claims WHERE telegram_id=${String(id)}::bigint AND claim_date=(NOW() AT TIME ZONE ${tz}::text)::date) AS claimed,
           CEIL(EXTRACT(EPOCH FROM (((((NOW() AT TIME ZONE ${tz}::text)::date + 1)::timestamp) AT TIME ZONE ${tz}::text) - NOW())))::int AS seconds_left,
           to_char((NOW() AT TIME ZONE ${tz}::text)::date,'YYYY-MM-DD') AS today,
           (SELECT to_char(last_date,'YYYY-MM-DD') FROM streaks WHERE telegram_id=${String(id)}::bigint) AS last_day,
           (SELECT current_streak FROM streaks WHERE telegram_id=${String(id)}::bigint) AS cur_streak,
           (SELECT best_streak FROM streaks WHERE telegram_id=${String(id)}::bigint) AS best_streak,
           (SELECT CASE WHEN booster_until > NOW() THEN booster_pct ELSE 100 END FROM users WHERE telegram_id=${String(id)}::bigint) AS boost_pct,
           (SELECT CASE WHEN booster_until > NOW() THEN CEIL(EXTRACT(EPOCH FROM (booster_until - NOW())))::int ELSE 0 END FROM users WHERE telegram_id=${String(id)}::bigint) AS boost_left`;
  const x = r[0];
  const streak = streakView({ last: x.last_day, today: x.today, current: x.cur_streak || 0, best: x.best_streak || 0, ladder, enabled: on, baseReward: reward });
  const pct = Number(x.boost_pct || 100), boosted = pct > 100 && Number(x.boost_left) > 0;
  // `reward` is what the next claim pays INCLUDING an active booster (whole Points, rounded down - same as the SQL below)
  return {
    reward: boosted ? boostedReward(streak.next_reward, pct) : streak.next_reward, claimed: x.claimed, seconds_left: x.seconds_left, streak,
    booster: boosted ? { percent: pct, label: boosterLabel(pct), seconds_left: Number(x.boost_left), base_reward: streak.next_reward } : null,
  };
}

/**
 * Daily claim: claim row + streak row + balance + ledger entry in ONE atomic statement; one claim per period (PK).
 * Streak rule (mirrored in lib/engagement.js streakAfterClaim): last claim = yesterday -> +1, anything else -> 1.
 * With the ladder ON the reward is ladder[(streak-1) % 7]; with it OFF it is the flat daily_reward (streak is still tracked).
 */
export const daily = async ({ id }) => {
  const { reward, tz, on, ladder } = await dailyConfig();
  const lad = JSON.stringify(ladder);
  const r = await sql`
    WITH today AS (SELECT (NOW() AT TIME ZONE ${tz}::text)::date AS d),
    bp AS (SELECT COALESCE((SELECT CASE WHEN booster_until > NOW() THEN booster_pct ELSE 100 END FROM users WHERE telegram_id=${id}::bigint),100)::bigint AS pct),
    prev AS (SELECT current_streak, last_date FROM streaks WHERE telegram_id=${id}::bigint),
    calc AS (
      SELECT today.d,
             CASE WHEN (SELECT last_date FROM prev) = today.d - 1 THEN COALESCE((SELECT current_streak FROM prev),0) + 1 ELSE 1 END AS streak
      FROM today),
    c AS (
      INSERT INTO daily_claims(telegram_id,claim_date,reward)
      SELECT ${id}::bigint, calc.d,
             (CASE WHEN ${on}::boolean THEN (${lad}::jsonb ->> ((calc.streak-1) % 7))::bigint ELSE ${reward}::bigint END) * (SELECT pct FROM bp) / 100
      FROM calc
      WHERE EXISTS(SELECT 1 FROM users WHERE telegram_id=${id}::bigint AND is_blocked=FALSE)
      ON CONFLICT DO NOTHING RETURNING telegram_id, claim_date, reward),
    s AS (
      INSERT INTO streaks(telegram_id,current_streak,best_streak,last_date)
      SELECT c.telegram_id, calc.streak, calc.streak, c.claim_date FROM c, calc
      ON CONFLICT(telegram_id) DO UPDATE SET current_streak=EXCLUDED.current_streak,
        best_streak=GREATEST(streaks.best_streak, EXCLUDED.best_streak), last_date=EXCLUDED.last_date, updated_at=NOW()
      RETURNING current_streak),
    u AS (
      UPDATE users SET points=points+c.reward FROM c
      WHERE users.telegram_id=c.telegram_id
      RETURNING users.telegram_id, users.points, c.claim_date, c.reward)
    INSERT INTO transactions(telegram_id,type,points_change,balance_after,description,reference)
    SELECT u.telegram_id,'Daily Reward',u.reward,u.points,
           'Daily reward '||u.claim_date::text||(CASE WHEN ${on}::boolean THEN ' · day '||((((SELECT streak FROM calc)-1) % 7)+1)::text ELSE '' END)||(CASE WHEN (SELECT pct FROM bp) > 100 THEN ' · booster '||(SELECT pct FROM bp)::text||'%' ELSE '' END),
           'daily:'||u.telegram_id::text||':'||u.claim_date::text FROM u
    RETURNING balance_after, points_change`;
  if (!r.length) throw bad("Daily reward already claimed", "already_claimed");
  let streak = null;
  try { streak = (await dailyState(id)).streak; await syncBadges(id); } catch (e) { console.error("post-claim badge sync failed:", e.message); } // a badge hiccup never undoes the reward
  return { reward: Number(r[0].points_change), balance: Number(r[0].balance_after), streak: streak && streak.current, day: streak && streak.current ? ladderDay(streak.current) : null, ladder_on: on };
};

/** Timer tasks: the server records the start time; completion is only accepted after timer_seconds. */
export const taskStart = async ({ id, body }) => {
  const tid = posInt(body.taskId);
  if (!tid) throw bad("Task unavailable");
  const t = await sql`SELECT id,type,timer_seconds,proof_required FROM tasks WHERE id=${tid} AND active=TRUE AND (target=0 OR completed<target)`;
  if (!t.length) throw bad("Task unavailable");
  if (t[0].type === "channel" || t[0].proof_required) return { started: false, seconds_left: 0 }; // proof tasks: no timer, the user submits a proof instead
  if ((await sql`SELECT 1 FROM task_completions WHERE task_id=${tid} AND telegram_id=${id}::bigint`).length) throw bad("Already completed", "already_completed");
  await sql`INSERT INTO task_attempts(task_id,telegram_id) VALUES(${tid},${id}::bigint) ON CONFLICT DO NOTHING`; // keeps the FIRST start time
  return { started: true, seconds_left: await secondsLeft(tid, id, t[0].timer_seconds) };
};

async function secondsLeft(tid, id, timer) {
  const a = await sql`SELECT GREATEST(0, CEIL(${timer}::int - EXTRACT(EPOCH FROM (NOW() - started_at))))::int AS left, started_at
                      FROM task_attempts WHERE task_id=${tid} AND telegram_id=${id}::bigint`;
  return a.length ? a[0].left : null;
}

export const taskComplete = async ({ id, body, isAdmin }) => {
  const tid = posInt(body.taskId);
  if (!tid) throw bad("Task unavailable");
  const t = await sql`SELECT id,type,title,reward,telegram_channel,timer_seconds,proof_required FROM tasks WHERE id=${tid} AND active=TRUE`;
  if (!t.length) throw bad("Task unavailable");
  const task = t[0];
  if (task.proof_required) throw bad("This task needs a proof: submit it and wait for review", "proof_required"); // never payable by a click or a timer
  let evidence, needTimer = false;

  if (task.type === "channel") {
    if (!/^@[A-Za-z0-9_]{5,32}$/.test(task.telegram_channel || "")) throw bad("Task is not configured correctly", "task_misconfigured", 503);
    const z = await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/getChatMember?chat_id=${encodeURIComponent(task.telegram_channel)}&user_id=${id}`,
      { signal: AbortSignal.timeout(8000) }).then(r => r.json()).catch(() => null);
    if (!z || !z.ok) throw bad(isAdmin ? adminHint(task.telegram_channel, z) : "Verification is temporarily unavailable", "verification_unavailable", 503); // e.g. bot not admin in channel (admins see why)
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

  // Completion + task counter + campaign budget + balance + ledger in ONE atomic statement. The timer is re-checked here (authoritative).
  // FOR UPDATE locks the task row first: a campaign that is closed at the same moment is seen as inactive (no pay-out after the refund).
  const method = task.type === "channel" ? "channel" : "timer";
  const r = await sql`
    WITH t AS (
      SELECT id,title,reward FROM tasks
      WHERE id=${tid} AND active=TRUE AND proof_required=FALSE AND (target=0 OR completed<target)
        AND (NOT ${needTimer}::boolean OR EXISTS(
              SELECT 1 FROM task_attempts a WHERE a.task_id=${tid} AND a.telegram_id=${id}::bigint
                AND a.started_at <= NOW() - make_interval(secs => tasks.timer_seconds)))
      FOR UPDATE),
    c AS (
      INSERT INTO task_completions(task_id,telegram_id,reward,evidence)
      SELECT id,${id}::bigint,reward,${JSON.stringify(evidence)}::jsonb FROM t
      WHERE EXISTS(SELECT 1 FROM users WHERE telegram_id=${id}::bigint AND is_blocked=FALSE)
      ON CONFLICT DO NOTHING RETURNING task_id, reward),
    tu AS (UPDATE tasks SET completed=completed+1 FROM c WHERE tasks.id=c.task_id RETURNING tasks.id),
    cm AS (
      UPDATE campaigns SET spent=campaigns.spent+campaigns.reward,
        status=CASE WHEN campaigns.spent+campaigns.reward >= campaigns.reward*campaigns.target THEN 'finished' ELSE campaigns.status END,
        finished_at=CASE WHEN campaigns.spent+campaigns.reward >= campaigns.reward*campaigns.target THEN NOW() ELSE campaigns.finished_at END
      FROM c WHERE campaigns.task_id=c.task_id AND campaigns.status='active' AND campaigns.spent+campaigns.reward <= campaigns.reward*campaigns.target
      RETURNING campaigns.id AS campaign_id, c.task_id AS task_id, campaigns.reward AS cost),
    cc AS (
      INSERT INTO campaign_completions(campaign_id,task_id,telegram_id,reward,method,platform_fee)
      SELECT cm.campaign_id, cm.task_id, ${id}::bigint, cm.cost, ${method}::text, GREATEST(cm.cost - (SELECT reward FROM c), 0) FROM cm ON CONFLICT DO NOTHING RETURNING 1),
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
export const adminCreateTask = async ({ id, row, body }) => {
  const reward = posInt(body.reward), title = String(body.title || "").trim().slice(0, 100);
  const target = Number.isSafeInteger(Number(body.target)) && Number(body.target) >= 0 ? Number(body.target) : 0;
  const timer = body.timerSeconds === undefined ? 30 : Number(body.timerSeconds);
  const channel = body.telegramChannel ? String(body.telegramChannel).trim() : null;
  const link = normalizeTaskLink(body.link);
  if (!TASK_TYPES.includes(body.type) || !title || !reward) throw bad("Invalid task");
  if (!link) throw bad("Valid link required (https://t.me/YourBot, https://example.com or @name)");
  if (!Number.isInteger(timer) || timer < 10 || timer > 600) throw bad("Timer must be 10-600 seconds");
  if (body.type === "channel" && !/^@[A-Za-z0-9_]{5,32}$/.test(channel || "")) throw bad("Channel tasks need telegramChannel like @MyChannel");
  if (body.type === "channel") { // join checks only work when the bot is an administrator of the channel
    const st = await botAdminStatus(channel);
    if (!st.admin) throw bad(botAdminMessage(channel, st.reason), st.reason === "unavailable" ? "verification_unavailable" : "bot_not_admin", st.reason === "unavailable" ? 503 : 409);
  }
  const proof = body.proofRequired === true;
  if (proof && body.type === "channel") throw bad("Channel tasks are verified by Telegram, they cannot need a proof");
  const hint = String(body.proofHint || "").trim().slice(0, 150) || null;
  const q = await sql`INSERT INTO tasks(type,title,description,link,reward,target,telegram_channel,timer_seconds,proof_required,proof_hint)
    VALUES(${body.type},${title},${String(body.description || "").slice(0, 300)},${link},${reward},${target},${channel},${timer},${proof},${hint}) RETURNING id`;
  await audit({ actorId: id, action: "task.create", targetType: "task", targetId: q[0].id, after: { title, type: body.type, reward, target, timer, proof_required: proof } });
  const t = { id: q[0].id, title, type: body.type, reward, target };
  await announceTask(t); // post in the announcement channel (setting), never throws
  await notifyAdmins("task_new", q[0].id, taskAdminText(t, row && (row.username ? "@" + row.username : row.first_name)));
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
