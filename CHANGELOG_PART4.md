# Part 4 of 7 — Finance
## Withdrawals (lifecycle: pending → approved → paid | rejected | cancelled)
1. `withdrawQuote` shows fee / net / Points before submit (integer math only, no floats).
2. `withdraw` **reserves** the Points at request time: balance debit + withdrawal row + ledger entry are ONE atomic SQL statement (no lost Points). Max `MAX_OPEN_WITHDRAWALS` (3) open requests per user.
3. User can cancel while `pending` → Points refunded atomically (ledger ref `wdrefund:<id>`, idempotent).
4. Admin: `adminWithdrawals` (queue + total owed), `adminWithdrawalApprove`, `adminWithdrawalReject` (reason required, Points refunded), `adminWithdrawalPaid` (payout tx hash required, unique — one hash can't close two requests). Every action is written to `admin_audit_logs`; state changes are compare-and-set, so double-clicks / two admins can't double-process.
## Deposits (BEP-20 USDT, verified on-chain)
1. User sends USDT to `DEPOSIT_WALLET_ADDRESS`, then submits tx hash + the wallet they sent **from**.
2. `lib/chain.js` reads the receipt from `BSC_RPC_URL` and only counts `Transfer` logs from the USDT contract, from that sender, to your wallet. Failed tx / wrong token / wrong recipient / wrong sender / below `MIN_DEPOSIT_USDT` → rejected. Fewer than `DEPOSIT_CONFIRMATIONS` blocks → stays pending (user taps Recheck). Never-appearing hashes expire after 48 h.
3. Verified deposits are **not auto-credited** by default: they wait for admin approval (`adminDepositApprove`). Set `DEPOSIT_AUTO_CREDIT=true` to credit automatically. Credit = status change + balance + ledger in ONE statement, exactly once (ref `dep:<id>`).
## Files
New: `db/migrations/004_finance.sql`, `lib/chain.js`, `lib/money.js`, `lib/finance.js`, `lib/actions/finance.js`, `tests/finance.test.js`.
Changed: `api/index.js`, `lib/config.js`, `lib/ratelimit.js`, `lib/actions/legacy.js` (withdraw/deposit moved out), `public/index.html` (quote, withdrawal list + cancel, deposit screen, minimal admin queues), `.env.example`, `package.json`, docs.
## Upgrade
1. Neon: run `004_finance.sql`. 2. Vercel env: see `.env.example` (Part 4 block). 3. Redeploy. 4. Deposits stay OFF until `DEPOSITS_ENABLED=true` **and** `DEPOSIT_WALLET_ADDRESS` is set.
## Assumptions (owner to confirm — not specified in the old bot)
- Withdrawals reserve Points at request time (not at approval).
- 1 USDT deposited = `POINTS_PER_USDT` Points (same rate as withdrawal).
- Min deposit 5 USDT, 15 confirmations (~45 s on BSC).
- Payouts are sent manually by the admin; the app records the payout hash.
## Known limits
- A deposit tx hash and sender are public on-chain: someone could submit another person's hash with that person's address first. That's why auto-credit is OFF by default; review before approving.
- SQL statements were reviewed but not run against a live Neon DB in this build — run the migration and test one small withdraw + deposit first.
