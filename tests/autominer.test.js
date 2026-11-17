// Part 17.2 (v1.18.0): Auto-Miner backend. The pure maths is tested directly (BigInt microseconds, same as the SQL);
// SQL shape and wiring are checked statically (no Postgres in the build environment), like the Games tests.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { accrue, planStats, validatePlanInput, US_PER_HOUR, MAX_ACTIVE_PLANS, PLAN_MAX_RATE, PLAN_MAX_PRICE } from "../lib/autominer.js";
import { validateSetting, resolveConfig, SETTING_DEFS } from "../lib/settingsDefs.js";
import { can, ACTION_PERMS } from "../lib/roles.js";

const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const act = read("lib/actions/autominer.js"), mig = read("db/migrations/016_auto_miner.sql"), api = read("api/index.js");
const rl = read("lib/ratelimit.js"), core = read("lib/actions/core.js"), app = read("public/app.js"), pkg = JSON.parse(read("package.json"));

const H = US_PER_HOUR;                       // 1 hour in microseconds
const T0 = 1_800_000_000_000_000n;           // an arbitrary "start" instant (microseconds)

/* ---------------- accrue(): the maths ---------------- */
test("a machine pays rate x hours, whole Points, rounded DOWN", () => {
  const r = { rate: 4, lastClaim: T0, ends: T0 + 720n * H, storageHours: 24 };
  assert.equal(accrue({ ...r, now: T0 + 1n * H }).pts, 4);
  assert.equal(accrue({ ...r, now: T0 + H / 2n }).pts, 2);
  assert.equal(accrue({ ...r, now: T0 + H / 8n }).pts, 0);           // 0.5 Point -> nothing yet
  assert.equal(accrue({ ...r, now: T0 + 3n * H + H / 3n }).pts, 13);  // 13.33 -> 13
});

test("the unpaid fraction of a Point stays in the machine (claim time moves by exactly the paid time)", () => {
  const r = { rate: 7, lastClaim: T0, ends: T0 + 720n * H, storageHours: 24 };
  const a = accrue({ ...r, now: T0 + 1n * H });                       // 7 Points, exact
  assert.equal(a.pts, 7); assert.equal(a.newLast, T0 + H);
  const b = accrue({ ...r, now: T0 + H / 2n });                       // 3.5 -> 3 paid, time for 3 Points consumed, 0.5 left
  assert.equal(b.pts, 3); assert.ok(b.newLast < T0 + H / 2n); assert.ok(b.newLast > T0);
  const c = accrue({ ...r, lastClaim: b.newLast, now: T0 + H / 2n + H / 14n });  // +0.5 Point of time -> the carried 0.5 completes a Point
  assert.equal(c.pts, 1);
});

test("storage: a machine only keeps `storageHours` of earnings", () => {
  const r = { rate: 10, lastClaim: T0, ends: T0 + 720n * H, storageHours: 24 };
  assert.equal(accrue({ ...r, now: T0 + 24n * H }).pts, 240);
  assert.equal(accrue({ ...r, now: T0 + 100n * H }).pts, 240);        // 100 h away: only the last 24 h count
  const a = accrue({ ...r, now: T0 + 100n * H });
  assert.equal(a.newLast, T0 + 100n * H);                             // and it is ready to store again from now
  assert.equal(accrue({ ...r, storageHours: 1, now: T0 + 100n * H }).pts, 10);
});

test("an ended machine pays up to ends_at (inside the storage window), then closes", () => {
  const ends = T0 + 48n * H, r = { rate: 5, lastClaim: T0 + 40n * H, ends, storageHours: 24 };
  const a = accrue({ ...r, now: ends + 5n * H });
  assert.equal(a.pts, 40);                                            // 8 h x 5, nothing for the time after the end
  assert.equal(a.finished, true); assert.equal(a.newLast, ends);      // closed: last_claim_at = ends_at
  const late = accrue({ ...r, lastClaim: T0, now: ends + 500n * H }); // not claimed for ages: only the last 24 h before the end
  assert.equal(late.pts, 120); assert.equal(late.newLast, ends);
  assert.equal(accrue({ ...r, lastClaim: ends, now: ends + H }).pts, 0); // already closed
});

test("a clock that is behind (parallel claim) never pays or moves backwards", () => {
  const r = { rate: 50, lastClaim: T0 + 10n * H, ends: T0 + 720n * H, storageHours: 24 };
  const a = accrue({ ...r, now: T0 + 9n * H });
  assert.equal(a.pts, 0); assert.equal(a.newLast, r.lastClaim);
});

test("rate must be a positive integer", () => {
  assert.throws(() => accrue({ rate: 0, lastClaim: T0, now: T0 + H, ends: T0 + 2n * H, storageHours: 24 }), RangeError);
});

test("property: never over-pays, and frequent claims pay EXACTLY rate x lifetime", () => {
  let seed = 12345; const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  for (let trial = 0; trial < 300; trial++) {
    const rate = 1 + rnd(PLAN_MAX_RATE > 500 ? 500 : PLAN_MAX_RATE), storage = 1 + rnd(48), days = 1 + rnd(40);
    const D = BigInt(days) * 24n, ends = T0 + D * H;
    // (a) random claim times, some far apart: the total can never exceed rate x lifetime, and one claim never exceeds rate x elapsed
    let last = T0, total = 0, now = T0;
    while (now < ends + 3n * H) {
      now += BigInt(1 + rnd(30 * 3600)) * 1_000_000n;                  // 1 s .. 30 h later
      const a = accrue({ rate, lastClaim: last, now, ends, storageHours: storage });
      assert.ok(BigInt(a.pts) * H <= BigInt(rate) * (now - last), "paid more than rate x elapsed");
      if (a.pts >= 1) { total += a.pts; last = a.newLast; }            // the SQL does nothing below 1 Point
    }
    assert.ok(total <= rate * Number(D), `total ${total} > rate x lifetime ${rate * Number(D)}`);
    // (b) claiming at least twice per storage window loses nothing: the machine pays exactly rate x lifetime.
    //     (Needs room for a whole Point inside the window, i.e. rate x storage >= 4; a claim below 1 Point does nothing, so on a
    //      1 Point/hour machine with a 1 h window the fraction would run past the window - that forfeit is the storage rule itself.)
    const store = Math.max(storage, Math.ceil(4 / rate));
    last = T0; total = 0; now = T0;
    const step = BigInt(store) * H / 2n;
    while (now < ends + BigInt(store) * H) {
      now += BigInt(1 + rnd(Number(step / 1_000_000n))) * 1_000_000n;
      const a = accrue({ rate, lastClaim: last, now, ends, storageHours: store });
      if (a.pts >= 1) { total += a.pts; last = a.newLast; }
    }
    assert.equal(total, rate * Number(D), `rate ${rate}, storage ${store}h, ${days} d`);
  }
});

/* ---------------- plans ---------------- */
test("planStats: per day, total return, payback, ROI", () => {
  const s = planStats({ price: 2000, rate_per_hour: 4, duration_days: 30 });
  assert.equal(s.per_day, 96); assert.equal(s.total_return, 2880); assert.equal(s.profit, 880);
  assert.equal(s.roi_pct, 144); assert.equal(s.payback_days, 20.8); assert.equal(s.pays_more_than_price, true);
  const free = planStats({ price: 0, rate_per_hour: 2, duration_days: 7 });
  assert.equal(free.total_return, 336); assert.equal(free.roi_pct, null); assert.equal(free.payback_days, 0);
  assert.equal(planStats({ price: 1000, rate_per_hour: 1, duration_days: 10 }).pays_more_than_price, false);
});

test("validatePlanInput: limits, whole numbers, clean name", () => {
  const ok = validatePlanInput({ name: "  Mega\n  Miner ", price: "500", rate_per_hour: 3, duration_days: 30, max_per_user: 2 });
  assert.deepEqual(ok, { ok: true, value: { name: "Mega Miner", price: 500, rate_per_hour: 3, duration_days: 30, max_per_user: 2 } });
  assert.equal(validatePlanInput({ name: "Free", price: 0, rate_per_hour: 1, duration_days: 1, max_per_user: 1 }).ok, true); // price 0 = free machine
  const base = { name: "X", price: 10, rate_per_hour: 1, duration_days: 1, max_per_user: 1 };
  for (const bad of [{ name: "" }, { name: "   " }, { price: -1 }, { price: PLAN_MAX_PRICE + 1 }, { price: 1.5 }, { price: "abc" }, { rate_per_hour: 0 }, { rate_per_hour: PLAN_MAX_RATE + 1 },
    { rate_per_hour: 0.5 }, { duration_days: 0 }, { duration_days: 366 }, { max_per_user: 0 }, { max_per_user: 1001 }, { price: null }, { price: Infinity }])
    assert.equal(validatePlanInput({ ...base, ...bad }).ok, false, JSON.stringify(bad));
  assert.equal(validatePlanInput(null).ok, false); assert.equal(validatePlanInput("x").ok, false);
  assert.equal(validatePlanInput({ ...base, name: "A".repeat(60) }).value.name.length, 30);
  assert.ok(MAX_ACTIVE_PLANS >= 1);
});

/* ---------------- settings ---------------- */
test("settings: Auto-Miner ships OFF with a 24 h storage window; values are validated", () => {
  const c = resolveConfig([]);
  assert.equal(c.autoMinerEnabled, false); assert.equal(c.autoMinerStorageHours, 24);
  assert.equal(validateSetting("auto_miner_enabled", "true").value, true);
  assert.equal(validateSetting("auto_miner_storage_hours", "48").value, 48);
  for (const v of [0, -1, 169, 1.5, "x"]) assert.equal(validateSetting("auto_miner_storage_hours", v).ok, false, String(v));
  assert.equal(SETTING_DEFS.auto_miner_enabled.group, "Auto-Miner"); assert.equal(SETTING_DEFS.auto_miner_storage_hours.group, "Auto-Miner");
  assert.equal(resolveConfig([{ key: "auto_miner_storage_hours", value: 9999 }]).autoMinerStorageHours, 24); // bad stored value -> default
});

/* ---------------- migration 016 ---------------- */
test("migration 016: idempotent tables, hard CHECKs, per-user counter, guarded seed, recorded", () => {
  for (const t of ["auto_miner_plans", "auto_miners", "auto_miner_buys", "auto_miner_claims"]) assert.match(mig, new RegExp(`CREATE TABLE IF NOT EXISTS ${t}\\(`), t);
  assert.doesNotMatch(mig, /CREATE TABLE (?!IF NOT EXISTS)/); assert.doesNotMatch(mig, /DROP /i);
  assert.match(mig, /PRIMARY KEY \(telegram_id, plan_id\)/);                                     // one counter row per user/plan
  assert.match(mig, /rate_per_hour BIGINT NOT NULL CHECK \(rate_per_hour BETWEEN 1 AND 100000\)/); // rate >= 1: the claim maths divides by it
  assert.match(mig, /price BIGINT NOT NULL CHECK \(price >= 0 AND price <= 10000000\)/);
  assert.match(mig, /points BIGINT NOT NULL CHECK \(points > 0\)/);                              // a claim row is always a real payout
  assert.match(mig, /CREATE INDEX IF NOT EXISTS auto_miners_open_idx ON auto_miners\(telegram_id\) WHERE last_claim_at < ends_at/);
  assert.match(mig, /WHERE NOT EXISTS \(SELECT 1 FROM auto_miner_plans\)/);                      // seeding twice never duplicates
  assert.match(mig, /INSERT INTO schema_migrations\(version\) VALUES\('016_auto_miner'\) ON CONFLICT DO NOTHING/);
});

/* ---------------- SQL shape: the atomic statements ---------------- */
test("buy is ONE statement: per-plan counter with the limit on the locked row -> balance -> machine -> ledger", () => {
  assert.match(act, /INSERT INTO auto_miner_buys[\s\S]*ON CONFLICT\(telegram_id, plan_id\) DO UPDATE SET n = auto_miner_buys\.n \+ 1[\s\S]*WHERE auto_miner_buys\.n < \(SELECT max_per_user FROM pl\)[\s\S]*UPDATE users SET points = CASE WHEN users\.points >= pl\.price THEN users\.points - pl\.price ELSE -1 END[\s\S]*INSERT INTO auto_miners[\s\S]*INSERT INTO transactions/);
  assert.match(act, /isCheckViolation\(e\)/);                                                    // too few Points -> clean error, counter rolled back with it
  assert.match(act, /'Auto-Miner Purchase'/); assert.match(act, /'automine-buy:'\|\|m\.id::text/);
  assert.match(act, /WHERE pl\.price > 0/);                                                      // a free machine writes no ledger row
  assert.match(act, /WHERE id=\$\{pid\}::bigint AND active=TRUE/);                               // inactive plans cannot be bought
  assert.match(act, /EXISTS\(SELECT 1 FROM users WHERE telegram_id=\$\{id\}::bigint AND is_blocked=FALSE\)/);
  // the machine copies price / rate / length from the plan, so later plan edits never change a running machine
  assert.match(act, /SELECT u\.telegram_id, pl\.id, pl\.name, pl\.price, pl\.rate_per_hour, NOW\(\), NOW\(\), NOW\(\) \+ make_interval\(hours => pl\.duration_days \* 24\)/);
});

test("claim is ONE statement: row-locked machines -> exact maths -> claim row -> machines advance -> balance + ledger", () => {
  assert.match(act, /FROM auto_miners m WHERE m\.telegram_id=\$\{id\}::bigint AND m\.last_claim_at < m\.ends_at\s+FOR UPDATE/);
  assert.match(act, /GREATEST\(m\.last_claim_at, LEAST\(NOW\(\), m\.ends_at\) - make_interval\(hours => \$\{hrs\}::int\)\) AS t_start/);   // storage window
  assert.match(act, /GREATEST\(0, FLOOR\(EXTRACT\(EPOCH FROM \(t_end - t_start\)\) \* 1000000\)\)::bigint AS us/);                       // never negative
  assert.match(act, /\(rate \* us\) \/ 3600000000 AS pts/);                                                                              // whole Points, rounded down
  assert.match(act, /CASE WHEN ends_at <= NOW\(\) THEN ends_at\s+ELSE t_start \+ \(\(pts \* 3600000000\) \/ rate\) \* INTERVAL '1 microsecond' END AS new_last/);
  assert.match(act, /WHERE tot\.pts >= 1 AND EXISTS\(SELECT 1 FROM users WHERE telegram_id=\$\{id\}::bigint AND is_blocked=FALSE\)/);    // nothing moves below 1 Point / for a blocked user
  assert.match(act, /UPDATE auto_miners m SET last_claim_at = fin\.new_last, total_claimed = m\.total_claimed \+ fin\.pts\s+FROM fin, cl WHERE m\.id = fin\.mid/);
  assert.match(act, /UPDATE users SET points = users\.points \+ cl\.pts/);
  assert.match(act, /'Auto-Miner Reward'/); assert.match(act, /'automine:'\|\|u\.claim_id::text/);                                        // unique ledger reference per claim
  assert.ok(act.indexOf("FOR UPDATE") < act.indexOf("INSERT INTO auto_miner_claims"));
  assert.ok(act.indexOf("INSERT INTO auto_miner_claims") < act.indexOf("UPDATE auto_miners m SET"));
});

test("claim / buy never trust the client for amounts: only plan_id comes from the body; Points maths is in SQL", () => {
  assert.match(act, /body\.plan_id/);
  assert.doesNotMatch(act, /body\.(points|amount|price|rate|pending|rate_per_hour)\b[\s\S]{0,80}(autoMinerBuy|autoMinerClaim)/);
  const claimFn = act.slice(act.indexOf("export const autoMinerClaim"), act.indexOf("/* ======================= admin"));
  assert.doesNotMatch(claimFn, /body/);                                                          // claim reads no request data at all
  assert.doesNotMatch(claimFn, /Math\.|Date\.now|new Date/);                                    // time and rounding come from the database
});

test("every action checks the master switch; the user screen reads the same expression as the claim", () => {
  assert.equal((act.match(/autoMinerEnabled/g) || []).length >= 4, true);
  assert.match(act, /if \(!c\.autoMinerEnabled\) return \{ enabled: false \}/);                  // screen: off -> no table is touched
  assert.match(act, /if \(!c\.autoMinerEnabled\) throw disabled\(\)/);
  assert.match(act, /\(m\.rate_per_hour \* GREATEST\(0, FLOOR\(EXTRACT\(EPOCH FROM \(LEAST\(NOW\(\), m\.ends_at\)\s+- GREATEST\(m\.last_claim_at, LEAST\(NOW\(\), m\.ends_at\) - make_interval\(hours => \$\{hrs\}::int\)\)\s*\) \) \* 1000000\)\)::bigint\) \/ 3600000000 AS pending/);
});

test("admin: every change is audited and returns the plan's ROI", () => {
  for (const a of ["autominer.plan_create", "autominer.plan_update", "autominer.plan_enable", "autominer.plan_disable"]) assert.ok(act.includes(a), a);
  assert.equal((act.match(/await audit\(/g) || []).length, 3);                                   // create, update, toggle (enable/disable share one call)
  assert.match(act, /const stats = planStats\(/);
  assert.match(act, /net_created: num\(paid\[0\]\.paid\) - num\(sold\[0\]\.spent\)/);              // the admin sees how many Points the app has created
  assert.match(act, /still_owed/);
});

/* ---------------- wiring ---------------- */
test("router, permissions and rate limits for the 6 new actions", () => {
  const user = ["autoMiner", "autoMinerBuy", "autoMinerClaim"], admin = ["adminAutoMinerOverview", "adminAutoMinerPlanSave", "adminAutoMinerPlanSetActive"];
  assert.match(api, /import \* as amn from "\.\.\/lib\/actions\/autominer\.js"/);
  assert.match(api, /autoMiner: \{ fn: amn\.autoMiner \}/);
  assert.match(api, /autoMinerBuy: \{ fn: amn\.autoMinerBuy, write: true \}/);                   // money moves: POST only
  assert.match(api, /autoMinerClaim: \{ fn: amn\.autoMinerClaim, write: true \}/);
  assert.match(api, /adminAutoMinerOverview: \{ fn: amn\.adminAutoMinerOverview, admin: true \}/);
  assert.match(api, /adminAutoMinerPlanSave: \{ fn: amn\.adminAutoMinerPlanSave, admin: true, write: true \}/);
  assert.match(api, /adminAutoMinerPlanSetActive: \{ fn: amn\.adminAutoMinerPlanSetActive, admin: true, write: true \}/);
  for (const a of admin) { assert.equal(ACTION_PERMS[a], "rewards", a); assert.equal(can("super", a), true); assert.equal(can("support", a), false); assert.equal(can("finance", a), false); }
  for (const a of user) assert.ok(!(a in ACTION_PERMS), a + " is a user action");
  for (const a of ["autoMiner", "autoMinerBuy", "autoMinerClaim"]) assert.match(rl, new RegExp(a + ": \\["), a);
  assert.match(rl, /autoMinerBuy: \[5, 60\]/); assert.match(rl, /autoMinerClaim: \[5, 60\]/);
});

test("bootstrap tells the app whether Auto-Miner is on (config only); History has icons for both ledger types", () => {
  assert.match(core, /const auto_miner = \{ enabled: cfg\.autoMinerEnabled \}/);
  assert.match(core, /return \{ user, miner, auto_miner, popup_ad,/);
  assert.doesNotMatch(core, /auto_miners|auto_miner_plans/);                                       // deploying before the migration cannot break the rest of the app
  assert.match(app, /'Auto-Miner Purchase': '🤖'/); assert.match(app, /'Auto-Miner Reward': '⛏️'/);
});

test("package.json: version bumped and the new files are syntax-checked", () => {
  assert.equal(pkg.version, "1.18.0");
  assert.ok(pkg.scripts.check.includes("node --check lib/autominer.js")); assert.ok(pkg.scripts.check.includes("node --check lib/actions/autominer.js"));
});
