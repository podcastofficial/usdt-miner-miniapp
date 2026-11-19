# Part 18 (A) — Home extras (v1.20.0)
Frontend only. No backend, SQL, settings or role changes. No new migration.

## What users see on Home
- **Withdraw progress bar** (inside the balance card): "Minimum withdraw: 630 / 1,000 MINER" with %, turns green with "You can withdraw now" at 100%. Hidden when withdrawals are OFF.
- **Live Payment Proof strip** (under the balance card): scrolling "Mi*** withdrew 5,000 MINER" from real paid withdrawals only (last 10). Hidden when Payment Proof is OFF or there are no payouts yet. Names are masked by the server (`maskName`). Respects "reduced motion".
- **Contest banner**: contest title, live countdown, top 3 and "Your rank / referrals". Tap opens the Contests screen. Hidden when Contests are OFF or no contest is running.

## Notes
- Uses the existing actions `financeInfo`, `proofList`, `contests`. Results are cached (proof 60 s, contest 30 s) because `boot()` runs after every action. Home never waits for these blocks.
- Contests and Payment Proof still have to be switched ON in Admin > Settings, otherwise the blocks stay hidden.
- English text only, same as the newer screens.

## Files
Changed: `public/index.html`, `public/app.js`, `public/styles.css`, `README.md`, `package.json` (1.20.0). New: `CHANGELOG_PART18.md`.

## Tests
`npm test`: 176 pass, 3 fail. The same 3 fail in the original zip before this change (`autominer.test.js`, `safety.test.js`, `leaderboard.test.js` "renders the referral count"), so they are not caused by Part A.
