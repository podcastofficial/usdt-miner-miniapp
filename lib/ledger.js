import { sql, isUniqueViolation } from "./db.js";
import { HttpError } from "./http.js";

function pts(n) {
  if (!Number.isSafeInteger(n) || n <= 0) throw new HttpError(400, "invalid_amount", "Invalid Points amount");
  return n;
}
async function balanceOf(id) {
  const r = await sql`SELECT points FROM users WHERE telegram_id=${String(id)} AND is_blocked=FALSE`;
  if (!r.length) throw new HttpError(403, "account_unavailable", "Account unavailable");
  return Number(r[0].points);
}

/**
 * Credit Points. The balance update and the ledger row are ONE SQL statement (atomic).
 * If `ref` (idempotency reference) was already used, nothing is credited and the current balance is returned.
 */
export async function credit(id, n, type, desc, ref = null) {
  n = pts(n);
  try {
    const r = await sql`
      WITH u AS (
        UPDATE users SET points=points+${n}::bigint
        WHERE telegram_id=${String(id)} AND is_blocked=FALSE
          AND (${ref}::text IS NULL OR NOT EXISTS(SELECT 1 FROM transactions WHERE reference=${ref}::text))
        RETURNING telegram_id, points)
      INSERT INTO transactions(telegram_id,type,points_change,balance_after,description,reference)
      SELECT telegram_id,${type}::text,${n}::bigint,points,${desc}::text,${ref}::text FROM u
      RETURNING balance_after`;
    if (r.length) return Number(r[0].balance_after);
  } catch (e) { if (!isUniqueViolation(e)) throw e; }
  return balanceOf(id); // duplicate reference (already credited) or unavailable account
}

/** Debit Points atomically; fails with 400 if the balance is insufficient. */
export async function debit(id, n, type, desc, ref = null) {
  n = pts(n);
  try {
    const r = await sql`
      WITH u AS (
        UPDATE users SET points=points-${n}::bigint
        WHERE telegram_id=${String(id)} AND points>=${n}::bigint AND is_blocked=FALSE
        RETURNING telegram_id, points)
      INSERT INTO transactions(telegram_id,type,points_change,balance_after,description,reference)
      SELECT telegram_id,${type}::text,(-${n}::bigint),points,${desc}::text,${ref}::text FROM u
      RETURNING balance_after`;
    if (r.length) return Number(r[0].balance_after);
  } catch (e) { if (!isUniqueViolation(e)) throw e; }
  throw new HttpError(400, "insufficient_points", "Insufficient Points");
}
