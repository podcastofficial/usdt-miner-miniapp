# Part 17.1 - MINER value in USDT (v1.17.0)
- New settings in Admin > Settings > "MINER Value": "Show MINER value in USDT" (ON) and "Price of 1 MINER (USDT)" (default 0.0001 = 10,000 MINER per USDT).
- Display only. Withdrawals are still paid in MINER. No migration needed.
- USDT estimate (≈) now shown next to MINER on: Home balance + rate pill, Tasks, History, Daily/streak/booster, Referral, Withdraw (balance, minimum, quote, list), Games, Ads, Leaderboard, Payment proof, and reward toasts.
- Fixed: the Deposit screen said "Minimum 1 MINER"; the minimum deposit is in USDT, now shows "Minimum X USDT · 1 USDT = 10,000 MINER".
- Next: 17.2 = Auto-Miner backend (DB + API), 17.3 = Auto-Miner screen + admin.

# Part 17.2 - Auto-Miner backend (v1.18.0)
Passive mining machines bought with Points (MINER). **Backend only** (DB + API): the Auto-Miner screen and the admin screen come in 17.3, so nothing changes for users yet. The feature ships **OFF**.
- Run `db/migrations/016_auto_miner.sql` in Neon BEFORE redeploying (safe to run twice). Creates `auto_miner_plans`, `auto_miners`, `auto_miner_buys`, `auto_miner_claims` and 4 starter machines.
- How it works: a machine mines `rate_per_hour` Points for `duration_days`. Earnings are computed from the last claim time (no cron, no per-tick rows). A machine stores `auto_miner_storage_hours` (default 24) of earnings, then pauses until the user claims.
- Whole Points only, rounded DOWN. The unpaid fraction stays in the machine (claim time moves by exactly the time that was paid). A machine copies price / rate / length when bought, so editing a plan never changes machines already running.
- New API actions: `autoMiner` (screen data), `autoMinerBuy` (POST, `plan_id`), `autoMinerClaim` (POST, claims all machines at once); admin (permission `rewards`, audited): `adminAutoMinerOverview`, `adminAutoMinerPlanSave`, `adminAutoMinerPlanSetActive`.
- Buy and claim are each ONE atomic statement (balance + machine rows + ledger). Limits are enforced on locked rows, so parallel taps cannot over-buy or double-claim. Ledger types: `Auto-Miner Purchase`, `Auto-Miner Reward`.
- New settings, Admin > Settings > Auto-Miner: `auto_miner_enabled` (OFF), `auto_miner_storage_hours` (24). `bootstrap` now returns `auto_miner: { enabled }` for the Home card.
- Per plan: price (0 = free machine), Points per hour, lifetime in days, and **max purchases per user over their lifetime** (race-safe counter).
- **Owner decisions before switching ON:** every Point a machine pays is a Point the app creates (1 Point = 1 MINER). The starter plans return 144% / 158% / 173% of their price (Starter is free: 336 Points in total), so check them with `adminAutoMinerOverview` (shows ROI per plan, Points spent vs paid, and the most that can still be paid out). A free machine is an abuse target for multi-accounts: keep Admin > Safety fraud scan ON.
- No SQL could be run in the build sandbox (no Postgres): the maths is pinned by a BigInt model + a 300-case property test, and the statements by structure tests. Run the new rows of the test matrix with tiny numbers before enabling.
- Changed: `api/index.js`, `lib/roles.js`, `lib/ratelimit.js`, `lib/settingsDefs.js`, `lib/actions/core.js`, `public/app.js` (2 History icons), `package.json`. New: `lib/autominer.js`, `lib/actions/autominer.js`, `db/migrations/016_auto_miner.sql`, `tests/autominer.test.js`.
- Next: 17.3 = Auto-Miner screen + admin screen.
