import { sql, isUniqueViolation } from "./db.js";
import { isAdminId } from "./auth.js";
import { newReferralCode } from "./refcode.js";

/**
 * Fresh registration: first authenticated visit creates the user, later visits only refresh profile data.
 * Idempotent (safe for duplicate/concurrent calls). Returns the row plus `created`.
 */
export async function ensureUser(u, startParam = null) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const rows = await sql`
        INSERT INTO users(telegram_id,username,first_name,last_name,language_code,is_admin,referral_code,signup_start_param)
        VALUES(${String(u.id)},${u.username || null},${u.first_name || ""},${u.last_name || ""},${u.language_code || null},
               ${isAdminId(u.id)},${newReferralCode()},${startParam ? String(startParam).slice(0, 64) : null})
        ON CONFLICT(telegram_id) DO UPDATE SET
          username=EXCLUDED.username, first_name=EXCLUDED.first_name, last_name=EXCLUDED.last_name,
          language_code=EXCLUDED.language_code, is_admin=EXCLUDED.is_admin, last_active_at=NOW()
        RETURNING *, (xmax = 0) AS created`;
      return rows[0];
    } catch (e) {
      if (!isUniqueViolation(e) || attempt === 3) throw e; // referral_code collision -> retry with a new code
    }
  }
}
