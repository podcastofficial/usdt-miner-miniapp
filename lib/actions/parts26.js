// Part 26: time-boxed referral challenges. A qualified referral counts only via referral_events.
import {sql} from "../db.js";
import {HttpError} from "../http.js";
import {audit} from "../audit.js";
import {creditEx} from "../ledger.js";
import {getConfig} from "../runtime.js";
const bad=(m,c="bad_request",s=400)=>new HttpError(s,c,m);
export const referralChallenges=async({id})=>{
  const rows=await sql`SELECT c.id,c.title,c.target,c.reward_points,c.starts_at,c.ends_at,
    COUNT(e.referred_id)::int AS qualified, (cl.telegram_id IS NOT NULL) AS claimed
    FROM referral_challenges c LEFT JOIN referral_events e ON e.referrer_id=${id}::bigint AND e.qualified_at>=c.starts_at AND e.qualified_at<c.ends_at
    LEFT JOIN referral_challenge_claims cl ON cl.challenge_id=c.id AND cl.telegram_id=${id}::bigint
    WHERE c.active=TRUE AND c.ends_at>NOW() GROUP BY c.id,cl.telegram_id ORDER BY c.ends_at LIMIT 20`;
  return {items:rows};
};
export const referralChallengeClaim=async({id,body})=>{
  const cfg=await getConfig(); if(!cfg.referralChallengesEnabled) throw bad("Referral challenges are disabled","feature_disabled",403);
  const cid=Number(body.challengeId); if(!Number.isSafeInteger(cid)||cid<1) throw bad("Invalid challenge");
  const c=(await sql`SELECT id,title,target,reward_points FROM referral_challenges WHERE id=${cid}::bigint AND active=TRUE AND NOW() BETWEEN starts_at AND ends_at`)[0];
  if(!c) throw bad("Challenge is not active","challenge_unavailable",404);
  const ref=`ref-challenge:${cid}:${id}`;
  const r=await sql`WITH eligible_user AS (SELECT telegram_id FROM users WHERE telegram_id=${id}::bigint AND is_blocked=FALSE FOR UPDATE),
    challenge AS (SELECT id,starts_at,ends_at FROM referral_challenges WHERE id=${cid}::bigint AND active=TRUE AND NOW() BETWEEN starts_at AND ends_at),
    cnt AS (SELECT COUNT(*)::int AS n FROM referral_events e CROSS JOIN challenge c WHERE e.referrer_id=${id}::bigint
      AND e.qualified_at>=c.starts_at AND e.qualified_at<c.ends_at),
    ins AS (INSERT INTO referral_challenge_claims(challenge_id,telegram_id,qualified_count,points)
      SELECT ${cid}::bigint,u.telegram_id,cnt.n,${c.reward_points}::bigint FROM cnt CROSS JOIN eligible_user u CROSS JOIN challenge WHERE cnt.n >= ${c.target}::int
      ON CONFLICT(challenge_id,telegram_id) DO NOTHING RETURNING points),
    credit AS (UPDATE users SET points=points+(SELECT points FROM ins) WHERE telegram_id=${id}::bigint AND is_blocked=FALSE AND EXISTS(SELECT 1 FROM ins) RETURNING points)
    INSERT INTO transactions(telegram_id,type,points_change,balance_after,description,reference)
      SELECT ${id}::bigint,'Referral Challenge',i.points,u.points,${`Challenge: ${c.title}`}::text,${ref}::text FROM ins i CROSS JOIN credit u
      ON CONFLICT(reference) DO NOTHING RETURNING balance_after`;
  if(!r.length) throw bad("Target not reached or reward already claimed","not_eligible",409);
  return {claimed:true,points:Number(c.reward_points),balance:Number(r[0].balance_after)};
};
export const adminReferralChallenges=async()=>({items:await sql`SELECT c.*,COUNT(cl.telegram_id)::int AS claims FROM referral_challenges c LEFT JOIN referral_challenge_claims cl ON cl.challenge_id=c.id GROUP BY c.id ORDER BY c.id DESC LIMIT 100`});
export const adminReferralChallengeSave=async({id,body})=>{
  const title=String(body.title??"").trim(),target=Number(body.target),reward=Number(body.rewardPoints),start=new Date(body.startsAt),end=new Date(body.endsAt);
  if(title.length<1||title.length>80||!Number.isInteger(target)||target<1||target>10000||!Number.isSafeInteger(reward)||reward<1||reward>1e7||!Number.isFinite(start.getTime())||!Number.isFinite(end.getTime())||end<=start) throw bad("Invalid challenge fields");
  const active=body.active===true;
  const r=await sql`INSERT INTO referral_challenges(title,target,reward_points,starts_at,ends_at,active,created_by)
    VALUES(${title},${target}::int,${reward}::bigint,${start.toISOString()}::timestamptz,${end.toISOString()}::timestamptz,${active}::boolean,${id}::bigint)
    RETURNING id,title,target,reward_points,starts_at,ends_at,active`;
  await audit({actorId:id,action:"referral.challenge_create",targetType:"referral_challenge",targetId:String(r[0].id),after:r[0]});
  return {item:r[0]};
};
