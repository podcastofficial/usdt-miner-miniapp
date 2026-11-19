// Part 21: share-card data, support tickets, achievements and season-pass status.
import { sql } from '../db.js';
import { getSetting } from '../settings.js';
import { HttpError } from '../http.js';
const bad=(m,c='bad_request',s=400)=>new HttpError(s,c,m);
export const shareCardInfo=async({id})=>{
 const r=await sql`SELECT COALESCE(SUM(points_change) FILTER(WHERE points_change>0),0)::bigint AS earned,
   (SELECT COUNT(*)::int FROM referral_events WHERE referrer_id=${String(id)}::bigint) AS referrals,
   (SELECT referral_code FROM users WHERE telegram_id=${String(id)}::bigint) AS code FROM transactions WHERE telegram_id=${String(id)}::bigint`;
 return {earned:Number(r[0].earned),qualified_referrals:r[0].referrals,referral_code:r[0].code};
};
export const supportTicketCreate=async({id,body})=>{
 const subject=String(body.subject||'').trim(),message=String(body.message||'').trim();
 if(subject.length<4||subject.length>100||message.length<10||message.length>2000) throw bad('Subject must be 4–100 chars and message 10–2000 chars');
 const open=await sql`SELECT COUNT(*)::int AS n FROM support_tickets WHERE telegram_id=${String(id)}::bigint AND status IN ('open','answered')`;
 if(open[0].n>=5) throw bad('You have reached the 5 open-ticket limit','ticket_limit',429);
 const r=await sql`INSERT INTO support_tickets(telegram_id,subject,message) VALUES(${String(id)}::bigint,${subject},${message}) RETURNING id,subject,status,created_at`;
 return r[0];
};
export const supportTicketList=async({id})=>({items:await sql`SELECT id,subject,message,status,admin_reply,created_at,updated_at FROM support_tickets WHERE telegram_id=${String(id)}::bigint ORDER BY id DESC LIMIT 50`});
export const achievementsInfo=async({id})=>{
 const [badges,stats]=await Promise.all([sql`SELECT code,earned_at FROM badges WHERE telegram_id=${String(id)}::bigint ORDER BY earned_at DESC`,sql`SELECT COALESCE(SUM(points_change) FILTER(WHERE points_change>0),0)::bigint AS earned FROM transactions WHERE telegram_id=${String(id)}::bigint`]);
 return {badges, lifetime_earned:Number(stats[0].earned)};
};
export const seasonPassInfo=async({id})=>({enabled:(await getSetting('season_pass_enabled',false))===true,season:null,points:0,claimed_level:0,message:'Season Pass is not configured yet.'});
