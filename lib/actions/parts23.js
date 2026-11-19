// Part 23: refresh transparent user risk scores from already-reviewed fraud signals.
import {sql} from "../db.js";
import {HttpError} from "../http.js";
import {audit} from "../audit.js";
import {scoreRisk} from "../riskScore.js";
const bad=(m,c="bad_request",s=400)=>new HttpError(s,c,m);
export const adminRiskOverview=async({body})=>{
  const limit=Math.min(100,Math.max(1,Number(body.limit)||50));
  const items=await sql`SELECT r.telegram_id,r.score,r.band,r.signals,r.calculated_at,u.username,u.first_name
    FROM user_risk_scores r JOIN users u ON u.telegram_id=r.telegram_id
    ORDER BY r.score DESC,r.calculated_at DESC LIMIT ${limit}::int`;
  const counts=await sql`SELECT band,COUNT(*)::int AS users FROM user_risk_scores GROUP BY band`;
  return {items,counts,method:"transparent_rules_v1",automatic_blocking:false};
};
export const adminRiskRecalculate=async({id,body})=>{
  const limit=Math.min(500,Math.max(1,Number(body.limit)||200));
  const rows=await sql`SELECT f.telegram_id,
    COUNT(*) FILTER(WHERE f.status='open')::int AS open_flags,
    COUNT(*) FILTER(WHERE f.status='open' AND f.severity='high')::int AS high_flags,
    COUNT(*) FILTER(WHERE f.status='open' AND f.rule='same_wallet')::int AS same_wallet,
    COUNT(*) FILTER(WHERE f.status='open' AND f.rule='referral_burst')::int AS referral_bursts,
    COUNT(*) FILTER(WHERE f.status='open' AND f.rule='rapid_claims')::int AS rapid_claims
    FROM fraud_flags f GROUP BY f.telegram_id ORDER BY COUNT(*) DESC LIMIT ${limit}::int`;
  let updated=0;
  for(const r of rows){
    const v=scoreRisk({openFlags:r.open_flags,highFlags:r.high_flags,sameWallet:r.same_wallet,referralBursts:r.referral_bursts,rapidClaims:r.rapid_claims});
    await sql`INSERT INTO user_risk_scores(telegram_id,score,band,signals,calculated_at)
      VALUES(${r.telegram_id}::bigint,${v.score}::int,${v.band}::text,${JSON.stringify(v.signals)}::jsonb,NOW())
      ON CONFLICT(telegram_id) DO UPDATE SET score=EXCLUDED.score,band=EXCLUDED.band,signals=EXCLUDED.signals,calculated_at=NOW()`;
    updated++;
  }
  await audit({actorId:id,action:"risk.recalculate",targetType:"risk_scores",after:{updated,method:"transparent_rules_v1"}});
  return {updated,method:"transparent_rules_v1",automatic_blocking:false};
};
