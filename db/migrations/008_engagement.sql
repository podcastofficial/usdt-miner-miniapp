-- Phase 2 / Part 2: engagement & retention (streaks, referral milestones, badges, promo codes). Idempotent.

-- Daily streak: one row per user, maintained by the daily-claim statement itself (same atomic statement as the Points credit).
CREATE TABLE IF NOT EXISTS streaks(
  telegram_id BIGINT PRIMARY KEY REFERENCES users(telegram_id),
  current_streak INTEGER NOT NULL DEFAULT 0 CHECK (current_streak >= 0),
  best_streak INTEGER NOT NULL DEFAULT 0 CHECK (best_streak >= 0),
  last_date DATE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());

-- Referral milestones: PRIMARY KEY makes each milestone payable exactly once per inviter.
CREATE TABLE IF NOT EXISTS milestones_paid(
  referrer_id BIGINT NOT NULL REFERENCES users(telegram_id),
  milestone INTEGER NOT NULL CHECK (milestone > 0),
  reward BIGINT NOT NULL CHECK (reward > 0),
  paid_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (referrer_id, milestone));

-- Badges: awarded by the server only, once per (user, code).
CREATE TABLE IF NOT EXISTS badges(
  telegram_id BIGINT NOT NULL REFERENCES users(telegram_id),
  code TEXT NOT NULL,
  earned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (telegram_id, code));

-- Promo codes. `redeemed` is a hard counter: the CHECK makes the total limit impossible to exceed even under concurrent redeems.
CREATE TABLE IF NOT EXISTS promo_codes(
  code TEXT PRIMARY KEY CHECK (code ~ '^[A-Z0-9]{4,20}$'),
  reward BIGINT NOT NULL CHECK (reward > 0),
  per_user_limit INTEGER NOT NULL DEFAULT 1 CHECK (per_user_limit BETWEEN 1 AND 10),
  total_limit INTEGER NOT NULL CHECK (total_limit >= 1),
  redeemed INTEGER NOT NULL DEFAULT 0 CHECK (redeemed >= 0),
  expires_at TIMESTAMPTZ,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  note TEXT,
  created_by BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT promo_total_not_exceeded CHECK (redeemed <= total_limit));

-- n = 1,2,3... per (code,user). UNIQUE(code,telegram_id,n) stops two parallel requests from both taking the same slot.
CREATE TABLE IF NOT EXISTS promo_redemptions(
  id BIGSERIAL PRIMARY KEY,
  code TEXT NOT NULL REFERENCES promo_codes(code),
  telegram_id BIGINT NOT NULL REFERENCES users(telegram_id),
  n INTEGER NOT NULL CHECK (n >= 1),
  reward BIGINT NOT NULL,
  redeemed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (code, telegram_id, n));
CREATE INDEX IF NOT EXISTS promo_redemptions_user_idx ON promo_redemptions(telegram_id, redeemed_at DESC);
CREATE INDEX IF NOT EXISTS users_referrer_created_idx ON users(referrer_id, created_at DESC, telegram_id);
CREATE INDEX IF NOT EXISTS transactions_user_type_idx ON transactions(telegram_id, type) WHERE points_change > 0;

-- No back-fill: a streak row is created by the user's first claim after the upgrade (the app is a fresh launch).

INSERT INTO schema_migrations(version) VALUES('008_engagement') ON CONFLICT DO NOTHING;
