-- Part 26: short referral challenges. Rewards are paid once through the existing ledger.
CREATE TABLE IF NOT EXISTS referral_challenges (
  id BIGSERIAL PRIMARY KEY,
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 80),
  target INTEGER NOT NULL CHECK (target BETWEEN 1 AND 10000),
  reward_points BIGINT NOT NULL CHECK (reward_points BETWEEN 1 AND 10000000),
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  active BOOLEAN NOT NULL DEFAULT FALSE,
  created_by BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (ends_at > starts_at)
);
CREATE TABLE IF NOT EXISTS referral_challenge_claims (
  challenge_id BIGINT NOT NULL REFERENCES referral_challenges(id) ON DELETE CASCADE,
  telegram_id BIGINT NOT NULL REFERENCES users(telegram_id) ON DELETE CASCADE,
  qualified_count INTEGER NOT NULL,
  points BIGINT NOT NULL,
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(challenge_id, telegram_id)
);
CREATE INDEX IF NOT EXISTS referral_challenges_active_idx ON referral_challenges(active, starts_at, ends_at);
INSERT INTO schema_migrations(version) VALUES('024_part26_referral_challenges') ON CONFLICT DO NOTHING;
