import test from "node:test";
import assert from "node:assert/strict";
import { maskName, publicName, pageWindow, validateCampaign, supportUrl, channelUrl, txUrl, money2, cleanText } from "../lib/community.js";
import { validateSetting, SETTING_DEFS } from "../lib/settingsDefs.js";

test("maskName never reveals the full name", () => {
  assert.equal(maskName("Rahul"), "Ra***"); assert.equal(maskName("Al"), "A***"); assert.equal(maskName("X"), "X***");
  assert.equal(maskName("", null), "Miner"); assert.equal(maskName("", "bob_the_miner"), "bo***");
});
test("names are cleaned of control / bidi characters", () => {
  assert.equal(cleanText("a\u202eb\u0000c"), "abc");
  assert.equal(publicName("", "x"), "x***"); assert.equal(publicName("  Sam  ", "u"), "Sam"); assert.equal(publicName("", ""), "Miner");
});
test("pageWindow clamps to 1..10", () => {
  assert.deepEqual(pageWindow(undefined), { page: 1, offset: 0, size: 20 });
  assert.equal(pageWindow(3).offset, 40); assert.equal(pageWindow(99).page, 10); assert.equal(pageWindow(-5).page, 1); assert.equal(pageWindow("x").page, 1); assert.equal(pageWindow(1.5).page, 1);
});
test("campaign validation", () => {
  const ok = { type: "channel", title: "My Channel", link: "https://t.me/MyChannel", reward: "50", target: 100 };
  assert.deepEqual(validateCampaign(ok).value, { type: "channel", title: "My Channel", link: "https://t.me/MyChannel", reward: 50, target: 100, budget: 5000 });
  const no = (o) => validateCampaign({ ...ok, ...o }).ok;
  assert.equal(no({ type: "x" }), false); assert.equal(no({ title: "ab" }), false);
  assert.equal(no({ link: "http://t.me/MyChannel" }), false); assert.equal(no({ link: "https://t.me/MyChannel/123" }), false);
  assert.equal(no({ link: "https://user:pw@t.me/MyChannel" }), false); assert.equal(no({ link: "https://localhost/x", type: "website" }), false);
  assert.equal(no({ type: "website", link: "https://example.com/page" }), true); assert.equal(no({ type: "bot", link: "https://example.com" }), false);
  assert.equal(no({ reward: 5 }), false); assert.equal(no({ reward: 1.5 }), false); assert.equal(no({ target: 5 }), false); assert.equal(no({ reward: 1_000_000, target: 1_000_000 }), false);
  assert.equal(validateCampaign(ok, { adMinReward: 100, adMinTarget: 10 }).ok, false);
});
test("links", () => {
  assert.equal(channelUrl("@MyChannel"), "https://t.me/MyChannel"); assert.equal(channelUrl("MyChannel"), null);
  assert.equal(supportUrl("@SupportBot1"), "https://t.me/SupportBot1"); assert.equal(supportUrl("https://evil.com"), null); assert.equal(supportUrl(""), null);
  assert.equal(txUrl("0x" + "a".repeat(64)), "https://bscscan.com/tx/0x" + "a".repeat(64)); assert.equal(txUrl("0x12"), null);
  assert.equal(money2("13.50000000"), "13.50"); assert.equal(money2("junk"), "0.00");
});
test("Part 6 settings validate", () => {
  assert.equal(validateSetting("support_link", "").ok, true); assert.equal(validateSetting("support_link", "@MySupport").ok, true);
  assert.equal(validateSetting("support_link", "https://t.me/MySupport").ok, true); assert.equal(validateSetting("support_link", "http://x.com").ok, false);
  assert.equal(validateSetting("official_channel", "@Updates1").ok, true); assert.equal(validateSetting("official_channel", "Updates").ok, false);
  assert.equal(validateSetting("ad_max_pending", 0).ok, false); assert.equal(validateSetting("proof_public", "false").value, false);
  for (const k of ["ads_enabled", "ad_min_reward", "ad_min_target", "ad_max_pending", "official_channel", "payments_channel", "support_link", "proof_public"]) assert.ok(SETTING_DEFS[k], k);
});
