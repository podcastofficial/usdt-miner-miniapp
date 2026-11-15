# Phase 2 / Part 2 — Engagement & Retention (v1.9.0)
## What's new
- **Daily streak**: claim on consecutive days; a missed day resets to day 1. 7-day ladder (starter 100 / 120 / 140 / 160 / 180 / 200 / 300, then it starts again). The streak row is written in the SAME atomic statement as the claim, balance and ledger entry. The ladder switch `streak_enabled` ships **OFF** (flat daily reward, streak still tracked); turning it ON needs no migration.
- **My Referrals**: paginated (20 per page), masked names, All / Qualified / Pending. The old unmasked list was removed from the `referral` action.
- **Referral milestones** 5 / 10 / 50 qualified referrals: paid once each (`milestones_paid` primary key + unique ledger reference `milestone:<id>:<n>`). Paid right after a referral qualifies and also when the inviter opens Rewards (catch-up). Ships **OFF**.
- **Levels & badges**: Bronze / Silver / Gold from lifetime earned Points (only Daily, Task, Referral, Milestone and Promo rewards count — never deposits, refunds or admin adjustments). 7 badges (7 / 30-day streak, 5 / 10 / 50 referrals, Silver, Gold), awarded by the server once.
- **Promo codes**: admin creates (reward, per-user limit 1-10, mandatory total limit, optional expiry). Redeem = slot row + counter + balance + ledger in one statement; per-user limit is enforced by `UNIQUE(code, telegram_id, n)`, the total limit by a table CHECK, so parallel requests cannot over-pay. 5 tries/min and 20 wrong codes per 12 h. Ships **OFF**.
- **New screen** Rewards (Home tile, More hub); streak card on Home; Admin > **Promo** tab; Admin > Settings > **Engagement**; Audit filter `promo`.
- **API**: `engagement`, `referralList`, `promoRedeem`, `adminPromoList`, `adminPromoCreate`, `adminPromoSetActive`. `daily` now also returns `streak` and `day`; `bootstrap.daily` includes a `streak` object.
- **Tests**: +25 (`tests/engagement.test.js`) → 92 passing.
## Upgrade
1. Neon SQL Editor: run `db/migrations/008_engagement.sql`.
2. Redeploy (no new env variables).
3. Admin > Settings > Engagement: review the starter values, then switch on what you want. See `docs/DEPLOYMENT_GUIDE.md` section 11.
## Owner confirmations needed (starter values, not decisions)
Streak ladder · milestone bonuses (500 / 1,500 / 10,000) · level thresholds (10,000 / 50,000) · whether promo codes go live.
## Not verified here (owner to do)
- No SQL was executed in this build (no Postgres in the build environment) and nothing was run against live Neon or Telegram. The unit tests cover the streak / level / badge / milestone / promo rules and statically check the SQL shape. Run rows 24-34 of `docs/TEST_MATRIX.md` with tiny amounts before enabling anything.
- The streak SQL (`daily`) mirrors `streakAfterClaim()` in `lib/engagement.js`; the first real two-day test (row 25) is what proves they agree.
- Streak is based on `daily_timezone` days; changing that setting mid-run can lengthen or break a streak once.
- Turning milestones ON is retroactive for inviters who already reached a milestone.
