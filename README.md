# USDT Miner Telegram Mini App — Fresh Launch

Fresh database and registration. This does NOT connect to or modify the existing Bots.Business bot. Existing users and balances are not imported.

## Stack
- Telegram Mini App frontend
- Vercel Node.js serverless API
- Neon PostgreSQL
- Telegram `initData` HMAC authentication

## Deploy
1. Create a Neon PostgreSQL database.
2. Run `db/schema.sql` in Neon SQL Editor.
3. Upload this project to a new GitHub repository.
4. Import repository into Vercel.
5. Add environment variables from `.env.example`.
6. Deploy and configure the HTTPS Mini App URL with BotFather.
7. Open through Telegram, not a normal browser.

## Existing rules retained
- 10,000 Points = 1 USDT
- Minimum withdrawal 15 USDT
- 10% withdrawal fee
- BEP-20
- Referral reward target 1,000 Points
- Required channels: @USDTMinerUpdates and @USDTMinerPayments
- Weekly/monthly referral contests intentionally postponed.

## Important before real launch
This is a functional starter, not a completed audited financial platform. Deposit hashes are queued for admin review; **automatic BEP-20 on-chain verification is not implemented**. Withdrawals create requests and require secure manual payout. Do not place private keys in GitHub or Vercel. Referral rewards are not yet granted because qualifying channel-join verification and referral attribution need a separate Telegram webhook flow. Bot/website task claims need stronger verification before awarding meaningful Points. Games are informational placeholder only. Advertising campaign creation reserves Points, but the full campaign delivery/verification workflow is not yet complete. Add rate limits, idempotent DB transactions, monitoring, backups, terms and privacy policy before production.

## API actions
`bootstrap`, `referral`, `leaderboard`, `daily`, `taskComplete`, `withdraw`, `depositSubmit`, `campaignCreate`, `adminOverview`.

## Security
Only Telegram Mini App signed initData is accepted. Admin IDs are set in `ADMIN_TELEGRAM_IDS`. Never commit `.env`.
