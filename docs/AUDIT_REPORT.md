# Source Audit Report (Phase 0) — baseline: uploaded `usdt-miner-miniapp-main.zip`

## What existed
Single `api/index.js` (all actions in one function), `lib/core.js`, `public/index.html` (all screens), `db/schema.sql` (11 tables).
Actions: bootstrap, referral, leaderboard, daily, taskComplete, withdraw, depositSubmit, campaignCreate, adminOverview, adminCreateTask.

## Findings (severity → status in Part 1)
| # | Severity | Finding | Status |
|---|----------|---------|--------|
| 1 | **Critical** | `credit()` updated the balance first, then inserted the ledger row with `ON CONFLICT DO NOTHING` — a duplicate reference still increased the balance (double credit) and update/insert were not atomic | **Fixed** (single atomic SQL statement, idempotent by `reference`) |
| 2 | **Critical** | `bot`/`website` tasks paid Points on a simple click (no proof) | **Blocked by default** (`ALLOW_UNVERIFIED_TASKS=false`); real verification in Part 2 |
| 3 | High | `withdraw`: `NaN` amount passed the minimum check; float math; Points debited before the request row was inserted (lost Points if insert failed) | **Hardened** (strict 2-decimal parsing, refund on failure). Full lifecycle in Part 4 |
| 4 | High | Raw DB/internal error messages returned to the client | **Fixed** (generic 500, details only in server logs) |
| 5 | High | No rate limiting | **Added** (per user+action, Postgres) |
| 6 | Medium | `CORS: *` although Mini App is same-origin | **Removed** |
| 7 | Medium | No audit log for admin actions | **Added** `admin_audit_logs` (used by task creation) |
| 8 | Medium | Deposit submit accepted any hash with no verification | **Disabled by default** (`DEPOSITS_ENABLED=false`); on-chain verifier in Part 4 |
| 9 | Medium | `.env.example` contained a real-looking admin ID | Replaced with placeholder |
| 10 | Medium | initData check: non-hex hash could throw, no future `auth_date` check, `localeCompare` sort | **Fixed** + 12 unit tests |
| 11 | Low | Referral reward never granted; link used `?start=ref_<id>` | Part 3 |
| 12 | Low | Mutating actions allowed on GET | **POST only** for write actions |
| 13 | Low | Guest outside Telegram saw a broken app | **Login-required screen** |

## Still open (scheduled)
Referral qualification + channel verification (P3) · on-chain BEP-20 deposit verification, withdrawal admin lifecycle, balance reservation policy (P4) · games, campaign delivery, payment proof, how-to (P5/6) · UI redesign (P7) · IP-based rate limiting / Vercel firewall, CSP, backups (P7).

## Items needing owner confirmation (not invented)
Daily reward value/timezone (starter: 500 Points, resets at Asia/Kolkata midnight) · task catalogue & proof rules · deposit minimum/confirmations · reserve-at-request vs deduct-at-approval · points expiry/negative balance/rounding · games · ad pricing/refunds · whether payment-proof stays · legal/KYC terms.
