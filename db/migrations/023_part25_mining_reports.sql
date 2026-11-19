-- Part 25: mining performance snapshots for admin review. Does not alter mining payout calculations.
CREATE TABLE IF NOT EXISTS mining_report_snapshots (
  id BIGSERIAL PRIMARY KEY,
  generated_by BIGINT NOT NULL,
  plan_count INTEGER NOT NULL DEFAULT 0,
  active_machines BIGINT NOT NULL DEFAULT 0,
  total_claimed_points NUMERIC(30,0) NOT NULL DEFAULT 0,
  report JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS mining_report_snapshots_created_idx ON mining_report_snapshots(created_at DESC);
INSERT INTO schema_migrations(version) VALUES('023_part25_mining_reports') ON CONFLICT DO NOTHING;
