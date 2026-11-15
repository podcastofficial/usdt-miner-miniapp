// BSC (BEP-20) on-chain deposit verification. Pure evaluation logic is separated from the RPC call so it can be unit-tested.
import { HttpError } from "./http.js";
import { USDT_DECIMALS } from "./config.js";

export const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"; // keccak256("Transfer(address,address,uint256)")
const DEFAULT_USDT = "0x55d398326f99059fF775485246999027B3197955";

export const isAddress = (a) => /^0x[a-fA-F0-9]{40}$/.test(String(a || ""));
export const isTxHash = (h) => /^0x[a-fA-F0-9]{64}$/.test(String(h || ""));
const topicAddr = (t) => "0x" + String(t || "").slice(-40).toLowerCase();

async function rpc(method, params) {
  const url = process.env.BSC_RPC_URL || "https://bsc-dataseed.binance.org/";
  const r = await fetch(url, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(8000),
  }).then(x => x.json()).catch(() => null);
  if (!r || r.error) throw new HttpError(503, "chain_unavailable", "Blockchain check is temporarily unavailable");
  return r.result;
}

/** raw token units (BigInt) -> USDT with 8 decimals (BigInt, rounded down) */
export function unitsToUsdt8(units, decimals = USDT_DECIMALS) {
  const d = BigInt(decimals);
  return d >= 8n ? units / 10n ** (d - 8n) : units * 10n ** (8n - d);
}
export const fmt8 = (n8) => `${n8 / 100000000n}.${(n8 % 100000000n).toString().padStart(8, "0")}`;
/** USDT (8-dec BigInt) -> integer Points (rounded down) */
export const pointsFromUsdt8 = (n8, ppu) => Number(n8 * BigInt(ppu) / 100000000n);

/**
 * Decide what a transaction receipt means for a deposit.
 * state: "pending" (not mined / not enough confirmations yet) | "rejected" (final, with reason) | "verified".
 * Only Transfer logs emitted by the USDT contract, from the declared sender to the deposit wallet, count.
 */
export function evaluateReceipt(receipt, latestBlock, { wallet, contract, from, minUnits, minConfirmations }) {
  if (!receipt) return { state: "pending", reason: "not_found" };
  if (receipt.status !== "0x1") return { state: "rejected", reason: "tx_failed" };
  const w = wallet.toLowerCase(), c = contract.toLowerCase(), f = from.toLowerCase();
  let total = 0n;
  for (const l of receipt.logs || []) {
    if (l.removed || String(l.address).toLowerCase() !== c) continue;
    if (!Array.isArray(l.topics) || l.topics.length !== 3 || String(l.topics[0]).toLowerCase() !== TRANSFER_TOPIC) continue;
    if (topicAddr(l.topics[2]) !== w || topicAddr(l.topics[1]) !== f) continue;
    try { total += BigInt(l.data); } catch { /* malformed log -> ignore */ }
  }
  if (total === 0n) return { state: "rejected", reason: "no_matching_transfer" };
  if (total < minUnits) return { state: "rejected", reason: "below_minimum", amountUnits: total };
  const block = Number(BigInt(receipt.blockNumber));
  const confirmations = Math.max(0, Number(latestBlock) - block + 1);
  if (confirmations < minConfirmations) return { state: "pending", reason: "confirming", confirmations, blockNumber: block, amountUnits: total };
  return { state: "verified", confirmations, blockNumber: block, amountUnits: total };
}

export async function verifyDeposit(hash, from, cfg) {
  const wallet = cfg.depositWallet, contract = process.env.USDT_BEP20_CONTRACT || DEFAULT_USDT;
  if (!isAddress(wallet)) throw new HttpError(503, "deposits_unconfigured", "Deposit wallet is not configured");
  const [receipt, latest] = await Promise.all([rpc("eth_getTransactionReceipt", [hash]), rpc("eth_blockNumber", [])]);
  const minUnits = BigInt(Math.round(cfg.minDepositUsdt * 100)) * 10n ** BigInt(USDT_DECIMALS - 2);
  const r = evaluateReceipt(receipt, Number(BigInt(latest)), { wallet, contract, from, minUnits, minConfirmations: cfg.depositConfirmations });
  if (r.amountUnits !== undefined) {
    const n8 = unitsToUsdt8(r.amountUnits);
    r.amountUsdt = fmt8(n8); r.points = pointsFromUsdt8(n8, cfg.pointsPerUsdt);
    delete r.amountUnits;
  }
  return r;
}
