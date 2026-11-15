-- Part 5: admin panel support. Idempotent.
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS task_id BIGINT REFERENCES tasks(id);
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS reject_reason TEXT;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS reviewed_by BIGINT;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;
UPDATE campaigns SET status='pending' WHERE status IS NULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='campaigns_status_chk') THEN
    ALTER TABLE campaigns ADD CONSTRAINT campaigns_status_chk CHECK (status IN ('pending','active','rejected','cancelled'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS campaigns_status_idx ON campaigns(status, id);

ALTER TABLE users ADD COLUMN IF NOT EXISTS blocked_reason TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS blocked_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS users_username_idx ON users(lower(username));
CREATE INDEX IF NOT EXISTS admin_audit_logs_action_idx ON admin_audit_logs(action, id DESC);

INSERT INTO schema_migrations(version) VALUES('005_admin') ON CONFLICT DO NOTHING;
