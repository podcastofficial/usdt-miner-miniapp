// Part 17.3: Auto-Miner screen + admin tab (static wiring checks, no browser needed).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const html = read("public/index.html"), app = read("public/app.js"), adm = read("public/admin.js"), api = read("api/index.js"), roles = read("lib/roles.js");

test("Auto-Miner screen: reachable from More and Home, Home card hidden until enabled", () => {
  assert.match(html, /<section id="automine" aria-labelledby="h-automine">/);
  assert.match(html, /<h2 id="h-automine">/);
  assert.match(html, /<button class="card hub" data-go="automine">/);
  assert.match(html, /<div id="amhome" hidden>/);
  for (const id of ["amnote", "amtop", "amminers", "amshop", "amclaims"]) assert.match(html, new RegExp(`id="${id}"`), id);
  assert.match(app, /automine: 'more'/);
  assert.match(app, /if \(id === 'automine'\) await loadAutoMiner\(\);/);
  assert.match(app, /data\.auto_miner && data\.auto_miner\.enabled/);
});

test("Auto-Miner screen: every data-act has a handler, and every API call it makes exists on the server", () => {
  for (const a of ["amClaim", "amBuy"]) assert.match(app, new RegExp(`^  (async )?${a}\\(`, "m"), a);
  for (const a of ["autoMiner", "autoMinerBuy", "autoMinerClaim"]) assert.match(api, new RegExp(`${a}: \\{ fn: amn\\.${a}`), a);
  for (const a of ["amClaim", "amBuy"]) assert.ok(app.includes(`data-act="${a}"`), a);
});

test("admin Auto-Miner tab: uses the rewards permission and only methods that exist", () => {
  assert.match(adm, /\['am','🤖','Auto-Miner','rewards'\]/);
  assert.match(roles, /adminAutoMinerOverview: "rewards"/);
  for (const m of ["amEdit", "amSave", "amOn"]) assert.match(adm, new RegExp(`^ (async )?${m}\\(`, "m"), m);
  assert.match(adm, /NUM=new Set\(\['amEdit','amOn'/);
  assert.match(adm, /BOOL=new Set\(\['amOn'/);
});

test("strict CSP: no inline styles or handlers in the new code", () => {
  for (const [name, src] of [["index.html", html], ["app.js", app], ["admin.js", adm]]) {
    assert.doesNotMatch(src, /\sstyle\s*=\s*["']/i, name + " inline style");
    assert.doesNotMatch(src, /\son[a-z]+\s*=\s*["']/i, name + " inline handler");
  }
});
