-- Part 12 (Phase 2, Part 5): fraud flags, admin roles, user language. Idempotent (safe to run twice).

-- Fraud flags: raised automatically by the scan, reviewed by a human. Nothing here ever blocks a user.
CREATE TABLE IF NOT EXISTS fraud_flags(
  id BIGSERIAL PRIMARY KEY,
  rule TEXT NOT NULL CHECK (rule IN ('same_wallet','referral_burst','rapid_claims')),
  telegram_id BIGINT NOT NULL REFERENCES users(telegram_id),
  severity TEXT NOT NULL DEFAULT 'medium' CHECK (severity IN ('low','medium','high')),
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  dedupe_key TEXT NOT NULL UNIQUE,                       -- the same finding is never flagged twice (re-scans are safe)
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','reviewed','dismissed')),
  review_note TEXT,
  reviewed_by BIGINT,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE INDEX IF NOT EXISTS fraud_flags_status_idx ON fraud_flags(status, id DESC);
CREATE INDEX IF NOT EXISTS fraud_flags_user_idx ON fraud_flags(telegram_id);

-- Admin roles. Super admins are ONLY the Telegram IDs in the ADMIN_TELEGRAM_IDS env variable, so a leaked database
-- can never create a super admin: this table can only hold the two limited roles.
CREATE TABLE IF NOT EXISTS admin_roles(
  telegram_id BIGINT PRIMARY KEY REFERENCES users(telegram_id),
  role TEXT NOT NULL CHECK (role IN ('support','finance')),
  set_by BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());

-- Language chosen in the app (en / hi / hinglish). NULL = not chosen yet (the app picks from the Telegram language).
ALTER TABLE users ADD COLUMN IF NOT EXISTS user_lang TEXT;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='users_user_lang_chk') THEN
    ALTER TABLE users ADD CONSTRAINT users_user_lang_chk CHECK (user_lang IS NULL OR user_lang IN ('en','hi','hinglish'));
  END IF;
END $$;

-- Analytics reads (day buckets over ledger rows).
CREATE INDEX IF NOT EXISTS transactions_created_idx ON transactions(created_at);
CREATE INDEX IF NOT EXISTS task_completions_created_idx ON task_completions(created_at);

INSERT INTO schema_migrations(version) VALUES('011_safety_admin') ON CONFLICT DO NOTHING;
