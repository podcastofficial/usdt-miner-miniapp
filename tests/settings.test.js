import test from "node:test";
import assert from "node:assert/strict";
import { validateSetting, resolveConfig, SETTING_DEFS, camel } from "../lib/settingsDefs.js";

test("every setting has a label, group, type and a default that passes its own validator", () => {
  for (const [k, d] of Object.entries(SETTING_DEFS)) {
    assert.ok(d.label && d.group && d.type, k);
    assert.notEqual(d.parse(d.def), undefined, `default of ${k} must be valid`);
  }
});
test("numbers: strict ranges, strings from the UI are accepted", () => {
  assert.deepEqual(validateSetting("daily_reward", "250"), { ok: true, value: 250 });
  assert.equal(validateSetting("daily_reward", 0).ok, false);
  assert.equal(validateSetting("daily_reward", 1.5).ok, false);
  assert.equal(validateSetting("daily_reward", "abc").ok, false);
  assert.equal(validateSetting("withdraw_fee_percent", 0).ok, true);   // 0% fee is allowed
  assert.equal(validateSetting("withdraw_fee_percent", 51).ok, false); // but absurd fees are not
  assert.equal(validateSetting("min_withdraw_usdt", "12.345").value, 12.35);
  assert.equal(validateSetting("points_per_usdt", -1).ok, false);
});
test("booleans", () => {
  assert.equal(validateSetting("maintenance_mode", true).value, true);
  assert.equal(validateSetting("maintenance_mode", "false").value, false);
  assert.equal(validateSetting("maintenance_mode", "yes").ok, false);
});
test("channels: @names only, at least one, de-duplicated", () => {
  assert.deepEqual(validateSetting("required_channels", "@MyChannel\n@MyChannel, @OtherChan").value, ["@MyChannel", "@OtherChan"]);
  assert.equal(validateSetting("required_channels", []).ok, false);
  assert.equal(validateSetting("required_channels", ["MyChannel"]).ok, false);
  assert.equal(validateSetting("required_channels", ["@ab"]).ok, false);
});
test("text fields: wallet, timezone, bot username, announcement", () => {
  assert.equal(validateSetting("deposit_wallet", "0x" + "a".repeat(40)).ok, true);
  assert.equal(validateSetting("deposit_wallet", "").ok, true);       // empty = not configured
  assert.equal(validateSetting("deposit_wallet", "0x123").ok, false);
  assert.equal(validateSetting("daily_timezone", "Asia/Kolkata").ok, true);
  assert.equal(validateSetting("daily_timezone", "Mars/Base").ok, false);
  assert.equal(validateSetting("bot_username", "My Bot").ok, false);
  assert.equal(validateSetting("announcement", "x".repeat(201)).ok, false);
});
test("unknown / prototype keys are rejected", () => {
  for (const k of ["nope", "__proto__", "constructor", "toString"]) assert.equal(validateSetting(k, 1).ok, false, k);
});
test("resolveConfig: stored values win, bad or missing rows fall back to defaults", () => {
  const c = resolveConfig([{ key: "daily_reward", value: 300 }, { key: "referral_reward", value: "junk" }, { key: "maintenance_mode", value: true }]);
  assert.equal(c.dailyReward, 300);
  assert.equal(c.referralReward, SETTING_DEFS.referral_reward.def);
  assert.equal(c.maintenanceMode, true);
  assert.equal(c.withdrawalsEnabled, true);
  assert.equal(camel("min_withdraw_usdt"), "minWithdrawUsdt");
});
