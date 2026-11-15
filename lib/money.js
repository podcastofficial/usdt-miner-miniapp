// Pure money helpers (no DB) - integer math only, so they are unit-testable.
/** "12.5" -> 1250 (cents). Strict: max 2 decimals, no signs/exponents. null when invalid. */
export function parseCents(raw) {
  const s = String(raw ?? "").trim();
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(s)) return null;
  const [i, f = ""] = s.split(".");
  const c = Number(i) * 100 + Number(f.padEnd(2, "0"));
  return Number.isSafeInteger(c) && c > 0 ? c : null;
}
export const fmtCents = (c) => `${Math.floor(c / 100)}.${String(c % 100).padStart(2, "0")}`;

/** Integer-only quote: gross amount -> Points to reserve, fee and net payout. */
export function quote(cents, { ppu, feePercent }) {
  const points = Math.round(cents * ppu / 100);
  const feeCents = Math.round(cents * feePercent / 100);
  const netCents = cents - feeCents;
  return { points, feeCents, netCents, amount: fmtCents(cents), fee: fmtCents(feeCents), net: fmtCents(netCents) };
}
