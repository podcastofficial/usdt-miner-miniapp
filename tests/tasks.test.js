// Phase 2 / Part 4: task proofs, ad-campaign budget maths, referral contests.
// Pure logic + static checks of the SQL / migration / wiring (nothing talks to a database; see CHANGELOG_PART11.md for what must be verified live).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateProof, canProofMove, PROOF_STATES, proofAllowance, campaignBudget, campaignRefund, campaignLeft, afterCompletion, closeOutcome, PROOF_MAX } from "../lib/tasks.js";
import { parsePrizes, validateContestInput, rankStandings, totalPrizes, secondsLeft, isOver, KINDS } from "../lib/contests.js";
import { validateSetting, resolveConfig, SETTING_DEFS } from "../lib/settingsDefs.js";

const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const mig = read("db/migrations/010_tasks_ads_contests.sql"), earn = read("lib/actions/earn.js"), tsk = read("lib/actions/tasks.js"), cts = read("lib/actions/contests.js");
const camp = read("lib/campaigns.js"), api = read("api/index.js"), adm = read("lib/actions/admin.js"), com = read("lib/actions/community.js");

/* ---------------- proof validation + state machine ---------------- */
test("validateProof: trims, strips control / bidi characters, enforces 3..300", () => {
  assert.deepEqual(validateProof("  @my_name  "), { ok: true, value: "@my_name" });
  assert.equal(validateProof("ab").ok, false);
  assert.equal(validateProof("x".repeat(PROOF_MAX + 1)).ok, false);
  assert.equal(validateProof("x".repeat(PROOF_MAX)).ok, true);
  assert.equal(validateProof("a\u202eb\u0000c d").value, "abc d");
  assert.equal(validateProof(12345).ok, false); assert.equal(validateProof(null).ok, false); assert.equal(validateProof("\u200b\u200b\u200b").ok, false);
});

test("proof state machine: only pending moves, decisions are final", () => {
  assert.deepEqual(PROOF_STATES, ["pending", "approved", "rejected"]);
  assert.equal(canProofMove("pending", "approved"), true); assert.equal(canProofMove("pending", "rejected"), true);
  for (const from of ["approved", "rejected"]) for (const to of PROOF_STATES) assert.equal(canProofMove(from, to), false, `${from}->${to}`);
  assert.equal(canProofMove("pending", "pending"), false); assert.equal(canProofMove("__proto__", "approved"), false); assert.equal(canProofMove("constructor", "approved"), false);
});

test("proofAllowance: completed > live proof > attempts used > too many waiting", () => {
  const base = { hasLive: false, completed: false, rejectedCount: 0, pendingTotal: 0 };
  assert.equal(proofAllowance(base).ok, true);
  assert.equal(proofAllowance({ ...base, completed: true, hasLive: true }).code, "already_completed");
  assert.equal(proofAllowance({ ...base, hasLive: true }).code, "proof_exists");
  assert.equal(proofAllowance({ ...base, rejectedCount: 3 }).code, "proof_tries");
  assert.equal(proofAllowance({ ...base, rejectedCount: 2 }).ok, true);
  assert.equal(proofAllowance({ ...base, pendingTotal: 5 }).code, "too_many_pending");
  assert.equal(proofAllowance({ ...base, rejectedCount: 1 }, { maxTries: 1 }).code, "proof_tries");
});

/* ---------------- campaign budget maths ---------------- */
test("budget maths is integer only: budget, left, refund never negative", () => {
  assert.equal(campaignBudget({ reward: 50, target: 100 }), 5000);
  assert.equal(campaignRefund({ reward: 50, target: 100, spent: 0 }), 5000);
  assert.equal(campaignRefund({ reward: 50, target: 100, spent: 1250 }), 3750);
  assert.equal(campaignRefund({ reward: 50, target: 100, spent: 5000 }), 0);
  assert.equal(campaignRefund({ reward: 50, target: 100, spent: 9999 }), 0);
  assert.equal(campaignLeft({ target: 10, completed: 4 }), 6); assert.equal(campaignLeft({ target: 10, completed: 12 }), 0);
});

test("afterCompletion: spends exactly the reward, finishes on the last one, never overspends, closed campaigns pay nothing", () => {
  let c = { reward: 25, target: 3, spent: 0, status: "active" };
  const seen = [];
  for (let i = 0; i < 5; i++) { const r = afterCompletion(c); seen.push(r.counted); c = { ...c, spent: r.spent, status: r.status }; }
  assert.deepEqual(seen, [true, true, true, false, false]);
  assert.equal(c.spent, 75); assert.equal(c.status, "finished"); assert.equal(c.spent, campaignBudget(c));
  for (const status of ["pending", "cancelled", "rejected", "finished"]) assert.equal(afterCompletion({ reward: 5, target: 5, spent: 0, status }).counted, false, status);
  assert.equal(afterCompletion({ reward: 10, target: 2, spent: 15, status: "active" }).counted, false); // would exceed the budget
});

test("closeOutcome: pending = full refund, active = unused part, closed = nothing (refund once)", () => {
  assert.deepEqual(closeOutcome({ status: "pending", reward: 40, target: 10, spent: 0 }, { byOwner: true }), { to: "cancelled", refund: 400 });
  assert.deepEqual(closeOutcome({ status: "pending", reward: 40, target: 10, spent: 0 }), { to: "rejected", refund: 400 });
  assert.deepEqual(closeOutcome({ status: "active", reward: 40, target: 10, spent: 120 }), { to: "cancelled", refund: 280 });
  assert.deepEqual(closeOutcome({ status: "active", reward: 40, target: 10, spent: 120 }, { byOwner: true }), { to: "cancelled", refund: 280 });
  for (const status of ["finished", "cancelled", "rejected"]) assert.equal(closeOutcome({ status, reward: 40, target: 10, spent: 400 }), null, status);
});

test("conservation: paid to users + refunded to owner = budget, for any number of completions", () => {
  for (const [reward, target] of [[10, 10], [50, 100], [7, 13]]) for (let done = 0; done <= target; done++) {
    const spent = reward * done, refund = closeOutcome({ status: "active", reward, target, spent });
    assert.equal(spent + (refund ? refund.refund : 0), reward * target, `${reward}x${target} after ${done}`);
  }
});

/* ---------------- SQL shape: one statement, once only ---------------- */
test("claim statement: task row locked, campaign budget + completion row written in the same statement as the payout", () => {
  const stmt = earn.slice(earn.indexOf("const method ="), earn.indexOf("if (!r.length) {\n    const d = await sql"));
  assert.match(stmt, /FOR UPDATE\)/); assert.match(stmt, /proof_required=FALSE/);
  assert.match(stmt, /UPDATE campaigns SET spent=campaigns\.spent\+campaigns\.reward/); assert.match(stmt, /platform_fee/); // budget uses the advertiser's full cost, the joiner is paid c.reward (their share) assert.match(stmt, /INSERT INTO campaign_completions/);
  assert.match(stmt, /<= campaigns\.reward\*campaigns\.target/); assert.match(stmt, /'task:'\|\|u\.task_id::text\|\|':'\|\|\$\{id\}::text/);
  assert.equal((stmt.match(/await sql`/g) || []).length, 1, "ONE statement");
  assert.match(earn, /needs a proof/); assert.match(earn, /"proof_required"/);
});

test("proof approval pays through the SAME ledger reference and completion row as a normal claim (cannot pay twice)", () => {
  const a = tsk.slice(tsk.indexOf("export const adminTaskProofApprove"), tsk.indexOf("export const adminTaskProofReject"));
  assert.match(a, /FOR UPDATE/); assert.match(a, /INSERT INTO task_completions/); assert.match(a, /ON CONFLICT DO NOTHING/);
  assert.match(a, /'task:'\|\|u\.task_id::text\|\|':'\|\|u\.telegram_id::text/); assert.match(a, /status='pending'/); assert.match(a, /UPDATE task_proofs SET status='approved'/);
  assert.match(a, /INSERT INTO campaign_completions/); assert.match(a, /'proof'/); assert.match(a, /action: "taskproof\.approve"/);
  assert.equal((a.match(/await sql`/g) || []).length >= 1, true);
  assert.match(tsk, /action: "taskproof\.reject"/); assert.match(tsk, /status='pending' RETURNING/);
});

test("proof submit: one live proof per user+task (unique index), attempts and waiting limits in the INSERT itself", () => {
  const s = tsk.slice(tsk.indexOf("export const taskProofSubmit"), tsk.indexOf("// ---------------- admin"));
  assert.match(s, /proof_required=TRUE/); assert.match(s, /taskProofMaxPending/); assert.match(s, /taskProofMaxTries/); assert.match(s, /isUniqueViolation/);
  assert.match(s, /NOT EXISTS\(SELECT 1 FROM task_completions/); assert.match(s, /taskProofEnabled/);
  assert.match(mig, /CREATE UNIQUE INDEX IF NOT EXISTS task_proofs_live_idx ON task_proofs\(task_id, telegram_id\) WHERE status IN \('pending','approved'\)/);
});

test("campaign close: ONE statement, compare-and-set status, refund = reward x target - spent, unique ledger ref, task switched off", () => {
  assert.match(camp, /WHERE id=\$\{cid\}::bigint AND status=\$\{from\}::text/); assert.match(camp, /GREATEST\(reward \* target - spent, 0\)/);
  assert.match(camp, /'cmprefund:'\|\|cid::text/); assert.match(camp, /UPDATE tasks SET active=FALSE/); assert.equal((camp.match(/await sql`/g) || []).length, 1);
  assert.match(adm, /closeCampaign\(/); assert.match(com, /closeCampaign\(/); assert.doesNotMatch(adm, /'cmprefund:'/); assert.doesNotMatch(com, /'cmprefund:'/); // the refund SQL lives only in lib/campaigns.js
  assert.match(com, /status IN \('pending','active'\)/); assert.match(com, /ownerId: id/);
});

test("approving a bot / website campaign makes it a proof task only while proofs are ON", () => {
  assert.match(adm, /taskProofEnabled === true/); assert.match(adm, /proof_required,proof_hint/); assert.match(adm, /c\.type !== "channel"/);
});

/* ---------------- migration ---------------- */
test("migration 010 is idempotent and records itself", () => {
  for (const m of mig.matchAll(/CREATE TABLE (?!IF NOT EXISTS)/g)) assert.fail("CREATE TABLE without IF NOT EXISTS");
  for (const m of mig.matchAll(/CREATE (UNIQUE )?INDEX (?!IF NOT EXISTS)/g)) assert.fail("CREATE INDEX without IF NOT EXISTS");
  for (const m of mig.matchAll(/ADD COLUMN (?!IF NOT EXISTS)/g)) assert.fail("ADD COLUMN without IF NOT EXISTS");
  assert.match(mig, /DROP CONSTRAINT IF EXISTS campaigns_status_chk/); assert.match(mig, /'finished'/);
  assert.match(mig, /INSERT INTO schema_migrations\(version\) VALUES\('010_tasks_ads_contests'\) ON CONFLICT DO NOTHING/);
  for (const t of ["task_proofs", "campaign_completions", "contests", "contest_entries"]) assert.match(mig, new RegExp(`CREATE TABLE IF NOT EXISTS ${t}\\(`), t);
  assert.match(mig, /UNIQUE \(campaign_id, telegram_id\)/); assert.match(mig, /contests_one_live_idx ON contests\(\(1\)\) WHERE status IN \('open','paying'\)/);
});

/* ---------------- contests ---------------- */
test("parsePrizes: lists or strings, whole Points, never increasing, 1..10 prizes", () => {
  assert.deepEqual(parsePrizes("5000, 3000 1000"), { ok: true, value: [5000, 3000, 1000] });
  assert.deepEqual(parsePrizes([100, 100, 50]).value, [100, 100, 50]);
  for (const bad of ["", "0", "-5", "1.5", "abc", "100 200", "5000,3000,4000", [], null, Array(11).fill(5), "99999999999"]) assert.equal(parsePrizes(bad).ok, false, JSON.stringify(bad));
});

test("validateContestInput: weekly = 7 days, monthly = 30, custom needs 1..90 days", () => {
  const now = new Date("2026-11-15T10:00:00Z");
  const w = validateContestInput({ kind: "weekly", title: "Invite Race", prizes: "500,200" }, now);
  assert.equal(w.ok, true); assert.equal(w.value.endsAt, "2026-11-22T10:00:00.000Z"); assert.equal(w.value.minReferrals, 1);
  assert.equal(validateContestInput({ kind: "monthly", title: "Month Cup", prizes: [100] }, now).value.endsAt, "2026-12-15T10:00:00.000Z");
  assert.equal(validateContestInput({ kind: "custom", title: "Short", prizes: "10", days: 3 }, now).value.days, 3);
  for (const bad of [{ kind: "custom", title: "Short", prizes: "10" }, { kind: "custom", title: "Short", prizes: "10", days: 91 }, { kind: "yearly", title: "Nope", prizes: "10" },
    { kind: "weekly", title: "ab", prizes: "10" }, { kind: "weekly", title: "Fine title", prizes: "" }, { kind: "weekly", title: "Fine title", prizes: "10", minReferrals: 0 }, null])
    assert.equal(validateContestInput(bad, now).ok, false, JSON.stringify(bad));
  assert.deepEqual(Object.keys(KINDS), ["weekly", "monthly", "custom"]);
});

test("rankStandings: more referrals first; a tie goes to whoever reached the number first; same instant -> lower id", () => {
  const rows = [
    { telegram_id: "30", referrals: 5, last_at: "2026-11-16T10:00:00Z" },
    { telegram_id: "10", referrals: 5, last_at: "2026-11-15T12:00:00Z" },   // same count, reached earlier -> rank 1
    { telegram_id: "20", referrals: 9, last_at: "2026-11-17T00:00:00Z" },   // most referrals -> rank 1 overall
    { telegram_id: "50", referrals: 3, last_at: "2026-11-15T09:00:00Z" },
    { telegram_id: "40", referrals: 3, last_at: "2026-11-15T09:00:00Z" },   // identical instant -> lower id (40) first
  ];
  const r = rankStandings(rows, { prizes: [500, 300, 100], minReferrals: 1 });
  assert.deepEqual(r.map(x => x.telegram_id), ["20", "10", "30", "40", "50"]);
  assert.deepEqual(r.map(x => x.rank), [1, 2, 3, 4, 5]);
  assert.deepEqual(r.map(x => x.prize), [500, 300, 100, 0, 0]);
  assert.equal(new Set(r.map(x => x.rank)).size, r.length, "ranks are unique, a prize is never split");
});

test("rankStandings: below the minimum = not ranked; Date objects and huge ids are fine; input is not mutated", () => {
  const rows = [{ telegram_id: "9007199254740993", referrals: 2, last_at: new Date("2026-11-15T10:00:00Z") }, { telegram_id: "9007199254740992", referrals: 2, last_at: new Date("2026-11-15T10:00:00Z") }, { telegram_id: "7", referrals: 1, last_at: "2026-11-15T10:00:00Z" }];
  const copy = JSON.stringify(rows);
  const r = rankStandings(rows, { prizes: [10, 5, 1], minReferrals: 2 });
  assert.deepEqual(r.map(x => x.telegram_id), ["9007199254740992", "9007199254740993"]); assert.equal(JSON.stringify(rows), copy);
  assert.deepEqual(rankStandings([], { prizes: [1] }), []); assert.deepEqual(rankStandings(null), []);
  assert.deepEqual(rankStandings(rows, { prizes: [10], minReferrals: 99 }), []);
});

test("prize totals and countdown helpers", () => {
  assert.equal(totalPrizes([5000, 3000, 1000]), 9000); assert.equal(totalPrizes(null), 0);
  const now = Date.parse("2026-11-15T10:00:00Z");
  assert.equal(secondsLeft("2026-11-15T10:01:00Z", now), 60); assert.equal(secondsLeft("2026-11-15T09:00:00Z", now), 0);
  assert.equal(secondsLeft(new Date("2026-11-15T10:00:30Z"), now), 30); assert.equal(isOver("2026-11-15T10:00:00Z", now), true); assert.equal(isOver("2026-11-15T10:00:01Z", now), false);
});

test("contest payout: resumable status machine, idempotent ledger ref, confirm word, audit, blocked inviters excluded", () => {
  const pay = cts.slice(cts.indexOf("export const adminContestPay"));
  assert.match(pay, /String\(body\.confirm \|\| ""\)\.trim\(\)\.toUpperCase\(\) !== "PAY"/); assert.match(pay, /status='paying' WHERE id=\$\{cid\}::bigint AND status='open' AND ends_at <= NOW\(\)/);
  assert.match(pay, /`contest:\$\{cid\}:\$\{w\.telegram_id\}`/); assert.match(pay, /status='paid'.*status='paying'/s); assert.match(pay, /action: "contest\.pay"/); assert.match(pay, /partial_payout/);
  assert.match(cts, /u\.is_blocked=FALSE/); assert.match(cts, /qualified_at >= c\.starts_at AND e\.qualified_at < c\.ends_at/); assert.match(cts, /ORDER BY referrals DESC, last_at ASC, e\.referrer_id ASC/);
  assert.match(cts, /contest\.create/); assert.match(cts, /contest\.cancel/); assert.match(cts, /status='open' RETURNING/);
  assert.match(cts, /23505/); assert.match(cts, /Contest Prize/);
});

/* ---------------- settings + wiring ---------------- */
test("everything that pays Points ships OFF; limits have sane starters", () => {
  assert.equal(SETTING_DEFS.task_proof_enabled.def, false); assert.equal(SETTING_DEFS.contests_enabled.def, false);
  const c = resolveConfig([]);
  assert.equal(c.taskProofEnabled, false); assert.equal(c.contestsEnabled, false); assert.equal(c.taskProofMaxPending, 5); assert.equal(c.taskProofMaxTries, 3);
  assert.equal(validateSetting("task_proof_enabled", "true").value, true); assert.equal(validateSetting("task_proof_max_tries", 0).ok, false); assert.equal(validateSetting("task_proof_max_pending", 51).ok, false);
  for (const k of ["task_proof_enabled", "task_proof_max_pending", "task_proof_max_tries", "contests_enabled"]) assert.equal(SETTING_DEFS[k].group, "Tasks, Ads & Contests");
});

test("API registry: user actions are POST for writes, admin actions are admin-only, rate limits exist", () => {
  const def = (n) => new RegExp(`${n}: \\{ fn: [\\w.]+(, admin: true)?(, write: true)? \\}`).exec(api);
  for (const n of ["taskProofSubmit", "adminTaskProofApprove", "adminTaskProofReject", "adminContestCreate", "adminContestCancel", "adminContestPay"]) assert.match(def(n)[0], /write: true/, n + " must be POST");
  for (const n of ["adminTaskProofs", "adminTaskProofApprove", "adminTaskProofReject", "adminContestList", "adminContestCreate", "adminContestCancel", "adminContestPay"]) assert.match(def(n)[0], /admin: true/, n + " must be admin-only");
  for (const n of ["taskProofSubmit", "contests"]) assert.doesNotMatch(def(n)[0], /admin: true/);
  const rl = read("lib/ratelimit.js"); assert.match(rl, /taskProofSubmit: \[5, 60\]/); assert.match(rl, /contests: \[20, 60\]/);
});

test("frontend: screens, handlers, admin tabs, version and check script", () => {
  const html = read("public/index.html"), app = read("public/app.js"), a = read("public/admin.js"), pkg = JSON.parse(read("package.json"));
  for (const id of ["taskproof", "contests", "pf_text", "pf_title", "pf_hint", "pf_note", "ctlist"]) assert.ok(html.includes(`id="${id}"`), id);
  assert.match(html, /data-go="contests"/); assert.match(html, /<label for="pf_text">/);
  for (const h of ["proofOpen", "proofOpenLink", "proofSend", "goRef"]) assert.match(app, new RegExp(`^  (async )?${h}\\(`, "m"), h);
  assert.match(app, /taskProofSubmit/); assert.match(app, /api\('contests'\)/); assert.match(app, /taskproof: 'tasks'/); assert.match(app, /contests: 'more'/);
  assert.match(a, /\['tpf','🧾','Task proofs'/); assert.match(a, /\['cts','🏁','Contests'/);
  for (const m of ["tp", "ctCreate", "ctPay", "ctCancel"]) assert.match(a, new RegExp(`^ (async )?${m}\\(`, "m"), m);
  assert.match(a, /'tp','ctPay','ctCancel'/); assert.match(a, /proofRequired:v\('proof'\)==='yes'/);
  assert.match(pkg.version, /^1\.(1[1-9]|[2-9]\d)\.\d+$/); // 1.11.0 or newer
  for (const f of ["lib/tasks.js", "lib/contests.js", "lib/campaigns.js", "lib/actions/tasks.js", "lib/actions/contests.js"]) assert.ok(pkg.scripts.check.includes(f), f);
});

test("bootstrap hides proof tasks while proofs are OFF and reports each user's proof status", () => {
  const core = read("lib/actions/core.js");
  assert.match(core, /taskProofEnabled\}::boolean OR t\.proof_required=FALSE/); assert.match(core, /AS proof_status/); assert.match(core, /AS proof_reason/);
});

test("Advertise split: joiner gets the configured share, platform keeps the rest, never 0 for the joiner", async () => {
  const { splitReward } = await import("../lib/tasks.js");
  assert.deepEqual(splitReward({ reward: 100, pct: 50 }), { user: 50, platform: 50 });
  assert.deepEqual(splitReward({ reward: 101, pct: 50 }), { user: 50, platform: 51 });
  assert.deepEqual(splitReward({ reward: 10, pct: 1 }), { user: 1, platform: 9 });
  assert.deepEqual(splitReward({ reward: 100, pct: 100 }), { user: 100, platform: 0 });
  assert.deepEqual(splitReward({ reward: 100, pct: 500 }), { user: 100, platform: 0 });
});
