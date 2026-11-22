-- Part 28: repeating website tasks + broadcast with image / inline buttons / channels. Idempotent: safe to run twice.
-- Run it BEFORE redeploying: the task claim now reads tasks.repeat_minutes and task_completions.times.

-- ---------- repeating tasks (admin tasks only, never ad campaigns) ----------
-- repeat_minutes = 0 -> one time only (old behaviour). > 0 -> the same user can do the task again that many minutes after the LAST completion.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS repeat_minutes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_repeat_minutes_chk;
ALTER TABLE tasks ADD CONSTRAINT tasks_repeat_minutes_chk CHECK (repeat_minutes BETWEEN 0 AND 10080);
-- task_completions keeps ONE row per (task, user): created_at = time of the latest completion, times = how many times it was done.
ALTER TABLE task_completions ADD COLUMN IF NOT EXISTS times INTEGER NOT NULL DEFAULT 1;

-- ---------- broadcast: target (bot / channel / both), image, inline buttons ----------
ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS target TEXT NOT NULL DEFAULT 'bot';
ALTER TABLE broadcasts DROP CONSTRAINT IF EXISTS broadcasts_target_chk;
ALTER TABLE broadcasts ADD CONSTRAINT broadcasts_target_chk CHECK (target IN ('bot','channel','both'));
ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS image BYTEA;            -- the photo picked from the gallery (already compressed by the admin page)
ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS image_mime TEXT;
ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS photo_file_id TEXT;     -- Telegram file_id after the first upload, reused for every other user
ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS buttons JSONB;          -- [{text,url}, ...]
ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS channels_sent INTEGER NOT NULL DEFAULT 0;
ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS channels_failed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS channel_report JSONB;
-- A channel-only broadcast has no user segment.
ALTER TABLE broadcasts DROP CONSTRAINT IF EXISTS broadcasts_segment_check;
ALTER TABLE broadcasts DROP CONSTRAINT IF EXISTS broadcasts_segment_chk;
ALTER TABLE broadcasts ADD CONSTRAINT broadcasts_segment_chk CHECK (segment IN ('all','active7','balance','new24','me','none'));

-- Channels the admin can post broadcasts to (add / remove / on-off from the admin panel).
CREATE TABLE IF NOT EXISTS broadcast_channels(
  id BIGSERIAL PRIMARY KEY,
  chat TEXT NOT NULL UNIQUE,            -- "@publicname" or numeric "-100..." id
  title TEXT,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_by BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());

INSERT INTO schema_migrations(version) VALUES('027_task_repeat_broadcast_media') ON CONFLICT DO NOTHING;
