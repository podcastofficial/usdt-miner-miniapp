// Phase 2 / Part 2: streaks, milestones, levels & badges, promo codes. Pure logic + static checks of the SQL/migration/wiring
// (nothing here talks to a database; see CHANGELOG_PART9.md for what the owner must still verify live).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  LADDER_DEFAULT, MILESTONES, EARN_TYPES, BADGES, dayDiff, streakAfterClaim, visibleStreak, ladderDay, ladderReward, streakView,
  levelFor, badgesFor, dueMilestones, milestoneRef, thresholds, milestoneReward, normalizePromo, generatePromoCode, validatePromoInput, promoFailure, pageNum, REF_PAGE,
} from "../lib/engagement.js";
import { validateSetting, resolveConfig, SETTING_DEFS, camel } from "../lib/settingsDefs.js";

const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");

/* ---------------- streak ---------------- */
test("dayDiff: whole days, month/year boundaries, bad input", () => {
  assert.equal(dayDiff("2026-11-14", "2026-11-15"), 1);
  assert.equal(dayDiff("2026-11-15", "2026-11-15"), 0);
  assert.equal(dayDiff("2026-02-28", "2026-03-01"), 1);
  assert.equal(dayDiff("2026-12-31", "2027-01-01"), 1);
  assert.equal(dayDiff("2026-11-10", "2026-11-15"), 5);
  assert.equal(dayDiff("nope", "2026-11-15"), null);
  assert.equal(dayDiff(null, "2026-11-15"), null);
});

test("streak continues after yesterday, restarts after a missed day, first claim = 1", () => {
  assert.equal(streakAfterClaim({ last: "2026-11-14", today: "2026-11-15", current: 3 }), 4);
  assert.equal(streakAfterClaim({ last: "2026-11-13", today: "2026-11-15", current: 6 }), 1); // missed one day -> reset
  assert.equal(streakAfterClaim({ last: "2026-10-01", today: "2026-11-15", current: 30 }), 1);
  assert.equal(streakAfterClaim({ last: null, today: "2026-11-15", current: 0 }), 1);
  assert.equal(streakAfterClaim({ last: "2026-11-15", today: "2026-11-15", current: 4 }), 4); // same day never double-counts
});

test("visible streak is only alive if the user claimed today or yesterday", () => {
  assert.equal(visibleStreak({ last: "2026-11-15", today: "2026-11-15", current: 5 }), 5);
  assert.equal(visibleStreak({ last: "2026-11-14", today: "2026-11-15", current: 5 }), 5);
  assert.equal(visibleStreak({ last: "2026-11-13", today: "2026-11-15", current: 5 }), 0);
  assert.equal(visibleStreak({ last: null, today: "2026-11-15", current: 0 }), 0);
});

test("7-day ladder: day 1..7 then it starts again; reward follows the configured ladder", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 14, 15].map(ladderDay), [1, 2, 3, 4, 5, 6, 7, 1, 7, 1]);
  assert.deepEqual(LADDER_DEFAULT, [100, 120, 140, 160, 180, 200, 300]);
  assert.equal(ladderReward(LADDER_DEFAULT, 1), 100);
  assert.equal(ladderReward(LADDER_DEFAULT, 7), 300);
  assert.equal(ladderReward(LADDER_DEFAULT, 8), 100);
  assert.equal(ladderReward([5, 6, 7, 8, 9, 10, 11], 3), 7);
});

test("streakView: what the home card shows in each situation", () => {
  const base = { ladder: LADDER_DEFAULT, enabled: true, baseReward: 100, best: 0 };
  const fresh = streakView({ ...base, last: null, today: "2026-11-15", current: 0 });
  assert.deepEqual([fresh.current, fresh.claimed_today, fresh.next_day, fresh.next_reward], [0, false, 1, 100]);
  const claimed = streakView({ ...base, last: "2026-11-15", today: "2026-11-15", current: 3, best: 3 });
  assert.deepEqual([claimed.current, claimed.claimed_today, claimed.next_day, claimed.next_reward], [3, true, 4, 160]); // tomorrow = day 4
  const waiting = streakView({ ...base, last: "2026-11-14", today: "2026-11-15", current: 3, best: 5 });
  assert.deepEqual([waiting.current, waiting.claimed_today, waiting.next_day, waiting.next_reward, waiting.best], [3, false, 4, 160, 5]);
  const broken = streakView({ ...base, last: "2026-11-10", today: "2026-11-15", current: 6, best: 6 });
  assert.deepEqual([broken.current, broken.next_day, broken.next_reward, broken.best], [0, 1, 100, 6]); // reset, best is kept
  const wrap = streakView({ ...base, last: "2026-11-15", today: "2026-11-15", current: 7, best: 7 });
  assert.deepEqual([wrap.next_day, wrap.next_reward], [1, 100]);
});

test("ladder OFF: flat reward, no ladder exposed", () => {
  const v = streakView({ ladder: LADDER_DEFAULT, enabled: false, baseReward: 100, last: "2026-11-14", today: "2026-11-15", current: 3, best: 3 });
  assert.equal(v.enabled, false); assert.equal(v.ladder, null); assert.equal(v.next_reward, 100);
});

test("the frontend ladder-day maths matches the server for 1..60", () => {
  const m = /const lastDayOf = ([^;]+);/.exec(read("public/app.js"));
  assert.ok(m, "lastDayOf not found in app.js");
  const f = new Function("return " + m[1])();
  for (let c = 1; c <= 60; c++) assert.equal(f(c), ladderDay(c), "streak " + c);
  assert.equal(f(0), 0);
});

/* ---------------- levels & badges ---------------- */
test("levels: Bronze -> Silver -> Gold on lifetime earned Points, with progress", () => {
  const t = { silver: 10000, gold: 50000 };
  assert.deepEqual([0, 9999, 10000, 49999, 50000, 1e9].map(e => levelFor(e, t).code), ["bronze", "bronze", "silver", "silver", "gold", "gold"]);
  assert.equal(levelFor(5000, t).progress, 50);
  assert.equal(levelFor(5000, t).next_at, 10000);
  assert.equal(levelFor(30000, t).progress, 50);
  assert.equal(levelFor(60000, t).next_at, null);
  assert.equal(levelFor(60000, t).progress, 100);
  assert.equal(levelFor(-5, t).earned, 0);
  assert.equal(levelFor("abc", t).code, "bronze");
});

test("only real earnings count towards levels (never deposits, refunds or admin adjustments)", () => {
  assert.deepEqual([...EARN_TYPES].sort(), ["Daily Reward", "Milestone Reward", "Promo Code", "Referral Reward", "Task Reward"]);
  for (const t of ["Deposit", "Admin Adjustment", "Campaign Refund", "Withdrawal Refund"]) assert.ok(!EARN_TYPES.includes(t), t);
});

test("badges: entitlement is derived from stats and every code has a name/icon/help", () => {
  assert.deepEqual(badgesFor({}), []);
  assert.deepEqual(badgesFor({ bestStreak: 7 }), ["streak_7"]);
  assert.deepEqual(badgesFor({ bestStreak: 30, qualified: 10, levelIndex: 2 }), ["streak_7", "streak_30", "ref_5", "ref_10", "level_silver", "level_gold"]);
  assert.ok(badgesFor({ qualified: 50 }).includes("ref_50"));
  for (const c of badgesFor({ bestStreak: 99, qualified: 99, levelIndex: 2 })) assert.ok(BADGES[c] && BADGES[c].name && BADGES[c].icon && BADGES[c].help, c);
});

/* ---------------- milestones ---------------- */
test("milestones 5 / 10 / 50: due only when reached and not already paid (once-only)", () => {
  assert.deepEqual(MILESTONES, [5, 10, 50]);
  assert.deepEqual(dueMilestones(4, []), []);
  assert.deepEqual(dueMilestones(5, []), [5]);
  assert.deepEqual(dueMilestones(12, []), [5, 10]);
  assert.deepEqual(dueMilestones(12, [5]), [10]);
  assert.deepEqual(dueMilestones(12, [5, 10]), []);      // second call pays nothing
  assert.deepEqual(dueMilestones(60, [5, 10, 50]), []);
  assert.deepEqual(dueMilestones(60, [5, 10]), [50]);
  assert.equal(milestoneRef("123", 10), "milestone:123:10");
});

/* ---------------- promo codes ---------------- */
test("promo input from users is normalised; hostile or malformed input is rejected before the database", () => {
  assert.equal(normalizePromo("  welcome-24 "), "WELCOME24");
  assert.equal(normalizePromo("ab cd ef"), "ABCDEF");
  for (const bad of [null, "", "abc", "x".repeat(21), "NO!PE12", "DROP TABLE;", "a'b\"c1", "😀😀😀😀"]) assert.equal(normalizePromo(bad), null, String(bad));
});

test("generated promo codes are 8 unambiguous characters and different each time", () => {
  const seen = new Set();
  for (let i = 0; i < 200; i++) { const c = generatePromoCode(); assert.match(c, /^[A-HJ-NP-Z2-9]{8}$/); seen.add(c); }
  assert.ok(seen.size > 190);
});

test("admin promo validation: a total cap is mandatory, limits are bounded, defaults are safe", () => {
  const ok = validatePromoInput({ code: "launch50", reward: "50", totalLimit: 100 });
  assert.deepEqual(ok, { ok: true, value: { code: "LAUNCH50", reward: 50, perUserLimit: 1, totalLimit: 100, expiresDays: 0, note: "" } });
  assert.match(validatePromoInput({ reward: 10, totalLimit: 5 }).value.code, /^[A-Z0-9]{8}$/); // empty code -> generated
  assert.equal(validatePromoInput({ code: "ABCDEF", reward: 10 }).ok, false);                    // no total limit
  assert.equal(validatePromoInput({ code: "ABCDEF", reward: 10, totalLimit: 0 }).ok, false);
  assert.equal(validatePromoInput({ code: "ABCDEF", reward: 0, totalLimit: 5 }).ok, false);
  assert.equal(validatePromoInput({ code: "ABCDEF", reward: 10_000_001, totalLimit: 5 }).ok, false);
  assert.equal(validatePromoInput({ code: "ABCDEF", reward: 10, totalLimit: 5, perUserLimit: 11 }).ok, false);
  assert.equal(validatePromoInput({ code: "ABCDEF", reward: 10, totalLimit: 5, expiresDays: 366 }).ok, false);
  assert.equal(validatePromoInput({ code: "A B", reward: 10, totalLimit: 5 }).ok, false);
  assert.equal(validatePromoInput({ code: "ABCDEF", reward: 1.5, totalLimit: 5 }).ok, false);
  assert.equal(validatePromoInput({ code: "ABCDEF", reward: 10, totalLimit: 5, note: "a\nb\u0000c" }).value.note, "a b c");
  assert.equal(validatePromoInput(null).ok, false);
});

test("promo failure reasons: invalid > inactive > expired > exhausted > already used", () => {
  const now = Date.parse("2026-11-15T12:00:00Z");
  const p = { active: true, expires_at: null, redeemed: 0, total_limit: 10, per_user_limit: 1, mine: 0 };
  assert.equal(promoFailure(null, now).code, "promo_invalid");
  assert.equal(promoFailure({ ...p, active: false }, now).code, "promo_inactive");
  assert.equal(promoFailure({ ...p, expires_at: "2026-11-15T11:59:59Z" }, now).code, "promo_expired");
  assert.equal(promoFailure({ ...p, expires_at: "2026-11-16T00:00:00Z", redeemed: 10 }, now).code, "promo_exhausted");
  assert.equal(promoFailure({ ...p, mine: 1 }, now).code, "promo_used");
  assert.equal(promoFailure({ ...p, per_user_limit: 3, mine: 2 }, now).code, "promo_unavailable"); // race: retry
  assert.equal(promoFailure({ ...p, redeemed: 10, mine: 1 }, now).code, "promo_exhausted");
});

test("referral pagination helper clamps page numbers", () => {
  assert.equal(REF_PAGE, 20);
  assert.deepEqual([undefined, "x", 0, -3, 1.5, 2, "3", 10001].map(pageNum), [1, 1, 1, 1, 1, 2, 3, 1]);
});

/* ---------------- settings ---------------- */
test("engagement settings: risky ones start OFF, defaults are valid, ladder needs exactly 7 whole numbers", () => {
  for (const k of ["streak_enabled", "milestones_enabled", "promo_enabled"]) { assert.equal(SETTING_DEFS[k].def, false, k + " must ship OFF"); assert.equal(SETTING_DEFS[k].group, "Engagement"); }
  assert.deepEqual(validateSetting("streak_ladder", "100 120 140\n160, 180 200 300").value, [100, 120, 140, 160, 180, 200, 300]);
  assert.deepEqual(validateSetting("streak_ladder", [1, 2, 3, 4, 5, 6, 7]).value, [1, 2, 3, 4, 5, 6, 7]);
  for (const bad of [[1, 2, 3], [1, 2, 3, 4, 5, 6, 7, 8], [0, 1, 1, 1, 1, 1, 1], [1.5, 1, 1, 1, 1, 1, 1], ["a", 1, 1, 1, 1, 1, 1], "", null, [1e7, 1, 1, 1, 1, 1, 1]])
    assert.equal(validateSetting("streak_ladder", bad).ok, false, JSON.stringify(bad));
  assert.equal(validateSetting("milestone_reward_5", 0).ok, false);
  assert.equal(validateSetting("level_silver_at", "10000").value, 10000);
});

test("milestone reward settings resolve through camel() and reach the payout code", () => {
  assert.equal(camel("milestone_reward_5"), "milestoneReward_5");
  const cfg = resolveConfig([{ key: "milestone_reward_10", value: 2222 }, { key: "level_gold_at", value: 5 }, { key: "level_silver_at", value: 9 }]);
  assert.equal(milestoneReward(cfg, 5), 500); assert.equal(milestoneReward(cfg, 10), 2222); assert.equal(milestoneReward(cfg, 50), 10000);
  assert.deepEqual(thresholds(cfg), { silver: 9, gold: 10 }); // gold <= silver is repaired, never inverted
  assert.equal(cfg.streakEnabled, false); assert.equal(cfg.promoEnabled, false); assert.equal(cfg.milestonesEnabled, false);
});

/* ---------------- static checks: migration, SQL safety, wiring ---------------- */
const mig = read("db/migrations/008_engagement.sql");
test("migration 008 is idempotent and creates what the code relies on", () => {
  for (const t of ["streaks", "milestones_paid", "badges", "promo_codes", "promo_redemptions"]) assert.match(mig, new RegExp(`CREATE TABLE IF NOT EXISTS ${t}\\(`));
  assert.match(mig, /PRIMARY KEY \(referrer_id, milestone\)/);
  assert.match(mig, /PRIMARY KEY \(telegram_id, code\)/);
  assert.match(mig, /UNIQUE \(code, telegram_id, n\)/);
  assert.match(mig, /CHECK \(redeemed <= total_limit\)/);
  assert.match(mig, /total_limit INTEGER NOT NULL CHECK \(total_limit >= 1\)/);
  assert.match(mig, /schema_migrations\(version\) VALUES\('008_engagement'\) ON CONFLICT DO NOTHING/);
  assert.doesNotMatch(mig, /DROP |TRUNCATE|DELETE FROM/i);
  assert.doesNotMatch(mig.replace(/CREATE (UNIQUE )?INDEX IF NOT EXISTS/g, ""), /CREATE (UNIQUE )?INDEX(?! IF NOT EXISTS)/);
});

test("money paths are single atomic statements with an idempotency guard", () => {
  const earn = read("lib/actions/earn.js"), eng = read("lib/actions/engage.js"), bad = read("lib/badges.js");
  // daily: claim + streak + balance + ledger in one statement, one claim per day via the PK
  assert.match(earn, /INSERT INTO daily_claims[\s\S]*ON CONFLICT DO NOTHING[\s\S]*INSERT INTO streaks[\s\S]*UPDATE users SET points=points\+c\.reward[\s\S]*INSERT INTO transactions/);
  assert.match(earn, /'daily:'\|\|u\.telegram_id::text\|\|':'\|\|u\.claim_date::text/);
  // milestones: PK insert -> balance -> ledger, unique ledger reference
  assert.match(bad, /INSERT INTO milestones_paid[\s\S]*ON CONFLICT DO NOTHING[\s\S]*UPDATE users SET points=points\+m\.reward[\s\S]*INSERT INTO transactions/);
  assert.match(bad, /'milestone:'\|\|telegram_id::text\|\|':'\|\|milestone::text/);
  assert.match(bad, /if \(!c\.milestonesEnabled\) return \[\]/);
  // promo: slot insert -> counter -> balance -> ledger; 23514 (CHECK) is turned into "fully redeemed"
  assert.match(eng, /INSERT INTO promo_redemptions[\s\S]*ON CONFLICT DO NOTHING[\s\S]*UPDATE promo_codes SET redeemed=redeemed\+1[\s\S]*UPDATE users SET points=points\+r\.reward[\s\S]*INSERT INTO transactions/);
  assert.match(eng, /'promo:'\|\|u\.code\|\|':'\|\|\$\{id\}::text\|\|':'\|\|u\.n::text/);
  assert.match(eng, /e\.code === "23514"/);
  assert.match(eng, /if \(!c\.promoEnabled\) throw/);
  assert.match(eng, /is_blocked=FALSE/);
});

test("guessing promo codes is throttled before the attempt, and admin cannot create unlimited codes", () => {
  const eng = read("lib/actions/engage.js"), rl = read("lib/ratelimit.js");
  assert.ok(eng.indexOf("failuresSoFar(id)) >= 20") < eng.indexOf("normalizePromo(body.code)"), "fail cap must be checked first");
  assert.match(rl, /promoRedeem: \[5, 60\]/); assert.match(rl, /promoFail: \[20, 43200\]/);
});

test("API registry: new actions exist, writes are POST-only, admin actions are admin-only", () => {
  const api = read("api/index.js");
  const line = (n) => (new RegExp(`^\\s*${n}: \\{[^\\n]*\\},?$`, "m").exec(api) || [""])[0];
  assert.match(line("promoRedeem"), /write: true/);
  for (const n of ["adminPromoCreate", "adminPromoSetActive"]) assert.match(line(n), /admin: true, write: true/, n);
  assert.match(line("adminPromoList"), /admin: true/);
  for (const n of ["engagement", "referralList"]) assert.ok(line(n), n + " not registered");
  assert.doesNotMatch(line("engagement"), /admin/);
});

test("My Referrals never sends raw names: masked server-side, and the old unmasked list is gone from `referral`", () => {
  const eng = read("lib/actions/engage.js"), ref = read("lib/actions/referral.js");
  assert.match(eng, /maskName\(r\.first_name, r\.username\)/);
  assert.doesNotMatch(ref, /referrals: list\.map/);
});

test("referral verification pays milestones + badges AFTER the reward, inside try/catch", () => {
  const ref = read("lib/actions/referral.js");
  assert.match(ref, /try \{ await payMilestones\(st\.referrer_id\); await syncBadges\(st\.referrer_id\); \}/);
  assert.ok(ref.indexOf("notifyReferral") < ref.indexOf("payMilestones"));
});

test("admin audit covers promo actions; version and check script are bumped", () => {
  const eng = read("lib/actions/engage.js"), pkg = JSON.parse(read("package.json"));
  for (const a of ["promo.create", "promo.enable", "promo.disable"]) assert.ok(eng.includes(a), a);
  const [maj, min] = pkg.version.split(".").map(Number); // Part 2 shipped 1.9.0; later parts only go up
  assert.ok(maj > 1 || (maj === 1 && min >= 9), pkg.version);
  for (const f of ["lib/engagement.js", "lib/badges.js", "lib/actions/engage.js"]) assert.ok(pkg.scripts.check.includes(f), f);
});
