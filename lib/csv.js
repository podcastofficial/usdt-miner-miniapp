// Phase 2 / Part 5: CSV building. Pure. Two jobs: RFC 4180 quoting, and neutralising spreadsheet formula injection
// (a username like =HYPERLINK(...) must not run when an admin opens the file in Excel / Sheets).
const NUMBER = /^-?\d+(\.\d+)?$/;
const FORMULA = /^[=+\-@\t\r]/;

export function csvCell(v) {
  if (v === null || v === undefined) return "";
  let s = v instanceof Date ? v.toISOString() : typeof v === "object" ? JSON.stringify(v) : String(v);
  if (typeof v !== "number" && !NUMBER.test(s) && FORMULA.test(s)) s = "'" + s; // plain numbers (even negative) are safe and stay numbers
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/** columns = [[header, key], ...]; rows = array of objects. CRLF line ends, UTF-8 BOM so Excel reads Hindi names correctly. */
export function toCsv(columns, rows) {
  const head = columns.map(([h]) => csvCell(h)).join(",");
  const body = rows.map(r => columns.map(([, k]) => csvCell(r[k])).join(","));
  return "﻿" + [head, ...body].join("\r\n") + "\r\n";
}

export const EXPORT_MAX_ROWS = 5000;
export const DATASETS = {
  users: { file: "users", cols: [["telegram_id", "telegram_id"], ["username", "username"], ["first_name", "first_name"], ["points", "points"], ["blocked", "is_blocked"], ["verified", "membership_verified"], ["referrer_id", "referrer_id"], ["language", "user_lang"], ["joined", "created_at"], ["last_active", "last_active_at"]] },
  withdrawals: { file: "withdrawals", cols: [["id", "id"], ["telegram_id", "telegram_id"], ["amount_usdt", "amount_usdt"], ["fee_usdt", "fee_usdt"], ["net_usdt", "net_usdt"], ["wallet", "wallet_address"], ["status", "status"], ["tx_hash", "tx_hash"], ["created", "created_at"], ["reviewed", "reviewed_at"]] },
  deposits: { file: "deposits", cols: [["id", "id"], ["telegram_id", "telegram_id"], ["amount_usdt", "amount_usdt"], ["from_address", "from_address"], ["tx_hash", "tx_hash"], ["status", "status"], ["created", "created_at"], ["reviewed", "reviewed_at"]] },
  ledger: { file: "ledger", cols: [["id", "id"], ["telegram_id", "telegram_id"], ["type", "type"], ["points_change", "points_change"], ["balance_after", "balance_after"], ["description", "description"], ["reference", "reference"], ["created", "created_at"]] },
};
export const isDataset = (d) => Object.prototype.hasOwnProperty.call(DATASETS, d);
