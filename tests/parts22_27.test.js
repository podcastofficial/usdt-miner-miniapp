import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { scoreRisk } from "../lib/riskScore.js";
import { criteriaOf } from "../lib/adminSegments.js";
import { validateSetting, resolveConfig } from "../lib/settingsDefs.js";

const api=readFileSync(new URL("../api/index.js",import.meta.url),"utf8");
const roles=readFileSync(new URL("../lib/roles.js",import.meta.url),"utf8");

test("Part 23 risk score is deterministic, capped, and explainable",()=>{
  assert.deepEqual(scoreRisk({}),{score:0,band:"low",signals:[]});
  const r=scoreRisk({openFlags:2,highFlags:2,sameWallet:1,referralBursts:1,rapidClaims:1});
  assert.equal(r.band,"high"); assert.ok(r.score<=100); assert.ok(r.signals.some(x=>x.key==="same_wallet_flags"));
  assert.equal(scoreRisk({openFlags:1000}).score,32);
});
test("Part 22 saved segment criteria accepts only bounded filters",()=>{
  assert.deepEqual(criteriaOf({blocked:false,activeDays:7,minPoints:0,maxPoints:500}),{blocked:false,activeDays:7,minPoints:0,maxPoints:500});
  assert.equal(criteriaOf({activeDays:0}),null);
  assert.equal(criteriaOf({minPoints:100,maxPoints:10}),null);
  assert.equal(criteriaOf({arbitrarySql:"DROP TABLE users"}),null);
});
test("new paid/reward features are OFF by default",()=>{
  const c=resolveConfig([]); assert.equal(c.premiumEnabled,false); assert.equal(c.referralChallengesEnabled,false);
  assert.equal(validateSetting("premium_enabled",true).value,true);
});
test("all new admin endpoints have an explicit permission and route",()=>{
  const actions=["adminSupportTickets","adminSupportTicketReply","adminUserNotes","adminUserNoteAdd","adminSegments","adminSegmentUsers","adminSegmentSave","adminSegmentDelete","adminRiskOverview","adminRiskRecalculate","adminPremiumTiers","adminPremiumTierSave","adminMiningReport","adminReferralChallenges","adminReferralChallengeSave","adminAnalyticsRange","adminAnalyticsReportList"];
  for(const a of actions){assert.ok(roles.includes(`${a}:`),a);assert.ok(api.includes(`${a}:`),a);}
});
test("new API writes are POST-only and user premium/challenge actions are registered",()=>{
  for(const s of ["premiumInfo: { fn: p24.premiumInfo }","premiumBuy: { fn: p24.premiumBuy, write: true }","adminAnalyticsRange: { fn: p27.adminAnalyticsRange, admin: true, write: true }","referralChallengeClaim: { fn: p26.referralChallengeClaim, write: true }"]) assert.ok(api.includes(s),s);
});
