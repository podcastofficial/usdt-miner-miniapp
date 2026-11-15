# Test matrix

## Automated (`npm test` → 67 tests, `npm run check` → syntax)
| Area | File | What it proves |
|---|---|---|
| Auth | `tests/auth.test.js` | initData signature, expiry, admin IDs |
| Money / ledger | `tests/finance.test.js` | strict 2-decimal parsing, fee/net maths, state rules |
| Referral | `tests/referral.test.js` | link capture, reward once, abuse rules |
| Community | `tests/community.test.js` | leaderboard paging, link validation, budget maths, proof masking |
| Settings | `tests/settings.test.js` | every admin option validates, defaults fall back |
| Notifications (v1.8.0) | `tests/notify.test.js` | message text is escaped, webhook secret check, Telegram error classification, broadcast validation, router order (webhook/cron before auth), migration idempotent, cron daily-only |
| Frontend (Part 7) | `tests/frontend.test.js` | WCAG AA 4.5:1 contrast for every text/background pair, 3:1 focus ring, labels, landmarks, ARIA tabs, 44px targets, reduced motion, **no inline handlers/styles/scripts**, strict CSP, every `data-go`/`data-act`/`data-adm` has a target, every element id used by JS exists, `.env` ignored |

Also run once (done in this build): headless Chromium at 390×844 against the strict CSP with a mocked API: all screens render, zero CSP violations, admin buttons/filters/modal work.

## Manual, in Telegram (test with tiny amounts; not run in this build)
| # | Flow | Pass when |
|---|---|---|
| 1 | Open in browser (not Telegram) | "Open in Telegram" gate shows |
| 2 | Open in Telegram | Points load, no error banner |
| 3 | Daily reward twice | 100 Points once, button shows Claimed |
| 4 | Channel task: Join then Verify | Points only after really joining |
| 5 | Timer task: claim early | Refused until the timer ends |
| 6 | Referral: friend joins via link, verifies | Inviter gets 1,000 Points exactly once |
| 7 | Withdraw below minimum / bad address | Clear error, Points unchanged |
| 8 | Withdraw → admin approve → mark paid with hash | Status updates, appears in Payment Proof |
| 9 | Withdraw → reject / cancel | Points refunded once |
| 10 | Deposit (only after enabling) | Wrong sender/amount rejected; correct one verified |
| 11 | Advertise create → cancel | Budget debited then fully refunded |
| 12 | Admin: campaign approve/reject, Points adjust, block/unblock | Ledger + audit rows written |
| 13 | Maintenance on | Users see message, admin still works |
| 14 | Admin → Ledger check | Reports no mismatch |
| 15 | Phone checks: small phone (320px), large text, light/dark Telegram theme, VoiceOver/TalkBack on Home and Withdraw, "reduce motion" on | Usable, coin stops spinning |
| 16 | Telegram Desktop, Android, iOS | Back button works, nothing clipped by the bottom bar |
| 17 | Admin > Notify > Set / refresh webhook | Shows ✅ Connected; `/start` in the bot replies with an Open button |
| 18 | Approve a small withdrawal | User gets the "approved" bot message once (approve again = no second message) |
| 19 | Mark paid with a real hash | User gets "paid" + BscScan link; with `proof_autopost` ON a masked post appears in the payments channel once |
| 20 | Reject a withdrawal | User gets reason + "refunded" message |
| 21 | Friend joins via link and verifies | Inviter gets the "+Points" message once |
| 22 | Broadcast to "Only me", then to a small segment, press Send next batch until Waiting = 0 | Messages arrive once; blocked users show as Skipped; Cancel stops the rest |
| 23 | Call `/api?action=cron` without / with wrong secret | 403 both times; with the right `Authorization: Bearer` header 200 |
