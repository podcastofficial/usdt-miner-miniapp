# Part 6 of 7 — Community
## What's new
- **🏆 Leaderboard** — paginated (20 per page, top 200), "your rank" card, ties broken deterministically. Shows first name only (no Telegram ID / @username).
- **📢 Advertise** — live budget calculator, strict link validation (https only; channel campaigns need `https://t.me/<channel>`), **My campaigns** with progress, **cancel while pending** (full refund, exactly once). Create = balance debit + campaign + ledger in ONE atomic statement. Limits are admin settings (min reward, min completions, max pending, on/off).
- **✈️ Official Channel** — official channel, payments channel, support and bot links, all from Admin → Settings.
- **🧾 Payment Proof** — paid withdrawals only (name masked to 2 letters, amount, date, payout hash with BscScan link), totals, paging. Admin can hide single items (**Admin → Proof**) or switch the screen off.
- **📖 How to Use** — steps + FAQ built from the live settings (rate, fee, rewards).
- **🎮 Games** — "coming soon" only; no Points are used or awarded.
- **✨ More** tab (bottom nav) is the hub for all of the above + History. Screens now live in `public/index.html` + `public/app.js` + `public/styles.css` (no inline JS).
## Files (extract over your repo)
New: `db/migrations/006_community.sql`, `lib/community.js`, `lib/actions/community.js`, `public/app.js`, `public/styles.css`, `tests/community.test.js`, this file.
Changed: `api/index.js`, `lib/ratelimit.js`, `lib/settingsDefs.js` (new "Community & Ads" group), `public/index.html`, `public/admin.js` (Proof tab), `package.json`.
Safe to delete: `lib/actions/legacy.js` (leaderboard + campaignCreate moved to `community.js`).
## Upgrade
1. Neon: run `db/migrations/006_community.sql`.
2. Deploy. 3. Admin → Settings → **Community & Ads**: check official/payments channel, add a support contact.
4. `npm test` → 36 passing.
## Assumptions (owner to confirm)
- Payment Proof = paid withdrawals with an on-chain payout hash, taken from the DB (not user-uploaded screenshots).
- Ad defaults: min 10 Points per user, min 10 completions, max 3 pending per user.
- Channel campaigns only verify joins if the bot is admin of the advertiser's channel (the Advertise screen says so).
- SQL was reviewed but not run against a live Neon DB here: test one campaign create → cancel and one Payment Proof load first.
