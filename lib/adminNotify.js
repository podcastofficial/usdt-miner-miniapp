// Admin activity alerts (bot DM to every admin) and new-task announcements (post in a channel). Both NEVER throw: they must never break the action that triggered them.
import { getConfig } from "./runtime.js";
import { sendAlert } from "./health.js";
import { sendMessage } from "./telegram.js";
import { escapeHtml, appLink } from "./notifyText.js";

const E = (v, n = 80) => escapeHtml(String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n));
const who = (u) => (u && (u.username ? "@" + E(u.username, 32) : E(u.first_name || "user", 40))) + (u && u.telegram_id ? ` (<code>${Number(u.telegram_id) ? String(u.telegram_id).slice(0, 15) : ""}</code>)` : "");
const pts = (n) => Number(n).toLocaleString("en-US");

/** One DM to every admin, once per (kind,key). */
export async function notifyAdmins(kind, key, text) {
  try {
    const c = await getConfig();
    if (c.adminCampaignAlerts === false) return { sent: 0, skipped: "disabled" };
    return await sendAlert({ kind: `act:${kind}:${key}`, text, minutes: 24 * 60 });
  } catch { return { sent: 0, skipped: "error" }; }
}

export const campaignText = (event, c, owner, extra = "") => {
  const head = { new: "🆕 <b>New campaign</b>", cancelled: "🚫 <b>Campaign cancelled by owner</b>", approved: "✅ <b>Campaign approved</b>", rejected: "❌ <b>Campaign rejected</b>", stopped: "⏹ <b>Campaign stopped</b>" }[event] || "📣 <b>Campaign</b>";
  return `${head} #${Number(c.id)}\n` +
    `Title: ${E(c.title, 100)}\nType: ${E(c.type, 12)}\n` +
    (c.link ? `Link: ${E(c.link, 160)}\n` : "") +
    `Reward: ${pts(c.reward)} × ${pts(c.target)} = ${pts(Number(c.reward) * Number(c.target))} Points\n` +
    (owner ? `Owner: ${who(owner)}\n` : "") + (extra ? extra + "\n" : "") +
    (event === "new" ? "Review it in Admin → Campaigns." : "");
};
export const taskAdminText = (t, actor) => `🧩 <b>Task added</b> #${Number(t.id)}\nTitle: ${E(t.title, 100)}\nType: ${E(t.type, 12)} · +${pts(t.reward)} Points${Number(t.target) ? " × " + pts(t.target) : ""}\nBy: ${E(actor, 40)}`;

/** Post "new task" in the announcement channel (setting), with an Open-app button. */
export async function announceTask({ title, reward, type }) {
  try {
    const c = await getConfig();
    if (c.taskAlertsEnabled === false) return { posted: false, skipped: "disabled" };
    const ch = c.taskAlertChannel || c.officialChannel;
    if (!ch || !process.env.BOT_TOKEN) return { posted: false, skipped: "not_configured" };
    const icon = type === "channel" ? "✈️" : type === "bot" ? "🤖" : "🌐";
    const text = `🆕 <b>New task available!</b>\n${icon} ${E(title, 100)}\n🪙 <b>+${pts(reward)} Points</b>\n\nOpen the app and complete it now 👇`;
    const r = await sendMessage(ch, text, { reply_markup: { inline_keyboard: [[{ text: "⛏ Open USDT Miner", url: appLink(c) }]] } });
    const ok = r.status === 200 && r.json && r.json.ok;
    if (!ok) console.error("task announce failed:", r.json && r.json.description);
    return { posted: !!ok };
  } catch { return { posted: false, skipped: "error" }; }
}
