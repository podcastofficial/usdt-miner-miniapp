-- Part 20: VIP levels and referral commission ledger. Commission accrual is feature-flagged OFF.
CREATE TABLE IF NOT EXISTS referral_commissions(
  id BIGSERIAL PRIMARY KEY,
  referrer_id BIGINT NOT NULL REFERENCES users(telegram_id),
  referred_id BIGINT NOT NULL REFERENCES users(telegram_id),
  source_ref TEXT NOT NULL,
  base_points BIGINT NOT NULL CHECK (base_points > 0),
  commission_points BIGINT NOT NULL CHECK (commission_points > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(referred_id, source_ref)
);
CREATE INDEX IF NOT EXISTS referral_commissions_owner_idx ON referral_commissions(referrer_id, created_at DESC);
INSERT INTO schema_migrations(version) VALUES('018_part20_vip') ON CONFLICT DO NOTHING;
