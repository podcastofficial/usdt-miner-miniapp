// Part 27: admin date-range analytics and saved aggregate reports.
import {sql} from "../db.js";
import {HttpError} from "../http.js";
import {audit} from "../audit.js";
const bad=(m,c="bad_request",s=400)=>new HttpError(s,c,m);
export const adminAnalyticsRange=async({id,body})=>{
  const days=Number(body.days??30); if(!Number.isInteger(days)||days<1||days>365) throw bad("days must be 1-365");
  const [daily,totals]=await Promise.all([
    sql`SELECT d.day::text AS day,COALESCE(u.new_users,0)::int AS new_users,COALESCE(a.active_users,0)::int AS active_users,
      COALESCE(l.points_in,0)::text AS points_in,COALESCE(l.points_out,0)::text AS points_out
      FROM generate_series(CURRENT_DATE-(${days-1}::int),CURRENT_DATE,INTERVAL '1 day') d(day)
      LEFT JOIN (SELECT created_at::date day,COUNT(*)::int new_users FROM users WHERE created_at>=CURRENT_DATE-(${days-1}::int) GROUP BY 1) u ON u.day=d.day::date
      LEFT JOIN (SELECT created_at::date day,COUNT(DISTINCT telegram_id)::int active_users FROM transactions WHERE created_at>=CURRENT_DATE-(${days-1}::int) GROUP BY 1) a ON a.day=d.day::date
      LEFT JOIN (SELECT created_at::date day,SUM(GREATEST(points_change,0))::numeric points_in,SUM(GREATEST(-points_change,0))::numeric points_out FROM transactions WHERE created_at>=CURRENT_DATE-(${days-1}::int) GROUP BY 1) l ON l.day=d.day::date
      ORDER BY d.day`,
    sql`SELECT (SELECT COUNT(*)::int FROM users WHERE created_at>=CURRENT_DATE-(${days-1}::int)) AS new_users,
      (SELECT COUNT(DISTINCT telegram_id)::int FROM transactions WHERE created_at>=CURRENT_DATE-(${days-1}::int)) AS active_users,
      (SELECT COALESCE(SUM(points_change) FILTER(WHERE points_change>0),0)::text FROM transactions WHERE created_at>=CURRENT_DATE-(${days-1}::int)) AS points_in,
      (SELECT COALESCE(SUM(-points_change) FILTER(WHERE points_change<0),0)::text FROM transactions WHERE created_at>=CURRENT_DATE-(${days-1}::int)) AS points_out`]);
  const metrics={range_days:days,totals:totals[0],daily};
  const saved=await sql`INSERT INTO admin_analytics_reports(report_name,range_days,generated_by,metrics)
    VALUES(${`Analytics ${days} days`},${days}::int,${id}::bigint,${JSON.stringify(metrics)}::jsonb) RETURNING id,created_at`;
  await audit({actorId:id,action:"analytics.range_report",targetType:"analytics_report",targetId:String(saved[0].id),after:{days}});
  return {...metrics,report_id:Number(saved[0].id),created_at:saved[0].created_at};
};
export const adminAnalyticsReportList=async({body})=>{
  const limit=Math.min(50,Math.max(1,Number(body.limit)||20));
  return {items:await sql`SELECT id,report_name,range_days,generated_by,created_at FROM admin_analytics_reports ORDER BY id DESC LIMIT ${limit}::int`};
};
