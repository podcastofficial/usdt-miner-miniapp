# Part 16 — MINER token mode (v1.15.0)
- 1 Point = 1 MINER. Withdrawals are requested and paid in MINER (BEP-20), whole numbers only, min 1000, fee 10% (editable in Admin > Settings).
- Run `db/migrations/015_token_mode.sql` BEFORE redeploying.
- USDT deposits (for ads) stay ON. They use a separate setting "Points credited per 1 USDT deposited" (default 10,000), so the 1 Point = 1 MINER withdrawal rate does not affect them.
- `contracts/MinerToken.sol`: fixed 100M supply. Deploy with Remix, verify on BscScan, then set `MINER_TOKEN_CONTRACT`.
- Payouts stay manual: send MINER from your treasury wallet, paste the tx hash in Admin > Withdrawals. Never put a private key in GitHub/Vercel.
- UI text changed in English only; the other 8 language files still say "Points".
