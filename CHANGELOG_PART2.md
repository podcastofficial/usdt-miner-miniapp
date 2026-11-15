# Part 2 of 7 — Points & Earning
## Decisions applied
- Daily reward = **100 Points** (stored in `settings.daily_reward`, not hard-coded). Reset time zone = `settings.daily_timezone` (default `Asia/Kolkata`, same as the starter).
- Bot / website tasks are verified by a **server-side timer proof**: Start → server saves the start time → claim accepted only after `timer_seconds` (default 30, per task 10–600). Channel tasks are verified through Telegram `getChatMember`.
## New / changed
- `db/migrations/002_points_and_tasks.sql` (ledger `status`/`metadata`, `task_attempts`, `tasks.timer_seconds`, `task_completions.evidence`, daily = 100)
- `lib/actions/earn.js` (daily, taskStart, taskComplete, history, adminCreateTask, adminSetTaskActive, adminReconcile), `lib/settings.js`
- `lib/ledger.js` (`creditEx` reports duplicates, metadata support), `lib/actions/core.js` (bootstrap returns per-task state + daily state)
- Daily claim and task completion are each ONE atomic SQL statement (claim/completion row + balance + ledger entry together; duplicates impossible).
- Frontend: task buttons Start → ⏳ countdown → Claim, Done ✓; daily button shows Claimed ✓; history has "Load more".
- Removed `ALLOW_UNVERIFIED_TASKS` flag (replaced by the timer verification).
## Admin API (UI comes in Part 5)
`adminCreateTask {type,title,link,reward,target,timerSeconds,telegramChannel}` · `adminSetTaskActive {taskId,active,reason}` · `adminReconcile` (ledger vs balances + total liability)
## Upgrade
1. Run `db/migrations/002_points_and_tasks.sql` in Neon. 2. Remove `ALLOW_UNVERIFIED_TASKS` from Vercel (optional). 3. Redeploy.
## Honest limits
A timer proves the user waited, not that they truly joined/used the bot or site. Keep timer-task rewards small; per-task rate limits and one-completion-per-user apply. Channel tasks need the bot to be an admin of that channel.
