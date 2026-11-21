-- Configurable multi-asset deposit methods with manual review. Idempotent.
ALTER TABLE deposits ADD COLUMN IF NOT EXISTS asset TEXT;
ALTER TABLE deposits ADD COLUMN IF NOT EXISTS network TEXT;
ALTER TABLE deposits ADD COLUMN IF NOT EXISTS method_id TEXT;
ALTER TABLE deposits ADD COLUMN IF NOT EXISTS amount_native NUMERIC(30,12);
ALTER TABLE deposits ADD COLUMN IF NOT EXISTS method_min NUMERIC(30,12);
INSERT INTO schema_migrations(version) VALUES('026_manual_deposit_methods') ON CONFLICT DO NOTHING;
