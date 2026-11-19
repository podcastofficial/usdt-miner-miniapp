# Part 21 — Support, achievements and season-pass foundation

Adds user-owned support tickets (maximum 5 open/answered tickets; bounded subject/message lengths), share-card statistics, achievement badge listing, and a disabled season-pass status endpoint. Season Pass defaults OFF (`season_pass_enabled=false`) and has no reward/payout path until configured.

New API actions: `shareCardInfo`, `supportTicketCreate`, `supportTicketList`, `achievementsInfo`, `seasonPassInfo`.

New migration: `db/migrations/019_part21_support_season.sql`.
