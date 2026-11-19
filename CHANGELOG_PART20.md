# Part 20 — VIP and referral commission foundation

Adds VIP status derived from lifetime positive ledger entries: Bronze (0), Silver (10,000), Gold (50,000), Diamond (200,000). Adds an auditable referral commission ledger table with unique source references. Commission rate is fixed at 1%, but accrual remains OFF by default (`referral_commission_enabled=false`) and is not automatically credited in this release; enable only after the earning-source policy and liability controls are reviewed.

New API action: `vipInfo`.

New migration: `db/migrations/018_part20_vip.sql`.
