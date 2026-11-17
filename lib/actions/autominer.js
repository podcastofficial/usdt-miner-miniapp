// Part 17.2: Auto-Miner backend - passive mining machines bought with Points (MINER). The screen + admin UI come in 17.3.
// Money rules, same as every other part: buying and claiming are each ONE atomic SQL statement (balance + machine rows + ledger),
// limits are enforced on locked rows (race-safe), earnings are whole Points rounded DOWN, and every admin action is audited.
// The maths is mirrored by accrue() in lib/autominer.js, which tests/autominer.test.js pins.
import { sql } from "../db.js";
import { HttpError } from "../http.js";
import { audit } from "../audit.js";
import { getConfig } from "../runtime.js";
import { planStats, validatePlanInput, MAX_ACTIVE_PLANS } from "../autominer.js";

const bad = (msg, code = "bad_request", status = 400) => new HttpError(status, code, msg);
const posInt = (v) => { const n = Number(v); return Number.isSafeInteger(n) && n > 0 ? n : null; };
const isCheckViolation = (e) => e && e.code === "23514"; // users.points >= 0: the price was more than the balance -> the whole statement rolled back
const disabled = () => bad("Auto-Miner is not available right now", "auto_miner_disabled", 403);

/* ======================= user: everything the Auto-Miner screen needs ======================= */
export const autoMiner = async ({ id }) => {
  const c = await getConfig();
  if (!c.autoMinerEnabled) return { enabled: false };
  const hrs = c.autoMinerStorageHours, storageSec = hrs * 3600;
  const [me, plans, miners, claims, tot] = await Promise.all([
    sql`SELECT points FROM users WHERE telegram_id=${id}::bigint`,
    sql`SELECT p.id, p.name, p.price, p.rate_per_hour, p.duration_days, p.max_per_user, COALESCE(b.n,0)::int AS owned
        FROM auto_miner_plans p LEFT JOIN auto_miner_buys b ON b.plan_id=p.id AND b.telegram_id=${id}::bigint
        WHERE p.active=TRUE ORDER BY p.price, p.id`,
    // pending = the same expression the claim statement uses (storage window, whole Points rounded down)
    sql`SELECT m.id, m.plan_id, m.plan_name, m.price_paid, m.rate_per_hour, m.started_at, m.ends_at, m.total_claimed,
          GREATEST(0, CEIL(EXTRACT(EPOCH FROM (m.ends_at - NOW()))))::int AS seconds_left,
          GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (LEAST(NOW(), m.ends_at) - m.last_claim_at))))::bigint AS idle_seconds,
          (m.rate_per_hour * GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (LEAST(NOW(), m.ends_at)
            - GREATEST(m.last_claim_at, LEAST(NOW(), m.ends_at) - make_interval(hours => ${hrs}::int))) ) * 1000000))::bigint) / 3600000000 AS pending
        FROM auto_miners m WHERE m.telegram_id=${id}::bigint AND m.last_claim_at < m.ends_at
        ORDER BY m.ends_at DESC, m.id DESC LIMIT 50`,
    sql`SELECT id, points, miners, created_at FROM auto_miner_claims WHERE telegram_id=${id}::bigint ORDER BY id DESC LIMIT 10`,
    sql`SELECT COALESCE(SUM(points),0)::bigint AS claimed FROM auto_miner_claims WHERE telegram_id=${id}::bigint`,
  ]);
  const list = miners.map(m => {
    const left = Number(m.seconds_left), pending = Number(m.pending), idle = Number(m.idle_seconds);
    return {
      id: Number(m.id), plan_id: Number(m.plan_id), name: m.plan_name, rate_per_hour: Number(m.rate_per_hour), price_paid: Number(m.price_paid),
      started_at: m.started_at, ends_at: m.ends_at, seconds_left: left, status: left > 0 ? "running" : "ended",
      pending, total_claimed: Number(m.total_claimed),
      full: idle >= storageSec, full_in_seconds: left > 0 ? Math.max(0, storageSec - idle) : 0, // when the machine stops storing until claimed
    };
  }).filter(m => m.status === "running" || m.pending > 0); // an ended machine with nothing left to claim is hidden
  const pendingTotal = list.reduce((s, m) => s + m.pending, 0);
  return {
    enabled: true, balance: Number((me[0] || {}).points || 0), storage_hours: hrs,
    per_hour: list.filter(m => m.status === "running").reduce((s, m) => s + m.rate_per_hour, 0),
    pending_total: pendingTotal, can_claim: pendingTotal >= 1, claimed_total: Number(tot[0].claimed),
    plans: plans.map(p => ({
      id: Number(p.id), name: p.name, price: Number(p.price), rate_per_hour: Number(p.rate_per_hour), duration_days: Number(p.duration_days),
      max_per_user: Number(p.max_per_user), owned: Number(p.owned), can_buy: Number(p.owned) < Number(p.max_per_user), ...planStats(p),
    })),
    miners: list,
    claims: claims.map(r => ({ id: Number(r.id), points: Number(r.points), miners: Number(r.miners), at: r.created_at })),
  };
};

/* ======================= user: buy a machine ======================= */
/**
 * ONE statement:
 *   pl  the active plan (price / rate / length are copied onto the machine)
 *   b   per-plan counter upsert; `WHERE n < max_per_user` runs on the locked row, so parallel requests cannot over-buy
 *   u   balance (-1 when the Points do not cover the price -> the users CHECK rolls the WHOLE statement back, counter included)
 *   m   the machine row (starts now, nothing to claim yet)
 *   t   ledger row (only when the price is above 0)
 */
export const autoMinerBuy = async ({ id, body }) => {
  const c = await getConfig();
  if (!c.autoMinerEnabled) throw disabled();
  const pid = posInt(body.plan_id);
  if (!pid) throw bad("Choose a miner");
  const plan = (await sql`SELECT id, name, price, active, max_per_user,
      COALESCE((SELECT n FROM auto_miner_buys WHERE telegram_id=${id}::bigint AND plan_id=${pid}::bigint),0)::int AS owned
    FROM auto_miner_plans WHERE id=${pid}::bigint`)[0];
  if (!plan || !plan.active) throw bad("This miner is not available", "plan_unavailable", 404);
  if (Number(plan.owned) >= Number(plan.max_per_user)) throw bad("You already own the maximum of this miner", "plan_limit");

  let r;
  try {
    r = await sql`
      WITH pl AS (
        SELECT id, name, price, rate_per_hour, duration_days, max_per_user FROM auto_miner_plans WHERE id=${pid}::bigint AND active=TRUE),
      b AS (
        INSERT INTO auto_miner_buys(telegram_id, plan_id, n)
        SELECT ${id}::bigint, pl.id, 1 FROM pl WHERE EXISTS(SELECT 1 FROM users WHERE telegram_id=${id}::bigint AND is_blocked=FALSE)
        ON CONFLICT(telegram_id, plan_id) DO UPDATE SET n = auto_miner_buys.n + 1
          WHERE auto_miner_buys.n < (SELECT max_per_user FROM pl)
        RETURNING plan_id),
      u AS (
        UPDATE users SET points = CASE WHEN users.points >= pl.price THEN users.points - pl.price ELSE -1 END
        FROM pl, b
        WHERE users.telegram_id=${id}::bigint AND users.is_blocked=FALSE AND b.plan_id = pl.id
        RETURNING users.telegram_id, users.points AS balance),
      m AS (
        INSERT INTO auto_miners(telegram_id, plan_id, plan_name, price_paid, rate_per_hour, started_at, last_claim_at, ends_at)
        SELECT u.telegram_id, pl.id, pl.name, pl.price, pl.rate_per_hour, NOW(), NOW(), NOW() + make_interval(hours => pl.duration_days * 24) FROM u, pl
        RETURNING id, ends_at),
      t AS (
        INSERT INTO transactions(telegram_id,type,points_change,balance_after,description,reference)
        SELECT u.telegram_id,'Auto-Miner Purchase',-pl.price,u.balance,'Auto-Miner: '||pl.name,'automine-buy:'||m.id::text FROM u, m, pl WHERE pl.price > 0)
      SELECT m.id, m.ends_at, u.balance FROM m, u`;
  } catch (e) {
    if (isCheckViolation(e)) throw bad("Not enough Points for this miner", "insufficient_points");
    throw e;
  }
  if (!r.length) {
    const o = (await sql`SELECT COALESCE((SELECT n FROM auto_miner_buys WHERE telegram_id=${id}::bigint AND plan_id=${pid}::bigint),0)::int AS owned`)[0];
    throw Number(o.owned) >= Number(plan.max_per_user) ? bad("You already own the maximum of this miner", "plan_limit") : bad("Could not buy, please try again", "buy_failed", 503);
  }
  return { id: Number(r[0].id), name: plan.name, ends_at: r[0].ends_at, balance: Number(r[0].balance) };
};

/* ======================= user: claim everything the machines mined ======================= */
/**
 * ONE statement, all of the user's machines at once:
 *   calc   the user's unfinished machines, ROW-LOCKED (a parallel claim waits, then re-reads the new last_claim_at -> never pays twice)
 *   pay    Points per machine, microsecond-exact, whole Points rounded down (mirror of accrue() in lib/autominer.js)
 *   tot    sum; nothing happens below 1 Point
 *   cl     the claim row; its id is the unique ledger reference. Needs an unblocked user, so a machine is never advanced without a credit
 *   upd    machines advance (also closes an ended machine that has only a fraction of a Point left): last_claim_at moves forward by exactly the time that was paid (the unpaid fraction of a Point stays in the machine)
 *   u / t  balance + ledger row
 */
export const autoMinerClaim = async ({ id }) => {
  const c = await getConfig();
  if (!c.autoMinerEnabled) throw disabled();
  const hrs = c.autoMinerStorageHours;
  const r = await sql`
    WITH calc AS (
      SELECT m.id AS mid, m.rate_per_hour AS rate, m.ends_at,
             LEAST(NOW(), m.ends_at) AS t_end,
             GREATEST(m.last_claim_at, LEAST(NOW(), m.ends_at) - make_interval(hours => ${hrs}::int)) AS t_start
      FROM auto_miners m WHERE m.telegram_id=${id}::bigint AND m.last_claim_at < m.ends_at
      FOR UPDATE),
    micro AS (
      SELECT mid, rate, ends_at, t_start, GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (t_end - t_start)) * 1000000))::bigint AS us FROM calc),
    pay AS (
      SELECT mid, rate, ends_at, t_start, (rate * us) / 3600000000 AS pts FROM micro),
    fin AS (
      SELECT mid, pts,
             CASE WHEN ends_at <= NOW() THEN ends_at
                  ELSE t_start + ((pts * 3600000000) / rate) * INTERVAL '1 microsecond' END AS new_last
      FROM pay),
    tot AS (SELECT COALESCE(SUM(pts),0)::bigint AS pts, (COUNT(*) FILTER (WHERE pts > 0))::int AS n FROM fin),
    cl AS (
      INSERT INTO auto_miner_claims(telegram_id, points, miners)
      SELECT ${id}::bigint, tot.pts, tot.n FROM tot
      WHERE tot.pts >= 1 AND EXISTS(SELECT 1 FROM users WHERE telegram_id=${id}::bigint AND is_blocked=FALSE)
      RETURNING id, points AS pts, miners AS n),
    upd AS (
      UPDATE auto_miners m SET last_claim_at = fin.new_last, total_claimed = m.total_claimed + fin.pts
      FROM fin, cl WHERE m.id = fin.mid
      RETURNING m.id),
    u AS (
      UPDATE users SET points = users.points + cl.pts
      FROM cl WHERE users.telegram_id=${id}::bigint AND users.is_blocked=FALSE
      RETURNING users.points AS balance, cl.id AS claim_id, cl.pts AS pts, cl.n AS n),
    t AS (
      INSERT INTO transactions(telegram_id,type,points_change,balance_after,description,reference)
      SELECT ${id}::bigint,'Auto-Miner Reward',u.pts,u.balance,'Auto-Miner earnings','automine:'||u.claim_id::text FROM u)
    SELECT u.claim_id, u.pts, u.balance, u.n AS machines FROM u`;
  if (!r.length) throw bad("Nothing to claim yet - your miners are still working", "nothing_to_claim");
  const x = r[0];
  return { claim_id: Number(x.claim_id), points: Number(x.pts), machines: Number(x.machines), balance: Number(x.balance) };
};

/* ======================= admin: report + miner types ======================= */
export const adminAutoMinerOverview = async () => {
  const c = await getConfig();
  const [plans, running, sold, paid, d24, owed] = await Promise.all([
    sql`SELECT p.id, p.name, p.price, p.rate_per_hour, p.duration_days, p.max_per_user, p.active,
          (SELECT COUNT(*) FROM auto_miners m WHERE m.plan_id=p.id)::int AS sold,
          (SELECT COUNT(*) FROM auto_miners m WHERE m.plan_id=p.id AND m.ends_at > NOW())::int AS running
        FROM auto_miner_plans p ORDER BY p.price, p.id`,
    sql`SELECT COUNT(*)::int AS machines, COUNT(DISTINCT telegram_id)::int AS users, COALESCE(SUM(rate_per_hour),0)::bigint AS per_hour
        FROM auto_miners WHERE ends_at > NOW()`,
    sql`SELECT COUNT(*)::int AS machines, COALESCE(SUM(price_paid),0)::bigint AS spent FROM auto_miners`,
    sql`SELECT COUNT(*)::int AS claims, COALESCE(SUM(points),0)::bigint AS paid FROM auto_miner_claims`,
    sql`SELECT COUNT(DISTINCT telegram_id)::int AS users, COALESCE(SUM(points),0)::bigint AS paid FROM auto_miner_claims WHERE created_at > NOW() - INTERVAL '24 hours'`,
    // most that can still be paid out: every unfinished machine from its last claim to its end (storage forfeits not counted)
    sql`SELECT COALESCE(SUM((rate_per_hour * FLOOR(EXTRACT(EPOCH FROM (ends_at - last_claim_at))))::bigint / 3600),0)::bigint AS still_owed
        FROM auto_miners WHERE last_claim_at < ends_at`,
  ]);
  const num = (v) => Number(v || 0);
  return {
    settings: { enabled: c.autoMinerEnabled, storage_hours: c.autoMinerStorageHours },
    running: { machines: running[0].machines, users: running[0].users, per_hour: num(running[0].per_hour) },
    totals: { machines_sold: sold[0].machines, points_spent: num(sold[0].spent), claims: paid[0].claims, points_paid: num(paid[0].paid), net_created: num(paid[0].paid) - num(sold[0].spent), still_owed: num(owed[0].still_owed) },
    last24h: { claimers: d24[0].users, paid: num(d24[0].paid) },
    plans: plans.map(p => ({ id: Number(p.id), name: p.name, price: Number(p.price), rate_per_hour: Number(p.rate_per_hour), duration_days: Number(p.duration_days),
      max_per_user: Number(p.max_per_user), active: p.active, sold: p.sold, running: p.running, ...planStats(p) })),
    max_active_plans: MAX_ACTIVE_PLANS,
  };
};

/** Create (no id) or edit (id) a miner type. Editing only changes FUTURE purchases: machines keep what they were bought with. */
export const adminAutoMinerPlanSave = async ({ id, body }) => {
  const v = validatePlanInput(body);
  if (!v.ok) throw bad(v.error);
  const { name, price, rate_per_hour, duration_days, max_per_user } = v.value, pid = body.id == null || body.id === "" ? null : posInt(body.id);
  if (body.id != null && body.id !== "" && !pid) throw bad("Invalid miner");
  const stats = planStats({ price, rate_per_hour, duration_days });
  if (pid) {
    const before = (await sql`SELECT name, price, rate_per_hour, duration_days, max_per_user, active FROM auto_miner_plans WHERE id=${pid}::bigint`)[0];
    if (!before) throw bad("Miner not found", "not_found", 404);
    await sql`UPDATE auto_miner_plans SET name=${name}::text, price=${price}::bigint, rate_per_hour=${rate_per_hour}::bigint, duration_days=${duration_days}::int, max_per_user=${max_per_user}::int WHERE id=${pid}::bigint`;
    await audit({ actorId: id, action: "autominer.plan_update", targetType: "auto_miner_plan", targetId: pid, before, after: { name, price, rate_per_hour, duration_days, max_per_user } });
    return { id: pid, stats };
  }
  const n = (await sql`SELECT COUNT(*)::int AS n FROM auto_miner_plans WHERE active=TRUE`)[0].n;
  if (n >= MAX_ACTIVE_PLANS) throw bad(`At most ${MAX_ACTIVE_PLANS} miners can be active - disable one first`, "too_many_plans");
  const q = await sql`INSERT INTO auto_miner_plans(name,price,rate_per_hour,duration_days,max_per_user) VALUES(${name}::text,${price}::bigint,${rate_per_hour}::bigint,${duration_days}::int,${max_per_user}::int) RETURNING id`;
  await audit({ actorId: id, action: "autominer.plan_create", targetType: "auto_miner_plan", targetId: q[0].id, after: { name, price, rate_per_hour, duration_days, max_per_user } });
  return { id: Number(q[0].id), stats };
};

/** Show / hide a miner type in the shop. Machines users already own keep running either way. */
export const adminAutoMinerPlanSetActive = async ({ id, body }) => {
  const pid = posInt(body.id);
  if (!pid || typeof body.active !== "boolean") throw bad("Invalid request");
  const p = (await sql`SELECT name, active FROM auto_miner_plans WHERE id=${pid}::bigint`)[0];
  if (!p) throw bad("Miner not found", "not_found", 404);
  if (body.active && !p.active) {
    const n = (await sql`SELECT COUNT(*)::int AS n FROM auto_miner_plans WHERE active=TRUE`)[0].n;
    if (n >= MAX_ACTIVE_PLANS) throw bad(`At most ${MAX_ACTIVE_PLANS} miners can be active`, "too_many_plans");
  }
  await sql`UPDATE auto_miner_plans SET active=${body.active}::boolean WHERE id=${pid}::bigint`;
  await audit({ actorId: id, action: body.active ? "autominer.plan_enable" : "autominer.plan_disable", targetType: "auto_miner_plan", targetId: pid, before: { active: p.active }, after: { active: body.active } });
  return { id: pid, active: body.active };
};
