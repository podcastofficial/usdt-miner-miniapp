# Part 5 of 7 — Admin panel (every option managed from the app)
Admins (Telegram IDs in `ADMIN_TELEGRAM_IDS`) get an **🛡 Admin** tab in the Mini App. Every call is re-checked on the server and every change is written to `admin_audit_logs`.
## Tabs
- **📊 Home** — users, new/active 24h, blocked, Points in wallets (≈ USDT), open withdrawals + USDT owed, paid out, deposits to review, campaigns pending, referrals, abuse flags. Buttons: Ledger check, Abuse events, Server check.
- **💸 Withdraw / ⬇️ Deposits** — queues with filters. Approve / Reject (refund) / Mark paid (payout hash); deposit Approve / Reject.
- **👤 Users** — search by Telegram ID, @username or name; profile, ledger, withdrawals, deposits, referral stats; **Block / Unblock** (reason required; admins can't be blocked); **Adjust Points** (+/−, reason required, goes through the ledger).
- **📋 Tasks** — create, **edit** (title, description, link, reward, target, timer, channel), enable/disable.
- **📢 Campaigns** — pending queue. **Approve** → becomes a live task. **Reject** (pending) / **Cancel** (active) → unspent budget refunded to the advertiser atomically.
- **⚙️ Settings** — all options below, validated server-side, saved all-or-nothing, effective within ~3 s.
- **🧾 Audit** — filterable, paginated log of every admin action (before/after).
## Settings now managed from the panel
Withdrawals on/off · Points per USDT · min withdrawal · fee % · max open requests per user · Deposits on/off · deposit wallet · auto-credit · min deposit · confirmations · daily reward · referral reward · daily reset timezone · required channels · bot username · Mini App short name · **maintenance mode** (blocks everyone except admins) · **announcement banner**.
Still in Vercel env on purpose (secrets): `DATABASE_URL`, `BOT_TOKEN`, `ADMIN_TELEGRAM_IDS`, `BSC_RPC_URL`, `USDT_BEP20_CONTRACT`. The Settings tab shows which of them are set (✅/❌, never the values).
## Important: precedence changed
A value saved in the `settings` table now **overrides** the env var of the same purpose (env is only the fallback when no row exists). The original `schema.sql` already seeded `points_per_usdt=10000`, `min_withdraw_usdt=15`, `withdraw_fee_percent=10`. If you had set different values in env, open ⚙️ Settings once and enter them there.
## Files
New: `db/migrations/005_admin.sql`, `lib/settingsDefs.js`, `lib/runtime.js`, `lib/actions/admin.js`, `public/admin.js`, `tests/settings.test.js`, this file.
Changed: `api/index.js` (admin routes, maintenance gate), `lib/actions/finance.js` + `lib/chain.js` + `lib/actions/referral.js` (read live settings), `lib/ratelimit.js`, `public/index.html` (Admin nav tab, announcement), `.env.example`, `package.json`, docs.
## Upgrade
1. Neon: run `005_admin.sql`. 2. Redeploy. 3. Open the app → **Admin → Settings** → check the values (especially deposit wallet and anything you customised in env).
## Notes
- Admin list itself stays in `ADMIN_TELEGRAM_IDS` (env) so a compromised database can't create admins.
- SQL was reviewed but, as in Part 4, not run against a live Neon DB in this build — test one campaign approve/reject, one Points adjustment and one settings save first.
