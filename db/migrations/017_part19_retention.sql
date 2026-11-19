-- Part 19: check-in calendar and mystery box. Both features ship disabled.
CREATE TABLE IF NOT EXISTS mystery_box_claims(
  id BIGSERIAL PRIMARY KEY,
  telegram_id BIGINT NOT NULL REFERENCES users(telegram_id),
  claim_date DATE NOT NULL,
  reward BIGINT NOT NULL CHECK (reward > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(telegram_id, claim_date)
);
CREATE INDEX IF NOT EXISTS mystery_box_user_idx ON mystery_box_claims(telegram_id, created_at DESC);
INSERT INTO schema_migrations(version) VALUES('017_part19_retention') ON CONFLICT DO NOTHING;
