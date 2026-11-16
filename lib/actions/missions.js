// Part 14: Weekly Missions (OFF until the admin turns it on in Settings > Weekly Missions).
import { sql } from "../db.js";
import { HttpError } from "../http.js";
import { getConfig } from "../runtime.js";
import { creditEx } from "../ledger.js";
import { buildState, claimPlan, missionRef, MISSION_IDS } from "../missions.js";

const bad = (msg, code = "bad_request", status = 400) => new HttpError(status, code, msg);

/** One round trip: the week (Monday 00:00 in the reward time zone), seconds left, and this user's three counters. */
async function weekAndProgress(id, tz) {
  const r = (await sql`
    WITH w AS (SELECT date_trunc('week', now() AT TIME ZONE ${tz}::text) AS ls)
    SELECT to_char(w.ls, 'YYYY-MM-DD') AS week,
      EXTRACT(EPOCH FROM (((w.ls + interval '7 days') AT TIME ZONE ${tz}::text) - now()))::int AS seconds_left,
      (SELECT COUNT(*) FROM transactions t WHERE t.telegram_id=${id}::bigint AND t.type='Daily Reward' AND t.created_at >= (w.ls AT TIME ZONE ${tz}::text))::int AS daily,
      (SELECT COUNT(*) FROM task_completions c WHERE c.telegram_id=${id}::bigint AND c.created_at >= (w.ls AT TIME ZONE ${tz}::text))::int AS tasks,
      (SELECT COUNT(*) FROM referral_events e WHERE e.referrer_id=${id}::bigint AND e.qualified_at >= (w.ls AT TIME ZONE ${tz}::text))::int AS refs
    FROM w`)[0];
  return r;
}

async function claimedSet(id, week) {
  const ids = [...MISSION_IDS, "bonus"], [a, b, c, d] = ids.map((m) => missionRef(week, m, id));
  const rows = await sql`SELECT reference FROM transactions WHERE reference IN (${a}::text,${b}::text,${c}::text,${d}::text)`;
  const done = new Set(rows.map((x) => x.reference));
  return new Set(ids.filter((m) => done.has(missionRef(week, m, id))));
}

async function load(id, c) {
  const p = await weekAndProgress(id, c.dailyTimezone);
  const claimed = await claimedSet(id, p.week);
  return { week: p.week, secondsLeft: Math.max(0, Number(p.seconds_left) || 0), state: buildState(c, p, claimed) };
}

export const missions = async ({ id }) => {
  const c = await getConfig();
  if (!c.missionsEnabled) return { enabled: false };
  const { week, secondsLeft, state } = await load(id, c);
  return { enabled: true, week, seconds_left: secondsLeft, items: state.items, bonus: state.bonus };
};

export const missionClaim = async ({ id, body }) => {
  const c = await getConfig();
  if (!c.missionsEnabled) throw bad("Weekly missions are not open right now", "missions_off", 503);
  const mission = String(body.mission || "");
  const { week, state } = await load(id, c);
  const plan = claimPlan(state, mission);
  if (!plan.ok) throw bad(plan.error, plan.code || "not_ready", plan.code === "already_claimed" ? 409 : 400);
  const r = await creditEx(id, plan.reward, "Mission Reward", `Weekly mission: ${plan.title}`, missionRef(week, mission, id), { week, mission });
  if (r.duplicate) throw bad("Already claimed this week", "already_claimed", 409);
  return { mission, reward: plan.reward, balance: r.balance };
};
