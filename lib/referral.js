import { sql } from "./db.js";
import { parseRefParam } from "./refcode.js";

/**
 * Called ONLY on a user's very first registration (row.created). The inviter is captured once and never re-attributed.
 * Self-referral is impossible (inviter must be a different, non-blocked user). No reward is paid here:
 * the reward is paid only after the referred user verifies the required channels (see actions/referral.js).
 */
export async function captureReferrer(userId, startParam) {
  const code = parseRefParam(startParam);
  if (!code) return null;
  const r = await sql`
    UPDATE users SET referrer_id = inv.telegram_id
    FROM users inv
    WHERE users.telegram_id=${String(userId)}::bigint AND users.referrer_id IS NULL
      AND inv.referral_code=${code}::text AND inv.telegram_id<>users.telegram_id AND inv.is_blocked=FALSE
    RETURNING inv.telegram_id`;
  return r.length ? r[0].telegram_id : null;
}
