# Part 1 of 7 — Foundation
## New files
lib/config.js, lib/http.js, lib/db.js, lib/auth.js, lib/refcode.js, lib/users.js, lib/ratelimit.js, lib/audit.js, lib/ledger.js,
lib/actions/core.js, lib/actions/legacy.js, db/migrations/001_foundation.sql, tests/auth.test.js, docs/AUDIT_REPORT.md, docs/ROADMAP_7_PARTS.md
## Changed
api/index.js (router), public/index.html (login gate + safer api()), package.json, vercel.json, .env.example, README.md
## Removed
lib/core.js (split into the modules above)
## Upgrade steps
1. Neon SQL Editor → run `db/migrations/001_foundation.sql` (after `db/schema.sql` if the DB is new).
2. Vercel env: add `INITDATA_MAX_AGE_SECONDS=86400`, `DEPOSITS_ENABLED=false`, `ALLOW_UNVERIFIED_TASKS=false`; set real `ADMIN_TELEGRAM_IDS`.
3. Redeploy; open inside Telegram. `npm test` → 12 passing.
