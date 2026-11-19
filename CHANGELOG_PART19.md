# Part 19 — Retention extras

Additive backend release. Adds a 30-day daily check-in calendar and a once-per-UTC-day Mystery Box API. Mystery Box defaults OFF (`mystery_box_enabled=false`); when enabled, server-side crypto randomness selects 10–100 MINER and a unique user/date key prevents duplicate claims. Existing daily reward/streak logic is unchanged.

New API actions: `checkinCalendar`, `mysteryBoxInfo`, `mysteryBoxClaim`.

New migration: `db/migrations/017_part19_retention.sql`.
