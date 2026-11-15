-- Part 3: referral qualification, abuse log. Idempotent.
ALTER TABLE referral_events ADD COLUMN IF NOT EXISTS reward BIGINT;
ALTER TABLE referral_events ADD COLUMN IF NOT EXISTS verification JSONB;
CREATE INDEX IF NOT EXISTS users_referrer_idx ON users(referrer_id);
CREATE INDEX IF NOT EXISTS referral_events_referrer_idx ON referral_events(referrer_id, qualified_at DESC);

CREATE TABLE IF NOT EXISTS abuse_events(
  id BIGSERIAL PRIMARY KEY, user_id BIGINT, kind TEXT NOT NULL, detail JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE INDEX IF NOT EXISTS abuse_events_created_idx ON abuse_events(created_at DESC);

INSERT INTO settings(key,value) VALUES('referral_reward','1000'::jsonb) ON CONFLICT(key) DO NOTHING;
INSERT INTO settings(key,value) VALUES('required_channels','["@USDTMinerUpdates","@USDTMinerPayments"]'::jsonb) ON CONFLICT(key) DO NOTHING;
INSERT INTO schema_migrations(version) VALUES('003_referrals') ON CONFLICT DO NOTHING;
