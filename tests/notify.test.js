import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  escapeHtml, withdrawalMessage, referralMessage, reminderMessage, proofMessage, validateBroadcast, classifySend,
  retryDelay, secretMatches, summarizeUpdate, validHost, webhookUrl, appLink, SEGMENTS, BROADCAST_MAX,
} from "../lib/notifyText.js";
import { validateSetting, SETTING_DEFS } from "../lib/settingsDefs.js";

const HASH = "0x" + "ab".repeat(32);

test("escapeHtml neutralises Telegram HTML", () => assert.equal(escapeHtml(`<b>&"x"</b>`), "&lt;b&gt;&amp;\"x\"&lt;/b&gt;"));

test("withdrawal messages: amount to 2 decimals, BscScan link only for a valid hash, reason is escaped", () => {
  assert.match(withdrawalMessage("approved", { id: 7, net: "13.5" }), /#7 approved[\s\S]*13\.50 MINER/);
  const paid = withdrawalMessage("paid", { id: 7, net: "13.5", txHash: HASH });
  assert.ok(paid.includes(`https://bscscan.com/tx/${HASH}`));
  assert.ok(!withdrawalMessage("paid", { id: 7, net: "13.5", txHash: "javascript:alert(1)" }).includes("<a "));
  const rej = withdrawalMessage("rejected", { id: 7, net: "1", reason: "<script>x</script> bad wallet" });
  assert.ok(!rej.includes("<script>") && rej.includes("&lt;script&gt;") && rej.includes("refunded"));
  assert.throws(() => withdrawalMessage("nope", { id: 1, net: 1 }));
});

test("referral + reminder messages never contain raw user HTML", () => {
  const m = referralMessage({ name: "<img src=x>", reward: 1000 });
  assert.ok(!m.includes("<img") && m.includes("+1,000 Points"));
  assert.match(reminderMessage({ reward: 100 }), /100 Points/);
});

test("proof message masks the name and links the transaction", () => {
  const m = proofMessage({ net: "20", firstName: "Rahul", username: "rahul99", txHash: HASH });
  assert.ok(m.includes("Ra***") && !m.includes("Rahul") && !m.includes("rahul99"));
  assert.ok(m.includes("20.00 MINER") && m.includes(HASH));
});

test("broadcast validation: length, segment, control chars, escaping", () => {
  assert.equal(validateBroadcast({ text: "hi", segment: "all" }).ok, false);
  assert.equal(validateBroadcast({ text: "Hello everyone", segment: "everyone" }).ok, false);
  assert.equal(validateBroadcast({ text: "x".repeat(BROADCAST_MAX + 1), segment: "all" }).ok, false);
  assert.equal(validateBroadcast(null).ok, false);
  const ok = validateBroadcast({ text: "  New <b>task</b> live!\u202e  ", segment: "me" });
  assert.equal(ok.ok, true);
  assert.equal(ok.value.text, "New &lt;b&gt;task&lt;/b&gt; live!");
  for (const s of SEGMENTS) assert.equal(validateBroadcast({ text: "Hello there", segment: s }).ok, true);
});

test("Telegram send outcomes are classified correctly", () => {
  assert.deepEqual(classifySend(200, { ok: true }), { kind: "ok" });
  assert.equal(classifySend(403, { ok: false, error_code: 403, description: "Forbidden: bot was blocked by the user" }).kind, "blocked");
  assert.equal(classifySend(400, { ok: false, error_code: 400, description: "Bad Request: chat not found" }).kind, "blocked");
  const r = classifySend(429, { ok: false, error_code: 429, parameters: { retry_after: 12 } });
  assert.deepEqual([r.kind, r.retryAfter], ["retry", 12]);
  assert.equal(classifySend(429, { error_code: 429, parameters: { retry_after: 999999 } }).retryAfter, 3600);
  assert.equal(classifySend(0, null).kind, "fail");                                   // network error / timeout
  assert.equal(classifySend(400, { error_code: 400, description: "can't parse entities" }).kind, "fail");
  assert.deepEqual([1, 2, 3, 9].map(retryDelay), [60, 120, 180, 300]);
});

test("webhook secret check is exact and constant-time", () => {
  assert.equal(secretMatches("s3cret", "s3cret"), true);
  assert.equal(secretMatches("s3cret!", "s3cret"), false);
  assert.equal(secretMatches("", "s3cret"), false);
  assert.equal(secretMatches(undefined, "s3cret"), false);
  assert.equal(secretMatches("anything", ""), false);       // secret not configured -> nobody passes
  assert.equal(secretMatches(["s3cret"], "s3cret"), false); // header sent twice
});

test("update summary: only private chats, /start, blocked/unblocked", () => {
  const priv = { type: "private" };
  assert.deepEqual(summarizeUpdate({ message: { chat: priv, from: { id: 5 }, text: "/start" } }), { type: "start", userId: 5 });
  assert.deepEqual(summarizeUpdate({ message: { chat: priv, from: { id: 5 }, text: "/start ref_ABC" } }), { type: "start", userId: 5 });
  assert.equal(summarizeUpdate({ message: { chat: priv, from: { id: 5 }, text: "/startx" } }).type, "message");
  assert.equal(summarizeUpdate({ message: { chat: { type: "supergroup" }, from: { id: 5 }, text: "/start" } }).type, "ignore");
  assert.equal(summarizeUpdate({ message: { chat: priv, from: { id: 5, is_bot: true }, text: "hi" } }).type, "ignore");
  assert.deepEqual(summarizeUpdate({ my_chat_member: { chat: priv, from: { id: 9 }, new_chat_member: { status: "kicked" } } }), { type: "blocked", userId: 9 });
  assert.deepEqual(summarizeUpdate({ my_chat_member: { chat: priv, from: { id: 9 }, new_chat_member: { status: "member" } } }), { type: "unblocked", userId: 9 });
  assert.equal(summarizeUpdate({ my_chat_member: { chat: { type: "channel" }, from: { id: 9 }, new_chat_member: { status: "kicked" } } }).type, "ignore");
  assert.equal(summarizeUpdate(null).type, "ignore");
  assert.equal(summarizeUpdate({}).type, "ignore");
});

test("webhook host whitelist and links", () => {
  assert.equal(validHost("my-app.vercel.app"), true);
  assert.equal(validHost("localhost"), false);
  assert.equal(validHost("evil.com/path?x"), false);
  assert.equal(validHost("a b.com"), false);
  assert.equal(webhookUrl("my-app.vercel.app"), "https://my-app.vercel.app/api?action=tgWebhook");
  assert.equal(appLink({ botUsername: "Bot", miniappShortName: "" }), "https://t.me/Bot?startapp");
  assert.equal(appLink({ botUsername: "Bot", miniappShortName: "app" }), "https://t.me/Bot/app");
});

test("notification settings exist, validate, and risky ones start OFF", () => {
  for (const k of ["notify_withdrawal", "notify_referral", "notify_reminder", "proof_autopost", "broadcast_enabled"]) {
    assert.ok(SETTING_DEFS[k], k);
    assert.equal(SETTING_DEFS[k].group, "Notifications");
    assert.equal(validateSetting(k, "true").value, true);
    assert.equal(validateSetting(k, "maybe").ok, false);
  }
  assert.equal(SETTING_DEFS.notify_reminder.def, false);
  assert.equal(SETTING_DEFS.proof_autopost.def, false);
});

test("router: webhook and cron are served before initData auth; admin tools are admin-only POST", () => {
  const api = fs.readFileSync(new URL("../api/index.js", import.meta.url), "utf8");
  assert.ok(api.indexOf('query.action === "tgWebhook"') > 0 && api.indexOf('query.action === "tgWebhook"') < api.indexOf("verifyInitData("));
  assert.ok(api.indexOf('query.action === "cron"') < api.indexOf("verifyInitData("));
  for (const a of ["adminNotifyProcess", "adminWebhookSetup", "adminBroadcastCreate", "adminBroadcastCancel"])
    assert.match(api, new RegExp(`${a}: \\{[^}]*admin: true, write: true`));
  assert.match(api, /adminNotifyStatus: \{[^}]*admin: true/);
  assert.ok(!/tgWebhook:\s*\{/.test(api), "webhook must not be a normal authenticated action");
});

test("notification code never throws into money flows and never trusts raw text", () => {
  const n = fs.readFileSync(new URL("../lib/notify.js", import.meta.url), "utf8");
  assert.match(n, /const safe = async/);
  assert.match(n, /FOR UPDATE SKIP LOCKED/);
  assert.match(n, /ON CONFLICT\(dedupe_key\) DO NOTHING/);
  const f = fs.readFileSync(new URL("../lib/actions/finance.js", import.meta.url), "utf8");
  assert.equal((f.match(/await notifyWithdrawal\(/g) || []).length, 3);
  assert.match(f, /await postProof\(wid\)/);
  const r = fs.readFileSync(new URL("../lib/actions/referral.js", import.meta.url), "utf8");
  assert.match(r, /await notifyReferral\(/);
});

test("migration 007 is idempotent and registers itself", () => {
  const m = fs.readFileSync(new URL("../db/migrations/007_notifications.sql", import.meta.url), "utf8");
  assert.ok(!/DROP\s/i.test(m));
  for (const stmt of m.match(/CREATE TABLE[^;]*;|CREATE INDEX[^;]*;|ALTER TABLE[^;]*;/g)) assert.match(stmt, /IF NOT EXISTS/, stmt);
  assert.match(m, /dedupe_key TEXT UNIQUE/);
  assert.match(m, /'007_notifications'/);
});

test("vercel.json: daily cron only (Hobby plan safe) and CSP unchanged", () => {
  const v = JSON.parse(fs.readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
  assert.deepEqual(v.crons.map(c => c.path), ["/api?action=cron"]);
  assert.match(v.crons[0].schedule, /^\d+ \d+ \* \* \*$/);
  assert.match(JSON.stringify(v.headers), /default-src 'none'/);
});
