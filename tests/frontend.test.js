// Part 7: static checks for the premium UI (no browser needed): WCAG contrast, accessibility basics,
// strict-CSP readiness (no inline handlers/styles), and wiring between HTML, app.js and admin.js.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const html = read("public/index.html"), css = read("public/styles.css"), app = read("public/app.js"), adm = read("public/admin.js");
const vercel = JSON.parse(read("vercel.json"));

/* ---------- WCAG contrast ---------- */
const hex = (h) => { h = h.replace("#", ""); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); };
const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const ratio = (a, b) => { const [x, y] = [lum(hex(a)), lum(hex(b))].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const v = {}; for (const m of css.matchAll(/--([a-z0-9-]+):(#[0-9a-fA-F]{6})/g)) v[m[1]] = m[2];

test("design tokens exist", () => {
  for (const k of ["bg", "card-a", "card-b", "field", "txt", "mut", "green", "red", "focus", "or1", "btn-a", "btn-b", "btn-c", "btn-ink"]) assert.ok(v[k], "missing --" + k);
});

test("text colours meet WCAG AA 4.5:1 on every surface they sit on", () => {
  const surfaces = [v.bg, v["card-a"], v["card-b"], v.field, "#3a1a00"]; // page glow top colour included
  const texts = [v.txt, v.mut, v.or1, v.green, v.red, v.focus];
  for (const t of texts) for (const s of surfaces) assert.ok(ratio(t, s) >= 4.5, `${t} on ${s} = ${ratio(t, s).toFixed(2)}`);
});

test("button label ink is readable on all three button gradient stops", () => {
  for (const b of [v["btn-a"], v["btn-b"], v["btn-c"]]) assert.ok(ratio(v["btn-ink"], b) >= 4.5, `ink on ${b} = ${ratio(v["btn-ink"], b).toFixed(2)}`);
});

test("badge, nav and tab colours are readable", () => {
  const pairs = [["#7ff0c8", v["card-b"]], ["#ffd27a", v["card-b"]], ["#ffabab", v["card-b"]], ["#ffd9a0", v["card-b"]], ["#d9c9b5", "#0b0c10"], ["#d9c9b5", "#1a1b21"], [v.txt, "#26120a"], [v.txt, "#2c2d35"], [v.txt, "#2a1606"], ["#00261a", "#5de3b0"], ["#00261a", "#26a17b"]];
  for (const [a, b] of pairs) assert.ok(ratio(a, b) >= 4.5, `${a} on ${b} = ${ratio(a, b).toFixed(2)}`);
});

test("keyboard focus ring is visible against the page and cards (3:1)", () => {
  for (const s of [v.bg, v["card-a"], v["card-b"]]) assert.ok(ratio(v.focus, s) >= 3, `focus on ${s}`);
});

/* ---------- accessibility basics ---------- */
test("document basics: lang, zoom allowed, skip link, landmarks, one h1", () => {
  assert.match(html, /<html lang="en">/);
  assert.doesNotMatch(html, /user-scalable\s*=\s*no|maximum-scale\s*=\s*1(\D|$)/);
  assert.match(html, /class="skip" href="#main"/);
  assert.match(html, /<main id="main"/);
  assert.match(html, /<nav id="nav" aria-label=/);
  assert.equal((html.match(/<h1[ >]/g) || []).length, 1);
});

test("CSS: visible focus, 44px targets, reduced motion, high contrast", () => {
  assert.match(css, /:focus-visible\{outline:3px/);
  assert.match(css, /\.btn\{[^}]*min-height:44px/);
  assert.match(css, /\.tab\{[^}]*min-height:44px/);
  assert.match(css, /nav#nav button\{[^}]*min-height:52px/);
  assert.match(css, /@media \(prefers-reduced-motion:reduce\)/);
  assert.match(css, /@media \(prefers-contrast:more\)/);
});

test("every form field has a label; icon-only decoration is aria-hidden", () => {
  for (const m of html.matchAll(/<(input|select|textarea)\b[^>]*\bid="([^"]+)"/g)) assert.match(html, new RegExp(`<label[^>]*for="${m[2]}"`), "no <label for> for #" + m[2]);
  for (const m of html.matchAll(/<span class="(ic|logo)"([^>]*)>/g)) assert.match(m[2], /aria-hidden="true"/);
});

test("every section is labelled by its heading and tabs follow the ARIA tabs pattern", () => {
  for (const m of html.matchAll(/<section id="([^"]+)"([^>]*)>/g)) {
    const lab = /aria-labelledby="([^"]+)"/.exec(m[2]); assert.ok(lab, "section #" + m[1] + " has no aria-labelledby");
    assert.match(html, new RegExp(`id="${lab[1]}"`), "missing heading #" + lab[1]);
  }
  assert.match(html, /role="tablist"/); assert.match(html, /role="tabpanel"/); assert.match(app, /ArrowRight/);
});

/* ---------- strict CSP readiness ---------- */
test("no inline event handlers, inline styles, inline scripts or <style> blocks anywhere", () => {
  for (const [name, src] of [["index.html", html], ["app.js", app], ["admin.js", adm]]) {
    assert.doesNotMatch(src, /\son[a-z]+\s*=\s*["']/i, name + " has an inline on* handler");
    assert.doesNotMatch(src, /\sstyle\s*=\s*["']/i, name + " has an inline style attribute");
    assert.doesNotMatch(src, /createElement\(['"]style['"]\)/, name + " injects a <style>");
  }
  assert.doesNotMatch(html, /<style[\s>]/i);
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/i, "inline <script>");
  assert.doesNotMatch(app + adm, /\beval\(|new Function\(|setTimeout\(\s*['"`]|setInterval\(\s*['"`]/);
});

test("vercel.json CSP forbids unsafe-inline/eval and limits script sources", () => {
  const h = vercel.headers.find((x) => x.source === "/(.*)").headers, get = (k) => (h.find((x) => x.key === k) || {}).value;
  const csp = get("Content-Security-Policy"); assert.ok(csp, "no CSP header");
  assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval|\*(?!\.telegram\.org)/);
  assert.match(csp, /default-src 'none'/); assert.match(csp, /script-src 'self' https:\/\/telegram\.org(;|$)/);
  assert.match(csp, /connect-src 'self'/); assert.match(csp, /object-src 'none'/); assert.match(csp, /base-uri 'none'/); assert.match(csp, /frame-ancestors [^;]*telegram\.org/);
  assert.equal(get("X-Content-Type-Options"), "nosniff"); assert.equal(get("Referrer-Policy"), "no-referrer");
  assert.match(get("Strict-Transport-Security"), /max-age=\d{7,}/); assert.match(get("Permissions-Policy"), /camera=\(\)/);
  const externals = [...html.matchAll(/(?:src|href)="(https?:\/\/[^"]+)"/g)].map((m) => m[1]);
  for (const u of externals) assert.ok(u.startsWith("https://telegram.org/"), "unexpected external resource " + u);
});

/* ---------- wiring ---------- */
const sectionIds = new Set([...html.matchAll(/<section id="([^"]+)"/g)].map((m) => m[1]));
const ACTkeys = (() => { const a = app.indexOf("const ACT = {"), b = app.indexOf("const INPUT"); return new Set([...app.slice(a, b).matchAll(/^\s{2}(?:async\s+)?(\w+)\(/gm)].map((m) => m[1])); })();

test("every data-go target is a real screen", () => {
  const targets = new Set([...html.matchAll(/data-go="(\w+)"/g)].map((m) => m[1]));
  for (const m of app.matchAll(/data-go=\\?"(\w+)/g)) targets.add(m[1]);
  assert.ok(targets.size >= 10);
  for (const t of targets) assert.ok(sectionIds.has(t), "no section #" + t);
  for (const m of app.matchAll(/(?:PARENT|NAVOF) = (\{[^}]*\})/g)) for (const [, val] of m[1].matchAll(/:\s*'(\w+)'/g)) assert.ok(sectionIds.has(val), "nav map points to missing #" + val);
});

test("every data-act used in HTML or app.js has a handler in ACT", () => {
  const used = new Set([...html.matchAll(/data-act="(\w+)"/g)].map((m) => m[1]));
  for (const m of app.matchAll(/data-act="(\w+)"/g)) used.add(m[1]);
  for (const m of app.matchAll(/\bbtn\(\s*(?:'[^']*'|label|\([^)]*\)[^,]*),\s*'(\w+)'/g)) used.add(m[1]);
  for (const a of ["daily", "verify", "withdraw", "deposit", "campaign", "tab", "openCh", "openUrl"]) assert.ok(ACTkeys.has(a), "ACT lacks " + a);
  for (const a of used) if (!["adm"].includes(a)) assert.ok(ACTkeys.has(a), "no ACT handler for data-act=" + a);
});

test("every $('id') in app.js exists in index.html", () => {
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
  const dynamic = new Set(["admjs"]);
  for (const m of app.matchAll(/\$\('([\w-]+)'\)/g)) assert.ok(ids.has(m[1]) || dynamic.has(m[1]), "missing element #" + m[1]);
  for (const k of ["c_type", "c_title", "c_link", "c_reward", "c_target"]) assert.ok(ids.has(k));
});

test("admin.js: every data-adm / data-admchg name is a method of window.Admin", () => {
  const methods = new Set([...adm.slice(adm.indexOf("window.Admin={")).matchAll(/^ (?:async )?(\w+)\(/gm)].map((m) => m[1]));
  const used = new Set([...adm.matchAll(/data-adm(?:chg)?="(\w+)"/g)].map((m) => m[1]));
  assert.ok(used.size >= 15);
  for (const u of used) assert.ok(methods.has(u), "Admin." + u + " is missing");
  assert.match(adm, /hasOwnProperty\.call\(Admin,/); // only own methods are dispatchable
});

test("server strings are escaped before reaching innerHTML (app.js)", () => {
  assert.match(app, /const esc = /);
  // every ${...} placed in a template that goes to innerHTML must be a number/escaped/helper output; flag raw field access
  const risky = [...app.matchAll(/\$\{(?:[a-z]\.)?(?:title|name|description|link|reason|reject_reason|wallet|tx_hash)\}/g)];
  assert.equal(risky.length, 0, "unescaped server field in a template: " + (risky[0] || [""])[0]);
});

test("repo hygiene: secrets and zips are git-ignored, version bumped", () => {
  const gi = read(".gitignore").split(/\r?\n/);
  assert.ok(gi.includes(".env") && gi.includes("node_modules"), ".gitignore must list .env and node_modules on separate lines");
  assert.ok(!read(".gitignore").includes("\\n"), ".gitignore contains a literal \\n");
  assert.match(JSON.parse(read("package.json")).version, /^1\.7\./);
});
