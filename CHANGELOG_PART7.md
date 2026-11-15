# Part 7 of 7 — Premium UI + Launch
## What's new
- **Black + Orange 3D design** (already in the Part 6 zip's `styles.css`/`index.html`/`app.js`; completed and verified here): 3D coin hero, raised buttons, bevelled cards, orange glow nav.
- **Admin panel is CSP-safe**: every `onclick`/`onchange`/inline style/injected `<style>` removed; buttons use `data-adm` with one delegated listener that can only call real `Admin` methods. Admin styles moved to `styles.css`. Modal is now a real dialog (labelled fields, focus moves in, Esc closes, focus returns).
- **Strict Content-Security-Policy** + HSTS, Permissions-Policy, cache revalidation for JS/CSS (`vercel.json`).
- **Bug fixes**: admin filter dropdowns (withdrawals/deposits/campaigns/audit) reset on every refresh; `.gitignore` contained a literal `\n`, so `.env` was **not** ignored; heading focus ring showed after navigating; More-menu titles ran into subtitles.
- **Accessibility**: labels on all admin fields, ARIA tabs, skip link, 44px targets, AA contrast, reduced-motion and high-contrast support (all enforced by tests).
- **Tests**: +17 (`tests/frontend.test.js`) → 53 passing.
- **Docs**: `docs/DEPLOYMENT_GUIDE.md`, `docs/TEST_MATRIX.md`, rewritten `DEPLOYMENT_CHECKLIST.md`.
- Removed the stray `usdt-miner-part2-of-7.zip` / `part3` files from the repo; `*.zip` is now git-ignored. Version 1.7.0.
## Upgrade
No database migration. Extract over your repo, deploy, then open the app inside Telegram and confirm it loads (the CSP is strict; if something external you added stops working, allow it in `vercel.json`).
## Not verified here (owner to do)
- Nothing was run against live Neon, Telegram or BSC. Run the manual rows of `docs/TEST_MATRIX.md` with tiny amounts.
- Privacy policy, Terms and local-law review are the owner's responsibility (see checklist).
- Admin UI was checked in headless Chromium with a mocked API, not on real phones or screen readers.
