-- Token mode: withdrawals are paid in the MINER BEP-20 token. 1 Point = 1 MINER.
-- Run BEFORE redeploying. Existing withdrawals keep the rate they were created with.
INSERT INTO settings(key,value) VALUES('points_per_usdt','1'::jsonb) ON CONFLICT(key) DO UPDATE SET value='1'::jsonb;
INSERT INTO settings(key,value) VALUES('min_withdraw_usdt','1000'::jsonb) ON CONFLICT(key) DO UPDATE SET value='1000'::jsonb;
-- USDT deposits (for ads) stay ON as they were. They now use their own rate: Points credited per 1 USDT (old behaviour: 10,000).
INSERT INTO settings(key,value) VALUES('deposit_points_per_usdt','10000'::jsonb) ON CONFLICT(key) DO NOTHING;
