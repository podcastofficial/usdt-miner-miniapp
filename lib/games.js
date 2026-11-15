// Phase 2 / Part 3: pure helpers for games, lucky draw and boosters (no DB, no network -> unit-testable).
// The SQL in lib/actions/games.js mirrors planPlay() / boostedReward() below; tests/games.test.js pins them.
import crypto from "node:crypto";

export const GAMES = {
  spin:    { name: "Spin Wheel", icon: "🎡", help: "Spin the wheel and win Points" },
  scratch: { name: "Scratch Card", icon: "🎟️", help: "Scratch the card to reveal your prize" },
  box:     { name: "Lucky Box", icon: "🎁", help: "Pick one of three boxes" },
};
export const GAME_CODES = Object.keys(GAMES);
export const BOX_COUNT = 3;
export const PRIZE_MAX_POINTS = 1_000_000;
export const PRIZE_MAX_WEIGHT = 1_000_000;
export const MAX_PRIZES_PER_GAME = 12; // keeps the wheel readable on a phone

const intIn = (v, min, max) => { const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN; return Number.isSafeInteger(n) && n >= min && n <= max ? n : null; };
const clean = (s, max) => String(s ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

/* ---------------- randomness ---------------- */
/** Uniform integer in [0, max) from the OS CSPRNG (node:crypto), never a predictable generator. */
export const secureInt = (max) => crypto.randomInt(0, max);

/** Weighted pick. prizes: [{ id, label, points, weight }]; rnd(max) -> integer in [0,max). Returns { prize, index } (index = position in `prizes`). */
export function pickWeighted(prizes, rnd = secureInt) {
  const list = Array.isArray(prizes) ? prizes : [];
  const total = list.reduce((s, p) => s + Number(p.weight), 0);
  if (!list.length || !Number.isSafeInteger(total) || total <= 0) return null;
  let r = rnd(total);
  for (let i = 0; i < list.length; i++) { r -= Number(list[i].weight); if (r < 0) return { prize: list[i], index: i }; }
  return { prize: list[list.length - 1], index: list.length - 1 }; // unreachable for a correct rnd; keeps the function total
}

/* ---------------- house edge ---------------- */
/** Expected Points paid per play (before the win cap). */
export function expectedValue(prizes) {
  const list = (prizes || []).filter(p => p.active !== false);
  const total = list.reduce((s, p) => s + Number(p.weight), 0);
  if (!total) return 0;
  return list.reduce((s, p) => s + Number(p.points) * Number(p.weight), 0) / total;
}
/** Preview for the admin: probability per prize, expected payout, and what the house keeps per PAID play (fee - EV; free plays are pure cost). */
export function houseEdge(prizes, fee = 0) {
  const list = (prizes || []).filter(p => p.active !== false);
  const total = list.reduce((s, p) => s + Number(p.weight), 0);
  const ev = expectedValue(list);
  const top = list.reduce((m, p) => Math.max(m, Number(p.points)), 0);
  return {
    active: list.length, total_weight: total, expected_payout: Math.round(ev * 100) / 100,
    free_play_cost: Math.round(ev * 100) / 100,
    paid_play_edge: fee > 0 ? Math.round((fee - ev) * 100) / 100 : null,
    paid_play_edge_pct: fee > 0 ? Math.round(((fee - ev) / fee) * 1000) / 10 : null,
    top_prize: top,
    losing_money_on_paid_plays: fee > 0 && ev >= fee,
    odds: list.map(p => ({ id: p.id, label: p.label, points: Number(p.points), pct: Math.round((Number(p.weight) / total) * 10000) / 100 })),
  };
}

/* ---------------- one play (pure mirror of the SQL statement) ---------------- */
/** Plays a user may make today for one game: free plays only, unless an entry fee is set (then paid plays up to maxPlays). */
export const playsAllowed = ({ free, fee, maxPlays }) => (fee > 0 ? Math.max(free, maxPlays) : free);

/**
 * What one play does. `prize` is what the server drew. The cap clips the PAID prize to what is left of today's win cap.
 * Returns { ok:false, code } (nothing changes) or { ok:true, fee, credit, plays, won, balance, capped }.
 * Mirror of the SQL: plays < allowed (locked row) -> fee only after the free plays -> balance must cover the fee BEFORE the prize is added.
 */
export function planPlay({ playsBefore, wonBefore, free, fee, maxPlays, cap, prize, balance }) {
  const allowed = playsAllowed({ free, fee, maxPlays });
  if (playsBefore >= allowed) return { ok: false, code: playsBefore >= free && fee <= 0 ? "no_free_plays" : "daily_limit" };
  const plays = playsBefore + 1;
  const owed = plays > free ? fee : 0;
  if (balance < owed) return { ok: false, code: "insufficient_points" };
  const credit = Math.min(prize, Math.max(0, cap - wonBefore));
  return { ok: true, fee: owed, credit, plays, won: wonBefore + credit, balance: balance - owed + credit, capped: credit < prize };
}

/** What the Games screen shows for one game: plays left, what the next play costs, win cap left. */
export function gameStatus({ plays, won, free, fee, maxPlays, cap }) {
  const allowed = playsAllowed({ free, fee, maxPlays });
  const left = Math.max(0, allowed - plays);
  return {
    plays_today: plays, plays_left: left, free_left: Math.max(0, free - plays),
    next_fee: left === 0 ? null : plays >= free ? fee : 0,
    win_cap: cap, win_left: Math.max(0, cap - won),
  };
}

/* ---------------- admin input: prizes ---------------- */
/** Admin input -> { ok, value:{game,label,points,weight} } | { ok:false, error }. */
export function validatePrizeInput(b) {
  b = b && typeof b === "object" ? b : {};
  if (!GAME_CODES.includes(b.game)) return { ok: false, error: "Unknown game" };
  const label = clean(b.label, 30);
  if (!label) return { ok: false, error: "Label is required (max 30 characters)" };
  const points = intIn(b.points, 0, PRIZE_MAX_POINTS);
  if (points == null) return { ok: false, error: `Points must be 0-${PRIZE_MAX_POINTS.toLocaleString("en-US")} (0 = no prize)` };
  const weight = intIn(b.weight, 1, PRIZE_MAX_WEIGHT);
  if (weight == null) return { ok: false, error: `Weight must be 1-${PRIZE_MAX_WEIGHT.toLocaleString("en-US")}` };
  return { ok: true, value: { game: b.game, label, points, weight } };
}

/* ---------------- admin input: lucky draw ---------------- */
export const DRAW_MAX_PRIZE = 10_000_000;
export function validateDrawInput(b) {
  b = b && typeof b === "object" ? b : {};
  const title = clean(b.title, 60);
  if (!title) return { ok: false, error: "Title is required (max 60 characters)" };
  const ticketPrice = intIn(b.ticketPrice, 1, 1_000_000);
  if (ticketPrice == null) return { ok: false, error: "Ticket price must be 1-1,000,000 Points" };
  const prize = intIn(b.prize, 1, DRAW_MAX_PRIZE);
  if (prize == null) return { ok: false, error: `Prize must be 1-${DRAW_MAX_PRIZE.toLocaleString("en-US")} Points` };
  const maxTickets = b.maxTickets == null || b.maxTickets === "" ? 10 : intIn(b.maxTickets, 1, 1000);
  if (maxTickets == null) return { ok: false, error: "Max tickets per user must be 1-1000" };
  const endsDays = b.endsDays == null || b.endsDays === "" ? 7 : intIn(b.endsDays, 0, 60);
  if (endsDays == null) return { ok: false, error: "Ends after must be 0-60 days (0 = until you draw)" };
  return { ok: true, value: { title, ticketPrice, prize, maxTickets, endsDays } };
}

/** Walk the ticket rows ([{ telegram_id, tickets }] in a stable order) with a random ticket number. Returns the winner row or null. */
export function pickWinner(rows, rnd = secureInt) {
  const list = Array.isArray(rows) ? rows : [];
  const total = list.reduce((s, r) => s + Number(r.tickets), 0);
  if (!list.length || !Number.isSafeInteger(total) || total <= 0) return null;
  let t = rnd(total);
  for (const r of list) { t -= Number(r.tickets); if (t < 0) return { winner: r, total }; }
  return { winner: list[list.length - 1], total };
}
/** Whole tickets a user may still buy in one go. */
export const ticketsAllowed = ({ have, max, want }) => Math.max(0, Math.min(Number(want) | 0, max - have));

/* ---------------- boosters ---------------- */
/** Daily reward with a booster. pct = 100 means no booster. Whole Points only (rounded down), same as the SQL integer division. */
export const boostedReward = (base, pct) => Math.floor((Number(base) * Number(pct)) / 100);
export const boosterLabel = (pct) => "×" + (Number(pct) / 100).toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
