# USDT Miner Telegram Mini App — Fresh Launch

Fresh database and registration. This does NOT connect to or modify the existing Bots.Business bot. Existing users and balances are not imported.

## Stack
- Telegram Mini App frontend
- Vercel Node.js serverless API
- Neon PostgreSQL
- Telegram `initData` HMAC authentication

## Deploy
1. Create a Neon PostgreSQL database.
2. Run `db/schema.sql`, then `db/migrations/001_foundation.sql` `002_points_and_tasks.sql` and `003_referrals.sql` … `007_notifications.sql` (in order), in Neon SQL Editor.
3. Upload this project to a new GitHub repository.
4. Import repository into Vercel.
5. Add environment variables from `.env.example`.
6. Deploy and configure the HTTPS Mini App URL with BotFather.
7. Open through Telegram, not a normal browser.

## Existing rules retained
- 10,000 Points = 1 USDT
- Minimum withdrawal 15 USDT
- 10% withdrawal fee
- BEP-20
- Referral reward target 1,000 Points
- Required channels: @USDTMinerUpdates and @USDTMinerPayments
- Weekly/monthly referral contests are planned in **Part 4** of the next phase (see below).

## Launch
See `docs/DEPLOYMENT_GUIDE.md`, `docs/TEST_MATRIX.md` and `DEPLOYMENT_CHECKLIST.md`. Run `npm test` (67 tests).

## Important before real launch
This is a functional starter, not a completed audited financial platform. Deposit hashes are queued for admin review; **automatic BEP-20 on-chain verification is not implemented**. Withdrawals create requests and require secure manual payout. Do not place private keys in GitHub or Vercel. Referral rewards are not yet granted because qualifying channel-join verification and referral attribution need a separate Telegram webhook flow. Bot/website task claims need stronger verification before awarding meaningful Points. Games are informational placeholder only. Advertising campaign creation reserves Points, but the full campaign delivery/verification workflow is not yet complete. Add rate limits, idempotent DB transactions, monitoring, backups, terms and privacy policy before production.

## API actions
`bootstrap`, `referral`, `leaderboard`, `daily`, `taskComplete`, `withdraw`, `depositSubmit`, `campaignCreate`, `adminOverview`, plus (v1.8.0) `adminNotifyStatus`, `adminNotifyProcess`, `adminWebhookSetup`, `adminBroadcastCreate`, `adminBroadcastCancel`. Server-to-server only: `tgWebhook`, `cron`.

## Security
Only Telegram Mini App signed initData is accepted. Admin IDs are set in `ADMIN_TELEGRAM_IDS`. Never commit `.env`.

## Project status
Built in 7 parts (all done, v1.7.0) — see `docs/ROADMAP_7_PARTS.md`, `docs/AUDIT_REPORT.md` and `CHANGELOG_PART1.md`.
Structure: `api/index.js` (router) · `lib/` (auth, db, ledger, ratelimit, audit, config) · `lib/actions/` · `db/` · `tests/`.
New flag: `DEPOSITS_ENABLED` (default off). Daily reward (100) and its time zone live in the `settings` table. Run tests: `npm test`.


---

## Next phase — 5 parts (v1.8.0 → v1.12.0)
Each part is a cumulative update (changed files + one new migration + tests + changelog). Full details: `docs/ROADMAP_5_PARTS.md`.
Rule for every part: new options live in Admin > Settings (default OFF where money/abuse risk), every reward goes through the atomic ledger, `npm test` must stay green.

### Part 1 — Bot Notifications & Broadcast (v1.8.0) ✅ DONE
- Telegram bot webhook (`/api?action=tgWebhook`, secret-token protected; one-tap setup in Admin > Notify)
- User notifications: withdrawal approved / paid / rejected, referral joined, daily-reward reminder
- Admin broadcast (all users or segment: active 7d, with balance, new users) with queue + rate-safe sending
- Auto-post paid withdrawals to the Payment Proof channel
- Admin > Settings > Notifications toggles; Admin > Notify tab (queue, broadcasts, webhook)
- Daily cron (`vercel.json`) queues reminders and drains the queue
- Migration `007_notifications.sql`; new env `TG_WEBHOOK_SECRET`, `CRON_SECRET`

### Part 2 — Engagement & Retention (v1.9.0)
- Daily streak bonus (day 1-7 ladder, resets on a missed day)
- "My Referrals" list + referral milestones (5 / 10 / 50 friends bonus)
- Achievements / badges and user levels (Bronze → Gold)
- Promo / redeem codes (admin creates; limit per user, total limit, expiry)
- Migration `008_engagement.sql`

### Part 3 — Games & Boosters (v1.10.0)
- Games screen goes live: Spin Wheel, Scratch Card, Lucky Box (server-side random, never client-side)
- Daily play limits + Points entry cost options, house-edge shown in Admin
- Weekly Lucky Draw (Points = ticket, winner picked and logged by admin action)
- Mining Boosters (Points-only, time-limited multiplier on daily reward)
- Migration `009_games.sql`

### Part 4 — Tasks, Ads & Contests (v1.11.0)
- Bot / website task verification (proof upload + admin review queue, optional postback)
- Ad campaign delivery: campaigns appear in Tasks, completions verified, budget used up and refunded when done
- Weekly / monthly referral contests with leaderboard and admin payout of prizes
- Migration `010_tasks_ads_contests.sql`

### Part 5 — Safety, Admin & Growth (v1.12.0)
- Fraud detection: multi-account patterns, shared wallet addresses, auto-flag + admin review
- Admin roles (Super admin / Support / Finance) with per-action permissions
- CSV export (users, withdrawals, deposits, ledger)
- Analytics dashboard: DAU, retention, referral conversion, Points in/out
- Multi-language (English / Hindi / Hinglish) + light theme
- Health alerts to admin on Telegram (errors, ledger mismatch, open withdrawals)
- Deposit auto-credit hardening (stays OFF until a small real test passes)
- Migration `011_safety_admin.sql`
