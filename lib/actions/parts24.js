// Part 24: Points-funded premium memberships. No fiat/crypto subscription or automatic external payment is handled here.
import crypto from "node:crypto";
import {sql} from "../db.js";
import {HttpError} from "../http.js";
import {audit} from "../audit.js";
import {getConfig} from "../runtime.js";
const bad=(m,c="bad_request",s=400)=>new HttpError(s,c,m);
export const premiumInfo=async({id})=>{
  const cfg=await getConfig();
  if(!cfg.premiumEnabled) return {enabled:false,tiers:[],membership:null};
  const [tiers,mem]=await Promise.all([
    sql`SELECT id,code,name,price_points,duration_days,benefits FROM premium_tiers WHERE active=TRUE ORDER BY price_points,id`,
    sql`SELECT m.tier_id,t.code,t.name,m.starts_at,m.ends_at,(m.ends_at>NOW()) AS active,t.benefits
      FROM user_premium_memberships m JOIN premium_tiers t ON t.id=m.tier_id WHERE m.telegram_id=${id}::bigint`
  ]);
  return {enabled:true,tiers,membership:mem[0]||null};
};
export const premiumBuy=async({id,body})=>{
  const cfg=await getConfig(); if(!cfg.premiumEnabled) throw bad("Premium is currently disabled","premium_disabled",403);
  const tierId=Number(body.tierId); if(!Number.isSafeInteger(tierId)||tierId<1) throw bad("Choose a valid tier");
  const ref=`premium:${crypto.randomUUID()}`;
  let rows;
  try {
    rows=await sql`WITH tier AS (
      SELECT id,name,price_points,duration_days FROM premium_tiers WHERE id=${tierId}::bigint AND active=TRUE
    ), debit_user AS (
      UPDATE users SET points=points-(SELECT price_points FROM tier)
      WHERE telegram_id=${id}::bigint AND is_blocked=FALSE AND points >= (SELECT price_points FROM tier)
      RETURNING telegram_id,points
    ), membership AS (
      INSERT INTO user_premium_memberships(telegram_id,tier_id,starts_at,ends_at,updated_at)
      SELECT d.telegram_id,t.id,NOW(),NOW()+make_interval(days=>t.duration_days),NOW() FROM debit_user d CROSS JOIN tier t
      ON CONFLICT(telegram_id) DO UPDATE SET tier_id=EXCLUDED.tier_id,
        starts_at=CASE WHEN user_premium_memberships.ends_at>NOW() THEN user_premium_memberships.starts_at ELSE NOW() END,
        ends_at=GREATEST(user_premium_memberships.ends_at,NOW())+(SELECT make_interval(days=>duration_days) FROM tier),updated_at=NOW()
      RETURNING telegram_id,tier_id,ends_at
    ), ledger AS (
      INSERT INTO transactions(telegram_id,type,points_change,balance_after,description,reference)
      SELECT d.telegram_id,'Premium Membership',-t.price_points,d.points,'Premium: '||t.name,${ref}::text
      FROM debit_user d CROSS JOIN tier t WHERE t.price_points>0
      RETURNING id
    ) SELECT m.telegram_id,m.tier_id,m.ends_at,d.points AS balance,t.name FROM membership m JOIN debit_user d ON d.telegram_id=m.telegram_id CROSS JOIN tier t`;
  } catch(e){throw e;}
  if(!rows.length) {
    const tier=await sql`SELECT id,price_points FROM premium_tiers WHERE id=${tierId}::bigint AND active=TRUE`;
    if(!tier.length) throw bad("Tier unavailable","tier_unavailable",404);
    throw bad("Insufficient Points or account unavailable","insufficient_points",400);
  }
  return {tier:rows[0].name,ends_at:rows[0].ends_at,balance:Number(rows[0].balance)};
};
export const adminPremiumTiers=async()=>({items:await sql`SELECT id,code,name,price_points,duration_days,benefits,active FROM premium_tiers ORDER BY id`});
export const adminPremiumTierSave=async({id,body})=>{
  const code=String(body.code??"").trim().toLowerCase(),name=String(body.name??"").trim();
  const price=Number(body.pricePoints),days=Number(body.durationDays);
  if(!/^[a-z0-9_]{2,24}$/.test(code)||name.length<1||name.length>40||!Number.isSafeInteger(price)||price<0||price>1e8||!Number.isInteger(days)||days<1||days>365) throw bad("Invalid tier fields");
  const benefits=body.benefits&&typeof body.benefits==="object"&&!Array.isArray(body.benefits)?body.benefits:{};
  const active=body.active===true;
  const r=await sql`INSERT INTO premium_tiers(code,name,price_points,duration_days,benefits,active)
    VALUES(${code},${name},${price}::bigint,${days}::int,${JSON.stringify(benefits)}::jsonb,${active}::boolean)
    ON CONFLICT(code) DO UPDATE SET name=EXCLUDED.name,price_points=EXCLUDED.price_points,duration_days=EXCLUDED.duration_days,benefits=EXCLUDED.benefits,active=EXCLUDED.active
    RETURNING id,code,name,price_points,duration_days,benefits,active`;
  await audit({actorId:id,action:"premium.tier_save",targetType:"premium_tier",targetId:String(r[0].id),after:r[0]});
  return {item:r[0]};
};
