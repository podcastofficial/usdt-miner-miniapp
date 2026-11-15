-- Part 4: withdrawal lifecycle + on-chain BEP-20 deposit verification. Idempotent.
ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS points BIGINT;
ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS points_per_usdt INTEGER;
ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS fee_percent NUMERIC(8,3);
ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS reviewed_by BIGINT;
ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS reject_reason TEXT;
ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;
ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
UPDATE withdrawals SET status='pending' WHERE status IS NULL;
UPDATE withdrawals SET points=ROUND(amount_usdt * COALESCE((SELECT (value#>>'{}')::numeric FROM settings WHERE key='points_per_usdt'),10000)) WHERE points IS NULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='withdrawals_status_chk') THEN
    ALTER TABLE withdrawals ADD CONSTRAINT withdrawals_status_chk CHECK (status IN ('pending','approved','paid','rejected','cancelled'));
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS withdrawals_payout_hash_key ON withdrawals(tx_hash) WHERE tx_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS withdrawals_user_idx ON withdrawals(telegram_id, id DESC);
CREATE INDEX IF NOT EXISTS withdrawals_status_idx ON withdrawals(status, id);

ALTER TABLE deposits ADD COLUMN IF NOT EXISTS from_address TEXT;
ALTER TABLE deposits ADD COLUMN IF NOT EXISTS block_number BIGINT;
ALTER TABLE deposits ADD COLUMN IF NOT EXISTS confirmations INTEGER;
ALTER TABLE deposits ADD COLUMN IF NOT EXISTS points_credited BIGINT;
ALTER TABLE deposits ADD COLUMN IF NOT EXISTS verification JSONB;
ALTER TABLE deposits ADD COLUMN IF NOT EXISTS reject_reason TEXT;
ALTER TABLE deposits ADD COLUMN IF NOT EXISTS reviewed_by BIGINT;
ALTER TABLE deposits ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;
ALTER TABLE deposits ADD COLUMN IF NOT EXISTS credited_at TIMESTAMPTZ;
ALTER TABLE deposits ADD COLUMN IF NOT EXISTS last_checked_at TIMESTAMPTZ;
-- old (Part 1-3) pending rows had no sender address and were never verified on-chain
UPDATE deposits SET status='rejected', reject_reason='legacy_unverified' WHERE status='pending' AND from_address IS NULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='deposits_status_chk') THEN
    ALTER TABLE deposits ADD CONSTRAINT deposits_status_chk CHECK (status IN ('pending','verified','confirmed','rejected'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS deposits_user_idx ON deposits(telegram_id, id DESC);
CREATE INDEX IF NOT EXISTS deposits_status_idx ON deposits(status, id);

INSERT INTO schema_migrations(version) VALUES('004_finance') ON CONFLICT DO NOTHING;
