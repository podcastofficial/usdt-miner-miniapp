-- Phase 2 / Part 4: Tasks with proof, Ad delivery accounting, Referral contests. Idempotent: safe to run twice.
-- Run it BEFORE redeploying: the task claim now reads campaigns.spent and tasks.proof_required.

-- ---------- tasks that need a proof (bot / website) ----------
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS proof_required BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS proof_hint TEXT;

CREATE TABLE IF NOT EXISTS task_proofs(
  id BIGSERIAL PRIMARY KEY,
  task_id BIGINT NOT NULL REFERENCES tasks(id),
  telegram_id BIGINT NOT NULL REFERENCES users(telegram_id),
  proof TEXT NOT NULL CHECK (char_length(proof) BETWEEN 3 AND 300),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  reward BIGINT,
  reject_reason TEXT,
  reviewed_by BIGINT,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
-- One live proof per user and task: a pending or approved proof blocks a second submission. A rejected one allows a retry (limited in the app).
CREATE UNIQUE INDEX IF NOT EXISTS task_proofs_live_idx ON task_proofs(task_id, telegram_id) WHERE status IN ('pending','approved');
CREATE INDEX IF NOT EXISTS task_proofs_queue_idx ON task_proofs(status, id);
CREATE INDEX IF NOT EXISTS task_proofs_user_idx ON task_proofs(telegram_id, id DESC);

-- ---------- ad delivery: budget accounting ----------
-- campaigns.spent = reward x completions so far. Unused budget = reward x target - spent (refunded once, ref cmprefund:<id>).
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS spent BIGINT NOT NULL DEFAULT 0;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS finished_at TIMESTAMPTZ;
ALTER TABLE campaigns DROP CONSTRAINT IF EXISTS campaigns_status_chk;
ALTER TABLE campaigns ADD CONSTRAINT campaigns_status_chk CHECK (status IN ('pending','active','rejected','cancelled','finished'));

-- One row per verified completion of a campaign (who, how it was verified, what it cost).
CREATE TABLE IF NOT EXISTS campaign_completions(
  id BIGSERIAL PRIMARY KEY,
  campaign_id BIGINT NOT NULL REFERENCES campaigns(id),
  task_id BIGINT NOT NULL REFERENCES tasks(id),
  telegram_id BIGINT NOT NULL REFERENCES users(telegram_id),
  reward BIGINT NOT NULL CHECK (reward > 0),
  method TEXT NOT NULL CHECK (method IN ('channel','timer','proof')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (campaign_id, telegram_id));
CREATE INDEX IF NOT EXISTS campaign_completions_campaign_idx ON campaign_completions(campaign_id, id DESC);

-- Backfill campaigns that were already running before this part (only rows that have not been migrated yet).
INSERT INTO campaign_completions(campaign_id, task_id, telegram_id, reward, method, created_at)
SELECT c.id, tc.task_id, tc.telegram_id, tc.reward, CASE WHEN tc.evidence->>'mode'='channel' THEN 'channel' ELSE 'timer' END, tc.created_at
FROM campaigns c JOIN task_completions tc ON tc.task_id=c.task_id
WHERE c.task_id IS NOT NULL AND tc.reward > 0
ON CONFLICT DO NOTHING;
UPDATE campaigns c SET spent = COALESCE((SELECT SUM(reward) FROM campaign_completions x WHERE x.campaign_id=c.id), 0)
WHERE c.spent = 0 AND c.status IN ('active','cancelled','rejected');
UPDATE campaigns SET status='finished', finished_at=COALESCE(finished_at, NOW()) WHERE status='active' AND spent >= reward * target;

-- ---------- referral contests ----------
-- prizes = JSON array of Points, rank 1 first (e.g. [5000,3000,1000]). One live contest at a time.
CREATE TABLE IF NOT EXISTS contests(
  id BIGSERIAL PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('weekly','monthly','custom')),
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 3 AND 60),
  prizes JSONB NOT NULL,
  min_referrals INTEGER NOT NULL DEFAULT 1 CHECK (min_referrals >= 1),
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','paying','paid','cancelled')),
  created_by BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paid_at TIMESTAMPTZ,
  paid_by BIGINT,
  cancel_reason TEXT,
  CHECK (ends_at > starts_at));
CREATE UNIQUE INDEX IF NOT EXISTS contests_one_live_idx ON contests((1)) WHERE status IN ('open','paying');
CREATE INDEX IF NOT EXISTS contests_status_idx ON contests(status, id DESC);

-- Final standings, written by the payout action (prize 0 = qualified but outside the prize list).
CREATE TABLE IF NOT EXISTS contest_entries(
  contest_id BIGINT NOT NULL REFERENCES contests(id),
  telegram_id BIGINT NOT NULL REFERENCES users(telegram_id),
  rank INTEGER NOT NULL,
  referrals INTEGER NOT NULL,
  last_at TIMESTAMPTZ,
  prize BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (contest_id, telegram_id));

INSERT INTO schema_migrations(version) VALUES('010_tasks_ads_contests') ON CONFLICT DO NOTHING;
