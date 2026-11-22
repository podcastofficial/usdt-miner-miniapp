// Part 28: pure helpers for broadcast target / image / inline buttons / channels (no DB, no network -> unit-testable).
import { normalizeTaskLink } from "./tasks.js";

export const TARGETS = ["bot", "channel", "both"];
export const MAX_BUTTONS = 6, BUTTON_TEXT_MAX = 40;
export const IMAGE_MAX_BYTES = 1_500_000; // after the admin page compressed it (a normal phone photo ends up around 150-400 KB)
export const wantsBot = (t) => t === "bot" || t === "both";
export const wantsChannel = (t) => t === "channel" || t === "both";

/** "@name" (public) or "-100123..." (numeric id of a channel) -> clean string or null. */
export function normalizeChannelRef(v) {
  const s = String(v ?? "").replace(/[\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/g, "").trim();
  const m = /^(?:@|(?:https?:\/\/)?(?:www\.)?(?:t|telegram)\.me\/)([A-Za-z0-9_]{5,32})\/?$/i.exec(s);
  if (m) return "@" + m[1];
  if (/^-100\d{6,14}$/.test(s)) return s;
  return null;
}

/** Inline buttons typed in the admin panel -> [{text,url}] (https links only, empty rows skipped) or an error. */
export function validateButtons(list) {
  if (list === undefined || list === null) return { ok: true, value: [] };
  if (!Array.isArray(list)) return { ok: false, error: "Buttons are invalid" };
  const out = [];
  for (const b of list) {
    const text = String((b && b.text) ?? "").replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, "").trim();
    const raw = String((b && b.url) ?? "").trim();
    if (!text && !raw) continue; // an empty row is simply ignored
    if (!text) return { ok: false, error: "Every button needs a name" };
    if (text.length > BUTTON_TEXT_MAX) return { ok: false, error: `Button name is too long (max ${BUTTON_TEXT_MAX} characters)` };
    const url = normalizeTaskLink(raw);
    if (!url) return { ok: false, error: `Button “${text}” needs a valid https:// link` };
    out.push({ text, url });
  }
  if (out.length > MAX_BUTTONS) return { ok: false, error: `At most ${MAX_BUTTONS} buttons` };
  return { ok: true, value: out };
}

/** Telegram inline_keyboard: one button per row. */
export const inlineKeyboard = (buttons) => (Array.isArray(buttons) && buttons.length ? { inline_keyboard: buttons.map((b) => [{ text: b.text, url: b.url }]) } : null);

/** data URL from the admin page -> { ok, value:{ bytes:Buffer, mime } } | { ok:false, error }. Only real JPEG / PNG files pass (checked by their first bytes, not by the name). */
export function parseImage(dataUrl) {
  if (dataUrl === undefined || dataUrl === null || dataUrl === "") return { ok: true, value: null };
  const m = /^data:(image\/(?:jpeg|png));base64,([A-Za-z0-9+/]+={0,2})$/.exec(String(dataUrl));
  if (!m) return { ok: false, error: "Image must be a JPEG or PNG picture" };
  const bytes = Buffer.from(m[2], "base64");
  if (bytes.length < 100) return { ok: false, error: "Image looks empty" };
  if (bytes.length > IMAGE_MAX_BYTES) return { ok: false, error: "Image is too big, pick a smaller one" };
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const png = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  if ((m[1] === "image/jpeg" && !jpeg) || (m[1] === "image/png" && !png)) return { ok: false, error: "Image file is damaged" };
  return { ok: true, value: { bytes, mime: m[1] } };
}

/** Text + target + segment (+ image presence) rules. Text may be empty only when there is an image. Returns the escaped text. */
export function validateBroadcastEx(body, { escapeHtml, BROADCAST_MAX, SEGMENTS }, hasImage) {
  const b = body && typeof body === "object" ? body : {};
  const target = TARGETS.includes(b.target) ? b.target : "bot";
  const raw = String(b.text ?? "").replace(/\r\n/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, "").trim();
  const limit = hasImage ? 1000 : BROADCAST_MAX; // a photo caption can hold at most 1024 characters in Telegram
  if (raw.length > limit) return { ok: false, error: `Message is too long (max ${limit} characters)` };
  if (raw.length < 3 && !(hasImage && raw.length === 0)) return { ok: false, error: hasImage ? "Write at least 3 characters, or leave the text empty to send only the picture" : "Message must be at least 3 characters" };
  let segment = "none";
  if (wantsBot(target)) {
    segment = SEGMENTS.includes(b.segment) ? b.segment : null;
    if (!segment) return { ok: false, error: "Choose who receives the message" };
  }
  return { ok: true, value: { text: escapeHtml(raw), segment, target } };
}
