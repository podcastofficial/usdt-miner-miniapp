-- Part 2: ledger fields, timer-proof tasks, daily reward = 100. Idempotent.
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'confirmed';
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS metadata JSONB;

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS timer_seconds INTEGER NOT NULL DEFAULT 30;
ALTER TABLE task_completions ADD COLUMN IF NOT EXISTS evidence JSONB;

CREATE TABLE IF NOT EXISTS task_attempts(
  task_id BIGINT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  telegram_id BIGINT NOT NULL REFERENCES users(telegram_id),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(task_id, telegram_id));

UPDATE settings SET value='100'::jsonb WHERE key='daily_reward';
INSERT INTO settings(key,value) VALUES('daily_timezone','"Asia/Kolkata"'::jsonb) ON CONFLICT(key) DO NOTHING;

INSERT INTO schema_migrations(version) VALUES('002_points_and_tasks') ON CONFLICT DO NOTHING;
