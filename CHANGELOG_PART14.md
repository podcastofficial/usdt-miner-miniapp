# Part 14 (v1.14.0): wallet cooldown, weekly missions, Terms & Privacy

## Upgrade (in this order)
1. Run `db/migrations/012_languages.sql`, then `db/migrations/013_missions_terms_wallets.sql` in Neon (both are safe to run twice). BEFORE redeploying.
2. Redeploy.
3. Admin > Settings: look at the new groups **Withdrawals**, **Weekly Missions**, **Legal**.

## 1. New wallet waiting time (account-takeover protection)
- A wallet address the user never used before must age **24 hours** before a withdrawal can go to it (Admin > Settings > Withdrawals > *New wallet waiting time*, `0` = off).
- The timer starts with the first attempt. The user sees how long is left.
- Addresses from earlier withdrawals are trusted from their first use (migration backfill), so nobody is locked out after the update.
- Table `wallet_addresses`. The original `first_seen_at` is never overwritten.

## 2. Weekly Missions (starts OFF)
- Three goals counted from Monday 00:00 in the daily-reward time zone: **claim the daily reward on 5 days**, **complete 10 tasks**, **get 3 qualified referrals**; plus a **bonus** for claiming all three.
- All targets and rewards are editable (Admin > Settings > Weekly Missions). Bonus `0` = no bonus.
- Progress is read from tables the app already has (ledger, task completions, referral events). A reward is a ledger row with the unique reference `mission:<week>:<mission>:<user>`, so it is paid **once per week** even if the button is tapped twice.
- Ledger type `Mission Reward` (counts for levels, has its own History icon). New screen: More > Weekly Missions.

## 3. Terms & Privacy
- New screen More > Terms & Privacy (and a link on the Withdraw screen). Texts are edited in Admin > Settings > Legal. The defaults are a **template, not legal advice**: have them checked for your country.
- Optional: *Require accepting Terms before withdrawing* (OFF by default). When ON, the first withdrawal sends the user to the Terms screen; after **I agree** they return to Withdraw. Raise *Terms version* after you change the texts to ask everybody again.
- Settings got a new type `longtext` (multi-line editor in the admin panel).

## Files
New: `db/migrations/013_missions_terms_wallets.sql`, `lib/walletGuard.js`, `lib/terms.js`, `lib/missions.js`, `lib/actions/missions.js`, `lib/actions/terms.js`, `tests/part14.test.js`.
Changed: `api/index.js`, `lib/actions/finance.js`, `lib/settingsDefs.js`, `lib/ratelimit.js`, `lib/engagement.js`, `public/index.html`, `public/app.js`, `public/admin.js`, `public/styles.css`, `public/i18n/*.json` (4 new keys), `package.json`, README.
New API actions: `missions`, `missionClaim`, `terms`, `termsAccept`.
