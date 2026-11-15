import { sql } from "../db.js";
import { envStatus } from "../config.js";

export const bootstrap = async ({ id, row, isAdmin }) => {
  const [tasks, tx, settings] = await Promise.all([
    sql`SELECT * FROM tasks WHERE active=TRUE AND (target=0 OR completed<target) ORDER BY id DESC`,
    sql`SELECT * FROM transactions WHERE telegram_id=${id} ORDER BY id DESC LIMIT 25`,
    sql`SELECT key,value FROM settings`,
  ]);
  const user = {
    telegram_id: row.telegram_id, username: row.username, first_name: row.first_name,
    points: row.points, ad_credits: row.ad_credits, referral_code: row.referral_code,
    membership_verified: row.membership_verified, created_at: row.created_at,
  };
  return { user, tasks, transactions: tx, settings: Object.fromEntries(settings.map(z => [z.key, z.value])), admin: isAdmin };
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
