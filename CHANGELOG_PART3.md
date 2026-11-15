# Part 3 of 7 — Referral
## How it works
1. Each user has a unique `referral_code`. Link: `https://t.me/<BOT>/<MINIAPP_SHORT_NAME>?startapp=ref_<CODE>` (or `https://t.me/<BOT>?startapp=ref_<CODE>` if you use the bot's Main Mini App). The code arrives inside Telegram-signed `start_param`.
2. **Capture:** on a user's FIRST registration only, the inviter is stored in `users.referrer_id`. Never re-attributed. Self-referral and blocked inviters are rejected.
3. **Qualification:** the referred user taps *Verify* → server checks `getChatMember` for every channel in `settings.required_channels` (@USDTMinerUpdates, @USDTMinerPayments).
4. **Reward:** only after all channels verify, the inviter gets `settings.referral_reward` (1,000 Points). Event row (UNIQUE `referred_id`) + balance + ledger entry are ONE atomic statement → paid exactly once.
5. **Abuse log:** ≥10 qualified referrals for one inviter within an hour → `abuse_events` row (logged for admin review; not auto-blocked, because the old bot's cap rules were never specified).
## New / changed
`db/migrations/003_referrals.sql`, `lib/referral.js`, `lib/telegram.js`, `lib/actions/referral.js`, `lib/refcode.js` (parseRefParam), router, bootstrap (`has_referrer`, `verify_needed`), frontend (verify banner on Home, Share button, referral list), `tests/referral.test.js` (15 tests total pass).
Admin API: `adminAbuseEvents`.
## Upgrade
1. Neon: run `003_referrals.sql`. 2. Vercel env: `MINIAPP_SHORT_NAME` (BotFather → /newapp short name; leave empty for Main Mini App). 3. **Add the bot as ADMIN of both required channels** (needed for getChatMember). 4. Redeploy.
## Not changed / open
Old-bot referral rules never specified (re-attribution, reversal, per-user cap) were NOT invented: no reversal if the friend later leaves a channel; no cap. Bot `/start ref_` deep links need a webhook and are not part of this flow.
