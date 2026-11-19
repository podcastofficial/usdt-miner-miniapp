import { randomInt } from 'node:crypto';
// Part 19: calendar + mystery box. Mystery Box is OFF unless Admin enables it.
import { sql } from '../db.js';
import { getSetting } from '../settings.js';
import { HttpError } from '../http.js';

const bad = (m, c='bad_request', s=400) => new HttpError(s,c,m);
export const checkinCalendar = async ({id}) => {
  const tz = String(await getSetting('daily_timezone','UTC'));
  const rows = await sql`SELECT to_char(claim_date,'YYYY-MM-DD') AS day, reward FROM daily_claims
    WHERE telegram_id=${String(id)}::bigint AND claim_date >= (NOW() AT TIME ZONE ${tz}::text)::date - 29
    ORDER BY claim_date`;
  const claimed = new Map(rows.map(x=>[x.day,Number(x.reward)]));
  const today = (await sql`SELECT to_char((NOW() AT TIME ZONE ${tz}::text)::date,'YYYY-MM-DD') AS d`)[0].d;
  return {today, days:Array.from({length:30},(_,i)=>{
    const d = new Date(`${today}T00:00:00Z`); d.setUTCDate(d.getUTCDate()-(29-i));
    const key=d.toISOString().slice(0,10); return {date:key,claimed:claimed.has(key),reward:claimed.get(key)||0};
  })};
};
export const mysteryBoxInfo = async ({id}) => {
  const enabled = (await getSetting('mystery_box_enabled',false)) === true;
  const r = await sql`SELECT to_char((NOW() AT TIME ZONE 'UTC')::date,'YYYY-MM-DD') AS d,
    EXISTS(SELECT 1 FROM mystery_box_claims WHERE telegram_id=${String(id)}::bigint AND claim_date=(NOW() AT TIME ZONE 'UTC')::date) AS claimed`;
  return {enabled,claimed:r[0].claimed,reward_min:10,reward_max:100};
};
export const mysteryBoxClaim = async ({id}) => {
  if ((await getSetting('mystery_box_enabled',false)) !== true) throw bad('Mystery Box is not enabled','feature_disabled',403);
  // Secure, server-side random reward; the unique daily key prevents double claims.
  const reward = randomInt(10,101);
  const r = await sql`WITH c AS (
    INSERT INTO mystery_box_claims(telegram_id,claim_date,reward)
    VALUES(${String(id)}::bigint,(NOW() AT TIME ZONE 'UTC')::date,${reward})
    ON CONFLICT(telegram_id,claim_date) DO NOTHING RETURNING telegram_id,reward
  ), u AS (UPDATE users SET points=points+c.reward FROM c WHERE users.telegram_id=c.telegram_id RETURNING users.points,c.reward,c.telegram_id)
  INSERT INTO transactions(telegram_id,type,points_change,balance_after,description,reference)
  SELECT telegram_id,'Mystery Box',reward,points,'Daily mystery box','mystery:'||telegram_id::text||':'||(NOW() AT TIME ZONE 'UTC')::date::text FROM u
  RETURNING points_change,balance_after`;
  if (!r.length) throw bad('You already opened today’s box','already_claimed',409);
  return {reward:Number(r[0].points_change),balance:Number(r[0].balance_after)};
};
