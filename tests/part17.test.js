import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateSetting, resolveConfig } from "../lib/settingsDefs.js";

const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");

test("MINER price: up to 8 decimals, must be positive", () => {
  assert.equal(validateSetting("miner_price_usdt", "0.00012345").value, 0.00012345);
  assert.equal(validateSetting("miner_price_usdt", 0).ok, false);
  assert.equal(validateSetting("miner_price_usdt", -1).ok, false);
  assert.equal(validateSetting("miner_value_enabled", "false").value, false);
});
test("MINER price defaults to 0.0001 and the display switch to ON", () => {
  const c = resolveConfig([]);
  assert.equal(c.minerPriceUsdt, 0.0001);
  assert.equal(c.minerValueEnabled, true);
});
test("frontend has the USDT helpers and uses them on the main screens", () => {
  for (const k of ["minerPrice", "fmtUsd", "withUsd", "renderUsdBalance"]) assert.ok(app.includes(k), k);
  assert.ok((app.match(/withUsd\(/g) || []).length >= 15);
});
