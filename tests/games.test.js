// Phase 2 / Part 3: Games & Boosters. Pure logic + static checks of the SQL / migration / wiring
// (nothing here talks to a database; see CHANGELOG_PART10.md for what the owner must still verify live).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  GAMES, GAME_CODES, BOX_COUNT, secureInt, pickWeighted, expectedValue, houseEdge, playsAllowed, planPlay, gameStatus,
  validatePrizeInput, validateDrawInput, pickWinner, ticketsAllowed, boostedReward, boosterLabel, MAX_PRIZES_PER_GAME,
} from "../lib/games.js";
import { validateSetting, resolveConfig, SETTING_DEFS } from "../lib/settingsDefs.js";

const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const mig = read("db/migrations/009_games.sql"), act = read("lib/actions/games.js"), earn = read("lib/actions/earn.js"), pure = read("lib/games.js");

/* starter prize tables, parsed straight out of the migration so the test can never drift from what ships */
const seed = (() => {
  const out = { spin: [], scratch: [], box: [] };
  for (const m of mig.matchAll(/\('(spin|scratch|box)','([^']+)',(\d+),(\d+)\)/g)) out[m[1]].push({ game: m[1], label: m[2], points: Number(m[3]), weight: Number(m[4]) });
  return out;
})();

/* ---------------- prize pick ---------------- */
test("pickWeighted: deterministic walk over the weights, boundaries are exact", () => {
  const pz = [{ id: 1, points: 0, weight: 3 }, { id: 2, points: 10, weight: 1 }, { id: 3, points: 50, weight: 2 }]; // total 6
  const at = (n) => pickWeighted(pz, () => n).prize.id;
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(at), [1, 1, 1, 2, 3, 3]);
  assert.equal(pickWeighted(pz, () => 3).index, 1);
});

test("pickWeighted: empty / zero-weight tables return null instead of a made-up prize", () => {
  assert.equal(pickWeighted([], () => 0), null);
  assert.equal(pickWeighted(null, () => 0), null);
  assert.equal(pickWeighted([{ id: 1, points: 5, weight: 0 }], () => 0), null);
});

test("pickWeighted with the real CSPRNG: observed odds match the starter spin table", () => {
  const pz = seed.spin.map((p, i) => ({ id: i + 1, ...p })), total = pz.reduce((s, p) => s + p.weight, 0), N = 200_000, hits = new Map();
  for (let i = 0; i < N; i++) { const r = pickWeighted(pz, secureInt); hits.set(r.prize.id, (hits.get(r.prize.id) || 0) + 1); }
  for (const p of pz) {
    const expected = (p.weight / total) * N, got = hits.get(p.id) || 0, sigma = Math.sqrt(N * (p.weight / total) * (1 - p.weight / total));
    assert.ok(Math.abs(got - expected) <= 5 * sigma + 2, `${p.label}: expected ~${expected.toFixed(0)}, got ${got}`); // 5-sigma band: flaky once in ~2 million runs
  }
});

test("randomness comes from node:crypto, never Math.random", () => {
  assert.match(pure, /from "node:crypto"/); assert.match(pure, /crypto\.randomInt/);
  assert.doesNotMatch(pure, /Math\.random/); assert.doesNotMatch(act, /Math\.random/);
});

/* ---------------- house edge ---------------- */
test("starter tables ship with the expected values the migration comment promises (11.6 / 4.65 / 9.75)", () => {
  assert.equal(expectedValue(seed.spin), 11.6); assert.equal(expectedValue(seed.scratch), 4.65); assert.equal(expectedValue(seed.box), 9.75);
  for (const g of GAME_CODES) { assert.ok(seed[g].length >= 2 && seed[g].length <= MAX_PRIZES_PER_GAME, g); assert.ok(seed[g].some(p => p.points === 0), g + " has a no-prize outcome"); }
});

test("houseEdge: odds add to 100, inactive prizes ignored, fee vs payout", () => {
  const pz = [{ id: 1, label: "a", points: 0, weight: 90 }, { id: 2, label: "b", points: 100, weight: 10 }, { id: 3, label: "off", points: 999999, weight: 500, active: false }];
  const e = houseEdge(pz, 15);
  assert.equal(e.expected_payout, 10); assert.equal(e.paid_play_edge, 5); assert.equal(e.paid_play_edge_pct, 33.3); assert.equal(e.top_prize, 100);
  assert.equal(e.losing_money_on_paid_plays, false); assert.equal(e.odds.reduce((s, o) => s + o.pct, 0), 100); assert.equal(e.odds.length, 2);
  assert.equal(houseEdge(pz, 10).losing_money_on_paid_plays, true);   // fee == EV is already a loss once costs exist
  assert.equal(houseEdge(pz, 0).paid_play_edge, null);                 // no fee: every play is pure cost
  assert.equal(houseEdge([], 5).expected_payout, 0);
});

/* ---------------- limits, caps, ledger ---------------- */
const P = (o = {}) => ({ playsBefore: 0, wonBefore: 0, free: 1, fee: 0, maxPlays: 5, cap: 500, prize: 50, balance: 100, ...o });

test("free play: no fee, prize credited, counters move", () => {
  const r = planPlay(P());
  assert.deepEqual(r, { ok: true, fee: 0, credit: 50, plays: 1, won: 50, balance: 150, capped: false });
});

test("no double play: after the free plays are used and no fee is set, the next play is refused", () => {
  const r = planPlay(P({ playsBefore: 1 }));
  assert.deepEqual(r, { ok: false, code: "no_free_plays" });
  assert.equal(planPlay(P({ free: 0 })).ok, false); // 0 free plays and no fee: nobody plays
});

test("paid plays start after the free ones, are charged the fee, and stop at the daily maximum", () => {
  assert.equal(playsAllowed({ free: 1, fee: 10, maxPlays: 5 }), 5);
  assert.equal(playsAllowed({ free: 3, fee: 10, maxPlays: 2 }), 3); // a max below the free plays never takes free plays away
  const paid = planPlay(P({ playsBefore: 1, fee: 10, prize: 0 }));
  assert.deepEqual(paid, { ok: true, fee: 10, credit: 0, plays: 2, won: 0, balance: 90, capped: false });
  assert.equal(planPlay(P({ playsBefore: 1, fee: 10 })).fee, 10);
  assert.deepEqual(planPlay(P({ playsBefore: 5, fee: 10 })), { ok: false, code: "daily_limit" });
});

test("the entry fee must be covered by the balance BEFORE the prize is added", () => {
  assert.deepEqual(planPlay(P({ playsBefore: 1, fee: 10, balance: 9, prize: 400 })), { ok: false, code: "insufficient_points" });
  assert.equal(planPlay(P({ playsBefore: 1, fee: 10, balance: 10, prize: 0 })).balance, 0);
  assert.equal(planPlay(P({ balance: 0 })).ok, true); // a free play needs no balance
});

test("win cap clips the paid prize to what is left of today's cap", () => {
  const r = planPlay(P({ wonBefore: 480, prize: 250 }));
  assert.equal(r.credit, 20); assert.equal(r.capped, true); assert.equal(r.won, 500); assert.equal(r.balance, 120);
  const full = planPlay(P({ wonBefore: 500, prize: 250 }));
  assert.equal(full.credit, 0); assert.equal(full.capped, true);
  assert.equal(planPlay(P({ wonBefore: 0, prize: 500 })).capped, false); // exactly the cap is fine
});

test("ledger balance after plays: balance == start + sum of ledger rows, never negative, limits and cap always hold", () => {
  const free = 2, fee = 7, maxPlays = 6, cap = 120, pz = seed.spin.map((p, i) => ({ id: i + 1, ...p }));
  for (let user = 0; user < 300; user++) {
    const start = secureInt(60); let balance = start, plays = 0, won = 0, ledger = 0;
    for (let k = 0; k < 12; k++) { // way more attempts than allowed
      const prize = pickWeighted(pz, secureInt).prize.points, r = planPlay({ playsBefore: plays, wonBefore: won, free, fee, maxPlays, cap, prize, balance });
      if (!r.ok) continue;
      ledger += -r.fee + r.credit; balance = r.balance; plays = r.plays; won = r.won;
      assert.ok(balance >= 0);
    }
    assert.equal(balance, start + ledger); assert.ok(plays <= playsAllowed({ free, fee, maxPlays })); assert.ok(won <= cap);
  }
});

test("gameStatus: what the screen shows", () => {
  assert.deepEqual(gameStatus({ plays: 0, won: 0, free: 1, fee: 0, maxPlays: 5, cap: 500 }), { plays_today: 0, plays_left: 1, free_left: 1, next_fee: 0, win_cap: 500, win_left: 500 });
  const s = gameStatus({ plays: 1, won: 480, free: 1, fee: 10, maxPlays: 5, cap: 500 });
  assert.equal(s.plays_left, 4); assert.equal(s.next_fee, 10); assert.equal(s.free_left, 0); assert.equal(s.win_left, 20);
  assert.equal(gameStatus({ plays: 1, won: 0, free: 1, fee: 0, maxPlays: 5, cap: 500 }).next_fee, null);
  assert.equal(gameStatus({ plays: 5, won: 0, free: 1, fee: 10, maxPlays: 5, cap: 500 }).plays_left, 0);
});

/* ---------------- admin input ---------------- */
test("prize input: strict ranges, labels cleaned, unknown game refused", () => {
  assert.deepEqual(validatePrizeInput({ game: "spin", label: "  50\u0000 Points ", points: "50", weight: 4 }), { ok: true, value: { game: "spin", label: "50 Points", points: 50, weight: 4 } });
  assert.equal(validatePrizeInput({ game: "spin", label: "No prize", points: 0, weight: 1 }).ok, true);
  for (const bad of [{ game: "dice" }, { game: "spin", label: "", points: 1, weight: 1 }, { game: "spin", label: "x", points: -1, weight: 1 }, { game: "spin", label: "x", points: 1.5, weight: 1 },
    { game: "spin", label: "x", points: 1_000_001, weight: 1 }, { game: "spin", label: "x", points: 1, weight: 0 }, { game: "spin", label: "x".repeat(31), points: 1, weight: 1 }, null])
    assert.equal(validatePrizeInput(bad).ok, bad && bad.label && bad.label.length > 30 ? true : false, JSON.stringify(bad)); // 31 chars is cut to 30, not refused
});

test("draw input: required price + prize, sane defaults, caps", () => {
  assert.deepEqual(validateDrawInput({ title: "Weekly", ticketPrice: "100", prize: "5000" }).value, { title: "Weekly", ticketPrice: 100, prize: 5000, maxTickets: 10, endsDays: 7 });
  assert.equal(validateDrawInput({ title: "x", ticketPrice: 0, prize: 10 }).ok, false);
  assert.equal(validateDrawInput({ title: "x", ticketPrice: 1, prize: 0 }).ok, false);
  assert.equal(validateDrawInput({ title: "", ticketPrice: 1, prize: 1 }).ok, false);
  assert.equal(validateDrawInput({ title: "x", ticketPrice: 1, prize: 1, maxTickets: 1001 }).ok, false);
  assert.equal(validateDrawInput({ title: "x", ticketPrice: 1, prize: 1, endsDays: 0 }).value.endsDays, 0);
  assert.equal(validateDrawInput({ title: "x", ticketPrice: 1, prize: 1, endsDays: 61 }).ok, false);
});

/* ---------------- lucky draw ---------------- */
test("pickWinner: weighted by tickets, exact boundaries, nobody -> null", () => {
  const rows = [{ telegram_id: "1", tickets: 1 }, { telegram_id: "2", tickets: 3 }, { telegram_id: "3", tickets: 2 }]; // 6 tickets
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(n => pickWinner(rows, () => n).winner.telegram_id), ["1", "2", "2", "2", "3", "3"]);
  assert.equal(pickWinner(rows, () => 0).total, 6);
  assert.equal(pickWinner([], () => 0), null);
});

test("pickWinner with the real CSPRNG: a 3-ticket holder wins ~3x as often as a 1-ticket holder", () => {
  const rows = [{ telegram_id: "a", tickets: 1 }, { telegram_id: "b", tickets: 3 }], c = { a: 0, b: 0 };
  for (let i = 0; i < 40_000; i++) c[pickWinner(rows, secureInt).winner.telegram_id]++;
  assert.ok(Math.abs(c.b / 40_000 - 0.75) < 0.02, JSON.stringify(c));
});

test("ticketsAllowed respects the per-user maximum", () => {
  assert.equal(ticketsAllowed({ have: 0, max: 10, want: 5 }), 5);
  assert.equal(ticketsAllowed({ have: 8, max: 10, want: 5 }), 2);
  assert.equal(ticketsAllowed({ have: 10, max: 10, want: 1 }), 0);
});

/* ---------------- boosters ---------------- */
test("booster: whole Points rounded down, x1 changes nothing, label is readable", () => {
  assert.equal(boostedReward(100, 150), 150); assert.equal(boostedReward(120, 150), 180); assert.equal(boostedReward(101, 150), 151); // 151.5 -> 151
  assert.equal(boostedReward(100, 100), 100); assert.equal(boostedReward(300, 200), 600);
  assert.equal(boosterLabel(150), "×1.5"); assert.equal(boosterLabel(200), "×2"); assert.equal(boosterLabel(125), "×1.25");
});

/* ---------------- settings ---------------- */
test("every new setting has a default that passes its own validator; everything that pays Points ships OFF", () => {
  const keys = Object.keys(SETTING_DEFS).filter(k => SETTING_DEFS[k].group === "Games & Boosters");
  assert.ok(keys.length >= 12);
  for (const k of keys) assert.notEqual(SETTING_DEFS[k].parse(SETTING_DEFS[k].def), undefined, k);
  const c = resolveConfig([]);
  assert.equal(c.gamesEnabled, false); assert.equal(c.luckyDrawEnabled, false); assert.equal(c.boosterEnabled, false);
  assert.equal(c.gameEntryFee, 0); // no paid plays until the owner decides
  assert.equal(c.gameFreePlays, 1); assert.equal(c.gameWinCap, 500); assert.equal(c.boosterPercent, 150); assert.equal(c.boosterHours, 24);
});

test("settings validation: ranges for plays, fee, cap, booster", () => {
  assert.equal(validateSetting("game_free_plays", 0).ok, true); assert.equal(validateSetting("game_free_plays", 21).ok, false);
  assert.equal(validateSetting("game_entry_fee", 0).ok, true); assert.equal(validateSetting("game_entry_fee", -1).ok, false);
  assert.equal(validateSetting("game_max_plays", 0).ok, false); assert.equal(validateSetting("game_max_plays", 100).ok, true);
  assert.equal(validateSetting("game_win_cap", 0).ok, false); assert.equal(validateSetting("game_win_cap", "250").value, 250);
  assert.equal(validateSetting("booster_percent", 100).ok, false); // x1.00 would be a free "booster"
  assert.equal(validateSetting("booster_percent", 501).ok, false); assert.equal(validateSetting("booster_percent", 200).ok, true);
  assert.equal(validateSetting("booster_hours", 0).ok, false); assert.equal(validateSetting("booster_hours", 169).ok, false);
  assert.equal(validateSetting("booster_cost", 0).ok, false);
  assert.equal(validateSetting("games_enabled", "true").value, true);
});

/* ---------------- migration ---------------- */
test("migration 009: idempotent tables, hard CHECKs, one open draw, guarded seed, recorded", () => {
  for (const t of ["game_prizes", "game_daily", "game_plays", "draws", "draw_tickets", "boosters"]) assert.match(mig, new RegExp(`CREATE TABLE IF NOT EXISTS ${t}\\(`), t);
  assert.doesNotMatch(mig, /CREATE TABLE (?!IF NOT EXISTS)/); assert.doesNotMatch(mig, /DROP /i);
  assert.match(mig, /PRIMARY KEY \(telegram_id, play_date, game\)/);                                // one counter row per user/day/game
  assert.match(mig, /PRIMARY KEY \(draw_id, telegram_id\)/);                                        // one ticket row per user/draw
  assert.match(mig, /CREATE UNIQUE INDEX IF NOT EXISTS draws_one_open_idx ON draws\(\(1\)\) WHERE status = 'open'/);
  assert.match(mig, /ADD COLUMN IF NOT EXISTS booster_until TIMESTAMPTZ/); assert.match(mig, /ADD COLUMN IF NOT EXISTS booster_pct INTEGER NOT NULL DEFAULT 100/);
  assert.match(mig, /WHERE NOT EXISTS \(SELECT 1 FROM game_prizes\)/);                              // seeding twice never duplicates
  assert.match(mig, /multiplier_pct INTEGER NOT NULL CHECK \(multiplier_pct BETWEEN 101 AND 500\)/);
  assert.match(mig, /INSERT INTO schema_migrations\(version\) VALUES\('009_games'\) ON CONFLICT DO NOTHING/);
});

/* ---------------- SQL shape: the atomic statements ---------------- */
test("gamePlay is ONE statement: counter upsert with the limit on the locked row -> balance -> play row -> ledger", () => {
  assert.match(act, /INSERT INTO game_daily[\s\S]*ON CONFLICT\(telegram_id,play_date,game\) DO UPDATE SET[\s\S]*WHERE game_daily\.plays < \$\{allowed\}::int[\s\S]*UPDATE users SET points = CASE WHEN users\.points >= g\.owed[\s\S]*ELSE -1 END[\s\S]*INSERT INTO game_plays[\s\S]*INSERT INTO transactions[\s\S]*INSERT INTO transactions/);
  assert.match(act, /'Game Entry'/); assert.match(act, /'Game Prize'/);
  assert.match(act, /'game:'\|\|p\.id::text\|\|':fee'/); assert.match(act, /'game:'\|\|p\.id::text\|\|':prize'/); // unique ledger references per play
  assert.match(act, /u\.balance-u\.credit/);                                                           // balance after the fee, before the prize
  assert.match(act, /isCheckViolation\(e\)/);                                                          // insufficient fee -> clean error, whole statement rolled back
});

test("the outcome is chosen BEFORE the statement and stored with the play (never on the client)", () => {
  assert.ok(act.indexOf("pickWeighted(prizes)") < act.indexOf("INSERT INTO game_plays"));
  assert.match(act, /\$\{outcome\}::jsonb/);
  assert.doesNotMatch(read("public/app.js"), /pickWeighted|secureInt|Math\.random/);
});

test("lucky draw: tickets are all-or-nothing, winner pick is guarded, cancel refunds once", () => {
  assert.match(act, /INSERT INTO draw_tickets[\s\S]*ON CONFLICT\(draw_id,telegram_id\) DO UPDATE SET tickets = draw_tickets\.tickets \+ EXCLUDED\.tickets[\s\S]*WHERE draw_tickets\.tickets \+ EXCLUDED\.tickets <= \(SELECT mx FROM d\)[\s\S]*UPDATE users SET points = users\.points - /);
  assert.match(act, /'Lucky Draw Ticket'/); assert.match(act, /'Lucky Draw Win'/); assert.match(act, /'Lucky Draw Refund'/);
  assert.match(act, /UPDATE draws SET status='drawn'[\s\S]*AND status='open'[\s\S]*SELECT COALESCE\(SUM\(tickets\),0\) FROM draw_tickets WHERE draw_id=\$\{did\}::bigint\) = \$\{allTotal\}::bigint/);
  assert.match(act, /'draw:'\|\|draw_id::text/); assert.match(act, /'drawrefund:'/);               // unique references: a second pay/refund cannot insert
  assert.match(act, /UPDATE draws SET status='cancelled' WHERE id=\$\{did\}::bigint AND status='open'/);
});

test("booster: one active at a time is a WHERE on the locked user row, history + ledger in the same statement", () => {
  assert.match(act, /UPDATE users SET points = points - \$\{cost\}::bigint, booster_pct = \$\{pct\}::int, booster_until = NOW\(\) \+ make_interval\(hours => \$\{hours\}::int\)[\s\S]*points >= \$\{cost\}::bigint AND \(booster_until IS NULL OR booster_until <= NOW\(\)\)[\s\S]*INSERT INTO boosters[\s\S]*INSERT INTO transactions/);
  assert.match(act, /'Booster Purchase'/); assert.match(act, /'booster:'\|\|b\.id::text/);
});

test("daily claim applies an active booster inside the same atomic statement; the Part 2 shape is untouched", () => {
  assert.match(earn, /bp AS \(SELECT COALESCE\(\(SELECT CASE WHEN booster_until > NOW\(\) THEN booster_pct ELSE 100 END FROM users/);
  assert.match(earn, /\* \(SELECT pct FROM bp\) \/ 100/);
  assert.match(earn, /INSERT INTO daily_claims[\s\S]*ON CONFLICT DO NOTHING[\s\S]*INSERT INTO streaks[\s\S]*UPDATE users SET points=points\+c\.reward[\s\S]*INSERT INTO transactions/);
  assert.match(earn, /boostedReward\(streak\.next_reward, pct\)/);
});

test("every mutating admin action is audited", () => {
  for (const a of ["game.prize_create", "game.prize_update", "game.prize_enable", "game.prize_disable", "draw.create", "draw.pick", "draw.cancel"]) assert.ok(act.includes(`"${a}"`), a);
});

/* ---------------- wiring ---------------- */
test("router: new actions exist with the right POST / admin flags, and have rate limits", () => {
  const api = read("api/index.js"), rl = read("lib/ratelimit.js");
  for (const a of ["gamePlay", "drawBuy", "boosterBuy"]) assert.match(api, new RegExp(`${a}: \\{ fn: gam\\.${a}, write: true \\}`), a);
  assert.match(api, /games: \{ fn: gam\.games \}/);
  for (const a of ["adminGamesReport", "adminDrawList"]) assert.match(api, new RegExp(`${a}: \\{ fn: gam\\.${a}, admin: true \\}`), a);
  for (const a of ["adminGamePrizeSave", "adminGamePrizeSetActive", "adminDrawCreate", "adminDrawPick", "adminDrawCancel"]) assert.match(api, new RegExp(`${a}: \\{ fn: gam\\.${a}, admin: true, write: true \\}`), a);
  for (const a of ["games", "gamePlay", "drawBuy", "boosterBuy"]) assert.match(rl, new RegExp(`${a}: \\[\\d+, 60\\]`), a);
});

test("frontend: games screen is live, handlers exist, no 'coming soon', admin tab present, version + check script bumped", () => {
  const html = read("public/index.html"), app = read("public/app.js"), adm = read("public/admin.js"), pkg = JSON.parse(read("package.json"));
  assert.doesNotMatch(html, /Games are not available yet/); assert.doesNotMatch(html, /<span class="badge soon">Soon<\/span>/);
  for (const id of ["gamelist", "gameresult", "boostcard", "drawcard", "playlist", "boostbox"]) assert.ok(html.includes(`id="${id}"`), id);
  for (const a of ["play", "boost", "drawBuy"]) assert.match(app, new RegExp(`^  (async )?${a}\\(`, "m"), a);
  assert.match(app, /prefers-reduced-motion/); assert.match(adm, /\['gam','🎮','Games'\]/);
  for (const m of ["editPrize", "prizeSave", "prizeOn", "drawCreate", "drawPick", "drawCancel"]) assert.match(adm, new RegExp(`^ (async )?${m}\\(`, "m"), m);
  assert.equal(pkg.version, "1.10.0");
  for (const f of ["lib/games.js", "lib/actions/games.js"]) assert.ok(pkg.scripts.check.includes(f), f);
});

test("game metadata is complete", () => {
  assert.equal(BOX_COUNT, 3);
  for (const g of GAME_CODES) assert.ok(GAMES[g].name && GAMES[g].icon && GAMES[g].help, g);
  assert.deepEqual(GAME_CODES.sort(), ["box", "scratch", "spin"]);
});
