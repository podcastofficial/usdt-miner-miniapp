-- Part 23: transparent rule-based risk scoring. This is not an AI model and never auto-blocks users.
CREATE TABLE IF NOT EXISTS user_risk_scores (
  telegram_id BIGINT PRIMARY KEY REFERENCES users(telegram_id) ON DELETE CASCADE,
  score INTEGER NOT NULL DEFAULT 0 CHECK (score BETWEEN 0 AND 100),
  band TEXT NOT NULL DEFAULT 'low' CHECK (band IN ('low','medium','high')),
  signals JSONB NOT NULL DEFAULT '[]'::jsonb,
  calculated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS user_risk_scores_band_idx ON user_risk_scores(band, score DESC);
INSERT INTO schema_migrations(version) VALUES('021_part23_risk_scores') ON CONFLICT DO NOTHING;
