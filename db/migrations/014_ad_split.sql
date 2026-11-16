-- Advertise reward split: the advertiser pays `reward` per completion; the joiner gets ad_user_share_pct % of it and the platform keeps the rest.
-- Run this BEFORE redeploying. Admin-created tasks are not touched (they have no campaign row).
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS user_reward BIGINT;           -- what the joiner gets (NULL = old campaign: joiner gets the full reward)
ALTER TABLE campaign_completions ADD COLUMN IF NOT EXISTS platform_fee BIGINT NOT NULL DEFAULT 0;  -- reward (advertiser cost) - what the joiner got
