// Part 25: mining performance and booster safety reports. Does not change accrual, balances, or claim logic.
import {sql} from "../db.js";
import {audit} from "../audit.js";
import {planStats} from "../autominer.js";
export const miningInsights=async({id})=>{
  const [miners,claims,totals,booster]=await Promise.all([
    sql`SELECT id,plan_name,rate_per_hour,price_paid,started_at,ends_at,total_claimed FROM auto_miners WHERE telegram_id=${id}::bigint ORDER BY id DESC LIMIT 50`,
    sql`SELECT id,points,miners,created_at FROM auto_miner_claims WHERE telegram_id=${id}::bigint ORDER BY id DESC LIMIT 20`,
    sql`SELECT COUNT(*)::int AS machines,COALESCE(SUM(total_claimed),0)::text AS claimed_points,
      COUNT(*) FILTER(WHERE ends_at>NOW())::int AS running FROM auto_miners WHERE telegram_id=${id}::bigint`,
    sql`SELECT booster_pct,booster_until,(booster_until>NOW()) AS active FROM users WHERE telegram_id=${id}::bigint`
  ]);
  return {miners,claims,totals:totals[0],booster:booster[0]||{booster_pct:100,active:false,booster_until:null}};
};
export const adminMiningReport=async({id})=>{
  const [plans,summary,boosters]=await Promise.all([
    sql`SELECT p.id,p.name,p.price,p.rate_per_hour,p.duration_days,p.max_per_user,p.active,
      COUNT(m.id)::int AS sold,COALESCE(SUM(m.total_claimed),0)::text AS claimed_points,
      COUNT(m.id) FILTER(WHERE m.ends_at>NOW())::int AS running
      FROM auto_miner_plans p LEFT JOIN auto_miners m ON m.plan_id=p.id GROUP BY p.id ORDER BY p.id`,
    sql`SELECT COUNT(*)::int AS machines,COUNT(*) FILTER(WHERE ends_at>NOW())::int AS running,
      COALESCE(SUM(total_claimed),0)::text AS claimed_points,COALESCE(SUM(price_paid),0)::text AS points_spent FROM auto_miners`,
    sql`SELECT COUNT(*)::int AS active_boosters FROM boosters WHERE ends_at>NOW()`
  ]);
  const report={plans:plans.map(p=>({...p,roi:planStats({price:Number(p.price),rate_per_hour:Number(p.rate_per_hour),duration_days:Number(p.duration_days)})})),summary:summary[0],boosters:boosters[0],note:"Projected ROI is arithmetic only; it is not a guarantee of token value or redemption."};
  await sql`INSERT INTO mining_report_snapshots(generated_by,plan_count,active_machines,total_claimed_points,report)
    VALUES(${id}::bigint,${plans.length}::int,${Number(summary[0].running)}::bigint,${summary[0].claimed_points}::numeric,${JSON.stringify(report)}::jsonb)`;
  await audit({actorId:id,action:"mining.report_generate",targetType:"mining_report",after:{plans:plans.length,running:Number(summary[0].running)}});
  return report;
};
