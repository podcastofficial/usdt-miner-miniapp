import test from "node:test";
import assert from "node:assert/strict";
process.env.BOT_TOKEN = "123:TEST";
const { makeToken, readToken } = await import("../lib/adtoken.js");

test("token round-trips for the same user", () => {
  const t = makeToken(777, 3, 1760000000000);
  assert.deepEqual(readToken(777, t), { slot: 3, ts: 1760000000000 });
});
test("token is refused for another user, a changed slot or garbage", () => {
  const t = makeToken(777, 3, 1760000000000);
  assert.equal(readToken(778, t), null);
  assert.equal(readToken(777, t.replace(/^3\./, "4.")), null);
  assert.equal(readToken(777, "nope"), null);
  assert.equal(readToken(777, ""), null);
  assert.equal(readToken(777, undefined), null);
});
