import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { verifyInitData, AuthError } from "../lib/auth.js";
import { newReferralCode } from "../lib/refcode.js";

const BOT = "123456:TEST_TOKEN";
function sign(fields, token = BOT) {
  const p = new URLSearchParams(fields);
  const check = [...p.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join("\n");
  const key = crypto.createHmac("sha256", "WebAppData").update(token).digest();
  p.set("hash", crypto.createHmac("sha256", key).update(check).digest("hex"));
  return p.toString();
}
const now = Math.floor(Date.now() / 1000);
const user = JSON.stringify({ id: 777, first_name: "Test", username: "tester" });
const good = (extra = {}) => sign({ auth_date: String(now), query_id: "AAA", user, ...extra });
const code = (fn) => { try { fn(); } catch (e) { assert.ok(e instanceof AuthError); return e.code; } assert.fail("did not throw"); };
const v = (raw, o = {}) => verifyInitData(raw, { botToken: BOT, ...o });

test("valid initData is accepted", () => { const r = v(good()); assert.equal(r.user.id, 777); assert.equal(r.startParam, null); });
test("start_param is returned", () => assert.equal(v(good({ start_param: "ref_ABC" })).startParam, "ref_ABC"));
test("missing initData", () => { assert.equal(code(() => v("")), "missing_init_data"); assert.equal(code(() => v(undefined)), "missing_init_data"); });
test("missing hash", () => assert.equal(code(() => v(`auth_date=${now}&user=${encodeURIComponent(user)}`)), "invalid_init_data"));
test("malformed hash", () => assert.equal(code(() => v(`auth_date=${now}&hash=zz`)), "invalid_init_data"));
test("tampered user id is rejected", () => {
  const p = new URLSearchParams(good()); p.set("user", JSON.stringify({ id: 1, first_name: "Admin" }));
  assert.equal(code(() => v(p.toString())), "bad_signature");
});
test("signature from a different bot token is rejected", () => assert.equal(code(() => v(good(), { botToken: "999:OTHER" })), "bad_signature"));
test("expired initData is rejected", () => {
  const old = sign({ auth_date: String(now - 90000), user });
  assert.equal(code(() => v(old)), "expired");
});
test("auth_date in the future is rejected", () => assert.equal(code(() => v(sign({ auth_date: String(now + 3600), user }))), "invalid_init_data"));
test("invalid user json / missing id", () => {
  assert.equal(code(() => v(sign({ auth_date: String(now), user: "{bad" }))), "invalid_init_data");
  assert.equal(code(() => v(sign({ auth_date: String(now), user: JSON.stringify({ first_name: "x" }) }))), "invalid_init_data");
});
test("server without bot token fails closed", () => assert.equal(code(() => verifyInitData(good(), {})), "server_misconfigured"));
test("referral codes are 10 chars from the safe alphabet", () => {
  const c = newReferralCode(); assert.match(c, /^[A-HJ-NP-Z2-9]{10}$/); assert.notEqual(c, newReferralCode());
});
