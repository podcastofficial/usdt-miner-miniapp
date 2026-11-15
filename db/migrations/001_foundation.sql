-- Part 1 foundation migration. Safe to run on a fresh DB (after db/schema.sql) and on an existing one. Idempotent.
CREATE TABLE IF NOT EXISTS schema_migrations(version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW());

ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_code TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS language_code TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS signup_start_param TEXT; -- raw start param at first registration (used by Part 3 referral capture)
UPDATE users SET referral_code = upper(substr(md5(random()::text || telegram_id::text || clock_timestamp()::text), 1, 10)) WHERE referral_code IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS users_referral_code_key ON users(referral_code);

CREATE INDEX IF NOT EXISTS users_points_idx ON users(points DESC, created_at ASC);
CREATE INDEX IF NOT EXISTS transactions_user_idx ON transactions(telegram_id, id DESC);

CREATE TABLE IF NOT EXISTS rate_limits(
  bucket TEXT NOT NULL, window_start TIMESTAMPTZ NOT NULL, hits INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(bucket, window_start));

CREATE TABLE IF NOT EXISTS admin_audit_logs(
  id BIGSERIAL PRIMARY KEY, actor_id BIGINT NOT NULL, action TEXT NOT NULL,
  target_type TEXT, target_id TEXT, reason TEXT, before_data JSONB, after_data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE INDEX IF NOT EXISTS admin_audit_logs_created_idx ON admin_audit_logs(created_at DESC);

INSERT INTO schema_migrations(version) VALUES('001_foundation') ON CONFLICT DO NOTHING;
