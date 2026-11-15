import test from "node:test";
import assert from "node:assert/strict";
import { parseRefParam, newReferralCode } from "../lib/refcode.js";

test("parses a valid referral start_param", () => {
  const c = newReferralCode();
  assert.equal(parseRefParam("ref_" + c), c);
});
test("referral code matching is case-insensitive and normalised to upper case", () => assert.equal(parseRefParam("ref_abcdefgh23"), "ABCDEFGH23"));
test("rejects malformed / hostile start params", () => {
  for (const bad of [null, "", "ref_", "ref_SHORT", "ref_ABCDEFGH23X", "ref_ABCDEFGH2O", "x_ABCDEFGH23", "ref_ABC DEFG23", "ref_ABCDEFGH23; DROP TABLE users", "ref_1234567890"])
    assert.equal(parseRefParam(bad), null, String(bad));
});
