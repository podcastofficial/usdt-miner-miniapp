# Phase 2 / Part 1 — Bot Notifications & Broadcast (v1.8.0)
## What's new
- **Bot webhook** `/api?action=tgWebhook`: accepted only with Telegram's secret-token header (`TG_WEBHOOK_SECRET`, constant-time check). Handles `/start` (welcome + Open button) and block/unblock events, so the bot knows who it can message. Admin → Notify → *Set / refresh webhook* registers it in one tap.
- **User notifications** (queued, one per event, never duplicated): withdrawal approved / paid (BscScan link) / rejected (reason + refund), referral joined (+Points to inviter), optional daily reward reminder.
- **Admin broadcast**: plain-text message to All / Active 7 days / Users with Points / New 24h / Only me (test). Sent in batches (*Send next batch*), cancellable, with sent / skipped / failed counts. One broadcast at a time.
- **Payment-proof auto-post** to the payments channel when a withdrawal is marked paid (masked name, BscScan link, posted once). Starts OFF.
- **Daily cron** (`vercel.json`, 03:30 UTC): queues reminders (if ON) and sends up to 100 waiting messages. Protected by `CRON_SECRET`.
- **Settings > Notifications**: `notify_withdrawal`, `notify_referral`, `notify_reminder` (OFF), `proof_autopost` (OFF), `broadcast_enabled`.
- **Admin > Notify tab** and audit entries `broadcast.create`, `broadcast.cancel`, `notify.webhook_set`.
- **Safety**: notification failures never break a withdrawal / referral (all hooks are try/catch); all user text is HTML-escaped; Telegram 429 is respected; users who blocked the bot are skipped; rows stuck in "sending" are recovered after 5 minutes.
- **Tests**: +14 (`tests/notify.test.js`) → 67 passing.
## Upgrade
1. Neon SQL Editor: run `db/migrations/007_notifications.sql`.
2. Vercel env: add `TG_WEBHOOK_SECRET`, `CRON_SECRET`; deploy.
3. Admin → Notify → Set / refresh webhook. Then follow `docs/DEPLOYMENT_GUIDE.md` section 10.
## Not verified here (owner to do)
- Nothing was run against live Neon or Telegram (SQL was not executed in this build, only unit tests). Run manual rows 17-23 of `docs/TEST_MATRIX.md` with tiny amounts and a broadcast to "Only me".
- The "daily cron queues reminders for users who have not claimed" query uses your `daily_timezone`; check one reminder arrives at the expected time.
- Sending is at-least-once: in a rare crash between Telegram accepting a message and the DB update, a user could get one message twice.
