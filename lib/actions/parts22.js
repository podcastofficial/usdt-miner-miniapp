// Part 22: internal admin workspace tools. All inputs are validated and changes are audited.
import { sql } from "../db.js";
import { HttpError } from "../http.js";
import { audit } from "../audit.js";
const bad = (m, c="bad_request", s=400) => new HttpError(s,c,m);
const uid = v => { const s=String(v??"").trim(); return /^\d{1,15}$/.test(s) && Number(s)>0 ? s : null; };
import { criteriaOf } from "../adminSegments.js";

export const adminUserNotes = async ({body}) => {
  const target=uid(body.userId); if(!target) throw bad("Invalid user id");
  const items=await sql`SELECT id,author_id,note,created_at FROM admin_user_notes WHERE telegram_id=${target}::bigint ORDER BY id DESC LIMIT 50`;
  return {items};
};
export const adminUserNoteAdd = async ({id,body}) => {
  const target=uid(body.userId), note=String(body.note??"").trim();
  if(!target || note.length<1 || note.length>1000) throw bad("User id and a note of 1-1000 characters are required");
  const r=await sql`INSERT INTO admin_user_notes(telegram_id,author_id,note) SELECT ${target}::bigint,${id}::bigint,${note}::text WHERE EXISTS(SELECT 1 FROM users WHERE telegram_id=${target}::bigint) RETURNING id,telegram_id,author_id,note,created_at`;
  if(!r.length) throw bad("User not found","not_found",404);
  await audit({actorId:id,action:"admin.user_note_add",targetType:"user",targetId:target,after:{note_id:Number(r[0].id)}});
  return {item:r[0]};
};
export const adminSegments = async () => ({items:await sql`SELECT id,name,criteria,created_by,created_at,updated_at FROM admin_saved_segments ORDER BY lower(name) LIMIT 100`});
export const adminSegmentSave = async ({id,body}) => {
  const name=String(body.name??"").trim(), criteria=criteriaOf(body.criteria);
  if(name.length<1||name.length>60||!criteria) throw bad("Name (1-60 chars) and valid criteria are required");
  const r=await sql`INSERT INTO admin_saved_segments(name,criteria,created_by) VALUES(${name},${JSON.stringify(criteria)}::jsonb,${id}::bigint)
    ON CONFLICT (lower(name)) DO UPDATE SET criteria=EXCLUDED.criteria,created_by=EXCLUDED.created_by,updated_at=NOW()
    RETURNING id,name,criteria,created_by,created_at,updated_at`;
  await audit({actorId:id,action:"admin.segment_save",targetType:"segment",targetId:String(r[0].id),after:{name,criteria}});
  return {item:r[0]};
};
export const adminSegmentDelete = async ({id,body}) => {
  const sid=Number(body.segmentId); if(!Number.isSafeInteger(sid)||sid<1) throw bad("Invalid segment id");
  const r=await sql`DELETE FROM admin_saved_segments WHERE id=${sid}::bigint RETURNING id,name`;
  if(!r.length) throw bad("Segment not found","not_found",404);
  await audit({actorId:id,action:"admin.segment_delete",targetType:"segment",targetId:String(sid),before:r[0]});
  return {deleted:true};
};

export const adminSegmentUsers = async ({body}) => {
  if(body.segmentId===undefined && body.criteria===undefined) throw bad("Provide a saved segment id or criteria");
  let criteria=criteriaOf(body.criteria||{});
  if(body.segmentId!==undefined){
    const sid=Number(body.segmentId); if(!Number.isSafeInteger(sid)||sid<1) throw bad("Invalid segment id");
    const saved=(await sql`SELECT criteria FROM admin_saved_segments WHERE id=${sid}::bigint`)[0];
    if(!saved) throw bad("Segment not found","not_found",404);
    criteria=criteriaOf(saved.criteria);
  }
  if(!criteria) throw bad("Invalid segment criteria");
  const blocked=criteria.blocked??null, activeDays=criteria.activeDays??null, minPoints=criteria.minPoints??null, maxPoints=criteria.maxPoints??null;
  const items=await sql`SELECT telegram_id,username,first_name,points,is_blocked,created_at,last_active_at FROM users
    WHERE (${blocked}::boolean IS NULL OR is_blocked=${blocked}::boolean)
      AND (${activeDays}::int IS NULL OR last_active_at>=NOW()-(${activeDays}::int*INTERVAL '1 day'))
      AND (${minPoints}::bigint IS NULL OR points>=${minPoints}::bigint)
      AND (${maxPoints}::bigint IS NULL OR points<=${maxPoints}::bigint)
    ORDER BY last_active_at DESC NULLS LAST,created_at DESC LIMIT 100`;
  return {criteria,items};
};
