# Go-live checklist
Tick in order. Anything marked **STOP** blocks launch.

## Build & config
- [ ] `npm install && npm test && npm run check` all green
- [ ] New Neon DB: `schema.sql` then migrations 001-007 applied
- [ ] Vercel env vars set (see `docs/DEPLOYMENT_GUIDE.md`); `git status` shows no `.env`
- [ ] Bot token belongs to the intended bot; admin Telegram IDs verified (numeric)
- [ ] Mini App URL set in BotFather; bot is admin in both official channels
- [ ] `/api?action=health` returns `{"ok":true,"db":true}`
- [ ] Response headers include the CSP (browser dev tools → Network) and the app still loads inside Telegram

## Bot notifications (v1.8.0)
- [ ] `TG_WEBHOOK_SECRET` and `CRON_SECRET` set; Admin → Notify shows webhook ✅ and both secrets ✅
- [ ] `/start` in the bot replies; broadcast to "Only me" arrives
- [ ] Bot is admin of the payments channel **before** turning `proof_autopost` ON

## Admin → Settings
- [ ] Withdrawal min/fee, rate, daily reward, referral reward confirmed
- [ ] Required channels, official/payments channel, support contact, bot username set
- [ ] Maintenance **off**; `ALLOW_UNVERIFIED_TASKS` still `false`

## Functional (small amounts) — see `docs/TEST_MATRIX.md` #1-14
- [ ] Auth, daily, tasks, referral, withdraw (approve/paid/reject/cancel), advertise create/cancel, proof, leaderboard, admin actions
- [ ] Deposits: **only** after a small real test deposit passes, then `DEPOSITS_ENABLED=true` + `DEPOSIT_WALLET_ADDRESS`; keep `DEPOSIT_AUTO_CREDIT=false` initially

## Money safety — **STOP** if any is unchecked
- [ ] No private key or seed anywhere in GitHub/Vercel/Neon
- [ ] Payout wallet is held offline/by a person; every payout is manual after admin approval
- [ ] Admin → Ledger check shows zero mismatches
- [ ] Neon backups/point-in-time restore enabled; you know how to restore

## Legal & trust — **STOP** until done (owner's decision, not code)
- [ ] Privacy policy and Terms published and linked in the official channel/bot
- [ ] Rules about earning, fees, withdrawals, bans and "Points are not a guaranteed value" written clearly
- [ ] Check the rules for operating a rewards/payout service in your country and for Telegram's Mini App terms
- [ ] Support contact monitored; someone is on call for the first week

- [ ] Part 4: migration `010` run; **Task proofs** and **Contests** still OFF until rows 51-66 of the test matrix passed

## Monitoring (first 48 hours)
- [ ] Vercel logs watched for `API error` lines; Admin dashboard checked at least daily (abuse flags, open withdrawals, ledger check)
- [ ] Know the kill switches: Settings → Withdrawals/Deposits/Advertising off, or Maintenance on
