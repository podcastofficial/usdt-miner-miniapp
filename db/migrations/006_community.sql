-- Part 6: community features (leaderboard paging, Advertise, Payment Proof). Idempotent.
-- Admin can hide a single payout from the public Payment Proof list.
ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS proof_hidden BOOLEAN NOT NULL DEFAULT FALSE;

-- Public Payment Proof list (newest paid payouts first, keyset paging by id).
CREATE INDEX IF NOT EXISTS withdrawals_paid_idx ON withdrawals(id DESC) WHERE status='paid' AND tx_hash IS NOT NULL;

-- Leaderboard: same order the query uses (points desc, oldest first, id as final tie-break), blocked users excluded.
CREATE INDEX IF NOT EXISTS users_leaderboard_idx ON users(points DESC, created_at ASC, telegram_id ASC) WHERE is_blocked=FALSE;

-- "My campaigns" list.
CREATE INDEX IF NOT EXISTS campaigns_owner_idx ON campaigns(owner_id, id DESC);

INSERT INTO schema_migrations(version) VALUES('006_community') ON CONFLICT DO NOTHING;
