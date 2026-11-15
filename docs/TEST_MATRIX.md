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
| 24 | Settings > Engagement: turn **Daily streak ladder** ON, claim today, claim again | Day 1 pays the ladder's first number once; second claim refused; Home shows the ladder with day 1 ticked |
| 25 | Next day claim, then skip a whole day and claim | Next day = day 2 (+ladder value). After a skipped day = day 1 again; Best streak is kept |
| 26 | Daily streak with the ladder OFF | Flat daily reward, no ladder on Home, no errors |
| 27 | Referral tab with 25+ test referrals (or fewer + page size check) | Names masked (e.g. `Jo***`), filters All / Qualified / Pending work, Load more adds the next 20 |
| 28 | Turn **Referral milestone bonuses** ON with a test inviter at 5 qualified referrals; open Rewards twice | +bonus once, ledger shows one `Milestone Reward`; second open pays nothing |
| 29 | Rewards screen: Level, progress bar, badges | Level matches lifetime earned Points (deposits / admin adjustments not counted); streak / referral badges appear once |
| 30 | Admin > Promo: create code (reward 10, total 2, per user 1); redeem as user A, A again, user B, user C | A +10; A again refused; B +10; C "fully redeemed". Ledger has exactly 2 `Promo Code` rows |
| 31 | Promo: expired code, disabled code, wrong code x21 | Clear messages; after 20 wrong codes the user is locked out for ~12 h even for a valid code |
| 32 | Promo with Promo codes setting OFF | Redeem refused, tile hidden on Home |
| 33 | Admin > Audit filter "promo" | `promo.create` / `promo.enable` / `promo.disable` rows with the admin ID |
| 34 | Admin > Ledger check after rows 24-33 | Reports no mismatch |
| 35 | Settings > Games & Boosters: Games OFF; open More > Games | "Games are not open yet", no play buttons; calling `gamePlay` directly returns `game_disabled` |
| 36 | Turn Games ON (1 free play, fee 0). Play Spin as user A | Highlight lands on the server's result; one `Game Prize` ledger row if the prize is above 0; balance matches; second Spin refused "No free plays left today" |
| 37 | Play Scratch Card and Lucky Box once each | Each has its own free play; Box shows the prize in the box you tapped; Games > recent plays lists all three |
| 38 | Double-tap Play, or play from two devices at once | Only ONE play is recorded and ONE ledger row exists |
| 39 | Win cap: set cap 20 and play until a prize above 20 is drawn (use a tiny test prize table) | Credited prize is cut to what is left of the cap, the result says it was cut, `game_daily.won` never exceeds the cap |
| 40 | Entry fee 5, daily max 3, free plays 1. Use the free play, then try a paid play with 4 Points | Refused "Not enough Points"; balance unchanged; the day's play counter did NOT go up (you can play again after topping up) |
| 41 | Same setup with enough Points: play 2 paid plays, then a 4th | Ledger shows `Game Entry` −5 then `Game Prize` per play; the 4th play is refused (daily limit) |
| 42 | Admin > Games: edit a prize, disable prizes one by one | Odds and expected payout update; the last active prize cannot be disabled; audit shows `game.prize_*` |
| 43 | Lucky Draw ON. Create draw (ticket 10, prize 100, max 3). A buys 1, then 3. B buys 2 | A's second purchase is refused (max 3, holds 1) with NO Points taken; B gets 2 tickets; ledger has `Lucky Draw Ticket` rows |
| 44 | Create a second draw while one is open | Refused "already an open draw" |
| 45 | Admin presses Draw winner (type DRAW), then presses it again | Exactly one winner, prize paid once (`Lucky Draw Win`), second press refused (closed); Games shows the masked winner; audit `draw.pick` |
| 46 | Cancel an open draw that has tickets | Every buyer refunded once (`Lucky Draw Refund`); no more ticket sales; audit `draw.cancel` |
| 47 | Boosters ON. Buy a booster as A, then tap Buy twice fast (or two devices) | Points drop by the price ONCE; Home shows the booster; a second purchase is refused "already active" |
| 48 | Claim the daily reward while the booster is active, then after it expires | Reward = base × booster % ÷ 100 rounded down, ledger text mentions the booster; after expiry the base reward again |
| 49 | Switch Boosters / Games / Lucky Draw OFF after purchases | An already-bought booster still applies; new purchases / plays / tickets are refused with clear messages |
| 50 | Admin > Audit filter `game` and `draw`, then Admin > Ledger check | Rows present with the admin ID; ledger check reports no mismatch |
