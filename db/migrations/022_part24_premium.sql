-- Part 24: Points-funded premium membership. Feature stays OFF until explicitly enabled.
CREATE TABLE IF NOT EXISTS premium_tiers (
  id BIGSERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE CHECK (code ~ '^[a-z0-9_]{2,24}$'),
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 40),
  price_points BIGINT NOT NULL CHECK (price_points >= 0 AND price_points <= 100000000),
  duration_days INTEGER NOT NULL CHECK (duration_days BETWEEN 1 AND 365),
  benefits JSONB NOT NULL DEFAULT '{}'::jsonb,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS user_premium_memberships (
  telegram_id BIGINT PRIMARY KEY REFERENCES users(telegram_id) ON DELETE CASCADE,
  tier_id BIGINT NOT NULL REFERENCES premium_tiers(id),
  starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ends_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO premium_tiers(code,name,price_points,duration_days,benefits) VALUES
 ('silver','Silver',5000,30,'{"badge":"Silver","support_priority":false}'::jsonb),
 ('gold','Gold',15000,30,'{"badge":"Gold","support_priority":true}'::jsonb)
ON CONFLICT(code) DO NOTHING;
INSERT INTO schema_migrations(version) VALUES('022_part24_premium') ON CONFLICT DO NOTHING;
