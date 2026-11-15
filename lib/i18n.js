// Phase 2 / Part 5: supported languages (shared by the server and the tests; the strings live in public/i18n/*.json).
export const LANGS = ["en", "hi", "hinglish"];
export const LANG_LABELS = { en: "English", hi: "हिन्दी", hinglish: "Hinglish" };
/** First guess for a new user from the Telegram language code. They can change it in More > Settings. */
export const guessLang = (code) => (String(code || "").toLowerCase().startsWith("hi") ? "hi" : "en");
