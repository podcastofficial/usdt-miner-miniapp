import { sql } from "./db.js";
// Every admin action must be logged: who, what, on what, why, before/after.
export async function audit({ actorId, action, targetType = null, targetId = null, reason = null, before = null, after = null }) {
  await sql`INSERT INTO admin_audit_logs(actor_id,action,target_type,target_id,reason,before_data,after_data)
    VALUES(${String(actorId)},${action},${targetType},${targetId == null ? null : String(targetId)},${reason},
           ${before ? JSON.stringify(before) : null}::jsonb,${after ? JSON.stringify(after) : null}::jsonb)`;
}
