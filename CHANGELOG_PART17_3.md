# Part 17.3 - Auto-Miner screen + admin (v1.19.0)
The Auto-Miner backend from 17.2 now has its screens. **No migration** (`016_auto_miner.sql` from 17.2 is still the only one). The feature stays OFF until you turn it on in Admin > Settings > Auto-Miner.

## User side
- **More > Auto-Miner** screen. A **Home card** appears only while Auto-Miner is ON.
- Top card: MINER ready to claim (with ≈ USDT), mining rate per hour, balance, and one **Claim** button (disabled when nothing is ready).
- **Your miners**: each running machine with its rate, time left, ready amount, and a warning when its storage is full.
- **Shop**: each miner type with price (or Free), MINER per hour, lifetime, and how many the user owns. Buy asks for confirmation. Buttons are disabled when the user cannot afford it or has reached the per-user limit.
- **Recent claims** list.
- Shows "not open yet" when the feature is OFF.

## Admin side
- New **Auto-Miner** tab (permission `rewards`, same as Games / Promo / Contests).
- Report: machines running, users with a running machine, MINER per hour now, machines sold, MINER spent / paid out, net created, still owed (max, unclaimed), last 24 h.
- Add, edit, show / hide miner types. The form enforces the same limits as the server (`validatePlanInput`).
- Each miner type shows per-day, total, profit, ROI, payback, and a warning when it pays back more than its price.
- Edits only affect future purchases, as on the server.

## Files
Changed: `public/index.html`, `public/app.js`, `public/admin.js`, `public/styles.css` (one rule so `.acts` button rows wrap), `package.json` (1.19.0), `README.md`.
New: `CHANGELOG_PART17_3.md`, `tests/part17b.test.js` (wiring, CSP, permission checks).

## Not changed
Backend (`api/index.js`, `lib/actions/autominer.js`, `lib/autominer.js`), the SQL migration, the settings, and the roles file are unchanged. The server already had every action the screens need.

## Before switching it ON
Check the ROI column in Admin > Auto-Miner. A machine pays Points that the app creates, so keep Admin > Safety fraud scan ON (free machines are an abuse target). Test one purchase and one claim with tiny numbers first.
