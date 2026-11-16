// Part 14: Weekly Missions. Pure helpers (the SQL lives in lib/actions/missions.js).
// A mission is a goal counted from Monday 00:00 (in the daily reward time zone) to the next Monday.
// Progress is READ from tables the app already keeps, so there is nothing new to cheat; the reward is a ledger row with a
// unique reference (mission:<week>:<id>:<user>), so each mission pays at most once per week even with parallel taps.
export const MISSION_IDS = ["daily", "tasks", "refs"];

export function missionDefs(cfg) {
  return [
    { id: "daily", icon: "📅", title: "Daily streak", unit: "daily reward", target: cfg.missionDailyTarget, reward: cfg.missionDailyReward, hint: `Claim your daily reward on ${cfg.missionDailyTarget} different days this week` },
    { id: "tasks", icon: "✅", title: "Task master", unit: "task", target: cfg.missionTasksTarget, reward: cfg.missionTasksReward, hint: `Complete ${cfg.missionTasksTarget} tasks this week` },
    { id: "refs", icon: "👥", title: "Invite friends", unit: "referral", target: cfg.missionRefsTarget, reward: cfg.missionRefsReward, hint: `Get ${cfg.missionRefsTarget} qualified referral${cfg.missionRefsTarget === 1 ? "" : "s"} this week` },
  ];
}

export const missionRef = (week, id, userId) => `mission:${week}:${id}:${userId}`;

const whole = (n) => (Number.isFinite(Number(n)) && Number(n) > 0 ? Math.floor(Number(n)) : 0);

/** progress = { daily, tasks, refs } (counts), claimed = Set of mission ids already paid this week. */
export function buildState(cfg, progress, claimed) {
  const items = missionDefs(cfg).map((m) => {
    const raw = whole(progress && progress[m.id]);
    return { id: m.id, icon: m.icon, title: m.title, hint: m.hint, target: m.target, reward: m.reward,
      progress: Math.min(raw, m.target), done: raw >= m.target, claimed: claimed.has(m.id) };
  });
  const allClaimed = items.every((i) => i.claimed);
  const bonusReward = whole(cfg.missionBonusReward);
  return {
    items,
    bonus: { reward: bonusReward, enabled: bonusReward > 0, available: bonusReward > 0 && allClaimed && !claimed.has("bonus"), claimed: claimed.has("bonus") },
  };
}

/** What a claim of `mission` would pay right now, or the reason it cannot be paid. */
export function claimPlan(state, mission) {
  if (mission === "bonus") {
    if (!state.bonus.enabled) return { ok: false, error: "There is no bonus this week" };
    if (state.bonus.claimed) return { ok: false, code: "already_claimed", error: "Bonus already claimed" };
    if (!state.bonus.available) return { ok: false, error: "Claim all three missions first" };
    return { ok: true, reward: state.bonus.reward, title: "All missions bonus" };
  }
  const m = state.items.find((i) => i.id === mission);
  if (!m) return { ok: false, error: "Unknown mission" };
  if (m.claimed) return { ok: false, code: "already_claimed", error: "Already claimed this week" };
  if (!m.done) return { ok: false, error: "Mission is not finished yet" };
  return { ok: true, reward: m.reward, title: m.title };
}
