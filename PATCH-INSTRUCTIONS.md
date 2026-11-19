# USDT Miner Parts 19–21 — Correct Folder Patch

Extract this ZIP into the existing project directory and choose **merge/overwrite** if asked.

The archive already uses the project's actual folder structure:
- `api/index.js` — replace the existing API router
- `lib/actions/` — add the three new action modules
- `db/migrations/` — add migrations 017, 018, 019
- `tests/` — add the new test file
- project root — add the three changelogs

IMPORTANT:
1. Do not upload `index.js` to the project root. It is placed at `api/index.js` in this archive.
2. Run migrations 017, 018, then 019 in the Neon SQL editor before deploying.
3. Keep a backup of the existing project first.
4. Features remain disabled by default. The 1% referral commission accrual is only a foundation and is not automatically paid.
