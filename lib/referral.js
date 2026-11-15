import { sql } from "./db.js";
import { parseRefParam } from "./refcode.js";

/**
 * Called on a user's very first registration (row.created) and - with `late` - when a brand-new account (under 1 hour, not verified yet) opens a referral link
 * after it was already created without one (e.g. opened the app first, then the link). The inviter is captured once and never re-attributed.
 * Self-referral is impossible (inviter must be a different, non-blocked user). No reward is paid here:
 * the reward is paid only after the referred user verifies the required channels (see actions/referral.js).
 */
export async function captureReferrer(userId, startParam, { late = false } = {}) {
  const code = parseRefParam(startParam);
  if (!code) return null;
  const r = await sql`
    UPDATE users SET referrer_id = inv.telegram_id
    FROM users inv
    WHERE users.telegram_id=${String(userId)}::bigint AND users.referrer_id IS NULL
      AND inv.referral_code=${code}::text AND inv.telegram_id<>users.telegram_id AND inv.is_blocked=FALSE
      AND (${late}::boolean = FALSE OR (users.created_at > NOW() - INTERVAL '1 hour' AND users.membership_verified=FALSE AND inv.referrer_id IS DISTINCT FROM users.telegram_id))
    RETURNING inv.telegram_id`;
  return r.length ? r[0].telegram_id : null;
}
