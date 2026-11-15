-- Phase 2 / Part 3: Games & Boosters (Points only, never real money). Idempotent: safe to run twice.

-- Prize tables (editable in Admin > Games). `weight` is relative: chance = weight / sum(weights of ACTIVE prizes of that game).
CREATE TABLE IF NOT EXISTS game_prizes(
  id BIGSERIAL PRIMARY KEY,
  game TEXT NOT NULL CHECK (game IN ('spin','scratch','box')),
  label TEXT NOT NULL CHECK (char_length(label) BETWEEN 1 AND 30),
  points BIGINT NOT NULL CHECK (points >= 0 AND points <= 1000000),
  weight INTEGER NOT NULL CHECK (weight BETWEEN 1 AND 1000000),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE INDEX IF NOT EXISTS game_prizes_game_idx ON game_prizes(game, id) WHERE active;

-- Per user / day / game counters. The play statement upserts this row FIRST; its `WHERE plays < allowed` is evaluated on the locked row,
-- so two parallel requests can never both take the last free play. `won` is the day's total PAID prize (the win cap is applied to it).
CREATE TABLE IF NOT EXISTS game_daily(
  telegram_id BIGINT NOT NULL REFERENCES users(telegram_id),
  play_date DATE NOT NULL,
  game TEXT NOT NULL CHECK (game IN ('spin','scratch','box')),
  plays INTEGER NOT NULL DEFAULT 0 CHECK (plays >= 0),
  won BIGINT NOT NULL DEFAULT 0 CHECK (won >= 0),
  last_credit BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (telegram_id, play_date, game));

-- One row per play. The outcome (prize drawn on the server with crypto-random) is written in the same statement that pays it,
-- i.e. BEFORE the app shows anything to the player.
CREATE TABLE IF NOT EXISTS game_plays(
  id BIGSERIAL PRIMARY KEY,
  telegram_id BIGINT NOT NULL REFERENCES users(telegram_id),
  game TEXT NOT NULL CHECK (game IN ('spin','scratch','box')),
  play_date DATE NOT NULL,
  fee BIGINT NOT NULL DEFAULT 0 CHECK (fee >= 0),
  prize_id BIGINT,
  prize_drawn BIGINT NOT NULL CHECK (prize_drawn >= 0),
  prize_paid BIGINT NOT NULL CHECK (prize_paid >= 0),
  outcome JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE INDEX IF NOT EXISTS game_plays_user_idx ON game_plays(telegram_id, id DESC);
CREATE INDEX IF NOT EXISTS game_plays_created_idx ON game_plays(created_at DESC);

-- Weekly Lucky Draw. Ticket price and prize are fixed per draw when the admin creates it.
CREATE TABLE IF NOT EXISTS draws(
  id BIGSERIAL PRIMARY KEY,
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 60),
  ticket_price BIGINT NOT NULL CHECK (ticket_price > 0),
  prize BIGINT NOT NULL CHECK (prize > 0),
  max_tickets_per_user INTEGER NOT NULL DEFAULT 10 CHECK (max_tickets_per_user BETWEEN 1 AND 1000),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','drawn','cancelled')),
  ends_at TIMESTAMPTZ,
  winner_id BIGINT REFERENCES users(telegram_id),
  winner_tickets INTEGER,
  total_tickets INTEGER,
  created_by BIGINT,
  drawn_by BIGINT,
  drawn_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
-- At most ONE open draw at a time.
CREATE UNIQUE INDEX IF NOT EXISTS draws_one_open_idx ON draws((1)) WHERE status = 'open';

-- Tickets per user per draw (aggregated: one row, a counter). The upsert's WHERE enforces max_tickets_per_user on the locked row.
CREATE TABLE IF NOT EXISTS draw_tickets(
  draw_id BIGINT NOT NULL REFERENCES draws(id),
  telegram_id BIGINT NOT NULL REFERENCES users(telegram_id),
  tickets INTEGER NOT NULL CHECK (tickets >= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (draw_id, telegram_id));

-- Mining Boosters: history of purchases ...
CREATE TABLE IF NOT EXISTS boosters(
  id BIGSERIAL PRIMARY KEY,
  telegram_id BIGINT NOT NULL REFERENCES users(telegram_id),
  multiplier_pct INTEGER NOT NULL CHECK (multiplier_pct BETWEEN 101 AND 500),
  cost BIGINT NOT NULL CHECK (cost > 0),
  starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ends_at TIMESTAMPTZ NOT NULL);
CREATE INDEX IF NOT EXISTS boosters_user_idx ON boosters(telegram_id, id DESC);
-- ... and the live state on the user row. "One active booster at a time" is enforced by the purchase statement's
-- `WHERE booster_until IS NULL OR booster_until <= NOW()` on the LOCKED user row (re-checked under concurrency).
ALTER TABLE users ADD COLUMN IF NOT EXISTS booster_until TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS booster_pct INTEGER NOT NULL DEFAULT 100;

-- Starter prize tables (owner confirms / edits in Admin > Games). Only seeded when the table is empty, so re-running never duplicates.
-- Starter expected value per play: spin 11.6, scratch 4.65, box 9.75 Points. Games ship OFF, so none of this is live until you enable it.
INSERT INTO game_prizes(game,label,points,weight)
SELECT v.game, v.label, v.points, v.weight FROM (VALUES
  ('spin','Try again',0,400),('spin','5 Points',5,300),('spin','10 Points',10,150),('spin','20 Points',20,80),
  ('spin','50 Points',50,40),('spin','100 Points',100,20),('spin','250 Points',250,8),('spin','500 Points',500,2),
  ('scratch','No match',0,600),('scratch','5 Points',5,250),('scratch','10 Points',10,100),('scratch','25 Points',25,40),
  ('scratch','100 Points',100,9),('scratch','500 Points',500,1),
  ('box','Empty box',0,300),('box','5 Points',5,350),('box','10 Points',10,200),('box','20 Points',20,100),
  ('box','50 Points',50,40),('box','200 Points',200,10)
) AS v(game,label,points,weight)
WHERE NOT EXISTS (SELECT 1 FROM game_prizes);

INSERT INTO schema_migrations(version) VALUES('009_games') ON CONFLICT DO NOTHING;
