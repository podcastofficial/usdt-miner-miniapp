// Part 14 (v1.14.0): withdrawal wallet cooldown, weekly missions, Terms & Privacy.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { cooldownLeftMs, fmtWait, normAddr } from "../lib/walletGuard.js";
import { buildState, claimPlan, missionRef, missionDefs, MISSION_IDS } from "../lib/missions.js";
import { DEFAULT_TERMS, DEFAULT_PRIVACY, termsAccepted, termsNeeded } from "../lib/terms.js";
import { resolveConfig, validateSetting, SETTING_DEFS } from "../lib/settingsDefs.js";
const read = (f) => fs.readFileSync(new URL("../" + f, import.meta.url), "utf8");
const cfg = resolveConfig([]);

/* ---------------- wallet cooldown ---------------- */
test("cooldownLeftMs: new address waits, old address is free, 0 hours = rule off, bad date = still waiting", () => {
  const now = Date.parse("2026-11-16T12:00:00Z"), H = 3600e3;
  assert.equal(cooldownLeftMs(new Date(now - 1 * H), now, 24), 23 * H);
  assert.equal(cooldownLeftMs(new Date(now - 24 * H), now, 24), 0);
  assert.equal(cooldownLeftMs(new Date(now - 100 * H), now, 24), 0);
  assert.equal(cooldownLeftMs(new Date(now), now, 0), 0);
  assert.equal(cooldownLeftMs(new Date(now), now, -5), 0);
  assert.equal(cooldownLeftMs("not a date", now, 24), 24 * H);
  assert.equal(cooldownLeftMs(null, now, 24), 24 * H); assert.equal(cooldownLeftMs(undefined, now, 24), 24 * H);
});
test("fmtWait rounds up and reads naturally", () => {
  assert.equal(fmtWait(1), "1 minute"); assert.equal(fmtWait(61e3), "2 minutes"); assert.equal(fmtWait(60 * 60e3), "1h");
  assert.equal(fmtWait(90 * 60e3), "1h 30m"); assert.equal(fmtWait(23 * 3600e3 + 59 * 60e3 + 1), "24h");
  assert.equal(normAddr("  0xABCdef "), "0xabcdef");
});
test("withdraw: terms check first, then the address is recorded, then the cooldown rule, then the reservation", () => {
  const f = read("lib/actions/finance.js"), w = f.slice(f.indexOf("export const withdraw = async"), f.indexOf("export const withdrawList"));
  const at = (re) => { const m = w.search(re); assert.ok(m >= 0, String(re)); return m; };
  const order = [at(/termsNeeded\(c, row\)/), at(/isAddress\(wallet\)/), at(/INSERT INTO wallet_addresses/), at(/cooldownLeftMs\(/), at(/createWithdrawal\(/)];
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
  assert.match(w, /"terms_required", 403/); assert.match(w, /"wallet_cooldown", 403/);
  assert.match(w, /ON CONFLICT \(telegram_id,address\) DO UPDATE SET address=EXCLUDED\.address RETURNING first_seen_at/); // keeps the ORIGINAL first_seen_at
  assert.match(f, /walletCooldownHours: c\.walletCooldownHours, termsRequired: c\.termsRequired/);
});

/* ---------------- weekly missions ---------------- */
test("missions: defaults are OFF and sensible; progress is capped, done/claimed flags follow", () => {
  assert.equal(cfg.missionsEnabled, false);
  assert.deepEqual(missionDefs(cfg).map((m) => [m.id, m.target, m.reward]), [["daily", 5, 200], ["tasks", 10, 300], ["refs", 3, 1000]]);
  const s = buildState(cfg, { daily: 7, tasks: 4, refs: 0 }, new Set(["daily"]));
  assert.deepEqual(s.items.map((i) => [i.id, i.progress, i.done, i.claimed]), [["daily", 5, true, true], ["tasks", 4, false, false], ["refs", 0, false, false]]);
  assert.equal(s.bonus.available, false);
  const s2 = buildState(cfg, { daily: 1, tasks: 1, refs: 1 }, new Set(MISSION_IDS));
  assert.equal(s2.bonus.available, true); assert.equal(s2.bonus.reward, 500);
  assert.equal(buildState(cfg, {}, new Set([...MISSION_IDS, "bonus"])).bonus.available, false); // already claimed
  assert.equal(buildState({ ...cfg, missionBonusReward: 0 }, {}, new Set(MISSION_IDS)).bonus.enabled, false); // 0 = no bonus
  assert.equal(buildState(cfg, { daily: "x", tasks: -3, refs: NaN }, new Set()).items.every((i) => i.progress === 0), true);
});
test("claimPlan: pays only finished, unclaimed missions; the bonus needs all three claimed first", () => {
  const st = (p, c) => buildState(cfg, p, new Set(c));
  assert.equal(claimPlan(st({ daily: 5 }, []), "daily").ok, true);
  assert.equal(claimPlan(st({ daily: 5 }, []), "daily").reward, 200);
  assert.equal(claimPlan(st({ daily: 4 }, []), "daily").ok, false);
  const again = claimPlan(st({ daily: 5 }, ["daily"]), "daily"); assert.equal(again.ok, false); assert.equal(again.code, "already_claimed");
  assert.equal(claimPlan(st({}, []), "nope").ok, false);
  assert.equal(claimPlan(st({ daily: 9, tasks: 99, refs: 9 }, ["daily", "tasks"]), "bonus").ok, false);
  assert.equal(claimPlan(st({}, MISSION_IDS), "bonus").ok, true);
  assert.equal(claimPlan(st({}, [...MISSION_IDS, "bonus"]), "bonus").code, "already_claimed");
});
test("missions: one ledger reference per user, week and mission; progress comes from existing tables; reward is idempotent", () => {
  assert.equal(missionRef("2026-11-16", "daily", "42"), "mission:2026-11-16:daily:42");
  const a = read("lib/actions/missions.js");
  assert.match(a, /date_trunc\('week', now\(\) AT TIME ZONE/); assert.match(a, /type='Daily Reward'/);
  assert.match(a, /FROM task_completions/); assert.match(a, /FROM referral_events/); assert.match(a, /e\.qualified_at/);
  assert.match(a, /creditEx\(id, plan\.reward, "Mission Reward"/); assert.match(a, /r\.duplicate/);
  assert.match(a, /missionsEnabled/);
  assert.match(read("lib/engagement.js"), /EARN_TYPES = \[[^\]]*"Mission Reward"/);
});

/* ---------------- terms & privacy ---------------- */
test("terms: accepted only for the current version; required only when the admin turns it on", () => {
  assert.equal(termsAccepted({ terms_version_accepted: 2 }, 2), true);
  assert.equal(termsAccepted({ terms_version_accepted: 1 }, 2), false);
  assert.equal(termsAccepted({}, 1), false); assert.equal(termsAccepted(null, 1), false);
  assert.equal(termsNeeded({ termsRequired: false, termsVersion: 1 }, {}), false);
  assert.equal(termsNeeded({ termsRequired: true, termsVersion: 1 }, {}), true);
  assert.equal(termsNeeded({ termsRequired: true, termsVersion: 2 }, { terms_version_accepted: 1 }), true);
  assert.equal(termsNeeded({ termsRequired: true, termsVersion: 2 }, { terms_version_accepted: 2 }), false);
  assert.ok(DEFAULT_TERMS.length > 200 && DEFAULT_TERMS.length < 8000 && DEFAULT_PRIVACY.length > 200 && DEFAULT_PRIVACY.length < 8000);
  assert.equal(cfg.termsRequired, false); assert.equal(cfg.termsVersion, 1);
  assert.match(read("lib/actions/terms.js"), /UPDATE users SET terms_version_accepted=\$\{c\.termsVersion\}::int/);
});

/* ---------------- settings ---------------- */
test("settings: new options validate, long texts keep line breaks, bad values are refused", () => {
  assert.equal(cfg.walletCooldownHours, 24);
  assert.equal(validateSetting("wallet_cooldown_hours", 0).value, 0); assert.equal(validateSetting("wallet_cooldown_hours", 721).ok, false);
  assert.equal(validateSetting("missions_enabled", "true").value, true);
  assert.equal(validateSetting("mission_daily_target", 8).ok, false); assert.equal(validateSetting("mission_daily_target", 7).ok, true);
  assert.equal(validateSetting("mission_bonus_reward", 0).ok, true);
  assert.equal(validateSetting("terms_text", "A\r\n\r\nB").value, "A\n\nB");
  assert.equal(validateSetting("terms_text", "x".repeat(8001)).ok, false); assert.equal(validateSetting("terms_text", 5).ok, false);
  assert.equal(validateSetting("terms_version", 0).ok, false);
  for (const k of ["missions_enabled", "terms_required"]) assert.equal(SETTING_DEFS[k].def, false, k + " must start OFF");
  for (const [k, d] of Object.entries(SETTING_DEFS)) assert.ok(d.label && d.group && d.type, k);
});

/* ---------------- plumbing ---------------- */
test("router, rate limits, migration and release files", () => {
  const api = read("api/index.js"), rl = read("lib/ratelimit.js");
  assert.match(api, /missions: \{ fn: mis\.missions \}/); assert.match(api, /missionClaim: \{ fn: mis\.missionClaim, write: true \}/);
  assert.match(api, /terms: \{ fn: trm\.terms \}/); assert.match(api, /termsAccept: \{ fn: trm\.termsAccept, write: true \}/);
  for (const a of ["missions", "missionClaim", "terms", "termsAccept"]) assert.match(rl, new RegExp(`${a}: \\[\\d+, 60\\]`), a);
  const m = read("db/migrations/013_missions_terms_wallets.sql"), code = m.replace(/--.*$/gm, "");
  assert.match(code, /CREATE TABLE IF NOT EXISTS wallet_addresses\(/); assert.match(code, /PRIMARY KEY \(telegram_id, address\)/);
  assert.match(code, /FROM withdrawals/); assert.match(code, /ON CONFLICT DO NOTHING/); // old addresses are trusted
  assert.match(code, /ADD COLUMN IF NOT EXISTS terms_version_accepted INT/); assert.match(code, /ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ/);
  assert.match(code, /INSERT INTO schema_migrations\(version\) VALUES\('013_missions_terms_wallets'\) ON CONFLICT DO NOTHING;/);
  assert.doesNotMatch(code, /DROP\s|TRUNCATE|DELETE\s+FROM/i);
  for (const m2 of code.matchAll(/CREATE (?:UNIQUE )?INDEX (?!IF NOT EXISTS)/g)) assert.fail("index without IF NOT EXISTS: " + m2[0]);
  const pkg = JSON.parse(read("package.json"));
  assert.match(pkg.version, /^1\.(1[4-9]|[2-9]\d)\./);
  for (const f of ["lib/walletGuard.js", "lib/terms.js", "lib/missions.js", "lib/actions/missions.js", "lib/actions/terms.js"]) assert.ok(pkg.scripts.check.includes("node --check " + f), f);
});
test("frontend: screens, handlers, no inline styles, admin long-text editor", () => {
  const html = read("public/index.html"), app = read("public/app.js"), adm = read("public/admin.js");
  for (const id of ["missions", "terms", "mslist", "termsbox", "termsbtn"]) assert.ok(html.includes(`id="${id}"`), id);
  for (const t of ["missions", "terms"]) assert.match(html, new RegExp(`data-go="${t}"`));
  for (const h of ["missionClaim", "termsAccept"]) assert.match(app, new RegExp(`^  (async )?${h}\\(`, "m"), h);
  assert.match(app, /api\('missions'\)/); assert.match(app, /api\('terms'\)/); assert.match(app, /missions: 'more', terms: 'more'/);
  assert.match(app, /e\.code === 'terms_required'/); assert.match(app, /er\.code = j\.code/);
  assert.match(adm, /i\.type==='longtext'\?`<textarea/);
  assert.doesNotMatch(html + app, /style="/); // strict CSP: no inline styles
});
