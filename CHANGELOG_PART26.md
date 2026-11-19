# Part 26 — Referral Challenges

Adds admin-created, time-boxed referral challenges with a qualified-referral target and Points reward. Qualification uses existing `referral_events`; rewards are claimable once per user/challenge and credited with a matching ledger row. The feature is OFF by default. Challenge creation is audited.

API: `referralChallenges`, `referralChallengeClaim`, `adminReferralChallenges`, `adminReferralChallengeSave`.
Setting: `referral_challenges_enabled` (OFF).
Migration: `024_part26_referral_challenges.sql`.
