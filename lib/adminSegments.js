// Pure allow-list parser for saved admin segment filters.
export function criteriaOf(v) {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const allowed=new Set(["blocked","activeDays","minPoints","maxPoints"]);
  if(Object.keys(v).some(k=>!allowed.has(k))) return null;
  const out={};
  if (v.blocked !== undefined) { if(typeof v.blocked!=="boolean") return null; out.blocked=v.blocked; }
  if (v.activeDays !== undefined) { const n=Number(v.activeDays); if(!Number.isInteger(n)||n<1||n>365) return null; out.activeDays=n; }
  if (v.minPoints !== undefined) { const n=Number(v.minPoints); if(!Number.isSafeInteger(n)||n<0||n>1e12) return null; out.minPoints=n; }
  if (v.maxPoints !== undefined) { const n=Number(v.maxPoints); if(!Number.isSafeInteger(n)||n<0||n>1e12) return null; out.maxPoints=n; }
  if (out.minPoints!==undefined && out.maxPoints!==undefined && out.minPoints>out.maxPoints) return null;
  return out;
}
