// Part 6: pure helpers for the community features (no DB, no network -> unit-testable).

export const LB_PAGE_SIZE = 20;
export const LB_MAX_PAGES = 10;     // leaderboard shows the top 200 only (keeps the query cheap)
export const PROOF_PAGE_SIZE = 20;

// Control characters + bidi overrides: stripped from every user-controlled name before it is shown to others.
const UNSAFE = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g;
export const cleanText = (s, max = 100) => String(s ?? "").replace(UNSAFE, "").replace(/\s+/g, " ").trim().slice(0, max);

/** Name shown on the leaderboard. Never exposes the Telegram id or @username. */
export function publicName(firstName, username) {
  const n = cleanText(firstName, 18);
  if (n) return n;
  const u = cleanText(username, 18);
  return u ? u.slice(0, 2) + "***" : "Miner";
}

/** Name shown on the Payment Proof list: only the first 2 characters are visible. */
export function maskName(firstName, username) {
  const src = cleanText(firstName, 30) || cleanText(username, 30);
  if (!src) return "Miner";
  const chars = [...src]; // by code point, so emoji are not cut in half
  return chars.slice(0, Math.min(2, Math.max(1, chars.length - 1))).join("") + "***";
}

/** page query -> { page (1-based), offset, size } clamped to the allowed range. */
export function pageWindow(raw, { size = LB_PAGE_SIZE, maxPages = LB_MAX_PAGES } = {}) {
  const n = Number(raw);
  const page = Number.isInteger(n) ? Math.min(Math.max(n, 1), maxPages) : 1;
  return { page, offset: (page - 1) * size, size };
}

export const channelUrl = (c) => (/^@[A-Za-z0-9_]{5,32}$/.test(String(c || "")) ? `https://t.me/${c.slice(1)}` : null);

/** support_link setting ("@name" or a t.me link) -> https URL, or null when not configured. */
export function supportUrl(v) {
  const s = String(v || "").trim();
  if (!s) return null;
  if (/^@[A-Za-z0-9_]{5,32}$/.test(s)) return `https://t.me/${s.slice(1)}`;
  return /^https:\/\/t\.me\/[A-Za-z0-9_+\/]{3,64}$/.test(s) ? s : null;
}

export const txUrl = (h) => (/^0x[a-fA-F0-9]{64}$/.test(String(h || "")) ? `https://bscscan.com/tx/${h}` : null);

/** "13.50000000" -> "13.50" (payouts are whole cents). */
export const money2 = (v) => { const n = Number(v); return Number.isFinite(n) ? n.toFixed(2) : "0.00"; };

const intIn = (v, min, max) => { const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v; return Number.isSafeInteger(n) && n >= min && n <= max ? n : null; };

/**
 * Validates an advertiser's campaign. Returns { ok:true, value } | { ok:false, error }.
 * Rules are strict on purpose: the admin reviews every campaign, but bad input should never reach the queue.
 *  - https links only; channel campaigns need a plain https://t.me/<channel> link (that is what the approval step needs)
 *  - reward / target must respect the admin-configured minimums, budget = reward x target (integer math)
 */
export function validateCampaign(body, { adMinReward = 10, adMinTarget = 10 } = {}) {
  const b = body && typeof body === "object" ? body : {};
  const type = b.type;
  if (!["channel", "bot", "website"].includes(type)) return { ok: false, error: "Choose a campaign type" };
  const title = cleanText(b.title, 100);
  if (title.length < 3) return { ok: false, error: "Title must be at least 3 characters" };

  const link = String(b.link ?? "").trim();
  let url;
  try { url = new URL(link); } catch { return { ok: false, error: "Enter a valid https:// link" }; }
  if (link.length > 500 || url.protocol !== "https:" || url.username || url.password || !url.hostname.includes(".")) return { ok: false, error: "Enter a valid https:// link" };
  if (type === "channel" && !/^https:\/\/t\.me\/[A-Za-z0-9_]{5,32}\/?$/.test(link)) return { ok: false, error: "Channel campaigns need a link like https://t.me/YourChannel" };
  if (type === "bot" && url.hostname !== "t.me") return { ok: false, error: "Bot campaigns need a https://t.me/YourBot link" };

  const reward = intIn(b.reward, adMinReward, 1_000_000);
  if (reward == null) return { ok: false, error: `Reward must be a whole number between ${adMinReward.toLocaleString("en-US")} and 1,000,000 Points` };
  const target = intIn(b.target, adMinTarget, 1_000_000);
  if (target == null) return { ok: false, error: `Target must be a whole number between ${adMinTarget.toLocaleString("en-US")} and 1,000,000` };
  const budget = reward * target;
  if (!Number.isSafeInteger(budget) || budget > 1_000_000_000) return { ok: false, error: "Budget is too large" };
  return { ok: true, value: { type, title, link, reward, target, budget } };
}
