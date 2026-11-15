# Deployment guide (fresh launch)

## 1. Accounts
Neon (PostgreSQL), Vercel, GitHub, Telegram BotFather. Use a **new** Neon database and the bot you want users to see. This app does not touch the old Bots.Business bot.

## 2. Database (Neon SQL Editor, in this order)
1. `db/schema.sql`
2. `db/migrations/001_foundation.sql` → `002_points_and_tasks.sql` → `003_referrals.sql` → `004_finance.sql` → `005_admin.sql` → `006_community.sql`

All migrations are idempotent (safe to re-run). Part 7 adds **no** migration.

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
