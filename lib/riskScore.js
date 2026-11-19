// Part 23: explainable heuristics only. No model inference, auto-ban, or automatic money action.
export function scoreRisk({openFlags=0, highFlags=0, sameWallet=0, referralBursts=0, rapidClaims=0}={}) {
  const signals=[]; let score=0;
  const add=(key,n,weight,cap)=>{const count=Math.max(0,Number(n)||0); if(count){const points=Math.min(cap,count*weight);score+=points;signals.push({key,count,points});}};
  add("open_flags",openFlags,8,32); add("high_severity_flags",highFlags,15,45);
  add("same_wallet_flags",sameWallet,20,40); add("referral_burst_flags",referralBursts,12,24); add("rapid_claim_flags",rapidClaims,8,16);
  score=Math.min(100,score);
  return {score,band:score>=70?"high":score>=30?"medium":"low",signals};
}
