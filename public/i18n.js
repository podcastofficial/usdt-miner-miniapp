'use strict';
/* Phase 2 / Part 5: tiny i18n. Strings live in /i18n/en.json, hi.json, hinglish.json (same keys in all three - a test checks it).
   Static text carries data-i18n="key" (or data-i18n-ph / data-i18n-aria); JS uses I18N.t(key, vars, englishFallback).
   English is always the fallback, so a missing key or a failed download never leaves the app blank. */
const I18N = (() => {
  const LANGS = ['en', 'hi', 'hinglish'], HTML_LANG = { en: 'en', hi: 'hi', hinglish: 'hi-Latn' };
  let cur = 'en', dict = {}, base = null;
  const cache = {};
  const load = async (l) => {
    if (cache[l]) return cache[l];
    const r = await fetch('/i18n/' + l + '.json', { cache: 'no-cache' });
    if (!r.ok) throw Error('i18n ' + l);
    return (cache[l] = await r.json());
  };
  const has = (k) => Object.prototype.hasOwnProperty.call(dict, k) || (base !== null && Object.prototype.hasOwnProperty.call(base, k));
  function t(k, vars, fallback) {
    let s = Object.prototype.hasOwnProperty.call(dict, k) ? dict[k] : base && Object.prototype.hasOwnProperty.call(base, k) ? base[k] : fallback !== undefined ? fallback : k;
    if (vars) s = String(s).replace(/\{(\w+)\}/g, (m, n) => (n in vars ? vars[n] : m));
    return s;
  }
  function apply(root) {
    root = root || document;
    root.querySelectorAll('[data-i18n]').forEach((el) => { if (has(el.dataset.i18n)) el.textContent = t(el.dataset.i18n); });
    root.querySelectorAll('[data-i18n-ph]').forEach((el) => { if (has(el.dataset.i18nPh)) el.setAttribute('placeholder', t(el.dataset.i18nPh)); });
    root.querySelectorAll('[data-i18n-aria]').forEach((el) => { if (has(el.dataset.i18nAria)) el.setAttribute('aria-label', t(el.dataset.i18nAria)); });
  }
  async function set(lang) {
    if (!LANGS.includes(lang)) lang = 'en';
    try {
      base = await load('en');
      dict = lang === 'en' ? {} : await load(lang);
      cur = lang;
    } catch (e) { cur = 'en'; dict = {}; return cur; } // offline / blocked: stay on the English text already in the page
    document.documentElement.lang = HTML_LANG[cur];
    try { localStorage.setItem('lang', cur); } catch (e) {}
    apply();
    return cur;
  }
  const guess = (code) => (String(code || '').toLowerCase().startsWith('hi') ? 'hi' : 'en');
  const stored = () => { try { const v = localStorage.getItem('lang'); return LANGS.includes(v) ? v : null; } catch (e) { return null; } };
  return { t, set, apply, guess, stored, has, LANGS, get lang() { return cur; } };
})();
