# USDT Miner Telegram Mini App — Fresh Launch

Fresh database and registration. This does NOT connect to or modify the existing Bots.Business bot. Existing users and balances are not imported.

## Stack
- Telegram Mini App frontend
- Vercel Node.js serverless API
- Neon PostgreSQL
- Telegram `initData` HMAC authentication

## Deploy
1. Create a Neon PostgreSQL database.
2. Run `db/schema.sql`, then `db/migrations/001_foundation.sql` `002_points_and_tasks.sql` and `003_referrals.sql` … `008_engagement.sql` (in order), in Neon SQL Editor.
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
- Weekly/monthly referral contests: **Part 4** (v1.11.0, ships OFF).
- Fraud flags, admin roles, CSV export, analytics, English / Hindi / Hinglish, light theme, health alerts: **Part 5** (v1.12.0).

## Launch
See `docs/DEPLOYMENT_GUIDE.md`, `docs/TEST_MATRIX.md` and `DEPLOYMENT_CHECKLIST.md`. Run `npm test` (146 tests).

## Important before real launch
This is a functional starter, not a completed audited financial platform. BEP-20 deposits are verified on-chain (`lib/chain.js`); auto-credit (`DEPOSITS_AUTO_CREDIT`) stays OFF until a small real test passes. Withdrawals create requests and require secure manual payout. Do not place private keys in GitHub or Vercel. Referral qualification and channel-join checks use Telegram `getChatMember`. Games, task proofs and contests ship OFF. Add backups, monitoring, terms and privacy policy before production.

## API actions
`bootstrap`, `referral`, `leaderboard`, `daily`, `taskComplete`, `withdraw`, `depositSubmit`, `campaignCreate`, `adminOverview`, plus (v1.8.0) `adminNotifyStatus`, `adminNotifyProcess`, `adminWebhookSetup`, `adminBroadcastCreate`, `adminBroadcastCancel`, plus (v1.9.0) `engagement`, `referralList`, `promoRedeem`, `adminPromoList`, `adminPromoCreate`, `adminPromoSetActive`, plus (v1.11.0) `taskProofSubmit`, `contests`, `adminTaskProofs`, `adminTaskProofApprove`, `adminTaskProofReject`, `adminContestList`, `adminContestCreate`, `adminContestCancel`, `adminContestPay`, plus (v1.12.0) `setLang`, `adminFraudList`, `adminFraudReview`, `adminFraudScan`, `adminRoles`, `adminRoleSet`, `adminRoleRemove`, `adminExport`, `adminAnalytics`, `adminHealth`, `adminHealthRun`. Server-to-server only: `tgWebhook`, `cron`.

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

### Part 2 — Engagement & Retention (v1.9.0) ✅ DONE
- Daily streak: 7-day ladder (starter 100 / 120 / 140 / 160 / 180 / 200 / 300), a missed day resets to day 1, shown on Home (**OFF** until you enable it)
- "My Referrals": paginated, masked names, All / Qualified / Pending filter
- Referral milestones at 5 / 10 / 50 qualified referrals, each paid once through the ledger (**OFF** until you enable it)
- Levels (Bronze → Silver → Gold, by lifetime earned Points) and 7 badges, on the new Rewards screen
- Promo codes: admin creates (reward, per-user limit, total limit, expiry), users redeem on the Rewards screen (**OFF** until you enable it)
- Admin > Promo tab; Admin > Settings > Engagement; Migration `008_engagement.sql`; no new env variables

### Part 3 — Games & Boosters (v1.10.0) ✅ DONE
- Games screen is live: Spin Wheel, Scratch Card, Lucky Box (prize drawn on the server with crypto-random and stored before it is shown) (**OFF** until you enable it)
- Daily free plays, optional Points entry fee (starts at 0), daily max plays and a per-user win cap; expected payout / house edge shown in Admin > Games
- Lucky Draw: Points = ticket, admin draws the winner (audited) or cancels with refunds (**OFF** until you enable it)
- Mining Boosters: Points-only, time-limited multiplier on the daily reward, one at a time (**OFF** until you enable it)
- Admin > Games tab; Admin > Settings > Games & Boosters; Migration `009_games.sql` (run it BEFORE redeploying); no new env variables
- Read the legal note in `CHANGELOG_PART10.md` before setting an entry fee or enabling the Lucky Draw

### Part 4 — Tasks, Ads & Contests (v1.11.0) ✅ DONE
- Bot / website tasks with a text proof + admin review queue (approve pays once)
- Ad delivery: every completion verified and counted, budget used, unused budget refunded once on stop / cancel, campaign finishes by itself
- Weekly / monthly / custom referral contests: live leaderboard, tie rule, admin payout (resumable, once per winner)
- Migration `010_tasks_ads_contests.sql` · details in `CHANGELOG_PART11.md`

### Part 5 — Safety, Admin & Growth (v1.12.0) ✅ DONE
- Fraud detection: multi-account patterns, shared wallet addresses, auto-flag + admin review
- Admin roles (Super admin / Support / Finance) with per-action permissions
- CSV export (users, withdrawals, deposits, ledger)
- Analytics dashboard: DAU, retention, referral conversion, Points in/out
- Multi-language (English / Hindi / Hinglish) + light theme
- Health alerts to admin on Telegram (errors, ledger mismatch, open withdrawals)
- Deposit auto-credit hardening (stays OFF until a small real test passes)
- Migration `011_safety_admin.sql`; no new env variables. Details: `CHANGELOG_PART12.md`


### Part 13 (v1.13.0) — Languages & CSP
- Run `db/migrations/012_languages.sql` in Neon BEFORE redeploying (9 languages: en, hi, es, ar, ru, pt, fr, tr, id; Hinglish users move to English)
- 7 new language files in `public/i18n/`, `hinglish.json` and `DELETE_THIS.txt` removed
- CSP unchanged on purpose: Monetag / Adsgram need `style-src 'unsafe-inline'` and `script-src https:` (a tighter CSP broke the ads)


### Part 14 (v1.14.0) — Wallet cooldown, Weekly Missions, Terms & Privacy
- New withdrawal wallet address waits 24 h (setting, `0` = off); old addresses are trusted by the migration
- Weekly Missions (**OFF** until enabled): daily streak / tasks / referrals + all-three bonus, paid once per week through the ledger
- Terms & Privacy screen with admin-editable texts; optional acceptance before the first withdrawal (**OFF** until enabled)
- Run `012_languages.sql` then `013_missions_terms_wallets.sql` BEFORE redeploying. Details: `CHANGELOG_PART14.md`
- New API actions: `missions`, `missionClaim`, `terms`, `termsAccept`

### Part 17.3 (v1.19.0) - Auto-Miner screen + admin
- Auto-Miner screen (More > Auto-Miner, and a card on Home when it is ON): shop, your miners with ready-to-claim MINER, one-tap claim, recent claims. Admin > Auto-Miner: report, add / edit / hide miner types, ROI check per type. **No migration** (backend is 17.2). Details: `CHANGELOG_PART17_3.md`

### Part 17.2 (v1.18.0) - Auto-Miner backend
- Passive mining machines bought with Points, claimed in one tap. Backend + API only (screen in 17.3). **OFF** until you enable it.
- Run `db/migrations/016_auto_miner.sql` BEFORE redeploying. New API actions: `autoMiner`, `autoMinerBuy`, `autoMinerClaim`, `adminAutoMinerOverview`, `adminAutoMinerPlanSave`, `adminAutoMinerPlanSetActive`. Details: `CHANGELOG_PART17.md`

