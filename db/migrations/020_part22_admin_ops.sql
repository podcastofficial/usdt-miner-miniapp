-- Part 22: admin operations workspace. Notes are internal and all writes are attributed.
CREATE TABLE IF NOT EXISTS admin_user_notes (
  id BIGSERIAL PRIMARY KEY,
  telegram_id BIGINT NOT NULL REFERENCES users(telegram_id) ON DELETE CASCADE,
  author_id BIGINT NOT NULL,
  note TEXT NOT NULL CHECK (char_length(note) BETWEEN 1 AND 1000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS admin_user_notes_user_idx ON admin_user_notes(telegram_id, id DESC);
CREATE TABLE IF NOT EXISTS admin_saved_segments (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  criteria JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS admin_saved_segments_name_uq ON admin_saved_segments(lower(name));
INSERT INTO schema_migrations(version) VALUES('020_part22_admin_ops') ON CONFLICT DO NOTHING;
