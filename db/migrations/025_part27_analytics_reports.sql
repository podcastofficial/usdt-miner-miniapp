-- Part 27: persisted analytics report history (aggregates only; no sensitive raw payloads).
CREATE TABLE IF NOT EXISTS admin_analytics_reports (
  id BIGSERIAL PRIMARY KEY,
  report_name TEXT NOT NULL CHECK (char_length(report_name) BETWEEN 1 AND 80),
  range_days INTEGER NOT NULL CHECK (range_days BETWEEN 1 AND 365),
  generated_by BIGINT NOT NULL,
  metrics JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS admin_analytics_reports_created_idx ON admin_analytics_reports(created_at DESC);
INSERT INTO schema_migrations(version) VALUES('025_part27_analytics_reports') ON CONFLICT DO NOTHING;
