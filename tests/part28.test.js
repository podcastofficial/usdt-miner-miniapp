// Part 28: repeating website tasks + broadcast image / inline buttons / channels.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { validateButtons, parseImage, inlineKeyboard, normalizeChannelRef, validateBroadcastEx, wantsBot, wantsChannel, TARGETS } from "../lib/broadcastMedia.js";
import { SEGMENTS, BROADCAST_MAX, escapeHtml } from "../lib/notifyText.js";
import { REPEAT_MAX } from "../lib/tasks.js";

const env = { escapeHtml, BROADCAST_MAX, SEGMENTS };
const jpeg = "data:image/jpeg;base64," + Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(300, 1)]).toString("base64");
const png = "data:image/png;base64," + Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(300, 1)]).toString("base64");

test("channel references: @name, t.me link or -100 id; everything else is refused", () => {
  assert.equal(normalizeChannelRef("@MyChannel"), "@MyChannel");
  assert.equal(normalizeChannelRef("https://t.me/MyChannel"), "@MyChannel");
  assert.equal(normalizeChannelRef("-1001234567890"), "-1001234567890");
  assert.equal(normalizeChannelRef("MyChannel"), null);
  assert.equal(normalizeChannelRef("@ab"), null);
  assert.equal(normalizeChannelRef("-12345"), null);
});

test("inline buttons: https links only, empty rows skipped, limits enforced", () => {
  assert.deepEqual(validateButtons([{ text: " Open ", url: "t.me/MyBot" }, { text: "", url: "" }]).value, [{ text: "Open", url: "https://t.me/MyBot" }]);
  assert.equal(validateButtons([{ text: "x", url: "javascript:alert(1)" }]).ok, false);
  assert.equal(validateButtons([{ text: "", url: "https://a.com" }]).ok, false);
  assert.equal(validateButtons(Array.from({ length: 7 }, (_, i) => ({ text: "b" + i, url: "https://a.com" }))).ok, false);
  assert.deepEqual(validateButtons(undefined).value, []);
  assert.deepEqual(inlineKeyboard([{ text: "A", url: "https://a.com/" }, { text: "B", url: "https://b.com/" }]).inline_keyboard, [[{ text: "A", url: "https://a.com/" }], [{ text: "B", url: "https://b.com/" }]]);
  assert.equal(inlineKeyboard([]), null);
});

test("image: real JPEG / PNG only (first bytes are checked), size capped", () => {
  assert.equal(parseImage(jpeg).value.mime, "image/jpeg");
  assert.equal(parseImage(png).value.mime, "image/png");
  assert.equal(parseImage("").value, null);
  assert.equal(parseImage("data:image/gif;base64,AAAA").ok, false);
  assert.equal(parseImage("data:image/jpeg;base64," + Buffer.alloc(400, 7).toString("base64")).ok, false); // not a JPEG inside
  assert.equal(parseImage("data:image/jpeg;base64," + Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(1_600_000)]).toString("base64")).ok, false);
});

test("broadcast text / target / segment rules", () => {
  assert.deepEqual(TARGETS, ["bot", "channel", "both"]);
  assert.equal(validateBroadcastEx({ text: "Hello <b>", target: "bot", segment: "all" }, env, false).value.text, "Hello &lt;b&gt;");
  assert.equal(validateBroadcastEx({ text: "Hello", target: "bot" }, env, false).ok, false);                 // a bot broadcast needs a segment
  const ch = validateBroadcastEx({ text: "Hello", target: "channel" }, env, false);
  assert.equal(ch.ok, true); assert.equal(ch.value.segment, "none");                                           // channel only: no segment
  assert.equal(validateBroadcastEx({ text: "", target: "channel" }, env, false).ok, false);                    // no text and no picture
  assert.equal(validateBroadcastEx({ text: "", target: "channel" }, env, true).ok, true);                      // picture only is fine
  assert.equal(validateBroadcastEx({ text: "ab", target: "channel" }, env, true).ok, false);
  assert.equal(validateBroadcastEx({ text: "x".repeat(1001), target: "channel" }, env, true).ok, false);       // caption limit
  assert.equal(validateBroadcastEx({ text: "Hello", target: "weird", segment: "all" }, env, false).value.target, "bot");
  assert.ok(wantsBot("both") && wantsChannel("both") && !wantsBot("channel") && !wantsChannel("bot"));
});

test("new admin actions are registered and need the notify permission", () => {
  const api = fs.readFileSync(new URL("../api/index.js", import.meta.url), "utf8"), roles = fs.readFileSync(new URL("../lib/roles.js", import.meta.url), "utf8");
  for (const a of ["adminBcChannelAdd", "adminBcChannelRemove", "adminBcChannelToggle"]) {
    assert.match(api, new RegExp(a + ": \\{ fn: ntf\\." + a + ", admin: true, write: true"));
    assert.match(roles, new RegExp(a + ": \"notify\""));
  }
});

test("repeating tasks: limits, ledger reference keeps the old format for the first completion, ad campaigns never repeat", () => {
  assert.equal(REPEAT_MAX, 7 * 24 * 60);
  const earn = fs.readFileSync(new URL("../lib/actions/earn.js", import.meta.url), "utf8");
  assert.match(earn, /ON CONFLICT \(task_id, telegram_id\) DO UPDATE SET[^]*times=task_completions\.times\+1/);
  assert.match(earn, /NOT EXISTS\(SELECT 1 FROM campaigns rc WHERE rc\.task_id=rt\.id\)/);   // never for ad campaigns
  assert.match(earn, /CASE WHEN u\.times > 1 THEN ':'\|\|u\.times::text ELSE '' END/);       // unique ledger reference per round
  const core = fs.readFileSync(new URL("../lib/actions/core.js", import.meta.url), "utf8");
  assert.match(core, /repeat_wait/);
  const mig = fs.readFileSync(new URL("../db/migrations/027_task_repeat_broadcast_media.sql", import.meta.url), "utf8");
  assert.match(mig, /repeat_minutes INTEGER NOT NULL DEFAULT 0/);
  assert.match(mig, /CREATE TABLE IF NOT EXISTS broadcast_channels/);
});
