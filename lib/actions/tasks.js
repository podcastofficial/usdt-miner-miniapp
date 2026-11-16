// Phase 2 / Part 4: tasks that need a proof (bot / website). The user submits a proof, an admin reviews it, approval pays Points exactly once.
// Same ledger reference (task:<task>:<user>) and same task_completions UNIQUE as the normal claim, so the two paths can never both pay.
import { sql, isUniqueViolation } from "../db.js";
import { HttpError } from "../http.js";
import { audit } from "../audit.js";
import { getConfig } from "../runtime.js";
import { cleanText, publicName } from "../community.js";
import { validateProof, proofAllowance } from "../tasks.js";

const bad = (msg, code = "bad_request", status = 400) => new HttpError(status, code, msg);
const posInt = (v) => { const n = Number(v); return Number.isSafeInteger(n) && n > 0 ? n : null; };
const STATUSES = ["pending", "approved", "rejected"];

/** User: send a proof for a proof task. One live proof per task; a rejected one can be replaced (limited). */
export const taskProofSubmit = async ({ id, body }) => {
  const c = await getConfig();
  if (!c.taskProofEnabled) throw bad("Proof tasks are not open yet", "proofs_off", 503);
  const tid = posInt(body.taskId);
  if (!tid) throw bad("Task unavailable");
  const v = validateProof(body.proof);
  if (!v.ok) throw bad(v.error);
  let r;
  try {
    r = await sql`
      WITH t AS (SELECT id FROM tasks WHERE id=${tid}::bigint AND active=TRUE AND proof_required=TRUE AND (target=0 OR completed<target))
      INSERT INTO task_proofs(task_id,telegram_id,proof)
      SELECT t.id, ${id}::bigint, ${v.value}::text FROM t
      WHERE EXISTS(SELECT 1 FROM users WHERE telegram_id=${id}::bigint AND is_blocked=FALSE)
        AND NOT EXISTS(SELECT 1 FROM task_completions WHERE task_id=t.id AND telegram_id=${id}::bigint)
        AND (SELECT COUNT(*) FROM task_proofs WHERE telegram_id=${id}::bigint AND status='pending') < ${c.taskProofMaxPending}::int
        AND (SELECT COUNT(*) FROM task_proofs WHERE task_id=t.id AND telegram_id=${id}::bigint AND status='rejected') < ${c.taskProofMaxTries}::int
      RETURNING id`;
  } catch (e) {
    if (isUniqueViolation(e)) throw bad("You already have a proof waiting for review", "proof_exists", 409);
    throw e;
  }
  if (r.length) return { id: Number(r[0].id), status: "pending" };
  // Nothing written: tell the user why.
  const t = (await sql`SELECT 1 FROM tasks WHERE id=${tid}::bigint AND active=TRUE AND proof_required=TRUE AND (target=0 OR completed<target)`)[0];
  if (!t) throw bad("Task unavailable", "task_unavailable");
  const st = (await sql`SELECT
      EXISTS(SELECT 1 FROM task_completions WHERE task_id=${tid}::bigint AND telegram_id=${id}::bigint) AS completed,
      EXISTS(SELECT 1 FROM task_proofs WHERE task_id=${tid}::bigint AND telegram_id=${id}::bigint AND status IN ('pending','approved')) AS has_live,
      (SELECT COUNT(*) FROM task_proofs WHERE task_id=${tid}::bigint AND telegram_id=${id}::bigint AND status='rejected')::int AS rejected_count,
      (SELECT COUNT(*) FROM task_proofs WHERE telegram_id=${id}::bigint AND status='pending')::int AS pending_total`)[0];
  const a = proofAllowance({ hasLive: st.has_live, completed: st.completed, rejectedCount: st.rejected_count, pendingTotal: st.pending_total },
    { maxTries: c.taskProofMaxTries, maxPending: c.taskProofMaxPending });
  throw a.ok ? bad("Proof could not be saved, please try again", "conflict", 409) : bad(a.error, a.code, 409);
};

// ---------------- admin ----------------
export const adminTaskProofs = async ({ body }) => {
  const st = STATUSES.includes(body.status) ? body.status : "pending";
  const before = posInt(body.before);
  const rows = await sql`
    SELECT p.id, p.task_id, p.telegram_id, p.proof, p.status, p.reward, p.reject_reason, p.created_at, p.reviewed_at,
           t.title, t.type, t.reward AS task_reward, t.active, t.target, t.completed, u.first_name, u.username
    FROM task_proofs p JOIN tasks t ON t.id=p.task_id JOIN users u ON u.telegram_id=p.telegram_id
    WHERE p.status=${st}::text AND (${before}::bigint IS NULL OR p.id < ${before}::bigint)
    ORDER BY CASE WHEN ${st}::text='pending' THEN p.id END ASC, p.id DESC LIMIT 31`;
  const items = rows.slice(0, 30).map(x => ({ ...x, proof: cleanText(x.proof, 300), name: publicName(x.first_name, x.username) }));
  return { items, next: rows.length > 30 ? items[items.length - 1].id : null };
};

/** Approve: proof status + completion + task counter + campaign budget + balance + ledger in ONE statement. Pays once. */
export const adminTaskProofApprove = async ({ id, body }) => {
  const pid = posInt(body.id);
  if (!pid) throw bad("Invalid request");
  const r = await sql`
    WITH p AS (SELECT id, task_id, telegram_id FROM task_proofs WHERE id=${pid}::bigint AND status='pending' FOR UPDATE),
    t AS (
      SELECT tasks.id, tasks.title, tasks.reward FROM tasks JOIN p ON p.task_id=tasks.id
      WHERE tasks.active=TRUE AND (tasks.target=0 OR tasks.completed<tasks.target) FOR UPDATE OF tasks),
    c AS (
      INSERT INTO task_completions(task_id,telegram_id,reward,evidence)
      SELECT t.id, p.telegram_id, t.reward, jsonb_build_object('mode','proof','proof_id',p.id) FROM t, p
      WHERE EXISTS(SELECT 1 FROM users WHERE telegram_id=p.telegram_id AND is_blocked=FALSE)
      ON CONFLICT DO NOTHING RETURNING task_id, telegram_id, reward),
    pu AS (
      UPDATE task_proofs SET status='approved', reward=c.reward, reviewed_by=${id}::bigint, reviewed_at=NOW()
      FROM c WHERE task_proofs.id=${pid}::bigint RETURNING task_proofs.id),
    tu AS (UPDATE tasks SET completed=completed+1 FROM c WHERE tasks.id=c.task_id RETURNING tasks.id),
    cm AS (
      UPDATE campaigns SET spent=campaigns.spent+campaigns.reward,
        status=CASE WHEN campaigns.spent+campaigns.reward >= campaigns.reward*campaigns.target THEN 'finished' ELSE campaigns.status END,
        finished_at=CASE WHEN campaigns.spent+campaigns.reward >= campaigns.reward*campaigns.target THEN NOW() ELSE campaigns.finished_at END
      FROM c WHERE campaigns.task_id=c.task_id AND campaigns.status='active' AND campaigns.spent+campaigns.reward <= campaigns.reward*campaigns.target
      RETURNING campaigns.id AS campaign_id, c.task_id AS task_id, c.telegram_id AS telegram_id, campaigns.reward AS cost, c.reward AS reward),
    cc AS (
      INSERT INTO campaign_completions(campaign_id,task_id,telegram_id,reward,method,platform_fee)
      SELECT campaign_id, task_id, telegram_id, cost, 'proof', GREATEST(cost - reward, 0) FROM cm ON CONFLICT DO NOTHING RETURNING 1),
    u AS (
      UPDATE users SET points=points+c.reward FROM c WHERE users.telegram_id=c.telegram_id
      RETURNING users.telegram_id, users.points, c.reward, c.task_id)
    INSERT INTO transactions(telegram_id,type,points_change,balance_after,description,reference)
    SELECT u.telegram_id,'Task Reward',u.reward,u.points,(SELECT title FROM t),'task:'||u.task_id::text||':'||u.telegram_id::text FROM u
    RETURNING telegram_id, points_change`;
  if (!r.length) {
    const p = (await sql`SELECT p.status, t.active, (t.target=0 OR t.completed<t.target) AS open,
        EXISTS(SELECT 1 FROM task_completions c WHERE c.task_id=p.task_id AND c.telegram_id=p.telegram_id) AS done,
        (SELECT NOT is_blocked FROM users WHERE telegram_id=p.telegram_id) AS user_ok
      FROM task_proofs p JOIN tasks t ON t.id=p.task_id WHERE p.id=${pid}::bigint`)[0];
    if (!p) throw bad("Proof not found", "not_found", 404);
    if (p.status !== "pending") throw bad("This proof was already reviewed", "invalid_state", 409);
    if (p.done) throw bad("This user already completed the task", "already_completed", 409);
    if (!p.active || !p.open) throw bad("The task is closed or full: reject the proof instead", "task_unavailable", 409);
    if (!p.user_ok) throw bad("The user is blocked: reject the proof instead", "user_blocked", 409);
    throw bad("Could not approve, please try again", "conflict", 409);
  }
  await audit({ actorId: id, action: "taskproof.approve", targetType: "task_proof", targetId: pid, after: { user: String(r[0].telegram_id), points: Number(r[0].points_change) } });
  return { id: pid, status: "approved", reward: Number(r[0].points_change) };
};

export const adminTaskProofReject = async ({ id, body }) => {
  const pid = posInt(body.id), reason = cleanText(body.reason, 200);
  if (!pid || reason.length < 3) throw bad("A reason (min 3 characters) is required");
  const r = await sql`UPDATE task_proofs SET status='rejected', reject_reason=${reason}::text, reviewed_by=${id}::bigint, reviewed_at=NOW()
    WHERE id=${pid}::bigint AND status='pending' RETURNING id, task_id`;
  if (!r.length) throw bad("This proof was already reviewed", "invalid_state", 409);
  await audit({ actorId: id, action: "taskproof.reject", targetType: "task_proof", targetId: pid, reason });
  return { id: pid, status: "rejected" };
};
