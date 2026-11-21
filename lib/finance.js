// Part 4: money helpers (pure) + atomic state transitions. Every balance change is ONE SQL statement
// (state change + balance + ledger row), so Points can never be lost or paid twice.
import { sql } from "./db.js";
export { parseCents, fmtCents, quote } from "./money.js";

/** Reserve Points + create the withdrawal + ledger row atomically. Returns null if the guard failed (balance / open-request limit). */
export async function createWithdrawal({ id, points, q, wallet, ppu, feePercent, maxOpen }) {
  const r = await sql`
    WITH u AS (
      UPDATE users SET points=users.points-${points}::bigint
      WHERE telegram_id=${id}::bigint AND points>=${points}::bigint AND is_blocked=FALSE
        AND (SELECT COUNT(*) FROM withdrawals x WHERE x.telegram_id=${id}::bigint AND x.status IN ('pending','approved')) < ${maxOpen}::int
      RETURNING telegram_id, points AS bal),
    w AS (
      INSERT INTO withdrawals(telegram_id,amount_usdt,fee_usdt,net_usdt,wallet_address,points,points_per_usdt,fee_percent,status)
      SELECT telegram_id,${q.amount}::numeric,${q.fee}::numeric,${q.net}::numeric,${wallet}::text,${points}::bigint,${ppu}::int,${feePercent}::numeric,'pending' FROM u
      RETURNING id, telegram_id),
    t AS (
      INSERT INTO transactions(telegram_id,type,points_change,balance_after,description,reference)
      SELECT u.telegram_id,'Withdrawal',-${points}::bigint,u.bal,'Withdrawal request','wdreq:'||w.id::text FROM u JOIN w ON w.telegram_id=u.telegram_id
      RETURNING 1)
    SELECT w.id, u.bal FROM w JOIN u ON u.telegram_id=w.telegram_id`;
  return r.length ? { id: r[0].id, balance: Number(r[0].bal) } : null;
}

/**
 * Close a withdrawal as cancelled/rejected AND give the reserved Points back, atomically + idempotently
 * (ledger reference wdrefund:<id>). ownerId limits it to the user's own request; allowApproved lets an admin reject an approved one.
 */
export async function closeWithdrawalWithRefund({ wid, to, actorId = null, ownerId = null, reason = null, allowApproved = false }) {
  const r = await sql`
    WITH w AS (
      UPDATE withdrawals SET status=${to}::text, reject_reason=${reason}::text, reviewed_by=${actorId}::bigint, reviewed_at=NOW(), updated_at=NOW()
      WHERE id=${wid}::bigint AND (status='pending' OR (${allowApproved}::boolean AND status='approved'))
        AND (${ownerId}::bigint IS NULL OR telegram_id=${ownerId}::bigint)
      RETURNING id, telegram_id, points AS wpoints),
    u AS (
      UPDATE users SET points=users.points+w.wpoints FROM w WHERE users.telegram_id=w.telegram_id
      RETURNING users.telegram_id, users.points AS bal, w.wpoints AS refund, w.id AS wid),
    t AS (
      INSERT INTO transactions(telegram_id,type,points_change,balance_after,description,reference)
      SELECT telegram_id,'Withdrawal Refund',refund,bal,'Withdrawal #'||wid::text||' '||${to}::text,'wdrefund:'||wid::text FROM u
      RETURNING 1)
    SELECT u.wid, u.bal FROM u`;
  return r.length ? { id: r[0].wid, balance: Number(r[0].bal) } : null;
}

/** Credit a verified on-chain deposit exactly once (status verified -> confirmed + balance + ledger, one statement). */
export async function creditDeposit({ did, points, actorId = null, amountUsdt = null }) {
  const r = await sql`
    WITH d AS (
      UPDATE deposits SET status='confirmed', amount_usdt=COALESCE(${amountUsdt}::numeric,amount_usdt), points_credited=${points}::bigint, credited_at=NOW(), reviewed_by=${actorId}::bigint, reviewed_at=NOW()
      WHERE id=${did}::bigint AND status IN ('verified','pending') RETURNING id, telegram_id),
    u AS (
      UPDATE users SET points=users.points+${points}::bigint FROM d WHERE users.telegram_id=d.telegram_id
      RETURNING users.telegram_id, users.points AS bal, d.id AS did),
    t AS (
      INSERT INTO transactions(telegram_id,type,points_change,balance_after,description,reference)
      SELECT telegram_id,'Deposit',${points}::bigint,bal,'USDT deposit #'||did::text,'dep:'||did::text FROM u
      RETURNING 1)
    SELECT u.did, u.bal FROM u`;
  return r.length ? { id: r[0].did, balance: Number(r[0].bal) } : null;
}
