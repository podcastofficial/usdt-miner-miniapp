import { sql } from "../db.js";
import { envStatus } from "../config.js";
import { dailyState } from "./earn.js";

export const bootstrap = async ({ id, row, isAdmin }) => {
  const [tasks, tx, settings, daily] = await Promise.all([
    sql`SELECT t.id,t.type,t.title,t.description,t.link,t.reward,t.timer_seconds,
               (c.task_id IS NOT NULL) AS done, a.started_at,
               CASE WHEN a.started_at IS NULL THEN NULL
                    ELSE GREATEST(0, CEIL(t.timer_seconds - EXTRACT(EPOCH FROM (NOW() - a.started_at))))::int END AS seconds_left
        FROM tasks t
        LEFT JOIN task_completions c ON c.task_id=t.id AND c.telegram_id=${id}::bigint
        LEFT JOIN task_attempts a ON a.task_id=t.id AND a.telegram_id=${id}::bigint
        WHERE t.active=TRUE AND (t.target=0 OR t.completed<t.target OR c.task_id IS NOT NULL)
        ORDER BY (c.task_id IS NOT NULL) ASC, t.id DESC`,
    sql`SELECT id,type,points_change,balance_after,description,status,created_at FROM transactions WHERE telegram_id=${id}::bigint ORDER BY id DESC LIMIT 25`,
    sql`SELECT key,value FROM settings`,
    dailyState(id),
  ]);
  const user = {
    telegram_id: row.telegram_id, username: row.username, first_name: row.first_name,
    points: row.points, ad_credits: row.ad_credits, referral_code: row.referral_code,
    membership_verified: row.membership_verified, created_at: row.created_at,
  };
  return { user, tasks, transactions: tx, daily, settings: Object.fromEntries(settings.map(z => [z.key, z.value])), admin: isAdmin };
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
