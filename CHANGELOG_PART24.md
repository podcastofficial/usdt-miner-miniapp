# Part 24 — Premium Membership Foundation

Adds Silver and Gold tiers, a user membership status endpoint, and Points-funded membership purchase. Membership purchase uses a single database statement to update the Points balance, membership expiry, and ledger transaction together. Premium is OFF by default and tier definitions are inactive until explicitly enabled by an administrator. No fiat, crypto, card, or third-party subscription billing is included.

API: `premiumInfo`, `premiumBuy`, `adminPremiumTiers`, `adminPremiumTierSave`.
Setting: `premium_enabled` (OFF).
Migration: `022_part24_premium.sql`.
