-- Part 13 (v1.13.0): languages. Idempotent (safe to run twice). Run it in Neon BEFORE redeploying.
-- Hinglish is removed. Existing "hinglish" users move to English (they can pick another language in More > Settings).
UPDATE users SET user_lang='en' WHERE user_lang='hinglish';

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_user_lang_chk;
ALTER TABLE users ADD CONSTRAINT users_user_lang_chk
  CHECK (user_lang IS NULL OR user_lang IN ('en','hi','es','ar','ru','pt','fr','tr','id'));

INSERT INTO schema_migrations(version) VALUES('012_languages') ON CONFLICT DO NOTHING;
