// Phase 2 / Part 5 (v1.12.0): permission matrix, fraud rules, CSV escaping, i18n key coverage, analytics, health alerts, light theme.
// Pure rules are tested directly; SQL and wiring are checked statically (no Postgres in the build environment).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

import { can, ACTION_PERMS, ROLE_PERMS, ROLES, GRANTABLE, PERMS, permsOf, roleOf } from "../lib/roles.js";
import { walletFlags, burstFlags, claimFlags, RULES, MAX_FLAGS_PER_SCAN } from "../lib/fraud.js";
import { csvCell, toCsv, DATASETS, EXPORT_MAX_ROWS, isDataset } from "../lib/csv.js";
import { fillDays, dayBefore, pct, retention, conversion, barHeights, DAYS } from "../lib/analytics.js";
import { scrub, adminIds, bucketOf, apiErrorText, ledgerText, withdrawalsText, shouldAlertWithdrawals, sendAlert } from "../lib/health.js";
import { autoCreditBlocked } from "../lib/safetyRules.js";
import { LANGS, guessLang } from "../lib/i18n.js";
import { validateSetting, SETTING_DEFS, resolveConfig } from "../lib/settingsDefs.js";

const read = (p) => fs.readFileSync(new URL("../" + p, import.meta.url), "utf8");
const api = read("api/index.js"), html = read("public/index.html"), app = read("public/app.js"), adm = read("public/admin.js");

/* ---------------- roles / permission matrix ---------------- */
const adminActions = [...api.matchAll(/^\s{2}(\w+): \{ fn: [\w.]+, admin: true/gm)].map((m) => m[1]);

test("every admin action in the router has a permission, and no permission points to a missing action", () => {
  assert.ok(adminActions.length >= 60, "found " + adminActions.length);
  for (const a of adminActions) assert.ok(a in ACTION_PERMS, "no permission for " + a);
  for (const a of Object.keys(ACTION_PERMS)) assert.ok(adminActions.includes(a), a + " is in ACTION_PERMS but is not an admin action in api/index.js");
  for (const [a, p] of Object.entries(ACTION_PERMS)) assert.ok(PERMS.includes(p), `${a} uses unknown permission ${p}`);
});

test("the router checks the role after the admin check, on every admin call", () => {
  assert.match(api, /roleOf\(id\)/);
  assert.match(api, /def\.admin && !can\(role, action\)/);
  assert.ok(api.indexOf("def.admin && !isAdmin") < api.indexOf("def.admin && !can(role, action)"));
  assert.match(api, /setLang: \{ fn: saf\.setLang, write: true \}/); // users set their own language
  assert.doesNotMatch(api.match(/setLang: \{[^}]*\}/)[0], /admin: true/);
});

test("super can do everything; unknown or missing roles can do nothing (fail closed)", () => {
  for (const a of Object.keys(ACTION_PERMS)) assert.equal(can("super", a), true, a);
  for (const role of [null, undefined, "", "owner", "admin", "SUPER", "__proto__", "constructor"]) for (const a of Object.keys(ACTION_PERMS)) assert.equal(can(role, a), false, `${role} ${a}`);
  assert.equal(can("super", "adminDoesNotExist"), false);
  assert.equal(can("super", "__proto__"), false);
  assert.equal(can("super", "constructor"), false);
  assert.deepEqual(permsOf("nobody"), []);
  assert.equal(permsOf("super").length, PERMS.length);
});

test("permission matrix: support (no money, no settings) and finance (no settings, no adjust, no content)", () => {
  const denied = { support: ["adminWithdrawalApprove", "adminWithdrawalPaid", "adminDepositApprove", "adminUserAdjust", "adminSettingsUpdate", "adminSettings", "adminRoleSet", "adminExport",
      "adminBroadcastCreate", "adminContestPay", "adminDrawPick", "adminPromoCreate", "adminAudit", "adminAnalytics", "adminDiagnostics", "adminReconcile"],
    finance: ["adminUserAdjust", "adminUserBlock", "adminSettingsUpdate", "adminRoleSet", "adminRoleRemove", "adminCreateTask", "adminCampaignApprove", "adminTaskProofApprove",
      "adminBroadcastCreate", "adminContestPay", "adminDrawPick", "adminPromoCreate", "adminDiagnostics"] };
  const allowed = { support: ["adminDashboard", "adminUsers", "adminUser", "adminUserBlock", "adminTasks", "adminCreateTask", "adminCampaignApprove", "adminCampaignClose", "adminTaskProofApprove", "adminTaskProofReject", "adminFraudList", "adminFraudReview", "adminFraudScan", "adminProofHide"],
    finance: ["adminDashboard", "adminWithdrawals", "adminWithdrawalApprove", "adminWithdrawalReject", "adminWithdrawalPaid", "adminDeposits", "adminDepositApprove", "adminDepositReject", "adminReconcile", "adminUsers", "adminExport", "adminAnalytics", "adminAudit", "adminFraudList", "adminFraudReview"] };
  for (const [role, list] of Object.entries(denied)) for (const a of list) assert.equal(can(role, a), false, `${role} must NOT ${a}`);
  for (const [role, list] of Object.entries(allowed)) for (const a of list) assert.equal(can(role, a), true, `${role} must ${a}`);
});

test("only the most dangerous actions are super-only", () => {
  const superOnly = Object.keys(ACTION_PERMS).filter((a) => !can("support", a) && !can("finance", a));
  for (const a of ["adminUserAdjust", "adminSettingsUpdate", "adminRoleSet", "adminRoleRemove", "adminRoles", "adminBroadcastCreate", "adminContestPay", "adminDrawPick", "adminDiagnostics", "adminWebhookSetup", "adminPromoCreate"]) assert.ok(superOnly.includes(a), a);
  for (const a of ["adminWithdrawalPaid", "adminUserBlock", "adminFraudReview"]) assert.ok(!superOnly.includes(a), a + " should be reachable by a limited role");
});

test("roles: super is env-only, the table can only hold support / finance", async () => {
  assert.deepEqual(ROLES, ["super", "support", "finance"]);
  assert.deepEqual(GRANTABLE, ["support", "finance"]);
  const mig = read("db/migrations/011_safety_admin.sql");
  assert.match(mig, /role TEXT NOT NULL CHECK \(role IN \('support','finance'\)\)/);
  assert.doesNotMatch(mig.match(/CREATE TABLE IF NOT EXISTS admin_roles[\s\S]*?\);/)[0], /'super'/);
  const old = process.env.ADMIN_TELEGRAM_IDS, oldDb = process.env.DATABASE_URL;
  process.env.ADMIN_TELEGRAM_IDS = "42, 43"; delete process.env.DATABASE_URL;
  try {
    assert.equal(await roleOf("42"), "super");
    assert.equal(await roleOf(43), "super");
    assert.equal(await roleOf("7"), null); // no database (or no migration yet): nobody else becomes an admin
  } finally { if (old === undefined) delete process.env.ADMIN_TELEGRAM_IDS; else process.env.ADMIN_TELEGRAM_IDS = old; if (oldDb !== undefined) process.env.DATABASE_URL = oldDb; }
});

test("role actions: env admins cannot be edited, target must exist, every change is audited", () => {
  const src = read("lib/actions/safety.js");
  const set = src.slice(src.indexOf("export const adminRoleSet"), src.indexOf("export const adminRoleRemove"));
  assert.match(set, /isAdminId\(target\)/); assert.match(set, /GRANTABLE\.includes\(role\)/); assert.match(set, /User not found/);
  assert.match(set, /action: "role\.set"/); assert.match(src, /action: "role\.remove"/);
  assert.match(src, /invalidateRoles\(\)/);
});

/* ---------------- fraud rules ---------------- */
test("same-wallet flags: below the minimum nothing, above it one flag per account with stable keys", () => {
  assert.deepEqual(walletFlags([{ wallet: "0xabc", source: "withdrawal", users: ["1"] }], { min: 2 }), []);
  const f = walletFlags([{ wallet: "0xABC", source: "withdrawal", users: ["1", "2"] }], { min: 2 });
  assert.equal(f.length, 2);
  assert.deepEqual(f.map((x) => x.userId).sort(), ["1", "2"]);
  assert.equal(f[0].rule, "same_wallet"); assert.equal(f[0].severity, "medium");
  assert.equal(f[0].key, "wallet:withdrawal:0xabc:1"); // lower-cased -> the same wallet in another case is the same finding
  assert.deepEqual(f[0].details.other_users, ["2"]);
  assert.equal(walletFlags([{ wallet: "0x1", source: "deposit", users: ["1", "2", "3"] }])[0].severity, "high");
  assert.equal(walletFlags([{ wallet: "0x1", source: "deposit", users: ["1", "1", "1"] }]).length, 0); // duplicates are not extra accounts
  assert.equal(walletFlags([{ wallet: "", source: "deposit", users: ["1", "2"] }]).length, 0);
  assert.equal(walletFlags([{ wallet: "0x1", source: "deposit", users: ["1", "2", "3"] }], { min: 4 }).length, 0);
  assert.deepEqual(walletFlags(null), []);
  const keys = walletFlags([{ wallet: "0x1", source: "withdrawal", users: ["1", "2"] }, { wallet: "0x1", source: "deposit", users: ["1", "2"] }]).map((x) => x.key);
  assert.equal(new Set(keys).size, keys.length); // withdrawal and deposit findings never collide
});

test("referral burst and rapid claims: threshold is inclusive, windows have their own key", () => {
  const rows = [{ user_id: 5, bucket: 100, n: 9, first_at: "a", last_at: "b" }, { user_id: 6, bucket: 100, n: 10, first_at: "a", last_at: "b" }, { user_id: 7, bucket: 101, n: 25, first_at: "a", last_at: "b" }];
  const b = burstFlags(rows, { count: 10, minutes: 30 });
  assert.deepEqual(b.map((x) => x.userId), ["6", "7"]);
  assert.deepEqual(b.map((x) => x.severity), ["medium", "high"]); // 2x the threshold = high
  assert.equal(b[0].key, "burst:6:100"); assert.equal(b[0].details.window_minutes, 30);
  assert.notEqual(burstFlags([{ ...rows[1], bucket: 101 }])[0].key, b[0].key); // next window = a new finding
  const c = claimFlags([{ user_id: 1, bucket: 9, n: 15 }, { user_id: 2, bucket: 9, n: 14 }], { count: 15, minutes: 10 });
  assert.equal(c.length, 1); assert.equal(c[0].rule, "rapid_claims"); assert.equal(c[0].key, "rapid:1:9");
  assert.deepEqual(burstFlags([], {}), []); assert.deepEqual(claimFlags(undefined, {}), []);
  assert.equal(burstFlags([{ user_id: 1, bucket: 1, n: 10 }], { count: "garbage" }).length, 1); // bad setting -> default threshold, never "flag everything"
});

test("fraud code never blocks, freezes, debits or rejects anyone", () => {
  for (const f of ["lib/fraud.js", "lib/actions/safety.js"]) {
    const src = read(f).replace(/\/\/.*$/gm, "");
    assert.doesNotMatch(src, /is_blocked\s*=/i, f);
    assert.doesNotMatch(src, /UPDATE\s+users(?!\s+SET\s+user_lang)/i, f); // the only users write is a person choosing their own language
    assert.doesNotMatch(src, /UPDATE\s+withdrawals/i, f);
    assert.doesNotMatch(src, /\b(debit|creditEx)\(/, f);
  }
  const fr = read("lib/fraud.js");
  assert.match(fr, /ON CONFLICT\(dedupe_key\) DO NOTHING/); // a re-scan never duplicates a flag
  assert.ok(MAX_FLAGS_PER_SCAN <= 500);
  assert.deepEqual(RULES, ["same_wallet", "referral_burst", "rapid_claims"]);
  for (const r of RULES) assert.match(read("db/migrations/011_safety_admin.sql"), new RegExp(`'${r}'`));
});

test("flag review needs a note, only changes the flag and is audited", () => {
  const src = read("lib/actions/safety.js"), rv = src.slice(src.indexOf("export const adminFraudReview"), src.indexOf("export const adminFraudScan"));
  assert.match(rv, /A note \(min 3 characters\) is required/); assert.match(rv, /UPDATE fraud_flags/); assert.match(rv, /action: "fraud\.review"/);
  assert.match(src, /action: "fraud\.scan"/);
  assert.equal(SETTING_DEFS.fraud_enabled.def, false); // the automatic scan ships OFF
});

/* ---------------- CSV ---------------- */
test("CSV cells: quoting, quotes doubled, newlines kept inside quotes", () => {
  assert.equal(csvCell("plain"), "plain");
  assert.equal(csvCell("a,b"), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell("line1\nline2"), '"line1\nline2"');
  assert.equal(csvCell("a\r\nb"), '"a\r\nb"');
  assert.equal(csvCell(null), ""); assert.equal(csvCell(undefined), "");
  assert.equal(csvCell(0), "0"); assert.equal(csvCell(false), "false");
  assert.equal(csvCell(new Date("2026-11-15T10:00:00Z")), "2026-11-15T10:00:00.000Z");
  assert.equal(csvCell({ a: 1 }), '"{""a"":1}"');
});

test("CSV cells: spreadsheet formulas are neutralised, real numbers are not touched", () => {
  for (const evil of ["=1+1", "+SUM(A1)", "-2+3", "@cmd", "=HYPERLINK(\"http://x\",\"y\")", "\t=1", "\r=1"]) {
    const out = csvCell(evil); assert.ok(out.replace(/^"/, "").startsWith("'"), `${JSON.stringify(evil)} -> ${out}`);
  }
  assert.equal(csvCell("-50"), "-50");        // BIGINT arrives as a string: a plain negative number must stay a number
  assert.equal(csvCell(-50), "-50");
  assert.equal(csvCell("12.50"), "12.50");
  assert.equal(csvCell("-1e5+1"), "'-1e5+1"); // looks numeric-ish but is not a plain number
  assert.equal(csvCell("0x" + "ab".repeat(20)), "0x" + "ab".repeat(20)); // wallet addresses are untouched
  assert.equal(csvCell("normal = fine"), "normal = fine");
});

test("toCsv: BOM, CRLF, header row, column order, missing fields", () => {
  const out = toCsv([["id", "id"], ["name", "name"], ["note", "note"]], [{ id: 1, name: "Rahul, K", note: "=x" }, { id: 2, name: "Ña" }]);
  assert.equal(out.charCodeAt(0), 0xfeff);
  assert.equal(out.slice(1), 'id,name,note\r\n1,"Rahul, K",\'=x\r\n2,Ña,\r\n');
  assert.equal(toCsv([["a", "a"]], []), "﻿a\r\n");
});

test("export datasets: only known ones, limited rows, admin only, audited, every column is selected by the SQL", () => {
  assert.deepEqual(Object.keys(DATASETS).sort(), ["deposits", "ledger", "users", "withdrawals"]);
  assert.equal(isDataset("users"), true); for (const bad of ["", "settings", "__proto__", "constructor", "admin_roles", "toString"]) assert.equal(isDataset(bad), false, bad);
  assert.ok(EXPORT_MAX_ROWS <= 5000);
  const src = read("lib/actions/safety.js"), ex = src.slice(src.indexOf("export const adminExport"), src.indexOf("// ---------------- analytics"));
  assert.match(ex, /action: "export\.csv"/); assert.match(ex, /LIMIT \$\{lim\}::int/); assert.match(ex, /rows\.slice\(0, EXPORT_MAX_ROWS\)/);
  assert.match(ex, /isDataset\(ds\)/);
  for (const [name, d] of Object.entries(DATASETS)) for (const [, key] of d.cols) assert.ok(ex.includes(key), `${name}: column ${key} is not selected`);
  assert.doesNotMatch(ex, /private|secret|token/i);
  assert.equal(ACTION_PERMS.adminExport, "csv"); assert.equal(can("support", "adminExport"), false);
});

/* ---------------- analytics ---------------- */
test("analytics: days are filled, ordered, and survive month / year / leap boundaries", () => {
  assert.equal(dayBefore("2026-03-01", 1), "2026-02-28");
  assert.equal(dayBefore("2028-03-01", 1), "2028-02-29");
  assert.equal(dayBefore("2027-01-01", 1), "2026-12-31");
  const d = fillDays([{ day: "2026-11-15", active: "7" }, { day: "2026-11-13T00:00:00.000Z", active: 3 }, { day: "2020-01-01", active: 99 }], "2026-11-15", ["active"]);
  assert.equal(d.length, DAYS);
  assert.equal(d[0].day, "2026-11-02"); assert.equal(d[DAYS - 1].day, "2026-11-15");
  assert.deepEqual(d.slice(-3).map((x) => x.active), [3, 0, 7]);
  assert.equal(d.reduce((a, x) => a + x.active, 0), 10); // the old row outside the window is ignored
  assert.deepEqual(fillDays(null, "2026-11-15", ["a", "b"], 2), [{ day: "2026-11-14", a: 0, b: 0 }, { day: "2026-11-15", a: 0, b: 0 }]);
});

test("analytics: percentages never divide by zero; retention and conversion shapes", () => {
  assert.equal(pct(1, 0), null); assert.equal(pct(0, 0), null); assert.equal(pct(1, 3), 33.3); assert.equal(pct(5, 5), 100);
  assert.deepEqual(retention({ d1_base: 0, d1_back: 0, d7_base: 4, d7_back: 1 }), { d1: null, d7: 25, d1_base: 0, d7_base: 4 });
  assert.deepEqual(conversion({ invited: "8", qualified: "2" }), { invited: 8, qualified: 2, rate: 25 });
  assert.equal(conversion({ invited: 0, qualified: 0 }).rate, null);
  assert.deepEqual(barHeights([0, 5, 10], 100), [0, 50, 100]); assert.deepEqual(barHeights([0, 0], 100), [0, 0]);
});

test("analytics query uses the daily time zone setting and counts only existing tables", () => {
  const src = read("lib/actions/safety.js"), a = src.slice(src.indexOf("export const adminAnalytics"), src.indexOf("// ---------------- health"));
  assert.match(a, /AT TIME ZONE \$\{tz\}::text/); assert.match(a, /dailyTimezone/);
  for (const t of ["transactions", "users", "referral_events"]) assert.match(a, new RegExp("(FROM|JOIN) " + t));
  assert.equal(ACTION_PERMS.adminAnalytics, "analytics");
});

/* ---------------- health alerts ---------------- */
test("alert text is escaped, short and never carries secrets", () => {
  const t = apiErrorText("with<draw>", "boom <b>x</b> 123456:ABCdefGhIJKlmNoPQRsTUVwxyz0123456789 postgresql://u:p@h/db?sslmode=require");
  assert.ok(!t.includes("<draw>") && !t.includes("<b>x") && t.includes("with&lt;draw&gt;"));
  assert.ok(!t.includes("ABCdefGhIJ") && !t.includes("postgresql://") && t.includes("[token]") && t.includes("[db-url]"));
  assert.ok(scrub("x".repeat(500)).length <= 160);
  assert.equal(scrub(null), "");
  assert.ok(scrub("0x" + "a".repeat(64)).includes("[hex]"));
  assert.match(ledgerText(3), /3 user balance/); assert.match(withdrawalsText(25, 20), /25 requests[\s\S]*20/);
});

test("alert helpers: admin ids, time buckets, withdrawal threshold", () => {
  const old = process.env.ADMIN_TELEGRAM_IDS;
  process.env.ADMIN_TELEGRAM_IDS = " 11, 22 ,abc,,33333333333333333333 ,44";
  try { assert.deepEqual(adminIds(), ["11", "22", "44"]); } finally { if (old === undefined) delete process.env.ADMIN_TELEGRAM_IDS; else process.env.ADMIN_TELEGRAM_IDS = old; }
  assert.equal(bucketOf(0, 30), 0); assert.equal(bucketOf(30 * 60000 - 1, 30), 0); assert.equal(bucketOf(30 * 60000, 30), 1);
  assert.equal(bucketOf(5000, 0), bucketOf(5000, 1)); // bad window -> 1 minute, never NaN
  assert.equal(shouldAlertWithdrawals(19, 20), false); assert.equal(shouldAlertWithdrawals(20, 20), true); assert.equal(shouldAlertWithdrawals(50, 0), false);
});

test("sendAlert: one message per kind per window, nothing without bot token or admins, never throws", async () => {
  const env = { ...process.env }, realFetch = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; return { status: 200, json: async () => ({ ok: true }) }; };
  try {
    delete process.env.DATABASE_URL; // the database is "down": the direct-send fallback is used
    delete process.env.BOT_TOKEN; process.env.ADMIN_TELEGRAM_IDS = "1,2";
    assert.deepEqual(await sendAlert({ kind: "k1", text: "x" }), { sent: 0, skipped: "not_configured" }); assert.equal(calls, 0);
    process.env.BOT_TOKEN = "123456:TESTTOKENTESTTOKENTESTTOKENTEST12"; process.env.ADMIN_TELEGRAM_IDS = "";
    assert.equal((await sendAlert({ kind: "k1", text: "x" })).sent, 0); assert.equal(calls, 0);
    process.env.ADMIN_TELEGRAM_IDS = "1,2";
    const now = 1_700_000_000_000;
    const a = await sendAlert({ kind: "k2", text: "x", minutes: 30, now }); assert.equal(a.sent, 2); assert.equal(calls, 2);
    const b = await sendAlert({ kind: "k2", text: "x", minutes: 30, now: now + 60_000 }); assert.equal(b.skipped, "throttled"); assert.equal(calls, 2);
    const c = await sendAlert({ kind: "k2", text: "x", minutes: 30, now: now + 31 * 60_000 }); assert.equal(c.sent, 2); assert.equal(calls, 4); // next window
    const d = await sendAlert({ kind: "other", text: "x", minutes: 30, now }); assert.equal(d.sent, 2); // another kind is not throttled by k2
  } finally { globalThis.fetch = realFetch; for (const k of ["DATABASE_URL", "BOT_TOKEN", "ADMIN_TELEGRAM_IDS"]) { if (env[k] === undefined) delete process.env[k]; else process.env[k] = env[k]; } }
});

test("health wiring: API errors alert (500 path only), cron runs fraud + health, alerts have a setting", () => {
  const catchPart = api.slice(api.indexOf("} catch (e) {"));
  assert.ok(catchPart.indexOf("reportApiError") > catchPart.indexOf('console.error("API error:"'));
  assert.ok(catchPart.indexOf("reportApiError") < catchPart.indexOf('code: "server_error"'));
  assert.ok(catchPart.indexOf("reportApiError") > catchPart.indexOf("if (e instanceof HttpError)")); // 4xx (bad input, rate limit) never alert
  assert.match(read("lib/actions/notify.js"), /cronSafety\(\)/);
  assert.match(read("lib/actions/safety.js"), /export async function cronSafety/);
  assert.equal(SETTING_DEFS.health_alerts.def, true);
  assert.equal(validateSetting("alert_open_withdrawals", 0).ok, false); assert.equal(validateSetting("alert_open_withdrawals", 20).ok, true);
  const h = read("lib/health.js"); assert.match(h, /alert:\$\{kind\}:\$\{bucket\}:\$\{a\}/); // DB dedupe key per kind, window and admin
});

/* ---------------- deposits auto-credit gate ---------------- */
test("auto-credit stays locked until one real deposit was approved by hand", () => {
  assert.match(autoCreditBlocked(0), /stays OFF/);
  assert.match(autoCreditBlocked("0"), /stays OFF/);
  assert.equal(autoCreditBlocked(1), null); assert.equal(autoCreditBlocked(12), null);
  const a = read("lib/actions/admin.js");
  assert.match(a, /clean\.deposit_auto_credit === true && !before\.depositAutoCredit/);
  assert.match(a, /status='confirmed'/); assert.match(a, /autocredit_locked/);
  assert.ok(a.indexOf("autoCreditBlocked(") < a.indexOf("INSERT INTO settings(key,value)")); // checked BEFORE anything is saved
});

/* ---------------- settings ---------------- */
test("Part 5 settings: validated, safe defaults, resolved into the config", () => {
  const defs = ["fraud_enabled", "fraud_wallet_min_users", "fraud_burst_count", "fraud_burst_minutes", "fraud_claims_count", "fraud_claims_minutes", "health_alerts", "alert_open_withdrawals"];
  for (const k of defs) { assert.ok(SETTING_DEFS[k], k); assert.equal(SETTING_DEFS[k].group, "Safety & Alerts"); }
  assert.equal(validateSetting("fraud_wallet_min_users", 1).ok, false); assert.equal(validateSetting("fraud_wallet_min_users", 2).ok, true);
  assert.equal(validateSetting("fraud_burst_minutes", 0).ok, false); assert.equal(validateSetting("fraud_burst_minutes", 1441).ok, false);
  assert.equal(validateSetting("fraud_enabled", "yes").ok, false);
  const c = resolveConfig([]);
  assert.equal(c.fraudEnabled, false); assert.equal(c.healthAlerts, true); assert.equal(c.fraudWalletMinUsers, 2); assert.equal(c.fraudBurstCount, 10); assert.equal(c.fraudClaimsCount, 15); assert.equal(c.alertOpenWithdrawals, 20);
  assert.equal(resolveConfig([{ key: "fraud_burst_count", value: -5 }]).fraudBurstCount, 10); // a broken row falls back to the default
});

/* ---------------- i18n ---------------- */
const dict = Object.fromEntries(LANGS.map((l) => [l, JSON.parse(read(`public/i18n/${l}.json`))]));
const vars = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");

test("i18n: All language files have exactly the same keys, no empty text, same {placeholders}", () => {
  assert.deepEqual(LANGS, ["en", "hi", "es", "ar", "ru", "pt", "fr", "tr", "id"]);
  const keys = Object.keys(dict.en).sort();
  assert.ok(keys.length >= 60);
  for (const l of LANGS) {
    assert.deepEqual(Object.keys(dict[l]).sort(), keys, l + " keys differ from en");
    for (const k of keys) { assert.equal(typeof dict[l][k], "string", `${l}.${k}`); assert.ok(dict[l][k].trim().length > 0, `${l}.${k} is empty`); assert.equal(vars(dict[l][k]), vars(dict.en[k]), `${l}.${k} placeholders differ`); }
  }
});

test("i18n: scripts are right (Hindi in Devanagari, Arabic, Russian in Cyrillic, no Hinglish left)", () => {
  const dev = /[ऀ-ॿ]/;
  let hiHits = 0, differs = 0;
  for (const [k, v] of Object.entries(dict.hi)) { if (dev.test(v)) hiHits++; if (v !== dict.en[k]) differs++; }
  assert.ok(hiHits / Object.keys(dict.hi).length > 0.9, "Hindi file should be mostly Devanagari");
  assert.ok(differs / Object.keys(dict.hi).length > 0.9);
  const arb = /[\u0600-\u06FF]/, cyr = /[\u0400-\u04FF]/;
  assert.ok(Object.values(dict.ar).filter((v) => arb.test(v)).length / Object.keys(dict.ar).length > 0.9, "Arabic file should be mostly Arabic script");
  assert.ok(Object.values(dict.ru).filter((v) => cyr.test(v)).length / Object.keys(dict.ru).length > 0.9, "Russian file should be mostly Cyrillic");
  assert.equal(fs.existsSync(new URL("../public/i18n/hinglish.json", import.meta.url)), false);
  for (const l of ["es", "pt", "fr", "tr", "id"]) assert.ok(Object.keys(dict[l]).filter((k) => dict[l][k] !== dict.en[k]).length > 30, l + " looks untranslated");
  for (const [k, v] of Object.entries(dict.en)) assert.doesNotMatch(v, dev, "en." + k);
});

test("i18n: every key used in index.html and app.js exists; the English text in the page matches en.json", () => {
  const used = new Set([...html.matchAll(/data-i18n(?:-ph|-aria)?="([\w.]+)"/g)].map((m) => m[1]));
  for (const m of app.matchAll(/\bT\('([\w.]+)'/g)) used.add(m[1]);
  for (const m of adm.matchAll(/\bT\('([\w.]+)'/g)) used.add(m[1]);
  assert.ok(used.size >= 50, "keys used: " + used.size);
  for (const k of used) assert.ok(k in dict.en, "missing key " + k);
  for (const m of html.matchAll(/<(\w+)[^>]*\bdata-i18n="([\w.]+)"[^>]*>([^<]*)</g)) {
    const text = m[3].replace(/&amp;/g, "&").trim();
    assert.equal(text, dict.en[m[2]], `page text for ${m[2]} differs from en.json (the page is the English fallback)`);
  }
  for (const k of ["toast.claimed", "toast.streak", "nav.admin", "prefs.saved"]) assert.ok(k in dict.en);
  assert.deepEqual(read("public/i18n.js").match(/const LANGS = (\[[^\]]*\])/)[1].replace(/'/g, '"'), JSON.stringify(LANGS).replace(/","/g, '", "'));
});

test("i18n: Telegram language guess and the settings screen", () => {
  assert.equal(guessLang("hi"), "hi"); assert.equal(guessLang("hi-IN"), "hi"); assert.equal(guessLang("HI"), "hi");
  assert.equal(guessLang("pt-BR"), "pt"); assert.equal(guessLang("ru"), "ru"); assert.equal(guessLang("AR"), "ar");
  for (const c of ["en", "de", "", null, undefined, "xx"]) assert.equal(guessLang(c), "en");
  assert.equal(guessLang("hindi"), "hi");
  assert.match(html, /<select id="pf_lang"[^>]*data-input="prefs"/); assert.match(html, /<label for="pf_lang"/);
  assert.match(html, /<select id="pf_theme"[^>]*data-input="prefs"/); assert.match(html, /<label for="pf_theme"/);
  assert.match(html, /<section id="prefs" aria-labelledby="h-prefs">/); assert.match(html, /data-go="prefs"/);
  assert.match(html, /<html lang="en">/); // the page starts in English; i18n.js changes it
  assert.match(app, /prefs: 'more'/);
  assert.match(html, /<script src="\/i18n\.js"><\/script>\s*<script src="\/app\.js">/); // i18n loads before app.js
  const jsLang = read("public/i18n.js").match(/const guess = [^;]+;/)[0];
  assert.match(jsLang, /LANGS\.includes\(/);
  assert.match(html, /<select id="pf_font"[^>]*data-input="prefs"/); assert.match(html, /<select id="pf_fsize"[^>]*data-input="prefs"/);
  for (const l of LANGS) assert.match(html, new RegExp(`<option value="${l}">`), "language option " + l);
});

test("i18n runtime: fallback to English, {vars}, html lang, apply(), survives a failed download", async () => {
  const store = {}, els = [];
  const mkEl = (key, attr) => ({ dataset: attr === "ph" ? { i18nPh: key } : { i18n: key }, textContent: "orig", attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } });
  els.push(mkEl("nav.home"), mkEl("tile.ref.b"), mkEl("nope.missing"));
  const doc = { documentElement: { lang: "en" }, querySelectorAll: (sel) => (sel === "[data-i18n]" ? els : []) };
  let fail = false;
  const ctx = { document: doc, localStorage: { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = v; } },
    fetch: async (u) => { if (fail) throw Error("offline"); const l = /\/i18n\/(\w+)\.json/.exec(u)[1]; return { ok: true, json: async () => dict[l] }; } };
  vm.createContext(ctx); vm.runInContext(read("public/i18n.js") + "\nthis.I18N = I18N;", ctx);
  const I = ctx.I18N;
  assert.equal(I.t("nav.home"), "nav.home"); assert.equal(I.t("x", null, "Fallback"), "Fallback");
  assert.equal(await I.set("hi"), "hi");
  assert.equal(doc.documentElement.lang, "hi"); assert.equal(store.lang, "hi");
  assert.equal(els[0].textContent, dict.hi["nav.home"]); assert.equal(els[1].textContent, dict.hi["tile.ref.b"]);
  assert.equal(els[2].textContent, "orig"); // unknown key leaves the page text alone
  assert.equal(I.t("toast.claimed", { n: 5 }), "🎁 5 पॉइंट्स मिले");
  assert.equal(I.t("toast.claimed", {}), dict.hi["toast.claimed"]); // missing var stays visible, never "undefined"
  await I.set("es"); assert.equal(doc.documentElement.lang, "es"); assert.equal(I.t("nav.tasks"), dict.es["nav.tasks"]); assert.equal(doc.documentElement.dir, "ltr");
  await I.set("ar"); assert.equal(doc.documentElement.dir, "rtl");
  await I.set("en"); assert.equal(doc.documentElement.lang, "en"); assert.equal(els[0].textContent, dict.en["nav.home"]);
  assert.equal(await I.set("klingon"), "en"); // unknown language -> English
  assert.equal(I.stored(), "en"); store.lang = "xx"; assert.equal(I.stored(), null);
  fail = true; const cacheBust = I.LANGS.length; assert.ok(cacheBust === 9);
  const ctx2 = { ...ctx, fetch: async () => { throw Error("offline"); } }; vm.createContext(ctx2); vm.runInContext(read("public/i18n.js") + "\nthis.I18N = I18N;", ctx2);
  assert.equal(await ctx2.I18N.set("hi"), "en"); // offline: stays English, no exception
});

/* ---------------- settings screen + theme + admin UI wiring ---------------- */
const hex = (h) => { h = h.replace("#", ""); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); };
const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const ratio = (a, b) => { const [x, y] = [lum(hex(a)), lum(hex(b))].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const light = read("public/light.css");
const lv = {}; for (const m of light.matchAll(/--([a-z0-9-]+):(#[0-9a-fA-F]{6})/g)) lv[m[1]] = m[2];

test("light theme: text colours meet WCAG AA on every light surface; focus ring and button ink too", () => {
  for (const k of ["bg", "card-a", "card-b", "field", "txt", "mut", "or1", "green", "red", "focus"]) assert.ok(lv[k], "missing --" + k);
  const surfaces = [lv.bg, lv["card-a"], lv["card-b"], lv.field, "#ffe2b8", "#fff3e0"];
  for (const t of [lv.txt, lv.mut, lv.or1, lv.green, lv.red, lv.focus]) for (const s of surfaces) assert.ok(ratio(t, s) >= 4.5, `${t} on ${s} = ${ratio(t, s).toFixed(2)}`);
  for (const s of surfaces) assert.ok(ratio(lv.focus, s) >= 3);
  const dark = read("public/styles.css"); const ink = /--btn-ink:(#[0-9a-f]{6})/i.exec(dark)[1];
  for (const b of ["btn-a", "btn-b", "btn-c"]) { const c = /--btn-(a|b|c):(#[0-9a-f]{6})/gi; void c; }
  for (const b of [/--btn-a:(#[0-9a-f]{6})/i, /--btn-b:(#[0-9a-f]{6})/i, /--btn-c:(#[0-9a-f]{6})/i]) assert.ok(ratio(ink, b.exec(dark)[1]) >= 4.5);
  const pairs = [["#075c41", "#d9f5ea"], ["#6e4300", "#fff0cf"], ["#8c1a1a", "#fde4e4"], ["#7a3300", "#ffe6c7"], ["#5a4128", "#ffeccf"], ["#8f3d00", "#ffeccf"], [lv.txt, "#f3dcbc"], [lv.txt, "#ffd9a0"], [lv.txt, "#ffc070"], [lv.txt, "#fbe9cf"], [lv.txt, "#ffe3bd"], [lv.txt, "#ffcf94"], ["#2b1200", "#ffc552"], [lv.txt, "#e9cfa7"]];
  for (const [a, b] of pairs) assert.ok(ratio(a, b) >= 4.5, `${a} on ${b} = ${ratio(a, b).toFixed(2)}`);
});

test("light theme is scoped to data-theme=light, loaded after styles.css, and never touches the dark tokens", () => {
  assert.match(html, /href="\/styles\.css">\s*<link rel="stylesheet" href="\/light\.css">/);
  for (const rule of light.replace(/\/\*[\s\S]*?\*\//g, "").split("}").map((r) => r.trim()).filter(Boolean)) assert.match(rule, /^html\[data-theme="light"\]/, rule.slice(0, 60));
  assert.doesNotMatch(read("public/styles.css"), /data-theme/);
  assert.match(app, /document\.documentElement\.dataset\.theme/); assert.match(app, /localStorage\.getItem\('theme'\)/);
  assert.match(app, /return THEMES\.includes\(v\) \? v : 'dark'/); // default stays the dark brand design
  assert.doesNotMatch(light, /\sstyle\s*=|@import|url\(/);
});

test("admin panel: tabs follow permissions, new screens are wired, no inline styles", () => {
  assert.match(adm, /const TABS=\(\)=>ALLTABS\.filter\(t=>can\(t\[3\]\)\)/);
  const block = adm.slice(adm.indexOf("const ALLTABS=["), adm.indexOf("];", adm.indexOf("const ALLTABS=[")));
  const tabs = [...block.matchAll(/\['(\w+)','[^']+','[^']+','(\w+)'\]/g)].map((m) => [m[1], m[2]]);
  assert.ok(tabs.length >= 18);
  for (const [k, perm] of tabs) { assert.ok(PERMS.includes(perm), `tab ${k}: unknown permission ${perm}`); assert.match(adm, new RegExp(`\\n async ${k}\\(`), `no view for tab ${k}`); }
  for (const k of ["flg", "ana", "exp", "rol"]) assert.ok(tabs.some((t) => t[0] === k), k);
  for (const m of ["fraudScan", "fraudRev", "flgMore", "goUser", "expMake", "expDownload", "expCopy", "roleSet", "roleDel"]) assert.match(adm.slice(adm.indexOf("window.Admin={")), new RegExp(`\\n async ${m}\\(`), m);
  assert.match(adm, /NUM=new Set\(\['fraudRev'/);
  assert.match(adm, /\.textContent|\.value=r\.csv/); assert.match(adm, /\$\('ex_out'\)\.value=r\.csv/); // CSV goes into a textarea value, never innerHTML
  assert.doesNotMatch(adm, /\sstyle\s*=\s*["']/);
  assert.match(adm, /role="img" aria-label=/); // charts have a text alternative
  assert.match(read("public/styles.css"), /svg\.chart \.bar\{fill:var\(--or1\)\}/);
  for (const w of ["adminFraudList", "adminFraudReview", "adminFraudScan", "adminRoles", "adminRoleSet", "adminRoleRemove", "adminExport", "adminAnalytics", "adminHealth", "adminHealthRun"]) assert.match(adm + "", new RegExp(w), w + " is not used by the panel");
});

test("bootstrap tells the app the role and permissions; dashboard counts open flags", () => {
  const core = read("lib/actions/core.js");
  assert.match(core, /admin_role: role \|\| null, admin_perms: permsOf\(role\)/);
  assert.match(core, /lang: row\.user_lang \|\| null/);
  assert.match(read("lib/actions/admin.js"), /FROM fraud_flags WHERE status='open'\)::int AS flags_open/);
});

/* ---------------- migration, release hygiene ---------------- */
test("migration 011 is idempotent and records itself", () => {
  const m = read("db/migrations/011_safety_admin.sql");
  for (const t of ["fraud_flags", "admin_roles"]) assert.match(m, new RegExp(`CREATE TABLE IF NOT EXISTS ${t}\\(`));
  assert.match(m, /ADD COLUMN IF NOT EXISTS user_lang TEXT/);
  assert.match(m, /IF NOT EXISTS \(SELECT 1 FROM pg_constraint WHERE conname='users_user_lang_chk'\)/);
  assert.match(m, /user_lang IN \('en','hi','hinglish'\)/);
  assert.match(m, /dedupe_key TEXT NOT NULL UNIQUE/);
  assert.match(m, /INSERT INTO schema_migrations\(version\) VALUES\('011_safety_admin'\) ON CONFLICT DO NOTHING;/);
  assert.doesNotMatch(m.replace(/--.*$/gm, ""), /DROP\s|TRUNCATE|DELETE\s+FROM/i);
  for (const m2 of m.matchAll(/CREATE (?:UNIQUE )?INDEX (?!IF NOT EXISTS)/g)) assert.fail("index without IF NOT EXISTS: " + m2[0]);
});

test("release: version 1.12.0, new files syntax-checked by npm run check, static files get revalidated", () => {
  const pkg = JSON.parse(read("package.json")), v = JSON.parse(read("vercel.json"));
  assert.match(pkg.version, /^1\.(1[2-9]|[2-9]\d)\.\d+$/); // 1.12.0 or newer
  for (const f of ["lib/roles.js", "lib/csv.js", "lib/fraud.js", "lib/analytics.js", "lib/health.js", "lib/i18n.js", "lib/safetyRules.js", "lib/actions/safety.js", "public/i18n.js"]) assert.ok(pkg.scripts.check.includes("node --check " + f), f + " is not in npm run check");
  const h = v.headers.find((x) => x.source.includes("admin"));
  const re = new RegExp("^" + h.source.replace(/\\\\/g, "\\") + "$");
  for (const f of ["/styles.css", "/light.css", "/app.js", "/admin.js", "/i18n.js", "/i18n/hi.json", "/i18n/es.json", "/i18n/en.json"]) assert.match(f, re, f);
  assert.ok(v.crons.some((c) => c.path === "/api?action=cron")); // the same daily cron now also runs the fraud scan and health alerts (Hobby plan: once a day)
  assert.match(read("docs/TEST_MATRIX.md"), /Part 5 \(v1\.12\.0\)/); assert.match(read("CHANGELOG_PART12.md"), /v1\.12\.0/);
});
