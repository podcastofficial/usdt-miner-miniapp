# USDT Miner Parts 19–27 — Cumulative changed-files patch

This ZIP is laid out from the project root. Extract it into the existing `usdt-miner-miniapp-main` folder and merge/overwrite when prompted.

## Database order

Run these migrations in the Neon SQL Editor in this exact order, before deploying:

1. `db/migrations/017_part19_retention.sql`
2. `db/migrations/018_part20_vip.sql`
3. `db/migrations/019_part21_support_season.sql`
4. `db/migrations/020_part22_admin_ops.sql`
5. `db/migrations/021_part23_risk_scores.sql`
6. `db/migrations/022_part24_premium.sql`
7. `db/migrations/023_part25_mining_reports.sql`
8. `db/migrations/024_part26_referral_challenges.sql`
9. `db/migrations/025_part27_analytics_reports.sql`

## Important

- `api/index.js` is the API router and must replace the existing `api/index.js`.
- The settings registry and role permissions are updated in `lib/settingsDefs.js` and `lib/roles.js`.
- Keep a backup before replacing files.
- Mystery Box, referral commission accrual, Season Pass, Premium, and Referral Challenges default OFF. Part 20's 1% referral commission remains a ledger foundation only; this patch does not accrue or pay commissions.
- Part 23 uses explainable rules, not an AI model. It never auto-blocks accounts.
- Part 24 Premium purchases use in-app Points only. No external payment provider or recurring billing is included.
- Part 25 adds reporting only; mining and booster payout calculations are unchanged.
- Part 21 Season Pass remains a status-only foundation; there is no reward claim flow.
- Frontend screens are not included in this patch. These are backend/API additions and must be connected to the app UI before users can operate the features in-app.
- Run `npm test` and `npm run check` after merging. Test against a staging database before production.

## Optional separate frontend pages (Parts 22–27)

The separate frontend patch adds `public/parts-admin.html`, `public/parts-admin.js`, `public/parts-user.html`, `public/parts-user.js`, and `public/parts-ui.css`. It does **not** modify `public/index.html`.

After copying these five files into the matching `public/` folder and deploying, open `/parts-admin.html` (admin tools) or `/parts-user.html` (user dashboard) inside the Telegram Mini App. Both pages use Telegram WebApp `initData` and the existing `/api?action=...` routes. The server remains responsible for authentication and role permissions. The user page displays premium, mining history, and referral challenges; the admin page displays notes, segments, risk scoring, premium tier management, mining reports, challenges, and analytics.
