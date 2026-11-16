import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { SETTING_DEFS, resolveConfig, validateSetting } from "../lib/settingsDefs.js";
import { maskName } from "../lib/community.js";

const read = (p) => fs.readFileSync(new URL("../" + p, import.meta.url), "utf8");

test("leaderboard privacy settings ship ON and validate", () => {
  for (const k of ["leaderboard_mask_names", "leaderboard_show_referrals"]) {
    assert.equal(SETTING_DEFS[k].group, "Leaderboard");
    assert.equal(SETTING_DEFS[k].def, true);
    assert.equal(validateSetting(k, false).ok, true);
  }
  const cfg = resolveConfig([]);
  assert.equal(cfg.leaderboardMaskNames, true);
  assert.equal(cfg.leaderboardShowReferrals, true);
  assert.equal(resolveConfig([{ key: "leaderboard_mask_names", value: false }]).leaderboardMaskNames, false);
});

test("masked names never reveal more than 2 characters", () => {
  assert.equal(maskName("Crypto Learning Hub"), "Cr***");
  assert.equal(maskName("E-COMMERCE"), "E-***");
});

test("leaderboard action masks other users, counts referrals, keeps own name", () => {
  const src = read("lib/actions/community.js");
  assert.match(src, /cfg\.leaderboardMaskNames && !mine \? maskName\(u\.first_name, u\.username\)/);
  assert.match(src, /FROM referral_events r WHERE r\.referrer_id = u\.telegram_id/);
  assert.match(src, /if \(cfg\.leaderboardShowReferrals\) item\.refs/);
  assert.ok(!/telegram_id: /.test(src.slice(src.indexOf("export const leaderboard"), src.indexOf("// ---------------- Advertise"))), "telegram id must not be returned");
});

test("leaderboard screen renders the referral count", () => {
  assert.match(read("public/app.js"), /class="rf">👥 \$\{N\(u\.refs\)\} referral/);
});
