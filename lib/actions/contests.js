// Phase 2 / Part 4: referral contests. Live leaderboard = qualified referrals (referral_events) that happened inside the contest window.
// Prizes are paid by the admin's payout action: resumable (status open -> paying -> paid) and idempotent (ledger ref contest:<id>:<user>).
import { sql } from "../db.js";
import { HttpError } from "../http.js";
import { audit } from "../audit.js";
import { creditEx } from "../ledger.js";
import { getConfig } from "../runtime.js";
import { publicName, cleanText } from "../community.js";
import { validateContestInput, rankStandings, STANDINGS_LIMIT, totalPrizes, secondsLeft, isOver } from "../contests.js";

const bad = (msg, code = "bad_request", status = 400) => new HttpError(status, code, msg);
const posInt = (v) => { const n = Number(v); return Number.isSafeInteger(n) && n > 0 ? n : null; };

/** Qualified referrals per inviter inside the contest window (blocked inviters never count). Same order the ranking uses. */
async function standings(cid) {
  return sql`
    SELECT e.referrer_id::text AS telegram_id, COUNT(*)::int AS referrals, MAX(e.qualified_at) AS last_at, u.first_name, u.username
    FROM contests c
    JOIN referral_events e ON e.qualified_at >= c.starts_at AND e.qualified_at < c.ends_at
    JOIN users u ON u.telegram_id=e.referrer_id AND u.is_blocked=FALSE
    WHERE c.id=${cid}::bigint
    GROUP BY e.referrer_id, u.first_name, u.username
    ORDER BY referrals DESC, last_at ASC, e.referrer_id ASC LIMIT ${STANDINGS_LIMIT}::int`;
}
const view = (c) => ({
  id: Number(c.id), kind: c.kind, title: c.title, prizes: c.prizes, min_referrals: c.min_referrals, status: c.status,
  starts_at: c.starts_at, ends_at: c.ends_at, seconds_left: secondsLeft(c.ends_at), over: isOver(c.ends_at), total_prizes: totalPrizes(c.prizes),
});

// ---------------- user ----------------
export const contests = async ({ id }) => {
  const cfg = await getConfig();
  if (!cfg.contestsEnabled) return { enabled: false, current: null, last: null };
  const cur = (await sql`SELECT * FROM contests WHERE status IN ('open','paying') ORDER BY id DESC LIMIT 1`)[0];
  const lastRow = (await sql`SELECT * FROM contests WHERE status='paid' ORDER BY id DESC LIMIT 1`)[0];
  let current = null, last = null;
  if (cur) {
    const rows = rankStandings(await standings(cur.id), { prizes: cur.prizes, minReferrals: cur.min_referrals });
    const mine = rows.find(r => r.telegram_id === String(id));
    const myCount = mine ? mine.referrals : Number((await sql`
      SELECT COUNT(*)::int AS n FROM referral_events e JOIN contests c ON c.id=${cur.id}::bigint
      WHERE e.referrer_id=${id}::bigint AND e.qualified_at >= c.starts_at AND e.qualified_at < c.ends_at`)[0].n);
    current = { ...view(cur), top: rows.slice(0, 50).map(r => ({ rank: r.rank, name: publicName(r.first_name, r.username), referrals: r.referrals, prize: r.prize, me: r.telegram_id === String(id) })),
      me: { referrals: myCount, rank: mine ? mine.rank : null, prize: mine ? mine.prize : 0, qualifies: myCount >= cur.min_referrals } };
  }
  if (lastRow) {
    const w = await sql`SELECT e.rank, e.referrals, e.prize, u.first_name, u.username, e.telegram_id::text AS telegram_id FROM contest_entries e JOIN users u ON u.telegram_id=e.telegram_id
      WHERE e.contest_id=${lastRow.id}::bigint AND e.prize>0 ORDER BY e.rank ASC LIMIT 10`;
    last = { ...view(lastRow), winners: w.map(x => ({ rank: x.rank, name: publicName(x.first_name, x.username), referrals: x.referrals, prize: Number(x.prize), me: x.telegram_id === String(id) })) };
  }
  return { enabled: true, current, last };
};

// ---------------- admin ----------------
export const adminContestList = async () => {
  const items = await sql`SELECT * FROM contests ORDER BY id DESC LIMIT 20`;
  const live = items.find(c => c.status === "open" || c.status === "paying");
  let top = [];
  if (live) top = rankStandings(await standings(live.id), { prizes: live.prizes, minReferrals: live.min_referrals }).slice(0, 20).map(r => ({ rank: r.rank, id: r.telegram_id, name: publicName(r.first_name, r.username), referrals: r.referrals, prize: r.prize }));
  return { items: items.map(c => ({ ...view(c), cancel_reason: c.cancel_reason, paid_at: c.paid_at })), live: live ? Number(live.id) : null, top };
};

export const adminContestCreate = async ({ id, body }) => {
  const v = validateContestInput(body);
  if (!v.ok) throw bad(v.error);
  const x = v.value;
  let r;
  try {
    r = await sql`INSERT INTO contests(kind,title,prizes,min_referrals,starts_at,ends_at,created_by)
      VALUES(${x.kind}::text,${x.title}::text,${JSON.stringify(x.prizes)}::jsonb,${x.minReferrals}::int,${x.startsAt}::timestamptz,${x.endsAt}::timestamptz,${id}::bigint) RETURNING id`;
  } catch (e) {
    if (e && e.code === "23505") throw bad("There is already a contest running: pay it out or cancel it first", "contest_live", 409);
    throw e;
  }
  await audit({ actorId: id, action: "contest.create", targetType: "contest", targetId: r[0].id, after: x });
  return { id: Number(r[0].id), ends_at: x.endsAt, total_prizes: totalPrizes(x.prizes) };
};

/** Cancel a contest that has not been paid out (nothing was paid, so nothing is refunded). */
export const adminContestCancel = async ({ id, body }) => {
  const cid = posInt(body.id), reason = cleanText(body.reason, 200);
  if (!cid || reason.length < 3) throw bad("A reason (min 3 characters) is required");
  const r = await sql`UPDATE contests SET status='cancelled', cancel_reason=${reason}::text WHERE id=${cid}::bigint AND status='open' RETURNING id`;
  if (!r.length) throw bad("Only a running contest that has not been paid out can be cancelled", "invalid_state", 409);
  await audit({ actorId: id, action: "contest.cancel", targetType: "contest", targetId: cid, reason });
  return { id: cid, status: "cancelled" };
};

/**
 * Pay the winners. Allowed once the contest has ended. status open -> paying (compare-and-set) -> paid.
 * Every prize is a ledger credit with the unique reference contest:<id>:<user>, so pressing the button again after a crash
 * pays only the winners who were not paid yet, and nobody twice.
 */
export const adminContestPay = async ({ id, body }) => {
  const cid = posInt(body.id);
  if (!cid) throw bad("Invalid request");
  if (String(body.confirm || "").trim().toUpperCase() !== "PAY") throw bad("Type PAY to confirm", "confirm_required");
  const c = (await sql`SELECT * FROM contests WHERE id=${cid}::bigint`)[0];
  if (!c) throw bad("Contest not found", "not_found", 404);
  if (c.status === "paid") throw bad("This contest was already paid out", "invalid_state", 409);
  if (c.status === "cancelled") throw bad("This contest was cancelled", "invalid_state", 409);
  if (c.status === "open") {
    const lock = await sql`UPDATE contests SET status='paying' WHERE id=${cid}::bigint AND status='open' AND ends_at <= NOW() RETURNING id`;
    if (!lock.length) {
      if (!isOver(c.ends_at)) throw bad("The contest has not ended yet", "not_ended", 409);
      throw bad("Another admin is paying this contest", "invalid_state", 409);
    }
  }
  const ranked = rankStandings(await standings(cid), { prizes: c.prizes, minReferrals: c.min_referrals }); // window is closed: this list can no longer change
  const failed = [];
  let paid = 0, paidPoints = 0;
  for (const w of ranked.filter(r => r.prize > 0)) {
    try {
      const r = await creditEx(w.telegram_id, w.prize, "Contest Prize", `${c.title} · rank ${w.rank}`, `contest:${cid}:${w.telegram_id}`, { contest: cid, rank: w.rank });
      if (!r.duplicate) { paid++; paidPoints += w.prize; }
    } catch (e) { failed.push({ id: w.telegram_id, rank: w.rank, error: e.message }); }
  }
  if (failed.length) {
    await audit({ actorId: id, action: "contest.pay_partial", targetType: "contest", targetId: cid, after: { paid, failed } });
    throw bad(`${failed.length} winner(s) could not be paid (${failed.map(f => "rank " + f.rank).join(", ")}). Press Pay again to retry.`, "partial_payout", 409);
  }
  for (const r of ranked.slice(0, 100)) {
    await sql`INSERT INTO contest_entries(contest_id,telegram_id,rank,referrals,last_at,prize) VALUES(${cid}::bigint,${r.telegram_id}::bigint,${r.rank}::int,${r.referrals}::int,${r.last_at instanceof Date ? r.last_at.toISOString() : r.last_at}::timestamptz,${r.prize}::bigint)
      ON CONFLICT(contest_id,telegram_id) DO NOTHING`;
  }
  const done = await sql`UPDATE contests SET status='paid', paid_at=NOW(), paid_by=${id}::bigint WHERE id=${cid}::bigint AND status='paying' RETURNING id`;
  if (done.length) await audit({ actorId: id, action: "contest.pay", targetType: "contest", targetId: cid, after: { winners: ranked.filter(r => r.prize > 0).length, paid_now: paid, points_now: paidPoints } });
  return { id: cid, status: "paid", winners: ranked.filter(r => r.prize > 0).map(r => ({ rank: r.rank, id: r.telegram_id, name: publicName(r.first_name, r.username), referrals: r.referrals, prize: r.prize })), paid_now: paid, points_paid_now: paidPoints };
};
