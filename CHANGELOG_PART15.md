# Part 15 — Leaderboard privacy + referral counts

- Leaderboard now hides other users' names (e.g. `Cr***`); a user still sees their own full name.
- Each leaderboard row shows how many qualified referrals that user has (👥 12 referrals).
- Two new switches in Admin > Settings > Leaderboard (both ON by default):
  - `leaderboard_mask_names`
  - `leaderboard_show_referrals`
- No database migration needed. Changed: `lib/settingsDefs.js`, `lib/actions/community.js`, `public/app.js`, `public/styles.css`; new test `tests/leaderboard.test.js`.
