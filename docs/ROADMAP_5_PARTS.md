# Next phase: delivery in 5 parts (cumulative, after v1.7.0)
Each part ships: changed files only, one new migration (idempotent, `schema_migrations` row), new tests, `CHANGELOG_PART8..12.md`, README status update.
Defaults are editable in Admin > Settings. Anything touching money/abuse ships **OFF** until you enable it.

## Part 1 — Bot Notifications & Broadcast (v1.8.0) — DONE
| Feature | Details |
|---|---|
| Webhook | `/api?action=tgWebhook`, verified by `X-Telegram-Bot-Api-Secret-Token` (new env `TG_WEBHOOK_SECRET`) |
| User alerts | withdrawal approved / paid (with hash) / rejected, referral joined, daily reminder |
| Broadcast | admin composes message; segments: all, active 7d, balance > 0, new 24h; queued in DB, sent in small batches |
| Proof auto-post | paid withdrawal posts masked proof to payments channel |
| Settings | `notify_withdrawal`, `notify_referral`, `notify_reminder` (OFF), `proof_autopost` (OFF), `broadcast_enabled`. Reminder time = the daily cron time in `vercel.json` (Hobby plan allows once a day), so there is no `reminder_hour` setting |
| DB | `007_notifications.sql`: `notification_queue` (unique `dedupe_key`), `broadcasts`, `users.bot_blocked`, `withdrawals.proof_posted_at` |
| Tests | queue idempotency, segment queries, secret-token check, masking |

## Part 2 — Engagement & Retention (v1.9.0) — DONE
| Feature | Details |
|---|---|
| Daily streak | 7-day ladder (starter: 100, 120, 140, 160, 180, 200, 300), reset after a missed day, uses existing daily time zone. Ladder switch `streak_enabled` ships OFF; the streak is tracked either way |
| My Referrals | paginated list (masked names), qualified vs pending |
| Milestones | 5 / 10 / 50 qualified referrals, each paid once via ledger reference |
| Levels & badges | Bronze → Gold by lifetime earned Points; badge list on profile |
| Promo codes | admin creates code, reward, per-user limit, total limit, expiry; redeem is atomic + rate limited |
| DB | `008_engagement.sql`: `streaks`, `milestones_paid`, `badges`, `promo_codes`, `promo_redemptions` |
| Tests | streak reset, milestone once-only, promo limits and double-redeem |

## Part 3 — Games & Boosters (v1.10.0) — DONE
| Feature | Details |
|---|---|
| Spin / Scratch / Lucky Box | outcome chosen on the server with crypto-random, stored before shown; prize table editable by admin |
| Limits | free plays per day, optional Points entry fee, max win cap per day per user |
| Lucky Draw | weekly, Points = ticket, admin draws winner (logged in audit) |
| Boosters | Points-only, time-limited multiplier on daily reward; one active at a time |
| Admin | game on/off switches, expected payout (house edge) preview, plays report |
| DB | `009_games.sql`: `game_plays`, `game_prizes`, `draws`, `draw_tickets`, `boosters` |
| Tests | outcome distribution, caps, no double play, ledger balance after plays |

## Part 4 — Tasks, Ads & Contests (v1.11.0) — DONE
| Feature | Details |
|---|---|
| Bot/website tasks | user submits proof, admin review queue, approve pays Points once; `ALLOW_UNVERIFIED_TASKS` stays false |
| Ad delivery | approved campaigns show in Tasks, each completion verified, budget consumed, unused budget refunded on finish/cancel |
| Contests | weekly / monthly referral contest, live leaderboard, prize list set by admin, payout action with audit |
| DB | `010_tasks_ads_contests.sql`: `task_proofs`, `campaign_completions`, `contests`, `contest_entries` |
| Tests | proof state machine, budget maths, refund once, contest ranking and ties |

## Part 5 — Safety, Admin & Growth (v1.12.0) — DONE
| Feature | Details |
|---|---|
| Fraud flags | same-wallet across users, referral bursts, rapid claims; auto-flag + admin review, never auto-ban |
| Admin roles | Super admin / Support / Finance; every admin action checks permission and is audited |
| CSV export | users, withdrawals, deposits, ledger (admin only, audited) |
| Analytics | DAU, retention, referral conversion, Points in/out charts |
| Languages | English / Hindi / Hinglish string files, language switch, light theme |
| Health alerts | Telegram message to admins on API errors, ledger mismatch, many open withdrawals |
| Deposits | auto-credit stays OFF until a real small test passes |
| DB | `011_safety_admin.sql`: `fraud_flags`, `admin_roles`, `user_lang` |
| Tests | permission matrix, flag rules, CSV escaping, i18n key coverage |

## Owner confirmations needed (not invented)
Streak ladder values · level thresholds · game prize table and entry fees · booster cost/multiplier · contest prizes · who gets which admin role · whether Payment Proof auto-post stays public.
## Always still your job
Real-money safety (no private keys, manual payouts), privacy policy/Terms, local-law check, tiny-amount live tests from `docs/TEST_MATRIX.md`.
