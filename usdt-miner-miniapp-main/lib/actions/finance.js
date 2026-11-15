// Part 4: withdrawal lifecycle (quote -> reserve -> review -> payout hash) + on-chain BEP-20 deposits.
import { sql, isUniqueViolation } from "../db.js";
import { HttpError } from "../http.js";
import { audit } from "../audit.js";
import { getConfig } from "../runtime.js";
import { parseCents, quote, createWithdrawal, closeWithdrawalWithRefund, creditDeposit } from "../finance.js";
import { verifyDeposit, isAddress, isTxHash } from "../chain.js";
import { notifyWithdrawal, postProof } from "../notify.js";

const bad = (msg, code = "bad_request", status = 400) => new HttpError(status, code, msg);
const posInt = (v) => { const n = Number(v); return Number.isSafeInteger(n) && n > 0 ? n : null; };
const reasonText = (v) => String(v || "").trim().slice(0, 200);
const NOT_FOUND_EXPIRY_HOURS = 48;

export const financeInfo = async () => {
  const c = await getConfig(), depOn = c.depositsEnabled && isAddress(c.depositWallet);
  return {
    withdraw: { enabled: c.withdrawalsEnabled, min: c.minWithdrawUsdt, feePercent: c.withdrawFeePercent, pointsPerUsdt: c.pointsPerUsdt, maxOpen: c.maxOpenWithdrawals },
    deposit: { enabled: depOn, wallet: depOn ? c.depositWallet : null, network: "BSC (BEP-20)", min: c.minDepositUsdt, confirmations: c.depositConfirmations, pointsPerUsdt: c.pointsPerUsdt },
  };
};

// ---------------- withdrawals (user) ----------------
function priced(raw, c) {
  const cents = parseCents(raw);
  if (cents == null) throw bad("Enter a valid USDT amount (max 2 decimals)");
  if (cents < Math.round(c.minWithdrawUsdt * 100)) throw bad(`Minimum withdrawal is ${c.minWithdrawUsdt} USDT`, "below_minimum");
  return { cents, q: quote(cents, { ppu: c.pointsPerUsdt, feePercent: c.withdrawFeePercent }) };
}

export const withdrawQuote = async ({ row, body }) => {
  const c = await getConfig(), { q } = priced(body.amount, c);
  return { amount: q.amount, fee: q.fee, net: q.net, points: q.points, enough: Number(row.points) >= q.points };
};

export const withdraw = async ({ id, row, body }) => {
  const c = await getConfig();
  if (!c.withdrawalsEnabled) throw bad("Withdrawals are temporarily paused", "withdrawals_paused", 503);
  const wallet = String(body.wallet || "").trim();
  if (!isAddress(wallet)) throw bad("Valid BEP-20 wallet address required");
  const { q } = priced(body.amount, c);
  if (Number(row.points) < q.points) throw bad("Insufficient Points", "insufficient_points");
  const r = await createWithdrawal({ id, points: q.points, q, wallet, ppu: c.pointsPerUsdt, feePercent: c.withdrawFeePercent, maxOpen: c.maxOpenWithdrawals });
  if (!r) throw bad(`You already have ${c.maxOpenWithdrawals} open withdrawal requests, or your balance changed. Please try again later.`, "withdraw_rejected", 409);
  return { id: r.id, fee: q.fee, net: q.net, points: q.points, balance: r.balance, status: "pending" };
};

export const withdrawList = async ({ id }) => ({
  items: await sql`SELECT id,amount_usdt,fee_usdt,net_usdt,wallet_address,status,tx_hash,reject_reason,created_at,paid_at
    FROM withdrawals WHERE telegram_id=${id}::bigint ORDER BY id DESC LIMIT 20`,
});

export const withdrawCancel = async ({ id, body }) => {
  const wid = posInt(body.id);
  if (!wid) throw bad("Invalid request");
  const r = await closeWithdrawalWithRefund({ wid, to: "cancelled", ownerId: id, actorId: null, reason: "Cancelled by user" });
  if (!r) throw bad("Only pending requests can be cancelled", "not_cancellable", 409);
  return { id: r.id, status: "cancelled", balance: r.balance };
};

// ---------------- withdrawals (admin) ----------------
const WSTATUS = ["open", "pending", "approved", "paid", "rejected", "cancelled"];
export const adminWithdrawals = async ({ body }) => {
  const st = WSTATUS.includes(body.status) ? body.status : "open";
  const items = await sql`
    SELECT w.id,w.telegram_id,u.username,u.first_name,w.amount_usdt,w.fee_usdt,w.net_usdt,w.wallet_address,w.status,w.tx_hash,w.reject_reason,w.created_at
    FROM withdrawals w LEFT JOIN users u ON u.telegram_id=w.telegram_id
    WHERE (${st}::text='open' AND w.status IN ('pending','approved')) OR w.status=${st}::text
    ORDER BY w.id ASC LIMIT 50`;
  const tot = await sql`SELECT COALESCE(SUM(net_usdt) FILTER (WHERE status IN ('pending','approved')),0)::text AS owed_usdt FROM withdrawals`;
  return { items, owed_usdt: tot[0].owed_usdt };
};

export const adminWithdrawalApprove = async ({ id, body }) => {
  const wid = posInt(body.id);
  if (!wid) throw bad("Invalid request");
  const r = await sql`UPDATE withdrawals SET status='approved', reviewed_by=${id}::bigint, reviewed_at=NOW(), updated_at=NOW()
    WHERE id=${wid}::bigint AND status='pending' RETURNING id`;
  if (!r.length) throw bad("Request is not pending", "invalid_state", 409);
  await audit({ actorId: id, action: "withdrawal.approve", targetType: "withdrawal", targetId: wid, before: { status: "pending" }, after: { status: "approved" } });
  await notifyWithdrawal(wid, "approved"); // never throws
  return { id: wid, status: "approved" };
};

export const adminWithdrawalReject = async ({ id, body }) => {
  const wid = posInt(body.id), reason = reasonText(body.reason);
  if (!wid || reason.length < 3) throw bad("A reason (min 3 characters) is required");
  const r = await closeWithdrawalWithRefund({ wid, to: "rejected", actorId: id, reason, allowApproved: true });
  if (!r) throw bad("Request is already finalised", "invalid_state", 409);
  await audit({ actorId: id, action: "withdrawal.reject", targetType: "withdrawal", targetId: wid, reason, after: { status: "rejected", refunded: true } });
  await notifyWithdrawal(wid, "rejected");
  return { id: wid, status: "rejected" };
};

export const adminWithdrawalPaid = async ({ id, body }) => {
  const wid = posInt(body.id), hash = String(body.txHash || "").trim().toLowerCase();
  if (!wid || !isTxHash(hash)) throw bad("Valid payout transaction hash required");
  try {
    const r = await sql`UPDATE withdrawals SET status='paid', tx_hash=${hash}::text, paid_at=NOW(), reviewed_by=${id}::bigint, updated_at=NOW()
      WHERE id=${wid}::bigint AND status='approved' RETURNING id`;
    if (!r.length) throw bad("Request must be approved first", "invalid_state", 409);
  } catch (e) {
    if (isUniqueViolation(e)) throw bad("This payout hash is already used on another withdrawal", "duplicate_tx", 409);
    throw e;
  }
  await audit({ actorId: id, action: "withdrawal.paid", targetType: "withdrawal", targetId: wid, before: { status: "approved" }, after: { status: "paid", tx_hash: hash } });
  await notifyWithdrawal(wid, "paid");
  await postProof(wid);
  return { id: wid, status: "paid", tx_hash: hash };
};

// ---------------- deposits ----------------
/** Run the on-chain check for one deposit row and move it to the right state. Safe to call repeatedly. */
async function processDeposit(dep, c) {
  const res = await verifyDeposit(dep.tx_hash, dep.from_address, c);
  const info = { reason: res.reason || null, confirmations: res.confirmations ?? null, amount_usdt: res.amountUsdt || null, points: res.points ?? null };
  if (res.state === "pending") {
    const expired = res.reason === "not_found" && Date.now() - new Date(dep.created_at).getTime() > NOT_FOUND_EXPIRY_HOURS * 3600e3;
    if (expired) {
      await sql`UPDATE deposits SET status='rejected', reject_reason='not_found_expired', last_checked_at=NOW() WHERE id=${dep.id}::bigint AND status='pending'`;
      return { status: "rejected", ...info, reason: "not_found_expired" };
    }
    await sql`UPDATE deposits SET last_checked_at=NOW(), confirmations=${res.confirmations ?? null}::int WHERE id=${dep.id}::bigint AND status='pending'`;
    return { status: "pending", ...info };
  }
  if (res.state === "rejected") {
    await sql`UPDATE deposits SET status='rejected', reject_reason=${res.reason}::text, last_checked_at=NOW() WHERE id=${dep.id}::bigint AND status='pending'`;
    return { status: "rejected", ...info };
  }
  // verified on-chain
  await sql`UPDATE deposits SET status='verified', amount_usdt=${res.amountUsdt}::numeric, block_number=${res.blockNumber}::bigint, confirmations=${res.confirmations}::int,
      verification=${JSON.stringify({ amount_usdt: res.amountUsdt, points: res.points })}::jsonb, verified_at=NOW(), last_checked_at=NOW()
    WHERE id=${dep.id}::bigint AND status='pending'`;
  if (c.depositAutoCredit) {
    const c = await creditDeposit({ did: dep.id, points: res.points });
    if (c) return { status: "confirmed", ...info, balance: c.balance };
  }
  return { status: "verified", ...info };
}
const safeProcess = async (dep) => {
  try { return await processDeposit(dep, await getConfig()); }
  catch (e) { if (e instanceof HttpError && e.status === 503) return { status: "pending", reason: e.code }; throw e; }
};

export const depositSubmit = async ({ id, body }) => {
  const c = await getConfig();
  if (!c.depositsEnabled || !isAddress(c.depositWallet)) throw bad("Deposits are not enabled yet", "deposits_disabled", 503);
  const hash = String(body.txHash || "").trim().toLowerCase(), from = String(body.from || "").trim().toLowerCase();
  if (!isTxHash(hash)) throw bad("Valid BSC transaction hash required");
  if (!isAddress(from)) throw bad("Enter the wallet address you sent the USDT from");
  let dep;
  try {
    dep = (await sql`INSERT INTO deposits(telegram_id,tx_hash,from_address,status) VALUES(${id}::bigint,${hash},${from},'pending') RETURNING id,tx_hash,from_address,created_at`)[0];
  } catch (e) { if (isUniqueViolation(e)) throw bad("This transaction hash was already submitted", "duplicate_tx", 409); throw e; }
  return { id: dep.id, ...(await safeProcess(dep)) };
};

export const depositRecheck = async ({ id, body }) => {
  const did = posInt(body.id);
  if (!did) throw bad("Invalid request");
  const dep = (await sql`SELECT id,tx_hash,from_address,created_at,status FROM deposits WHERE id=${did}::bigint AND telegram_id=${id}::bigint`)[0];
  if (!dep) throw bad("Deposit not found", "not_found", 404);
  if (dep.status !== "pending") return { id: did, status: dep.status };
  return { id: did, ...(await safeProcess(dep)) };
};

export const depositList = async ({ id }) => ({
  items: await sql`SELECT id,tx_hash,status,amount_usdt,points_credited,confirmations,reject_reason,created_at
    FROM deposits WHERE telegram_id=${id}::bigint ORDER BY id DESC LIMIT 20`,
});

export const adminDeposits = async ({ body }) => {
  const st = ["pending", "verified", "confirmed", "rejected"].includes(body.status) ? body.status : "verified";
  return { items: await sql`SELECT d.id,d.telegram_id,u.username,u.first_name,d.tx_hash,d.from_address,d.status,d.amount_usdt,d.verification,d.confirmations,d.reject_reason,d.created_at
    FROM deposits d LEFT JOIN users u ON u.telegram_id=d.telegram_id WHERE d.status=${st}::text ORDER BY d.id ASC LIMIT 50` };
};

export const adminDepositApprove = async ({ id, body }) => {
  const did = posInt(body.id);
  if (!did) throw bad("Invalid request");
  const d = (await sql`SELECT verification FROM deposits WHERE id=${did}::bigint AND status='verified'`)[0];
  const points = Number(d?.verification?.points);
  if (!d || !Number.isSafeInteger(points) || points <= 0) throw bad("Only on-chain verified deposits can be approved", "invalid_state", 409);
  const c = await creditDeposit({ did, points, actorId: id });
  if (!c) throw bad("Deposit already processed", "invalid_state", 409);
  await audit({ actorId: id, action: "deposit.approve", targetType: "deposit", targetId: did, after: { status: "confirmed", points } });
  return { id: did, status: "confirmed", points };
};

export const adminDepositReject = async ({ id, body }) => {
  const did = posInt(body.id), reason = reasonText(body.reason);
  if (!did || reason.length < 3) throw bad("A reason (min 3 characters) is required");
  const r = await sql`UPDATE deposits SET status='rejected', reject_reason=${reason}::text, reviewed_by=${id}::bigint, reviewed_at=NOW()
    WHERE id=${did}::bigint AND status IN ('pending','verified') RETURNING id`;
  if (!r.length) throw bad("Deposit already finalised", "invalid_state", 409);
  await audit({ actorId: id, action: "deposit.reject", targetType: "deposit", targetId: did, reason, after: { status: "rejected" } });
  return { id: did, status: "rejected" };
};
