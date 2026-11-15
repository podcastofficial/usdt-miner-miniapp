// Phase 2 / Part 3: Games & Boosters - Spin / Scratch / Lucky Box, weekly Lucky Draw, Mining Boosters (Points only).
// Money rules, same as every other part: each payout is ONE atomic SQL statement (counter + balance + ledger), the outcome is drawn
// on the server with crypto-random and stored before anything is shown, and every admin action is audited.
import { sql, isUniqueViolation } from "../db.js";
import { HttpError } from "../http.js";
import { audit } from "../audit.js";
import { getConfig } from "../runtime.js";
import { maskName } from "../community.js";
import {
  GAMES, GAME_CODES, BOX_COUNT, MAX_PRIZES_PER_GAME, pickWeighted, pickWinner, playsAllowed, gameStatus, houseEdge,
  validatePrizeInput, validateDrawInput, ticketsAllowed, boosterLabel,
} from "../games.js";

const bad = (msg, code = "bad_request", status = 400) => new HttpError(status, code, msg);
const posInt = (v) => { const n = Number(v); return Number.isSafeInteger(n) && n > 0 ? n : null; };
const FLAG = { spin: "gameSpinEnabled", scratch: "gameScratchEnabled", box: "gameBoxEnabled" };
const isCheckViolation = (e) => e && e.code === "23514"; // users.points >= 0: the fee/price/cost was more than the balance -> the whole statement rolled back

/* ======================= user: everything the Games screen needs ======================= */
export const games = async ({ id }) => {
  const c = await getConfig(), tz = c.dailyTimezone;
  const [daily, prizes, recent, me, open, last] = await Promise.all([
    sql`SELECT game, plays, won FROM game_daily WHERE telegram_id=${id}::bigint AND play_date=(NOW() AT TIME ZONE ${tz}::text)::date`,
    sql`SELECT id, game, label, points, weight FROM game_prizes WHERE active=TRUE ORDER BY game, id`,
    sql`SELECT id, game, fee, prize_paid, prize_drawn, created_at FROM game_plays WHERE telegram_id=${id}::bigint ORDER BY id DESC LIMIT 10`,
    sql`SELECT points, booster_pct, booster_until,
          CASE WHEN booster_until > NOW() THEN CEIL(EXTRACT(EPOCH FROM (booster_until - NOW())))::int ELSE 0 END AS seconds_left
        FROM users WHERE telegram_id=${id}::bigint`,
    sql`SELECT d.id, d.title, d.ticket_price, d.prize, d.max_tickets_per_user, d.ends_at,
          COALESCE((SELECT SUM(tickets) FROM draw_tickets WHERE draw_id=d.id),0)::int AS total_tickets,
          COALESCE((SELECT tickets FROM draw_tickets WHERE draw_id=d.id AND telegram_id=${id}::bigint),0)::int AS my_tickets,
          (d.ends_at IS NOT NULL AND d.ends_at <= NOW()) AS ended
        FROM draws d WHERE d.status='open' LIMIT 1`,
    sql`SELECT d.id, d.title, d.prize, d.drawn_at, d.winner_id, d.total_tickets, u.first_name, u.username
        FROM draws d LEFT JOIN users u ON u.telegram_id=d.winner_id WHERE d.status='drawn' ORDER BY d.id DESC LIMIT 1`,
  ]);
  const dayOf = new Map(daily.map(r => [r.game, r]));
  const list = GAME_CODES.map(code => {
    const pz = prizes.filter(p => p.game === code).map(p => ({ label: p.label, points: Number(p.points), weight: Number(p.weight) }));
    const total = pz.reduce((s, p) => s + p.weight, 0), d = dayOf.get(code);
    const st = gameStatus({ plays: d ? d.plays : 0, won: d ? Number(d.won) : 0, free: c.gameFreePlays, fee: c.gameEntryFee, maxPlays: c.gameMaxPlays, cap: c.gameWinCap });
    return {
      code, ...GAMES[code], enabled: c.gamesEnabled && c[FLAG[code]] && pz.length > 0, ...st,
      prizes: pz.map(p => ({ label: p.label, points: p.points, pct: Math.round((p.weight / total) * 10000) / 100 })), // odds are shown to players
    };
  });
  const u = me[0] || {}, boosting = Number(u.seconds_left) > 0;
  const o = open[0] || null, l = last[0] || null;
  return {
    enabled: c.gamesEnabled, balance: Number(u.points || 0), box_count: BOX_COUNT,
    games: list,
    recent: recent.map(r => ({ id: r.id, game: r.game, fee: Number(r.fee), prize: Number(r.prize_paid), drawn: Number(r.prize_drawn), at: r.created_at })),
    booster: {
      enabled: c.boosterEnabled, cost: c.boosterCost, percent: c.boosterPercent, label: boosterLabel(c.boosterPercent), hours: c.boosterHours,
      active: boosting ? { percent: Number(u.booster_pct), label: boosterLabel(u.booster_pct), seconds_left: Number(u.seconds_left), until: u.booster_until } : null,
    },
    draw: {
      enabled: c.luckyDrawEnabled,
      open: o && { id: o.id, title: o.title, ticket_price: Number(o.ticket_price), prize: Number(o.prize), max_tickets: o.max_tickets_per_user, ends_at: o.ends_at, ended: o.ended, total_tickets: o.total_tickets, my_tickets: o.my_tickets },
      last: l && { id: l.id, title: l.title, prize: Number(l.prize), drawn_at: l.drawn_at, tickets: l.total_tickets, winner: maskName(l.first_name, l.username), you_won: String(l.winner_id) === String(id) },
    },
  };
};

/* ======================= user: play one game ======================= */
/**
 * One play = ONE atomic statement:
 *   g  upsert today's counter row; `WHERE plays < allowed` runs on the locked row, so parallel requests cannot over-play;
 *      last_credit = the prize clipped to what is left of today's win cap
 *   u  balance: needs to cover the entry fee BEFORE the prize is added (else it writes -1 and the users CHECK rolls everything back)
 *   p  the play row (drawn prize + paid prize + outcome)
 *   t1/t2  ledger rows (entry fee, prize). Mirror of planPlay() in lib/games.js.
 */
export const gamePlay = async ({ id, body }) => {
  const c = await getConfig();
  const game = GAME_CODES.includes(body.game) ? body.game : null;
  if (!game) throw bad("Unknown game");
  if (!c.gamesEnabled || !c[FLAG[game]]) throw bad("This game is not available right now", "game_disabled", 403);
  const free = c.gameFreePlays, fee = c.gameEntryFee, maxPlays = c.gameMaxPlays, cap = c.gameWinCap, tz = c.dailyTimezone;
  const allowed = playsAllowed({ free, fee, maxPlays });
  if (allowed < 1) throw bad("No free plays are available right now", "no_free_plays");

  const prizes = (await sql`SELECT id, label, points, weight FROM game_prizes WHERE game=${game}::text AND active=TRUE ORDER BY id`)
    .map(p => ({ id: Number(p.id), label: p.label, points: Number(p.points), weight: Number(p.weight) }));
  const pick = pickWeighted(prizes); // crypto-random, chosen BEFORE the statement below stores it
  if (!pick) throw bad("This game is not available right now", "game_unavailable", 503);
  const { prize, index } = pick;
  const boxPick = game === "box" ? (Number.isInteger(Number(body.pick)) && Number(body.pick) >= 0 && Number(body.pick) < BOX_COUNT ? Number(body.pick) : 0) : null;
  const outcome = JSON.stringify({ index, label: prize.label, pick: boxPick, weight: prize.weight, total_weight: prizes.reduce((s, p) => s + p.weight, 0) });
  const name = GAMES[game].name;

  let r;
  try {
    r = await sql`
      WITH g AS (
        INSERT INTO game_daily(telegram_id,play_date,game,plays,won,last_credit)
        SELECT ${id}::bigint, (NOW() AT TIME ZONE ${tz}::text)::date, ${game}::text, 1, LEAST(${prize.points}::bigint, ${cap}::bigint), LEAST(${prize.points}::bigint, ${cap}::bigint)
        WHERE ${allowed}::int >= 1 AND EXISTS(SELECT 1 FROM users WHERE telegram_id=${id}::bigint AND is_blocked=FALSE)
        ON CONFLICT(telegram_id,play_date,game) DO UPDATE SET
          plays = game_daily.plays + 1,
          won = game_daily.won + LEAST(${prize.points}::bigint, GREATEST(0::bigint, ${cap}::bigint - game_daily.won)),
          last_credit = LEAST(${prize.points}::bigint, GREATEST(0::bigint, ${cap}::bigint - game_daily.won))
        WHERE game_daily.plays < ${allowed}::int
        RETURNING play_date, plays, last_credit,
          (CASE WHEN game_daily.plays > ${free}::int THEN ${fee}::bigint ELSE 0::bigint END) AS owed),
      u AS (
        UPDATE users SET points = CASE WHEN users.points >= g.owed THEN users.points - g.owed + g.last_credit ELSE -1 END
        FROM g WHERE users.telegram_id=${id}::bigint AND users.is_blocked=FALSE
        RETURNING users.points AS balance, g.play_date, g.plays, g.last_credit AS credit, g.owed),
      p AS (
        INSERT INTO game_plays(telegram_id,game,play_date,fee,prize_id,prize_drawn,prize_paid,outcome)
        SELECT ${id}::bigint, ${game}::text, u.play_date, u.owed, ${prize.id}::bigint, ${prize.points}::bigint, u.credit, ${outcome}::jsonb FROM u
        RETURNING id),
      t1 AS (
        INSERT INTO transactions(telegram_id,type,points_change,balance_after,description,reference)
        SELECT ${id}::bigint,'Game Entry',-u.owed,u.balance-u.credit,${name + " entry"}::text,'game:'||p.id::text||':fee' FROM u, p WHERE u.owed > 0),
      t2 AS (
        INSERT INTO transactions(telegram_id,type,points_change,balance_after,description,reference)
        SELECT ${id}::bigint,'Game Prize',u.credit,u.balance,${name + " prize"}::text,'game:'||p.id::text||':prize' FROM u, p WHERE u.credit > 0)
      SELECT p.id, u.balance, u.credit, u.owed, u.plays FROM u, p`;
  } catch (e) {
    if (isCheckViolation(e)) throw bad("Not enough Points for the entry fee", "insufficient_points");
    throw e;
  }
  if (!r.length) {
    const d = (await sql`SELECT plays FROM game_daily WHERE telegram_id=${id}::bigint AND game=${game}::text AND play_date=(NOW() AT TIME ZONE ${tz}::text)::date`)[0];
    if (d && d.plays >= allowed) throw d.plays >= free && fee <= 0 ? bad("No free plays left today. Come back tomorrow!", "no_free_plays") : bad("Daily play limit reached. Come back tomorrow!", "daily_limit");
    throw bad("Could not play, please try again", "game_unavailable", 503);
  }
  const x = r[0], left = Math.max(0, allowed - Number(x.plays));
  return {
    game, play_id: Number(x.id), index, pick: boxPick, label: prize.label,
    prize_drawn: prize.points, prize: Number(x.credit), capped: Number(x.credit) < prize.points,
    fee: Number(x.owed), balance: Number(x.balance), plays_left: left, next_fee: left === 0 ? null : Number(x.plays) >= free ? fee : 0,
  };
};

/* ======================= user: lucky draw tickets ======================= */
/** Ticket row + balance + ledger in ONE statement. The upsert's WHERE enforces the per-user maximum on the locked row;
 *  if the Points are not enough the users CHECK fails and the ticket insert rolls back with it. */
export const drawBuy = async ({ id, body }) => {
  const c = await getConfig();
  if (!c.luckyDrawEnabled) throw bad("Lucky Draw is not available right now", "draw_disabled", 403);
  const n = posInt(body.tickets);
  if (!n || n > 1000) throw bad("Choose how many tickets to buy");
  const d = (await sql`SELECT id, ticket_price, max_tickets_per_user, (ends_at IS NOT NULL AND ends_at <= NOW()) AS ended,
      COALESCE((SELECT tickets FROM draw_tickets WHERE draw_id=draws.id AND telegram_id=${id}::bigint),0)::int AS mine
    FROM draws WHERE status='open' LIMIT 1`)[0];
  if (!d) throw bad("There is no open draw right now", "no_open_draw");
  if (d.ended) throw bad("Ticket sales for this draw have ended", "draw_ended");
  if (ticketsAllowed({ have: d.mine, max: d.max_tickets_per_user, want: n }) < n) throw bad(`You can hold at most ${d.max_tickets_per_user} tickets in this draw (you have ${d.mine})`, "ticket_limit");
  let r;
  try {
    r = await sql`
      WITH d AS (SELECT id, ticket_price, max_tickets_per_user AS mx FROM draws WHERE id=${d.id}::bigint AND status='open' AND (ends_at IS NULL OR ends_at > NOW())),
      t AS (
        INSERT INTO draw_tickets(draw_id,telegram_id,tickets)
        SELECT d.id, ${id}::bigint, ${n}::int FROM d
        WHERE ${n}::int <= d.mx AND EXISTS(SELECT 1 FROM users WHERE telegram_id=${id}::bigint AND is_blocked=FALSE)
        ON CONFLICT(draw_id,telegram_id) DO UPDATE SET tickets = draw_tickets.tickets + EXCLUDED.tickets
        WHERE draw_tickets.tickets + EXCLUDED.tickets <= (SELECT mx FROM d)
        RETURNING draw_id, tickets),
      u AS (
        UPDATE users SET points = users.points - (${n}::bigint * (SELECT ticket_price FROM d)) FROM t
        WHERE users.telegram_id=${id}::bigint RETURNING users.points AS balance, t.draw_id, t.tickets, ${n}::bigint * (SELECT ticket_price FROM d) AS cost),
      l AS (
        INSERT INTO transactions(telegram_id,type,points_change,balance_after,description,reference)
        SELECT ${id}::bigint,'Lucky Draw Ticket',-u.cost,u.balance,'Lucky Draw #'||u.draw_id::text||': '||${n}::text||' ticket(s)','drawbuy:'||u.draw_id::text||':'||${id}::text||':'||u.tickets::text FROM u)
      SELECT u.balance, u.tickets, u.cost FROM u`;
  } catch (e) {
    if (isCheckViolation(e)) throw bad("Not enough Points for these tickets", "insufficient_points");
    throw e;
  }
  if (!r.length) throw bad("Could not buy tickets, the draw may have just closed", "draw_unavailable", 409);
  return { tickets: Number(r[0].tickets), bought: n, cost: Number(r[0].cost), balance: Number(r[0].balance) };
};

/* ======================= user: mining booster ======================= */
/** Balance + booster state + history row + ledger in ONE statement. "One active booster" is the WHERE on the LOCKED user row
 *  (re-checked under concurrency), so two parallel taps cannot buy two. Applies to the daily reward (see lib/actions/earn.js). */
export const boosterBuy = async ({ id }) => {
  const c = await getConfig();
  if (!c.boosterEnabled) throw bad("Boosters are not available right now", "booster_disabled", 403);
  const cost = c.boosterCost, pct = c.boosterPercent, hours = c.boosterHours;
  const r = await sql`
    WITH u AS (
      UPDATE users SET points = points - ${cost}::bigint, booster_pct = ${pct}::int, booster_until = NOW() + make_interval(hours => ${hours}::int)
      WHERE telegram_id=${id}::bigint AND is_blocked=FALSE AND points >= ${cost}::bigint AND (booster_until IS NULL OR booster_until <= NOW())
      RETURNING telegram_id, points, booster_until),
    b AS (
      INSERT INTO boosters(telegram_id,multiplier_pct,cost,starts_at,ends_at)
      SELECT telegram_id, ${pct}::int, ${cost}::bigint, NOW(), booster_until FROM u RETURNING id),
    l AS (
      INSERT INTO transactions(telegram_id,type,points_change,balance_after,description,reference)
      SELECT u.telegram_id,'Booster Purchase',-${cost}::bigint,u.points,'Mining booster '||${boosterLabel(pct)}::text||' for '||${hours}::text||'h','booster:'||b.id::text FROM u, b)
    SELECT u.points AS balance, u.booster_until FROM u`;
  if (!r.length) {
    const m = (await sql`SELECT points, (booster_until IS NOT NULL AND booster_until > NOW()) AS active FROM users WHERE telegram_id=${id}::bigint AND is_blocked=FALSE`)[0];
    if (!m) throw bad("Account unavailable", "account_unavailable", 403);
    throw m.active ? bad("You already have an active booster", "booster_active") : bad("Not enough Points for a booster", "insufficient_points");
  }
  return { balance: Number(r[0].balance), until: r[0].booster_until, percent: pct, hours };
};

/* ======================= admin: reports & prize tables ======================= */
export const adminGamesReport = async () => {
  const c = await getConfig();
  const [w, d24, prizes, draws] = await Promise.all([
    sql`SELECT game, COUNT(*)::int AS plays, COUNT(DISTINCT telegram_id)::int AS players, COALESCE(SUM(fee),0)::bigint AS fees, COALESCE(SUM(prize_paid),0)::bigint AS paid
        FROM game_plays WHERE created_at > NOW() - INTERVAL '7 days' GROUP BY game`,
    sql`SELECT COUNT(*)::int AS plays, COUNT(DISTINCT telegram_id)::int AS players, COALESCE(SUM(fee),0)::bigint AS fees, COALESCE(SUM(prize_paid),0)::bigint AS paid
        FROM game_plays WHERE created_at > NOW() - INTERVAL '24 hours'`,
    sql`SELECT id, game, label, points, weight, active FROM game_prizes ORDER BY game, id`,
    sql`SELECT COALESCE(SUM(d.ticket_price * t.n),0)::bigint AS sold
        FROM draws d JOIN (SELECT draw_id, SUM(tickets)::bigint AS n FROM draw_tickets GROUP BY draw_id) t ON t.draw_id=d.id WHERE d.status='drawn'`,
  ]);
  const wk = new Map(w.map(r => [r.game, r]));
  const num = (v) => Number(v || 0);
  return {
    settings: { enabled: c.gamesEnabled, free_plays: c.gameFreePlays, entry_fee: c.gameEntryFee, max_plays: c.gameMaxPlays, win_cap: c.gameWinCap },
    last24h: { plays: d24[0].plays, players: d24[0].players, fees: num(d24[0].fees), paid: num(d24[0].paid), net: num(d24[0].fees) - num(d24[0].paid) },
    games: GAME_CODES.map(code => {
      const r = wk.get(code) || {}, pz = prizes.filter(p => p.game === code).map(p => ({ ...p, points: num(p.points), weight: num(p.weight) }));
      return {
        code, name: GAMES[code].name, icon: GAMES[code].icon,
        week: { plays: num(r.plays), players: num(r.players), fees: num(r.fees), paid: num(r.paid), net: num(r.fees) - num(r.paid) },
        edge: houseEdge(pz, c.gameEntryFee), max_active: MAX_PRIZES_PER_GAME, prizes: pz,
      };
    }),
    draw_tickets_sold_points: num(draws[0].sold),
  };
};

export const adminGamePrizeSave = async ({ id, body }) => {
  const v = validatePrizeInput(body);
  if (!v.ok) throw bad(v.error);
  const { game, label, points, weight } = v.value, pid = body.id == null || body.id === "" ? null : posInt(body.id);
  if (body.id != null && body.id !== "" && !pid) throw bad("Invalid prize");
  if (pid) {
    const before = (await sql`SELECT game, label, points, weight, active FROM game_prizes WHERE id=${pid}::bigint`)[0];
    if (!before) throw bad("Prize not found", "not_found", 404);
    if (before.game !== game) throw bad("A prize cannot move to another game");
    await sql`UPDATE game_prizes SET label=${label}::text, points=${points}::bigint, weight=${weight}::int WHERE id=${pid}::bigint`;
    await audit({ actorId: id, action: "game.prize_update", targetType: "game_prize", targetId: pid, before, after: { game, label, points, weight } });
    return { id: pid };
  }
  const n = (await sql`SELECT COUNT(*)::int AS n FROM game_prizes WHERE game=${game}::text AND active=TRUE`)[0].n;
  if (n >= MAX_PRIZES_PER_GAME) throw bad(`A game can have at most ${MAX_PRIZES_PER_GAME} active prizes - disable one first`, "too_many_prizes");
  const q = await sql`INSERT INTO game_prizes(game,label,points,weight) VALUES(${game}::text,${label}::text,${points}::bigint,${weight}::int) RETURNING id`;
  await audit({ actorId: id, action: "game.prize_create", targetType: "game_prize", targetId: q[0].id, after: { game, label, points, weight } });
  return { id: Number(q[0].id) };
};

export const adminGamePrizeSetActive = async ({ id, body }) => {
  const pid = posInt(body.id);
  if (!pid || typeof body.active !== "boolean") throw bad("Invalid request");
  const p = (await sql`SELECT game, active FROM game_prizes WHERE id=${pid}::bigint`)[0];
  if (!p) throw bad("Prize not found", "not_found", 404);
  const n = (await sql`SELECT COUNT(*)::int AS n FROM game_prizes WHERE game=${p.game}::text AND active=TRUE`)[0].n;
  if (!body.active && p.active && n <= 1) throw bad("Keep at least one active prize in a game (turn the game off in Settings instead)", "last_prize");
  if (body.active && !p.active && n >= MAX_PRIZES_PER_GAME) throw bad(`A game can have at most ${MAX_PRIZES_PER_GAME} active prizes`, "too_many_prizes");
  await sql`UPDATE game_prizes SET active=${body.active}::boolean WHERE id=${pid}::bigint`;
  await audit({ actorId: id, action: body.active ? "game.prize_enable" : "game.prize_disable", targetType: "game_prize", targetId: pid, reason: String(body.reason || "").slice(0, 200) || null });
  return { id: pid, active: body.active };
};

/* ======================= admin: lucky draw ======================= */
export const adminDrawList = async () => ({
  items: await sql`
    SELECT d.id, d.title, d.ticket_price, d.prize, d.max_tickets_per_user, d.status, d.ends_at, d.created_at, d.drawn_at, d.winner_id, d.winner_tickets, d.total_tickets,
      COALESCE((SELECT SUM(tickets) FROM draw_tickets WHERE draw_id=d.id),0)::int AS tickets_now,
      COALESCE((SELECT COUNT(*) FROM draw_tickets WHERE draw_id=d.id),0)::int AS players,
      u.first_name, u.username
    FROM draws d LEFT JOIN users u ON u.telegram_id=d.winner_id ORDER BY d.id DESC LIMIT 20`,
});

export const adminDrawCreate = async ({ id, body }) => {
  const v = validateDrawInput(body);
  if (!v.ok) throw bad(v.error);
  const { title, ticketPrice, prize, maxTickets, endsDays } = v.value;
  let r;
  try {
    r = await sql`
      INSERT INTO draws(title,ticket_price,prize,max_tickets_per_user,ends_at,created_by)
      VALUES(${title}::text, ${ticketPrice}::bigint, ${prize}::bigint, ${maxTickets}::int,
             CASE WHEN ${endsDays}::int > 0 THEN NOW() + make_interval(days => ${endsDays}::int) END, ${id}::bigint)
      RETURNING id, ends_at`;
  } catch (e) {
    if (isUniqueViolation(e)) throw bad("There is already an open draw. Draw its winner or cancel it first.", "draw_open");
    throw e;
  }
  await audit({ actorId: id, action: "draw.create", targetType: "draw", targetId: r[0].id, after: { title, ticketPrice, prize, maxTickets, endsDays } });
  return { id: Number(r[0].id), ends_at: r[0].ends_at };
};

/** Pick the winner on the server (crypto-random, weighted by tickets) and pay the prize in ONE statement. The statement only succeeds if the
 *  draw is still open and the ticket total is exactly what the winner was picked from (a late ticket makes it fail - just press Draw again). */
export const adminDrawPick = async ({ id, body }) => {
  const did = posInt(body.id);
  if (!did) throw bad("Invalid draw");
  const d = (await sql`SELECT id, status, prize FROM draws WHERE id=${did}::bigint`)[0];
  if (!d) throw bad("Draw not found", "not_found", 404);
  if (d.status !== "open") throw bad("This draw is already closed", "draw_closed");
  const rows = await sql`SELECT t.telegram_id, t.tickets, u.is_blocked FROM draw_tickets t JOIN users u ON u.telegram_id=t.telegram_id WHERE t.draw_id=${did}::bigint ORDER BY t.telegram_id`;
  const allTotal = rows.reduce((s, r) => s + Number(r.tickets), 0);
  if (!allTotal) throw bad("No tickets were sold. Cancel the draw instead.", "no_tickets");
  const pick = pickWinner(rows.filter(r => !r.is_blocked));
  if (!pick) throw bad("Every ticket holder is blocked. Cancel the draw instead.", "no_eligible");
  const w = String(pick.winner.telegram_id), wt = Number(pick.winner.tickets);
  const r = await sql`
    WITH d AS (
      UPDATE draws SET status='drawn', winner_id=${w}::bigint, winner_tickets=${wt}::int, total_tickets=${allTotal}::int, drawn_by=${id}::bigint, drawn_at=NOW()
      WHERE id=${did}::bigint AND status='open'
        AND EXISTS(SELECT 1 FROM users WHERE telegram_id=${w}::bigint AND is_blocked=FALSE)
        AND (SELECT COALESCE(SUM(tickets),0) FROM draw_tickets WHERE draw_id=${did}::bigint) = ${allTotal}::bigint
      RETURNING id, prize, winner_id),
    u AS (
      UPDATE users SET points = points + d.prize FROM d WHERE users.telegram_id = d.winner_id
      RETURNING users.telegram_id, users.points, d.id AS draw_id, d.prize)
    INSERT INTO transactions(telegram_id,type,points_change,balance_after,description,reference)
    SELECT telegram_id,'Lucky Draw Win',prize,points,'Lucky Draw #'||draw_id::text||' winner','draw:'||draw_id::text FROM u
    RETURNING points_change`;
  if (!r.length) throw bad("Tickets changed while drawing. Press Draw again.", "draw_changed", 409);
  await audit({ actorId: id, action: "draw.pick", targetType: "draw", targetId: did, after: { winner_id: w, winner_tickets: wt, total_tickets: allTotal, prize: Number(r[0].points_change) } });
  return { id: did, winner_id: w, winner_tickets: wt, total_tickets: allTotal, prize: Number(r[0].points_change) };
};

/** Cancel an open draw and refund every ticket (ledger row per user) in ONE statement. */
export const adminDrawCancel = async ({ id, body }) => {
  const did = posInt(body.id), reason = String(body.reason || "").trim().slice(0, 200);
  if (!did) throw bad("Invalid draw");
  const r = await sql`
    WITH d AS (UPDATE draws SET status='cancelled' WHERE id=${did}::bigint AND status='open' RETURNING id, ticket_price),
    rf AS (SELECT t.telegram_id, (t.tickets::bigint * d.ticket_price) AS amt, d.id AS draw_id FROM draw_tickets t JOIN d ON d.id=t.draw_id),
    u AS (UPDATE users SET points = points + rf.amt FROM rf WHERE users.telegram_id = rf.telegram_id RETURNING users.telegram_id, users.points, rf.amt, rf.draw_id),
    l AS (
      INSERT INTO transactions(telegram_id,type,points_change,balance_after,description,reference)
      SELECT telegram_id,'Lucky Draw Refund',amt,points,'Lucky Draw #'||draw_id::text||' cancelled - tickets refunded','drawrefund:'||draw_id::text||':'||telegram_id::text FROM u RETURNING points_change)
    SELECT (SELECT COUNT(*) FROM d)::int AS cancelled, (SELECT COUNT(*) FROM l)::int AS refunds, COALESCE((SELECT SUM(points_change) FROM l),0)::bigint AS refunded`;
  if (!r[0].cancelled) throw bad("This draw is not open", "draw_closed");
  await audit({ actorId: id, action: "draw.cancel", targetType: "draw", targetId: did, reason: reason || null, after: { refunds: r[0].refunds, refunded_points: Number(r[0].refunded) } });
  return { id: did, refunds: r[0].refunds, refunded_points: Number(r[0].refunded) };
};
