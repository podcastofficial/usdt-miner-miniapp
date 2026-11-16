import test from "node:test";
import assert from "node:assert/strict";
import { adsgramReward } from "../lib/adsgram.js";

test("AdsGram callback: 200 for a numeric userid, no secret configured", () => {
  assert.deepEqual(adsgramReward("GET", { userid: "123456789" }, {}), { status: 200, body: { ok: true } });
});
test("AdsGram callback: rejects non-GET, bad or missing userid", () => {
  assert.equal(adsgramReward("POST", { userid: "1" }, {}).status, 405);
  assert.equal(adsgramReward("GET", {}, {}).status, 400);
  assert.equal(adsgramReward("GET", { userid: "[userId]" }, {}).status, 400);
  assert.equal(adsgramReward("GET", { userid: "1; DROP" }, {}).status, 400);
});
test("AdsGram callback: with a secret set, only the right secret passes", () => {
  const env = { ADSGRAM_REWARD_SECRET: "s3cret" };
  assert.equal(adsgramReward("GET", { userid: "5" }, env).status, 403);
  assert.equal(adsgramReward("GET", { userid: "5", secret: "nope" }, env).status, 403);
  assert.equal(adsgramReward("GET", { userid: "5", secret: "s3cret" }, env).status, 200);
});
