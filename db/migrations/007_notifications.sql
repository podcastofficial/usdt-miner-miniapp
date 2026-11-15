-- Part 8 (Phase 2, Part 1): bot notifications + admin broadcast. Idempotent.
ALTER TABLE users ADD COLUMN IF NOT EXISTS bot_blocked BOOLEAN NOT NULL DEFAULT FALSE; -- Telegram refused our message (user blocked / never started the bot). Reset by /start.
ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS proof_posted_at TIMESTAMPTZ;           -- set once when the payout proof was posted to the payments channel

CREATE TABLE IF NOT EXISTS broadcasts(
  id BIGSERIAL PRIMARY KEY,
  created_by BIGINT NOT NULL,
  text TEXT NOT NULL,
  segment TEXT NOT NULL CHECK (segment IN ('all','active7','balance','new24','me')),
  total INTEGER NOT NULL DEFAULT 0,
  cancelled BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());

CREATE TABLE IF NOT EXISTS notification_queue(
  id BIGSERIAL PRIMARY KEY,
  telegram_id BIGINT NOT NULL,
  kind TEXT NOT NULL,                                   -- withdrawal | referral | reminder | broadcast
  text TEXT NOT NULL,                                   -- already escaped HTML
  dedupe_key TEXT UNIQUE,                               -- one message per event (retries never double-send)
  broadcast_id BIGINT REFERENCES broadcasts(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sending','sent','failed','skipped')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  send_after TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  claimed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ);
CREATE INDEX IF NOT EXISTS notification_queue_due_idx ON notification_queue(send_after, id) WHERE status='pending';
CREATE INDEX IF NOT EXISTS notification_queue_bc_idx ON notification_queue(broadcast_id, status);
CREATE INDEX IF NOT EXISTS broadcasts_id_idx ON broadcasts(id DESC);

INSERT INTO schema_migrations(version) VALUES('007_notifications') ON CONFLICT DO NOTHING;
