// Supported languages (shared by the server and the tests; the strings live in public/i18n/*.json).
export const LANGS = ["en", "hi", "es", "ar", "ru", "pt", "fr", "tr", "id"];
export const LANG_LABELS = { en: "English", hi: "हिन्दी", es: "Español", ar: "العربية", ru: "Русский", pt: "Português", fr: "Français", tr: "Türkçe", id: "Bahasa Indonesia" };
/** First guess for a new user from the Telegram language code ("pt-BR" -> "pt"). They can change it in More > Settings. */
export const guessLang = (code) => { const c = String(code || "").toLowerCase().slice(0, 2); return LANGS.includes(c) ? c : String(code || "").toLowerCase() === "hindi" ? "hi" : "en"; };
