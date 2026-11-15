# Deployment guide (fresh launch)

## 1. Accounts
Neon (PostgreSQL), Vercel, GitHub, Telegram BotFather. Use a **new** Neon database and the bot you want users to see. This app does not touch the old Bots.Business bot.

## 2. Database (Neon SQL Editor, in this order)
1. `db/schema.sql`
2. `db/migrations/001_foundation.sql` → `002_points_and_tasks.sql` → `003_referrals.sql` → `004_finance.sql` → `005_admin.sql` → `006_community.sql` → `007_notifications.sql`

All migrations are idempotent (safe to re-run). Upgrading from v1.7.0: run only `007_notifications.sql`.

## 3. GitHub
Create a private repo and push this folder. `.gitignore` now excludes `.env`, `.env.*` (except `.env.example`), `node_modules` and `*.zip`. Run `git status` once and confirm no `.env` is listed.

## 4. Vercel
Import the repo. Framework preset: Other. Add the env vars below (Production), then deploy.

| Variable | Value |
|---|---|
| `DATABASE_URL` | Neon connection string (`sslmode=require`) |
| `BOT_TOKEN` | token of the bot that opens the Mini App |
| `ADMIN_TELEGRAM_IDS` | comma-separated numeric Telegram IDs of admins |
| `BOT_USERNAME` | bot username without `@` |
| `MINIAPP_SHORT_NAME` | BotFather `/newapp` short name, or empty for the bot's Main Mini App |
| `DEPOSITS_ENABLED` | `false` until the deposit test below passes |
| `DEPOSIT_WALLET_ADDRESS` | receive-only BEP-20 address (never a private key) |
| `DEPOSIT_AUTO_CREDIT` | `false` at first |
| `TG_WEBHOOK_SECRET` | any long random string (A-Z a-z 0-9 _ -). Only Telegram knows it |
| `CRON_SECRET` | any long random string. Vercel sends it to the daily cron |
| other values | defaults in `.env.example` are fine |

Never put a private key, seed phrase or wallet password in GitHub or Vercel.

## 5. BotFather
`/newapp` (or Bot Settings → Menu Button) → set the Mini App URL to `https://<your-project>.vercel.app`. Set the bot as **admin** in `@USDTMinerUpdates` and `@USDTMinerPayments` (needed for join verification), and in each advertiser channel that runs a channel campaign.

## 6. First-run configuration (in the app: Admin → Settings)
Check withdrawal min/fee, rates, required channels, official/payments channel, support link, bot username, announcement. Keep maintenance mode **off**.

## 7. Health check
`https://<project>.vercel.app/api?action=health` → `{"ok":true,"db":true}`. Anything else: check `DATABASE_URL`.

## 8. Security headers
`vercel.json` sets a strict Content-Security-Policy (no inline scripts or styles, scripts only from this site and `telegram.org`, API only to this site, embedding only by Telegram), plus HSTS, `nosniff`, no-referrer and a locked-down Permissions-Policy. If you add a new external script, image host or font, you must add it to the CSP, otherwise the browser will block it.

## 9. Rollback
Vercel → Deployments → previous deployment → **Promote to Production**. Database changes are additive, so old code keeps working. To stop money movement at once: Admin → Settings → turn Withdrawals / Deposits / Advertising off, or switch Maintenance on (admins stay in).

## 10. Bot notifications (v1.8.0)
1. Add `TG_WEBHOOK_SECRET` and `CRON_SECRET` in Vercel, redeploy.
2. Open the app as admin → **Admin → Notify → Set / refresh webhook**. It must show ✅ Connected. Send `/start` to the bot: it should reply with an **Open** button.
3. **Admin → Settings → Notifications**: withdrawal and referral messages are ON; daily reminder and auto-post to the payments channel start **OFF**. For auto-post the bot must be an admin of the payments channel.
4. Test a broadcast with **Only me** first. Large broadcasts are sent in batches: press **Send next batch** until Waiting is 0. The daily cron (03:30 UTC) also sends up to 100 waiting messages and queues reminders. Vercel Hobby allows one cron run per day; on Pro you can change the schedule in `vercel.json`.
5. Telegram only lets a bot message users who started it. Others are marked Skipped and are not tried again until they press Start.

## 11. Engagement & Retention (v1.9.0)
1. Neon SQL Editor: run `db/migrations/008_engagement.sql` (safe to run twice). No new Vercel env variables. Redeploy.
2. **Admin → Settings → Engagement**. Streak ladder, Referral milestone bonuses and Promo codes all start **OFF**; Levels and badges are always on (they pay nothing).
3. Before enabling, confirm the starter numbers (they are suggestions, not decisions): ladder 100/120/140/160/180/200/300, milestone bonuses 500 / 1,500 / 10,000 Points, Silver at 10,000 and Gold at 50,000 lifetime earned Points.
4. Turning **Referral milestone bonuses** ON also pays inviters who already passed 5 / 10 / 50 qualified referrals (once, the next time they open the app). Check your numbers first.
5. **Admin → Promo**: a total redeem cap is required. Worst-case cost = reward × total redeems, shown when you create the code. Run rows 24-34 of `docs/TEST_MATRIX.md` with tiny numbers before announcing anything.

## 12. Games & Boosters (v1.10.0)
1. Neon SQL Editor: run `db/migrations/009_games.sql` (safe to run twice). **Do this BEFORE redeploying**: the daily claim now reads `users.booster_until`. No new Vercel env variables. Redeploy.
2. **Admin → Settings → Games & Boosters**. Games, Lucky Draw and Mining Boosters all start **OFF**. The entry fee starts at 0 (free plays only).
3. **Admin → Games**: review the starter prize tables. Expected payout per play is Spin 11.6, Scratch 4.65, Box 9.75 Points, and every free play is Points you create. Edit weights / prizes until you are happy. At least 1 prize must stay active per game.
4. Turn on in this order, testing each with tiny numbers: Games (free plays only) → Mining Boosters → Lucky Draw. Set free plays, daily max and the win cap before you switch Games ON.
5. **Legal**: Points can be withdrawn as USDT. Before you set an **entry fee above 0** or switch the **Lucky Draw** (paid tickets) ON, check what your local law says about games of chance and lotteries. Run rows 35-50 of `docs/TEST_MATRIX.md` first.
6. Lucky Draw: create the draw (Admin → Games), set a sales end date, and after it ends press **Draw winner** (type DRAW). One draw can be open at a time. **Cancel + refund** returns every ticket.

## 13. Tasks with proof, Ads & Contests (v1.11.0)
1. Neon SQL Editor: run `db/migrations/010_tasks_ads_contests.sql` (safe to run twice). **Do this BEFORE redeploying**: the task claim now reads `campaigns.spent`. No new Vercel env variables. Redeploy.
2. **Admin → Settings → Tasks, Ads & Contests**. Task proofs and Contests start **OFF**.
3. Proof tasks: Admin → Tasks → set "Proof required" and tell users what to send in the hint. Turn **Tasks that need a proof** ON and review **Admin → Task proofs** daily. Keep rewards small: a proof is text and an admin judges it.
4. Ads: nothing to switch. Approved bot / website campaigns become proof tasks only while proofs are ON; channel campaigns are checked by Telegram (the bot must be admin in the advertiser's channel).
5. Contests: Admin → Contests → create one, then switch **Referral contests** ON. Prizes are Points the app creates: check the total. After the end date type `PAY`. Run rows 51-66 of `docs/TEST_MATRIX.md` with tiny numbers first.

## 14. Safety, Admin & Growth (v1.12.0)
1. Neon SQL Editor: run `db/migrations/011_safety_admin.sql` (safe to run twice). **Do this BEFORE redeploying**: the dashboard now counts `fraud_flags` and the app reads `users.user_lang`. No new Vercel env variables. Redeploy.
2. **Roles.** You (the IDs in `ADMIN_TELEGRAM_IDS`) stay super admins. To add a helper: they open the app once, then Admin → Roles → their Telegram ID → **support** (users, tasks, campaigns, proofs, flags) or **finance** (withdrawals, deposits, ledger, export, analytics, audit). Roles cannot touch Settings, Points adjustment, broadcasts or contest / game payouts.
3. **Fraud flags.** Admin → Safety → **Scan now**. Settings → Safety & Alerts → **Automatic fraud scan** is OFF; switch it ON to let the daily cron scan (about 03:30 UTC). Flags only ask you to look; nobody is blocked.
4. **Health alerts** are ON: admins get a Telegram message on API errors, a ledger mismatch, or when open withdrawals reach the alert level (default 20). Each admin must have pressed Start on the bot once. Use Admin → Home → **Check + alert admins** to test.
5. **Deposits auto-credit** can only be switched ON after one real deposit has been approved by hand (the Settings save is refused otherwise).
6. **Language / theme**: users pick them in More → Settings. Dark stays the default.
7. Run rows 67-90 of `docs/TEST_MATRIX.md` with tiny numbers first.

