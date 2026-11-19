// Part 20: VIP level summary and auditable 1% referral commission ledger foundation.
import { sql } from '../db.js';
import { getSetting } from '../settings.js';
export const vipInfo = async ({id}) => {
  const [earned, refs, enabled] = await Promise.all([
    sql`SELECT COALESCE(SUM(points_change),0)::bigint AS n FROM transactions WHERE telegram_id=${String(id)}::bigint AND points_change>0`,
    sql`SELECT COUNT(*)::int AS n FROM referral_events WHERE referrer_id=${String(id)}::bigint`,
    getSetting('referral_commission_enabled',false),
  ]);
  const points=Number(earned[0].n), levels=[
    {name:'Bronze',min:0,benefit:'Basic member'},
    {name:'Silver',min:10000,benefit:'Silver VIP'},
    {name:'Gold',min:50000,benefit:'Gold VIP'},
    {name:'Diamond',min:200000,benefit:'Diamond VIP'},
  ];
  let level=levels[0]; for(const x of levels) if(points>=x.min) level=x;
  const next=levels[levels.indexOf(level)+1]||null;
  const commissions=await sql`SELECT COALESCE(SUM(commission_points),0)::bigint AS n FROM referral_commissions WHERE referrer_id=${String(id)}::bigint`;
  return {level:level.name,lifetime_earned:points,qualified_referrals:refs[0].n,next_level:next?{name:next.name,points_needed:next.min-points}:null,
    commission:{enabled:enabled===true,rate_percent:1,earned_points:Number(commissions[0].n),note:'Commission accrual remains OFF until enabled in Admin settings.'}};
};
