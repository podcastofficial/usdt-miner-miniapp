-- Part 21: support tickets and season pass foundation. Season pass ships disabled.
CREATE TABLE IF NOT EXISTS support_tickets(
  id BIGSERIAL PRIMARY KEY,
  telegram_id BIGINT NOT NULL REFERENCES users(telegram_id),
  subject TEXT NOT NULL CHECK (char_length(subject) BETWEEN 4 AND 100),
  message TEXT NOT NULL CHECK (char_length(message) BETWEEN 10 AND 2000),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','answered','closed')),
  admin_reply TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS support_tickets_user_idx ON support_tickets(telegram_id, id DESC);
CREATE TABLE IF NOT EXISTS season_pass_progress(
  telegram_id BIGINT NOT NULL REFERENCES users(telegram_id),
  season_key TEXT NOT NULL,
  points BIGINT NOT NULL DEFAULT 0 CHECK (points >= 0),
  claimed_level INTEGER NOT NULL DEFAULT 0 CHECK (claimed_level >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(telegram_id, season_key)
);
INSERT INTO schema_migrations(version) VALUES('019_part21_support_season') ON CONFLICT DO NOTHING;
