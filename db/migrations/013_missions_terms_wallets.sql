-- Part 14 (v1.14.0): withdrawal wallet cooldown, weekly missions, Terms & Privacy acceptance. Idempotent (safe to run twice).
-- Run it in Neon BEFORE redeploying.

-- Wallet addresses a user has used. A NEW address must age (setting wallet_cooldown_hours, default 24 h) before a withdrawal can go to it.
CREATE TABLE IF NOT EXISTS wallet_addresses(
  telegram_id BIGINT NOT NULL REFERENCES users(telegram_id),
  address TEXT NOT NULL,                                  -- lower-case
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (telegram_id, address));
-- Addresses already used in earlier withdrawals are trusted from their first use (no surprise lock for existing users).
INSERT INTO wallet_addresses(telegram_id, address, first_seen_at)
  SELECT telegram_id, lower(wallet_address), MIN(created_at) FROM withdrawals
  WHERE wallet_address IS NOT NULL GROUP BY telegram_id, lower(wallet_address)
  ON CONFLICT DO NOTHING;

-- Terms & Privacy: which version the user accepted (the admin raises terms_version to ask everybody again).
ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_version_accepted INT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ;

-- Weekly missions read existing tables (ledger, task_completions, referral_events); claims are ledger rows with a unique reference.
CREATE INDEX IF NOT EXISTS task_completions_user_created_idx ON task_completions(telegram_id, created_at);

INSERT INTO schema_migrations(version) VALUES('013_missions_terms_wallets') ON CONFLICT DO NOTHING;
