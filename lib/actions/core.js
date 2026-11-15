import { sql } from "../db.js";
import { envStatus } from "../config.js";
import { dailyState } from "./earn.js";
import { getConfig } from "../runtime.js";
import { permsOf } from "../roles.js";
import { guessLang } from "../i18n.js";
import { getSetting } from "../settings.js";
import { channelTitles, isChannelName, botAdminLink } from "../telegram.js";

export const bootstrap = async ({ id, row, isAdmin, role }) => {
  const cfg = await getConfig(); // proof tasks stay hidden while the proof switch is OFF (nobody could finish them)
  const [tasks, tx, settings, daily, rew] = await Promise.all([
    sql`SELECT t.id,t.type,t.title,t.description,t.link,t.reward,t.timer_seconds,t.proof_required,t.proof_hint,
               (SELECT p.status FROM task_proofs p WHERE p.task_id=t.id AND p.telegram_id=${id}::bigint ORDER BY p.id DESC LIMIT 1) AS proof_status,
               (SELECT p.reject_reason FROM task_proofs p WHERE p.task_id=t.id AND p.telegram_id=${id}::bigint AND p.status='rejected' ORDER BY p.id DESC LIMIT 1) AS proof_reason,
               (c.task_id IS NOT NULL) AS done, a.started_at,
               CASE WHEN a.started_at IS NULL THEN NULL
                    ELSE GREATEST(0, CEIL(t.timer_seconds - EXTRACT(EPOCH FROM (NOW() - a.started_at))))::int END AS seconds_left
        FROM tasks t
        LEFT JOIN task_completions c ON c.task_id=t.id AND c.telegram_id=${id}::bigint
        LEFT JOIN task_attempts a ON a.task_id=t.id AND a.telegram_id=${id}::bigint
        WHERE t.active=TRUE AND (t.target=0 OR t.completed<t.target OR c.task_id IS NOT NULL) AND (${cfg.taskProofEnabled}::boolean OR t.proof_required=FALSE)
        ORDER BY (c.task_id IS NOT NULL) ASC, t.id DESC`,
    sql`SELECT id,type,points_change,balance_after,description,status,created_at FROM transactions WHERE telegram_id=${id}::bigint ORDER BY id DESC LIMIT 25`,
    sql`SELECT key,value FROM settings`,
    dailyState(id),
    sql`SELECT EXISTS(SELECT 1 FROM referral_events WHERE referred_id=${id}::bigint) AS rewarded`,
  ]);
  let channel_titles = {};
  try { const rc = await getSetting("required_channels", ["@USDTMinerUpdates", "@USDTMinerPayments"]); channel_titles = await channelTitles((Array.isArray(rc) ? rc : []).filter(isChannelName)); } catch (e) { /* names are optional */ }
  const user = {
    telegram_id: row.telegram_id, username: row.username, first_name: row.first_name,
    points: row.points, ad_credits: row.ad_credits, referral_code: row.referral_code,
    membership_verified: row.membership_verified, created_at: row.created_at,
    has_referrer: row.referrer_id != null,
    lang: row.user_lang || null, lang_guess: guessLang(row.language_code),
    verify_needed: !row.membership_verified || (row.referrer_id != null && !rew[0].rewarded),
  };
  const popup_ad = { enabled: cfg.popupAdEnabled, on_tasks: cfg.popupAdOnTasks, on_ads: cfg.popupAdOnAds, on_games: cfg.popupAdOnGames, type: cfg.popupAdType,
    cooldown: cfg.popupAdCooldown, wait: cfg.popupAdWait, title: cfg.popupAdTitle, text: cfg.popupAdText, image: cfg.popupAdImage, link: cfg.popupAdLink,
    button: cfg.popupAdButton || "Open", adsgram_block_id: cfg.adsgramBlockId, monetag_zone_id: cfg.monetagZoneId };
  return { user, popup_ad, tasks, transactions: tx, daily, settings: Object.fromEntries(settings.map(z => [z.key, z.value])), channel_titles, bot_add_url: botAdminLink(cfg.botUsername), admin: isAdmin, admin_role: role || null, admin_perms: permsOf(role) };
};

export const adminOverview = async () => {
  const q = await sql`SELECT (SELECT COUNT(*) FROM users)::int users,
    (SELECT COUNT(*) FROM deposits WHERE status='pending')::int deposits,
    (SELECT COUNT(*) FROM withdrawals WHERE status='pending')::int withdrawals`;
  return q[0];
};

// Admin-only: which env vars are set (true/false only, never values) + DB connectivity.
export const adminDiagnostics = async () => {
  let db = false; try { await sql`SELECT 1`; db = true; } catch {}
  return { env: envStatus(), db, node: process.version };
};
