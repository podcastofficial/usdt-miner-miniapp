// Phase 2 / Part 4: ONE place that closes an ad campaign (owner stop / admin reject / admin cancel).
// Status change + task switch-off + refund + ledger row are ONE SQL statement; the status change is compare-and-set, so a double click,
// two admins, or an owner and an admin at the same moment can refund only once (and the ledger reference cmprefund:<id> is unique anyway).
// Refund = reward x target - spent, read from the campaigns row AFTER Postgres has locked it, so a claim that commits first is never refunded.
import { sql } from "./db.js";
import { HttpError } from "./http.js";

/**
 * @param {{cid:number, from:'pending'|'active', to:'rejected'|'cancelled', reason:string, reviewer:string|null, ownerId?:string|null}} p
 * ownerId set -> only that owner's campaign can be closed (owner stop).
 * @returns {Promise<{id:number, status:string, refunded_points:number}>}
 */
export async function closeCampaign({ cid, from, to, reason, reviewer, ownerId = null }) {
  const r = await sql`
    WITH c AS (
      UPDATE campaigns SET status=${to}::text, reject_reason=${reason}::text, reviewed_by=${reviewer}::bigint, reviewed_at=NOW()
      WHERE id=${cid}::bigint AND status=${from}::text AND (${ownerId}::bigint IS NULL OR owner_id=${ownerId}::bigint)
      RETURNING id, owner_id, task_id, GREATEST(reward * target - spent, 0) AS refund),
    tk AS (UPDATE tasks SET active=FALSE FROM c WHERE tasks.id=c.task_id RETURNING tasks.id),
    u AS (
      UPDATE users SET points=users.points+c.refund FROM c WHERE users.telegram_id=c.owner_id AND c.refund>0
      RETURNING users.telegram_id, users.points AS bal, c.refund AS refund, c.id AS cid),
    t AS (
      INSERT INTO transactions(telegram_id,type,points_change,balance_after,description,reference)
      SELECT telegram_id,'Campaign Refund',refund,bal,'Campaign #'||cid::text||' '||${to}::text,'cmprefund:'||cid::text FROM u RETURNING 1)
    SELECT c.id, c.refund::text AS refund FROM c`;
  if (!r.length) throw new HttpError(409, "invalid_state", "Campaign is already closed");
  return { id: Number(r[0].id), status: to, refunded_points: Number(r[0].refund) };
}
