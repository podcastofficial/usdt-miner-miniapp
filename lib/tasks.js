// Phase 2 / Part 4: pure helpers for task proofs and ad-campaign budget maths (no DB, no network -> unit-testable).
// The SQL in lib/actions/earn.js, lib/actions/tasks.js and lib/campaigns.js mirrors these rules; tests/tasks.test.js pins them.
import { cleanText } from "./community.js";

export const PROOF_MIN = 3, PROOF_MAX = 300;

/** Proof text typed by the user (a @username, a code the bot showed, a link). Control / bidi characters are stripped. */
export function validateProof(v) {
  if (typeof v !== "string") return { ok: false, error: "Write your proof first" };
  const s = cleanText(v, PROOF_MAX + 1);
  if (s.length < PROOF_MIN) return { ok: false, error: `Proof must be at least ${PROOF_MIN} characters` };
  if (s.length > PROOF_MAX) return { ok: false, error: `Proof can be at most ${PROOF_MAX} characters` };
  return { ok: true, value: s };
}

/** Proof state machine: only a pending proof can be decided, and a decision is final (a rejected user submits a NEW proof). */
export const PROOF_STATES = ["pending", "approved", "rejected"];
const NEXT = { pending: ["approved", "rejected"], approved: [], rejected: [] };
export const canProofMove = (from, to) => Object.prototype.hasOwnProperty.call(NEXT, from) && NEXT[from].includes(to);

/** May this user submit another proof for the task? rejectedCount = how many of THEIR proofs for it were rejected. */
export function proofAllowance({ hasLive, completed, rejectedCount, pendingTotal }, { maxTries = 3, maxPending = 5 } = {}) {
  if (completed) return { ok: false, code: "already_completed", error: "Already completed" };
  if (hasLive) return { ok: false, code: "proof_exists", error: "You already have a proof waiting for review" };
  if (rejectedCount >= maxTries) return { ok: false, code: "proof_tries", error: `You used all ${maxTries} attempts for this task` };
  if (pendingTotal >= maxPending) return { ok: false, code: "too_many_pending", error: `You can have at most ${maxPending} proofs waiting for review` };
  return { ok: true };
}

/* ---------- campaign budget maths (integer only) ---------- */
export const campaignBudget = ({ reward, target }) => reward * target;
/** Unused budget = what the owner paid minus what completions consumed. Never negative. */
export const campaignRefund = ({ reward, target, spent }) => Math.max(0, reward * target - spent);
export const campaignLeft = ({ target, completed }) => Math.max(0, target - completed);

/** Mirrors the `cm` CTE in the claim statements: one completion consumes `reward`; the campaign finishes when the budget is used up. */
export function afterCompletion({ reward, target, spent, status }) {
  if (status !== "active") return { spent, status, counted: false }; // a closed campaign never consumes budget
  const next = spent + reward;
  if (next > reward * target) return { spent, status, counted: false }; // can never overspend the budget
  return { spent: next, status: next >= reward * target ? "finished" : "active", counted: true };
}

/** Owner / admin close: pending -> (rejected | cancelled by owner) with the full budget back, active -> cancelled with the unused part. */
export function closeOutcome({ status, reward, target, spent }, { byOwner = false } = {}) {
  if (status === "pending") return { to: byOwner ? "cancelled" : "rejected", refund: campaignRefund({ reward, target, spent: 0 }) };
  if (status === "active") return { to: "cancelled", refund: campaignRefund({ reward, target, spent }) };
  return null; // finished / rejected / cancelled: already closed, nothing to refund (and nothing can be refunded twice)
}
