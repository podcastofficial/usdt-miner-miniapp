# Parts 22–27 separate frontend pages

## Files
- `public/parts-admin.html` — admin operations page
- `public/parts-admin.js` — admin API integration
- `public/parts-user.html` — user dashboard page
- `public/parts-user.js` — user API integration
- `public/parts-ui.css` — shared responsive styling

## Install
Copy all five files into the existing project's `public/` directory, preserving their names. Do not replace or edit `public/index.html`.

Deploy the project. Open `/parts-admin.html` or `/parts-user.html` from inside the Telegram Mini App so Telegram provides signed `initData`. Direct browser access outside Telegram will not authenticate. API permissions are still enforced server-side.

## Notes
- Admin analytics generates and saves a 30-day report when opened.
- Mining report generates and stores a snapshot when opened.
- Premium membership purchases use app Points only.
- Referral challenge claims require the feature to be enabled and the target to be met.
- The backend feature flags remain off by default; enable the relevant settings in the existing admin Settings screen before expecting premium/challenges to be available.
- `index.html` is unchanged.
