# Phase 2 / Part 3 — Games & Boosters (v1.10.0)
## What's new
- **Games** (More > Games): **Spin Wheel**, **Scratch Card**, **Lucky Box**. Points only. The prize is drawn on the server with `crypto.randomInt` (weighted by the prize table) and stored in `game_plays` in the same statement that pays it, so nothing is decided or paid by the app. The Box "pick" is cosmetic. Odds are shown to players under each game.
- **Limits**: free plays per game per day (starter 1), optional **entry fee** after the free plays (starter **0 = no paid plays**), daily maximum for paid plays (starter 5), and a **win cap** per user per game per day (starter 500 Points; a prize is cut down to what is left of the cap, and the player is told). Day = the daily-reward time zone.
- **Lucky Draw**: admin creates one open draw (title, ticket price, prize, max tickets per user, sales end). Users buy tickets with Points. Admin presses **Draw winner** (type `DRAW`): winner chosen by crypto-random weighted by tickets, prize paid once, `draw.pick` audited. **Cancel + refund** gives every buyer their Points back, once.
- **Mining Boosters**: spend Points for a time-limited multiplier on the **daily reward** (starter ×1.5 for 24 h, 2,000 Points). One active booster at a time. Whole Points, rounded down. Shown on Home while active.
- **Admin > Games** tab: 24 h / 7-day plays, players, entry fees, prizes paid and net per game; prize tables with odds, **expected payout per play** and house edge; add / edit / enable / disable prizes (at least 1 active, at most 12 per game); draw create / draw winner / cancel. Admin > Settings > **Games & Boosters** (13 settings). Audit filters `game` and `draw`.
- **DB**: `009_games.sql`: `game_prizes`, `game_daily`, `game_plays`, `draws`, `draw_tickets`, `boosters`, `users.booster_until / booster_pct`. Starter prize tables are seeded only when `game_prizes` is empty.
- **API**: `games`, `gamePlay`, `drawBuy`, `boosterBuy`, `adminGamesReport`, `adminGamePrizeSave`, `adminGamePrizeSetActive`, `adminDrawList`, `adminDrawCreate`, `adminDrawPick`, `adminDrawCancel`. `daily` / `bootstrap.daily` now include the booster.
- **Tests**: +31 (`tests/games.test.js`) → 123 passing.
## How the money rules are enforced (all in SQL, one statement each)
- **No double play / over-limit**: the play statement first upserts `game_daily`; `WHERE plays < allowed` runs on the locked row, so two parallel taps cannot both take the last play.
- **Entry fee**: the balance must cover the fee *before* the prize is added. If not, the statement writes `-1` and the existing `users.points >= 0` CHECK rolls the whole statement back (counter, play row and ledger included).
- **Ledger**: `Game Entry` (−fee) and `Game Prize` (+prize) rows with unique references `game:<playId>:fee|prize`; draw tickets / win / refund and booster purchases have their own unique references. Reconciliation (Admin > Ledger check) keeps working.
- **One booster at a time**: `WHERE booster_until IS NULL OR booster_until <= NOW()` on the locked user row (re-checked under concurrency). An already-bought booster keeps working if you later switch Boosters OFF.
- **Daily claim with booster** is still ONE statement; `reward = base × booster% / 100` (integer, rounded down).
- **Levels**: game prizes, draw wins and boosters do **not** count towards levels / badges (the allow-list in `lib/engagement.js` is unchanged).
## Upgrade
1. Neon SQL Editor: run `db/migrations/009_games.sql` (safe to run twice). **Run it BEFORE redeploying**: the daily claim now reads `users.booster_until`.
2. Redeploy (no new env variables).
3. Admin > Settings > **Games & Boosters**: everything that pays Points starts **OFF**. Check the prize tables in Admin > Games first. See `docs/DEPLOYMENT_GUIDE.md` section 12 and rows 35-50 of `docs/TEST_MATRIX.md`.
## Owner confirmations needed (starter values, not decisions)
Prize tables (expected payout per play: Spin 11.6, Scratch 4.65, Box 9.75 Points) · free plays · entry fee (0) · daily max plays · win cap · booster price / multiplier / length · each draw's price, prize and ticket limit · whether the Lucky Draw is run at all.
## Legal note (your decision, not mine)
Points can be withdrawn as USDT. Games of chance with an **entry fee**, and draws with **paid tickets**, can count as gambling or lottery depending on where your users are. The build therefore ships with free plays only (entry fee 0) and Lucky Draw OFF. Get a local-law check before you set an entry fee above 0 or switch the Lucky Draw on. The free games still cost you real liability: every free play is Points you create.
## Not verified here (owner to do)
- No SQL was executed in this build (no Postgres in the build environment) and nothing was run against live Neon or Telegram. Tests cover the pure rules (prize pick, odds, limits, cap, fee-before-prize, ledger balance over simulated plays, draw winner, booster maths) and statically check the SQL shape, the migration and the wiring. Rows 35-50 of `docs/TEST_MATRIX.md` are what prove the SQL, with tiny numbers.
- A ticket bought at the exact moment the admin presses Draw can be missed by the winner pick. The pick statement then fails ("Tickets changed while drawing, press Draw again") instead of paying out on stale data, but a ticket still in flight at that instant is not locked against. Close sales (end date) before drawing to avoid it.
- Scratch / Spin / Box animations are simple CSS highlights (strict CSP forbids inline styles). They respect "reduce motion".
## Not changed / open
No bot notification when someone wins the Lucky Draw (the winner sees it on the Games screen). Draw winners are shown with masked names. Prize odds are public by design.
