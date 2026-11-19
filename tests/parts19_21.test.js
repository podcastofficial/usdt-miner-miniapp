import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const api=fs.readFileSync(new URL('../api/index.js',import.meta.url),'utf8');
test('Parts 19–21 actions are registered with write protection on mutations',()=>{
 for(const name of ['checkinCalendar','mysteryBoxInfo','mysteryBoxClaim','vipInfo','shareCardInfo','supportTicketCreate','supportTicketList','achievementsInfo','seasonPassInfo']) assert.match(api,new RegExp(name+': \\{ fn:'));
 assert.match(api,/mysteryBoxClaim: \{ fn: p19\.mysteryBoxClaim, write: true \}/);
 assert.match(api,/supportTicketCreate: \{ fn: p21\.supportTicketCreate, write: true \}/);
});
test('Parts 19–21 migrations are idempotent and record their versions',()=>{
 for(const f of ['017_part19_retention.sql','018_part20_vip.sql','019_part21_support_season.sql']){
  const s=fs.readFileSync(new URL('../db/migrations/'+f,import.meta.url),'utf8');
  assert.match(s,/CREATE TABLE IF NOT EXISTS/); assert.match(s,/INSERT INTO schema_migrations/);
 }
});
test('Mystery Box is disabled by default and uses cryptographic randomness',()=>{
 const s=fs.readFileSync(new URL('../lib/actions/parts19.js',import.meta.url),'utf8');
 assert.match(s,/getSetting\('mystery_box_enabled',false\)/); assert.match(s,/randomInt\(10,101\)/);
});
