-- Part 17.2: Auto-Miner (passive mining machines, bought with Points). Idempotent: safe to run twice.
-- Run BEFORE redeploying. The feature itself ships OFF (Admin > Settings > Auto-Miner).

-- Machine types. Editable in the admin API (screen comes in 17.3). Editing a plan only changes FUTURE purchases:
-- every machine keeps the price, rate and name it was bought with.
CREATE TABLE IF NOT EXISTS auto_miner_plans(
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 30),
  price BIGINT NOT NULL CHECK (price >= 0 AND price <= 10000000),                 -- Points; 0 = free machine
  rate_per_hour BIGINT NOT NULL CHECK (rate_per_hour BETWEEN 1 AND 100000),       -- Points mined per hour
  duration_days INTEGER NOT NULL CHECK (duration_days BETWEEN 1 AND 365),         -- how long the machine runs
  max_per_user INTEGER NOT NULL DEFAULT 1 CHECK (max_per_user BETWEEN 1 AND 1000), -- purchases per user, lifetime (race-safe counter below)
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());

-- One row per bought machine. Earnings are NOT stored per tick: they are computed from `last_claim_at` (see lib/autominer.js).
-- last_claim_at < ends_at  = the machine still has something left to pay (running, or ended with unclaimed earnings).
CREATE TABLE IF NOT EXISTS auto_miners(
  id BIGSERIAL PRIMARY KEY,
  telegram_id BIGINT NOT NULL REFERENCES users(telegram_id),
  plan_id BIGINT NOT NULL REFERENCES auto_miner_plans(id),
  plan_name TEXT NOT NULL,
  price_paid BIGINT NOT NULL CHECK (price_paid >= 0),
  rate_per_hour BIGINT NOT NULL CHECK (rate_per_hour BETWEEN 1 AND 100000),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ends_at TIMESTAMPTZ NOT NULL,
  last_claim_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  total_claimed BIGINT NOT NULL DEFAULT 0 CHECK (total_claimed >= 0));
CREATE INDEX IF NOT EXISTS auto_miners_user_idx ON auto_miners(telegram_id, id DESC);
CREATE INDEX IF NOT EXISTS auto_miners_open_idx ON auto_miners(telegram_id) WHERE last_claim_at < ends_at;

-- Purchases per user per plan. The buy statement upserts this row FIRST; its `WHERE n < max_per_user` is evaluated on the
-- locked row, so two parallel requests can never both take the last allowed machine (same pattern as draw_tickets).
CREATE TABLE IF NOT EXISTS auto_miner_buys(
  telegram_id BIGINT NOT NULL REFERENCES users(telegram_id),
  plan_id BIGINT NOT NULL REFERENCES auto_miner_plans(id),
  n INTEGER NOT NULL CHECK (n >= 1),
  PRIMARY KEY (telegram_id, plan_id));

-- One row per claim (the claim id is the idempotency reference of its ledger row).
CREATE TABLE IF NOT EXISTS auto_miner_claims(
  id BIGSERIAL PRIMARY KEY,
  telegram_id BIGINT NOT NULL REFERENCES users(telegram_id),
  points BIGINT NOT NULL CHECK (points > 0),
  miners INTEGER NOT NULL CHECK (miners >= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE INDEX IF NOT EXISTS auto_miner_claims_user_idx ON auto_miner_claims(telegram_id, id DESC);
CREATE INDEX IF NOT EXISTS auto_miner_claims_created_idx ON auto_miner_claims(created_at DESC);

-- Starter plans (owner confirms / edits them; the feature is OFF until you switch it on). Only seeded when the table is empty.
-- Starter values: Free 336 Points in total, Bronze 144%, Silver 158%, Gold 173% of the price over the machine's life.
-- Every Point a machine pays is a Point the app creates (1 Point = 1 MINER): check the numbers before enabling.
INSERT INTO auto_miner_plans(name, price, rate_per_hour, duration_days, max_per_user)
SELECT v.name, v.price, v.rate, v.days, v.mx FROM (VALUES
  ('Starter Miner', 0,     2,   7,  1),
  ('Bronze Miner',  2000,  4,   30, 5),
  ('Silver Miner',  10000, 22,  30, 3),
  ('Gold Miner',    50000, 120, 30, 2)
) AS v(name, price, rate, days, mx)
WHERE NOT EXISTS (SELECT 1 FROM auto_miner_plans);

INSERT INTO schema_migrations(version) VALUES('016_auto_miner') ON CONFLICT DO NOTHING;
