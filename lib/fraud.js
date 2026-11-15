// Phase 2 / Part 5: fraud flags. A flag is a QUESTION for a human, never a verdict:
// nothing in this file blocks, freezes, debits or rejects anything. (A test enforces that.)
// Pure rule functions (rows in -> flags out) are separated from the SQL so thresholds and de-duplication are unit-testable.
import { sql } from "./db.js";

export const RULES = ["same_wallet", "referral_burst", "rapid_claims"];
export const RULE_LABELS = { same_wallet: "Same wallet on several accounts", referral_burst: "Referral burst", rapid_claims: "Rapid task claims" };
export const MAX_FLAGS_PER_SCAN = 200;
const SCAN_HOURS = 48; // the daily cron looks back 2 days, so one missed run loses nothing

const int = (v, d) => { const n = Number(v); return Number.isSafeInteger(n) && n > 0 ? n : d; };

/** rows: [{ wallet, source:'withdrawal'|'deposit', users:[id,...] }] -> one flag per user per wallet. */
export function walletFlags(rows, { min = 2 } = {}) {
  const out = [];
  for (const r of rows || []) {
    const users = [...new Set((r.users || []).map(String))];
    if (!r.wallet || users.length < int(min, 2)) continue;
    for (const u of users) out.push({
      rule: "same_wallet", userId: u, severity: users.length >= 3 ? "high" : "medium",
      key: `wallet:${r.source}:${String(r.wallet).toLowerCase()}:${u}`,
      details: { wallet: r.wallet, source: r.source, accounts: users.length, other_users: users.filter(x => x !== u).slice(0, 10) },
    });
  }
  return out;
}

/** rows: [{ user_id, bucket, n, first_at, last_at }] (tumbling windows of `minutes`) -> flags at or above `count`. */
export function burstFlags(rows, { count = 10, minutes = 30 } = {}) {
  const c = int(count, 10);
  return (rows || []).filter(r => Number(r.n) >= c).map(r => ({
    rule: "referral_burst", userId: String(r.user_id), severity: Number(r.n) >= c * 2 ? "high" : "medium",
    key: `burst:${r.user_id}:${r.bucket}`,
    details: { referrals: Number(r.n), window_minutes: int(minutes, 30), first_at: r.first_at, last_at: r.last_at },
  }));
}

export function claimFlags(rows, { count = 15, minutes = 10 } = {}) {
  const c = int(count, 15);
  return (rows || []).filter(r => Number(r.n) >= c).map(r => ({
    rule: "rapid_claims", userId: String(r.user_id), severity: Number(r.n) >= c * 2 ? "high" : "medium",
    key: `rapid:${r.user_id}:${r.bucket}`,
    details: { claims: Number(r.n), window_minutes: int(minutes, 10), first_at: r.first_at, last_at: r.last_at },
  }));
}

/** Read-only detection queries + flag insert. Safe to run any number of times: dedupe_key is UNIQUE. */
export async function runFraudScan(cfg) {
  const minUsers = int(cfg.fraudWalletMinUsers, 2), bCount = int(cfg.fraudBurstCount, 10), bMin = int(cfg.fraudBurstMinutes, 30),
    cCount = int(cfg.fraudClaimsCount, 15), cMin = int(cfg.fraudClaimsMinutes, 10);
  const [wd, dp, bu, cl] = await Promise.all([
    sql`SELECT lower(wallet_address) AS wallet, 'withdrawal'::text AS source, ARRAY_AGG(DISTINCT telegram_id::text) AS users
        FROM withdrawals WHERE wallet_address IS NOT NULL AND status <> 'cancelled'
        GROUP BY 1 HAVING COUNT(DISTINCT telegram_id) >= ${minUsers}::int LIMIT 100`,
    sql`SELECT lower(from_address) AS wallet, 'deposit'::text AS source, ARRAY_AGG(DISTINCT telegram_id::text) AS users
        FROM deposits WHERE from_address IS NOT NULL AND status <> 'rejected'
        GROUP BY 1 HAVING COUNT(DISTINCT telegram_id) >= ${minUsers}::int LIMIT 100`,
    sql`SELECT referrer_id::text AS user_id, floor(extract(epoch FROM qualified_at) / (${bMin}::int * 60))::bigint AS bucket,
               COUNT(*)::int AS n, MIN(qualified_at) AS first_at, MAX(qualified_at) AS last_at
        FROM referral_events WHERE qualified_at > NOW() - (${SCAN_HOURS}::int * INTERVAL '1 hour') AND referrer_id IS NOT NULL
        GROUP BY 1, 2 HAVING COUNT(*) >= ${bCount}::int LIMIT 100`,
    sql`SELECT telegram_id::text AS user_id, floor(extract(epoch FROM created_at) / (${cMin}::int * 60))::bigint AS bucket,
               COUNT(*)::int AS n, MIN(created_at) AS first_at, MAX(created_at) AS last_at
        FROM task_completions WHERE created_at > NOW() - (${SCAN_HOURS}::int * INTERVAL '1 hour')
        GROUP BY 1, 2 HAVING COUNT(*) >= ${cCount}::int LIMIT 100`,
  ]);
  const flags = [...walletFlags([...wd, ...dp], { min: minUsers }), ...burstFlags(bu, { count: bCount, minutes: bMin }), ...claimFlags(cl, { count: cCount, minutes: cMin })]
    .slice(0, MAX_FLAGS_PER_SCAN);
  const created = { same_wallet: 0, referral_burst: 0, rapid_claims: 0 };
  for (const f of flags) {
    const r = await sql`INSERT INTO fraud_flags(rule,telegram_id,severity,details,dedupe_key)
      VALUES(${f.rule}::text,${f.userId}::bigint,${f.severity}::text,${JSON.stringify(f.details)}::jsonb,${f.key}::text)
      ON CONFLICT(dedupe_key) DO NOTHING RETURNING id`;
    if (r.length) created[f.rule]++;
  }
  return { found: flags.length, created, new_flags: created.same_wallet + created.referral_burst + created.rapid_claims };
}
