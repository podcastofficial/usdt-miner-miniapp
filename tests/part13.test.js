// Part 13 (v1.13.0): language migration, 9 language files, stricter CSP.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const read = (f) => fs.readFileSync(new URL("../" + f, import.meta.url), "utf8");

test("migration 012: user_lang allows the 9 languages, Hinglish users move to English, idempotent", () => {
  const m = read("db/migrations/012_languages.sql"), code = m.replace(/--.*$/gm, "");
  assert.match(code, /UPDATE users SET user_lang='en' WHERE user_lang='hinglish'/);
  assert.match(code, /DROP CONSTRAINT IF EXISTS users_user_lang_chk/);
  assert.match(code, /user_lang IN \('en','hi','es','ar','ru','pt','fr','tr','id'\)/);
  assert.match(code, /INSERT INTO schema_migrations\(version\) VALUES\('012_languages'\) ON CONFLICT DO NOTHING;/);
  assert.doesNotMatch(code, /TRUNCATE|DROP\s+TABLE|DELETE\s+FROM/i);
});

test("every language in the picker has a file, and Hinglish is gone", () => {
  const html = read("public/index.html");
  for (const l of ["en", "hi", "es", "ar", "ru", "pt", "fr", "tr", "id"]) {
    assert.ok(fs.existsSync(new URL(`../public/i18n/${l}.json`, import.meta.url)), l);
    assert.match(html, new RegExp(`<option value="${l}">`), l);
  }
  assert.equal(fs.existsSync(new URL("../public/i18n/hinglish.json", import.meta.url)), false);
  assert.equal(fs.existsSync(new URL("../DELETE_THIS.txt", import.meta.url)), false);
});

test("CSP keeps what the ad SDKs (Monetag / Adsgram) need: https scripts and inline styles; no eval", () => {
  const v = JSON.parse(read("vercel.json")), h = v.headers.find((x) => x.source === "/(.*)").headers;
  const csp = h.find((x) => x.key === "Content-Security-Policy").value;
  assert.match(csp, /script-src 'self' https:;/);
  assert.match(csp, /style-src 'self' 'unsafe-inline';/);
  assert.doesNotMatch(csp, /unsafe-eval/);
});
