import test from "node:test";
import assert from "node:assert/strict";
import { parseCents, fmtCents, quote } from "../lib/money.js";
import { evaluateReceipt, unitsToUsdt8, fmt8, pointsFromUsdt8, TRANSFER_TOPIC, isAddress, isTxHash } from "../lib/chain.js";

test("parseCents accepts clean amounts only", () => {
  assert.equal(parseCents("15"), 1500);
  assert.equal(parseCents("15.5"), 1550);
  assert.equal(parseCents("15.05"), 1505);
  for (const b of ["", "0", "0.00", "-5", "1e3", "15.123", "abc", "NaN", "Infinity", " ", "1,5", "1234567890", null, undefined])
    assert.equal(parseCents(b), null, String(b));
});
test("quote uses integer math: fee, net and Points", () => {
  const q = quote(2000, { ppu: 10000, feePercent: 10 });
  assert.deepEqual([q.points, q.fee, q.net, q.amount], [200000, "2.00", "18.00", "20.00"]);
  const odd = quote(1537, { ppu: 10000, feePercent: 10 });
  assert.equal(odd.points, 153700);
  assert.equal(odd.feeCents + odd.netCents, 1537); // fee + net always equals the gross amount
  assert.equal(fmtCents(5), "0.05");
});
test("unit conversion: 18-decimals token units -> USDT / Points", () => {
  const units = 25n * 10n ** 18n + 5n * 10n ** 17n; // 25.5 USDT
  const n8 = unitsToUsdt8(units, 18);
  assert.equal(fmt8(n8), "25.50000000");
  assert.equal(pointsFromUsdt8(n8, 10000), 255000);
  assert.equal(pointsFromUsdt8(unitsToUsdt8(10n ** 6n, 6), 10000), 10000); // 6-decimal token works too
});

const W = "0x1111111111111111111111111111111111111111", C = "0x55d398326f99059fF775485246999027B3197955", F = "0x2222222222222222222222222222222222222222";
const pad = (a) => "0x" + "0".repeat(24) + a.slice(2).toLowerCase();
const log = (o = {}) => ({ address: C, topics: [TRANSFER_TOPIC, pad(o.from || F), pad(o.to || W)], data: "0x" + (o.units ?? 10n * 10n ** 18n).toString(16), removed: false });
const rc = (logs, status = "0x1", block = 1000) => ({ status, blockNumber: "0x" + block.toString(16), logs });
const cfg = { wallet: W, contract: C, from: F, minUnits: 5n * 10n ** 18n, minConfirmations: 15 };

test("receipt: verified when transfer matches and confirmations are enough", () => {
  const r = evaluateReceipt(rc([log()]), 1014, cfg);
  assert.equal(r.state, "verified"); assert.equal(r.confirmations, 15); assert.equal(r.amountUnits, 10n * 10n ** 18n);
});
test("receipt: not mined -> pending; too few confirmations -> pending", () => {
  assert.equal(evaluateReceipt(null, 1000, cfg).reason, "not_found");
  const r = evaluateReceipt(rc([log()]), 1005, cfg);
  assert.deepEqual([r.state, r.reason, r.confirmations], ["pending", "confirming", 6]);
});
test("receipt: failed tx / wrong token / wrong recipient / wrong sender / dust are rejected", () => {
  assert.equal(evaluateReceipt(rc([log()], "0x0"), 2000, cfg).reason, "tx_failed");
  assert.equal(evaluateReceipt(rc([{ ...log(), address: "0x3333333333333333333333333333333333333333" }]), 2000, cfg).reason, "no_matching_transfer");
  assert.equal(evaluateReceipt(rc([log({ to: F })]), 2000, cfg).reason, "no_matching_transfer");
  assert.equal(evaluateReceipt(rc([log({ from: W })]), 2000, cfg).reason, "no_matching_transfer");
  assert.equal(evaluateReceipt(rc([log({ units: 10n ** 18n })]), 2000, cfg).reason, "below_minimum");
  assert.equal(evaluateReceipt(rc([{ ...log(), removed: true }]), 2000, cfg).reason, "no_matching_transfer");
  assert.equal(evaluateReceipt(rc([{ ...log(), topics: [TRANSFER_TOPIC, pad(F)] }]), 2000, cfg).reason, "no_matching_transfer");
});
test("receipt: several matching transfers in one tx are summed", () => {
  const r = evaluateReceipt(rc([log({ units: 3n * 10n ** 18n }), log({ units: 4n * 10n ** 18n })]), 2000, cfg);
  assert.equal(r.state, "verified"); assert.equal(r.amountUnits, 7n * 10n ** 18n);
});
test("address / hash validators", () => {
  assert.ok(isAddress(W)); assert.ok(!isAddress("0x123")); assert.ok(isTxHash("0x" + "a".repeat(64))); assert.ok(!isTxHash("0x" + "g".repeat(64)));
});
