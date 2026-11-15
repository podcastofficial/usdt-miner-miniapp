// Part 5: Admin panel UI. Loaded only for admins (index.html injects this file after bootstrap says admin=true).
// All permissions are enforced server-side on every call; this file is just a remote control.
(()=>{
const $=id=>document.getElementById(id),E=esc,A=(a,p)=>api(a,p||{}),N=Number;
const D=x=>x?new Date(x).toLocaleString():'';
const short=h=>h?String(h).slice(0,10)+'…'+String(h).slice(-6):'';
const nm=x=>E(x.first_name||x.username||x.telegram_id||x.owner_id);
const TABS=[['home','📊','Home'],['wd','💸','Withdraw'],['dep','⬇️','Deposits'],['usr','👤','Users'],['tsk','📋','Tasks'],['cmp','📢','Campaigns'],['set','⚙️','Settings'],['prf','🧾','Proof'],['aud','🧾','Audit']];
let tab='home',cur={tasks:[],setItems:[],audNext:null,prfNext:null};

const st=document.createElement('style');st.textContent=`#admtabs{display:flex;gap:6px;overflow-x:auto;margin:8px 0;padding-bottom:4px}#admtabs .tab{flex:0 0 auto;padding:8px 12px}
#admnote{color:var(--or1);font-size:13px;min-height:16px}.admodal{position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:50;display:flex;align-items:center;justify-content:center;padding:16px}.admodal .card{width:100%;max-width:420px}
textarea{width:100%;padding:12px;margin:6px 0;background:#08090c;color:#fff;border:1.5px solid #3a2a1a;border-radius:12px;font:inherit;min-height:70px}
#adm .stat{margin:6px 0;padding:10px}#adm .stat small{display:block}#adm .stat b{font-size:18px;color:var(--or1)}#adm .acts{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}
#adm pre{white-space:pre-wrap;word-break:break-all;font-size:11px;color:var(--mut)}.ghost{background:#2c2d35!important;color:#fff!important;box-shadow:none!important}`;document.head.appendChild(st);

function note(m){const n=$('admnote');if(n)n.textContent=m;try{say(m)}catch(e){}}
async function run(fn){try{await fn()}catch(e){note(e.message)}}
function ask(title,fields){return new Promise(res=>{const o=document.createElement('div');o.className='admodal';
 o.innerHTML=`<div class="card"><h2>${E(title)}</h2>${fields.map(f=>`<small>${E(f.label)}</small><input data-k="${E(f.k)}" type="${f.type||'text'}" inputmode="${f.type==='number'?'numeric':'text'}" placeholder="${E(f.ph||'')}">`).join('')}<div class="acts"><button class="btn sm" data-ok>OK</button><button class="btn sm ghost" data-no>Cancel</button></div></div>`;
 document.body.appendChild(o);const done=v=>{o.remove();res(v)};o.querySelector('[data-no]').onclick=()=>done(null);
 o.querySelector('[data-ok]').onclick=()=>{const v={};o.querySelectorAll('input').forEach(i=>v[i.dataset.k]=i.value.trim());done(v)}})}
const empty=t=>`<div class="empty">${t}</div>`;
const sel=(id,opts,fn,c)=>`<select id="${id}" onchange="${fn}">${opts.map(o=>`<option${o===c?' selected':''}>${o}</option>`).join('')}</select>`;
const stat=(l,v)=>`<div class="card stat"><small>${l}</small><b>${E(v)}</b></div>`;

function shell(){$('adm').innerHTML=`<div id="admtabs">${TABS.map(t=>`<button class="tab${t[0]===tab?' on':''}" onclick="Admin.go('${t[0]}')">${t[1]} ${t[2]}</button>`).join('')}</div><div id="admnote"></div><div id="admbody"></div>`}
async function show(){shell();const b=$('admbody');b.innerHTML=empty('Loading…');await run(async()=>{b.innerHTML=await VIEWS[tab]()})}
const VIEWS={
 async home(){const d=await A('adminDashboard');return `<div class="grid">${[
  ['Users',d.users],['New (24h)',d.new_24h],['Active (24h)',d.active_24h],['Blocked',d.blocked],
  ['Points in wallets',Number(d.points_total).toLocaleString()+' ≈ '+d.points_total_usdt+' USDT'],['Open withdrawals',d.open_withdrawals+' · owe '+d.owed_usdt+' USDT'],
  ['Paid out',d.paid_usdt+' USDT'],['Deposits to review',d.deposits_waiting],['Deposited',d.deposited_usdt+' USDT'],['Campaigns pending',d.campaigns_pending],
  ['Active tasks',d.tasks_active],['Qualified referrals',d.referrals_qualified],['Abuse flags (24h)',d.abuse_24h],['Maintenance',d.maintenance?'ON':'off']].map(x=>stat(x[0],x[1])).join('')}</div>
  <div class="acts"><button class="btn sm" onclick="Admin.tool('adminReconcile')">Ledger check</button><button class="btn sm" onclick="Admin.tool('adminAbuseEvents')">Abuse events</button><button class="btn sm" onclick="Admin.tool('adminDiagnostics')">Server check</button></div><pre id="admout"></pre>`},
 async wd(){const f=$('wdf')?$('wdf').value:'open';const r=await A('adminWithdrawals',{status:f});
  return sel('wdf',['open','paid','rejected','cancelled'],"Admin.go('wd')",f)+`<small class="muted">Owed (pending+approved): ${E(r.owed_usdt)} USDT</small>`+(r.items.map(x=>`<div class="card"><b>#${N(x.id)} · ${E(x.net_usdt)} USDT <small style="display:inline">(${E(x.status)})</small></b><small>${nm(x)} · ${E(D(x.created_at))}</small><p>${E(x.wallet_address)}</p>${x.reject_reason?`<small>${E(x.reject_reason)}</small>`:''}${x.tx_hash?`<small>${E(short(x.tx_hash))}</small>`:''}
  ${x.status==='pending'?`<div class="acts"><button class="btn sm" onclick="Admin.w(${N(x.id)},'Approve')">Approve</button><button class="btn sm ghost" onclick="Admin.w(${N(x.id)},'Reject')">Reject</button></div>`:x.status==='approved'?`<div class="acts"><button class="btn sm" onclick="Admin.w(${N(x.id)},'Paid')">Mark paid</button><button class="btn sm ghost" onclick="Admin.w(${N(x.id)},'Reject')">Reject</button></div>`:''}</div>`).join('')||empty('Nothing here'))},
 async dep(){const f=$('depf')?$('depf').value:'verified';const r=await A('adminDeposits',{status:f});
  return sel('depf',['verified','pending','confirmed','rejected'],"Admin.go('dep')",f)+(r.items.map(x=>`<div class="card"><b>#${N(x.id)} · ${E(x.amount_usdt||'?')} USDT <small style="display:inline">(${E(x.status)})</small></b><small>${nm(x)} · ${E(short(x.tx_hash))}</small><small>from ${E(short(x.from_address))}${x.reject_reason?' · '+E(x.reject_reason):''}</small>
  ${x.status==='verified'?`<div class="acts"><button class="btn sm" onclick="Admin.d(${N(x.id)},'Approve')">Approve</button><button class="btn sm ghost" onclick="Admin.d(${N(x.id)},'Reject')">Reject</button></div>`:x.status==='pending'?`<div class="acts"><button class="btn sm ghost" onclick="Admin.d(${N(x.id)},'Reject')">Reject</button></div>`:''}</div>`).join('')||empty('Nothing here'))},
 async usr(){return `<input id="uq" placeholder="Search Telegram ID, @username or name"><button class="btn" onclick="Admin.users()">Search ›</button><div id="ulist"></div>`},
 async tsk(){const r=await A('adminTasks');cur.tasks=r.items;
  return `<div class="card"><h2 id="tfh">New task</h2><input type="hidden" id="tf_id"><select id="tf_type"><option>channel</option><option>bot</option><option>website</option></select><input id="tf_title" placeholder="Title"><input id="tf_desc" placeholder="Description (optional)"><input id="tf_link" placeholder="https:// link"><input id="tf_reward" type="number" placeholder="Reward (Points)"><input id="tf_target" type="number" placeholder="Target completions (0 = unlimited)"><input id="tf_timer" type="number" placeholder="Timer seconds (10-600, default 30)"><input id="tf_chan" placeholder="@channel (channel tasks)"><div class="acts"><button class="btn sm" onclick="Admin.saveTask()">Save</button><button class="btn sm ghost" onclick="Admin.go('tsk')">Reset</button></div></div>`+
  r.items.map(t=>`<div class="card row"><div class="ic">${t.active?'🟢':'⚪'}</div><div class="mid"><b>#${N(t.id)} ${E(t.title)}</b><small>${E(t.type)} · +${N(t.reward).toLocaleString()} · ${N(t.completed)}/${t.target?N(t.target):'∞'}</small></div><div class="acts"><button class="btn sm" onclick="Admin.editTask(${N(t.id)})">Edit</button><button class="btn sm ghost" onclick="Admin.taskOn(${N(t.id)},${!t.active})">${t.active?'Disable':'Enable'}</button></div></div>`).join('')},
 async cmp(){const f=$('cmpf')?$('cmpf').value:'pending';const r=await A('adminCampaigns',{status:f});
  return sel('cmpf',['pending','active','rejected','cancelled'],"Admin.go('cmp')",f)+(r.items.map(x=>`<div class="card"><b>#${N(x.id)} ${E(x.title)} <small style="display:inline">(${E(x.status)})</small></b><small>${nm(x)} · ${E(x.type)} · +${N(x.reward).toLocaleString()} × ${N(x.target)} · done ${N(x.completed)}</small><p>${E(x.link)}</p>${x.reject_reason?`<small>${E(x.reject_reason)}</small>`:''}
  ${x.status==='pending'?`<div class="acts"><button class="btn sm" onclick="Admin.c(${N(x.id)},'Approve')">Approve</button><button class="btn sm ghost" onclick="Admin.c(${N(x.id)},'Close')">Reject</button></div>`:x.status==='active'?`<div class="acts"><button class="btn sm ghost" onclick="Admin.c(${N(x.id)},'Close')">Cancel + refund rest</button></div>`:''}</div>`).join('')||empty('Nothing here'))},
 async set(){const r=await A('adminSettings');cur.setItems=r.items;const groups=[...new Set(r.items.map(i=>i.group))];
  return groups.map(g=>`<div class="card"><h2>${E(g)}</h2>${r.items.filter(i=>i.group===g).map(i=>{const id='st_'+i.key,v=i.value;
   const ctl=i.type==='bool'?`<select id="${id}"><option value="true"${v?' selected':''}>ON</option><option value="false"${v?'':' selected'}>OFF</option></select>`
    :i.type==='list'?`<textarea id="${id}">${E((v||[]).join('\n'))}</textarea>`
    :`<input id="${id}" type="${i.type==='text'?'text':'number'}" step="any" value="${E(v)}">`;
   return `<small><b>${E(i.label)}</b>${i.custom?'':' (default)'}${i.help?' — '+E(i.help):''}</small>${ctl}`}).join('')}</div>`).join('')+
  `<button class="btn" onclick="Admin.saveSettings()">Save settings ›</button><div class="card"><small>Secrets stay in Vercel env: ${Object.entries(r.env).map(([k,v])=>E(k)+(v?' ✅':' ❌')).join(' · ')}</small></div>`},
 async prf(){const r=await A('adminProofList');cur.prfNext=r.next;return `<small class="muted">Paid withdrawals shown on the public Payment Proof screen. Hide any you do not want shown.</small><div id="prfl">${prfRows(r.items)}</div>`+(r.next?`<button class="btn" id="prfmore" onclick="Admin.prfMore()">Load more</button>`:'')},
 async aud(){const f=$('audf')?$('audf').value:'';const r=await A('adminAudit',{action:f==='all'?'':f});cur.audNext=r.next;
  return sel('audf',['all','withdrawal','deposit','user','task','campaign','proof','settings'],"Admin.go('aud')",f||'all')+`<div id="audl">${audRows(r.items)}</div>`+(r.next?`<button class="btn" id="audmore" onclick="Admin.more()">Load more</button>`:'')},
};
function prfRows(items){return items.map(x=>`<div class="card row"><div class="mid"><b>#${N(x.id)} · ${E(x.amount)} USDT</b><small>${E(x.name)} · ${E(D(x.paid_at))} · ${E(short(x.tx))}</small><small>${x.hidden?'Hidden from users':'Visible to users'}</small></div><button class="btn sm ghost" onclick="Admin.prfHide(${N(x.id)},${!x.hidden})">${x.hidden?'Show':'Hide'}</button></div>`).join('')||empty('No paid withdrawals yet')}
function audRows(items){return items.map(a=>`<div class="card"><b>${E(a.action)}</b><small>#${N(a.id)} · ${E(D(a.created_at))} · by ${E(a.actor_id)}</small><small>${E(a.target_type||'')} ${E(a.target_id||'')}${a.reason?' · '+E(a.reason):''}</small>${a.after_data?`<pre>${E(JSON.stringify(a.after_data)).slice(0,300)}</pre>`:''}</div>`).join('')||empty('Nothing here')}

window.Admin={
 open(){show()},
 go(t){tab=t;show()},
 async tool(a){await run(async()=>{$('admout').textContent=JSON.stringify(await A(a),null,1)})},
 async w(id,act){const p={id};if(act==='Reject'){const v=await ask('Reject withdrawal #'+id,[{k:'reason',label:'Reason (Points are refunded to the user)'}]);if(!v)return;p.reason=v.reason}
  if(act==='Paid'){const v=await ask('Mark #'+id+' paid',[{k:'tx',label:'Payout transaction hash (0x…)'}]);if(!v)return;p.txHash=v.tx}
  await run(async()=>{await A('adminWithdrawal'+act,p);note('Withdrawal #'+id+' updated');await show()})},
 async d(id,act){const p={id};if(act==='Reject'){const v=await ask('Reject deposit #'+id,[{k:'reason',label:'Reason'}]);if(!v)return;p.reason=v.reason}
  await run(async()=>{await A('adminDeposit'+act,p);note('Deposit #'+id+' updated');await show()})},
 async c(id,act){const p={id};if(act==='Close'){const v=await ask('Close campaign #'+id,[{k:'reason',label:'Reason (unspent budget is refunded to the owner)'}]);if(!v)return;p.reason=v.reason}
  await run(async()=>{const r=await A('adminCampaign'+act,p);note('Campaign #'+id+' → '+r.status+(r.refunded_points?' · refunded '+r.refunded_points+' Points':''));await show()})},
 async users(){await run(async()=>{const r=await A('adminUsers',{q:$('uq').value});$('ulist').innerHTML=r.items.map(u=>`<div class="card row"><div class="ic">${u.is_blocked?'⛔':'👤'}</div><div class="mid"><b>${nm(u)}</b><small>${E(u.telegram_id)} · ${N(u.points).toLocaleString()} pts</small></div><button class="btn sm" onclick="Admin.user('${E(u.telegram_id)}')">Open</button></div>`).join('')||empty('No users found')})},
 async user(uid){await run(async()=>{const r=await A('adminUser',{userId:uid}),u=r.user;
  $('ulist').innerHTML=`<div class="card"><b>${E(u.first_name||'')} ${u.username?'@'+E(u.username):''}</b><small>ID ${E(u.telegram_id)} · joined ${E(D(u.created_at))} · last seen ${E(D(u.last_active_at))}</small><small>Points ${N(u.points).toLocaleString()} · verified ${u.membership_verified?'yes':'no'} · referred by ${E(u.referrer_id||'—')} · invited ${N(r.referrals.invited)} (${N(r.referrals.qualified)} qualified)</small>${u.is_blocked?`<small>⛔ Blocked: ${E(u.blocked_reason||'')}</small>`:''}
  <div class="acts"><button class="btn sm" onclick="Admin.adjust('${E(u.telegram_id)}')">Adjust Points</button><button class="btn sm ghost" onclick="Admin.block('${E(u.telegram_id)}',${!u.is_blocked})">${u.is_blocked?'Unblock':'Block'}</button><button class="btn sm ghost" onclick="Admin.users()">‹ Back</button></div></div>
  <h2>Ledger</h2>${r.transactions.map(t=>`<div class="card row"><div class="mid"><b>${E(t.type)}</b><small>${E(t.description||'')} · ${E(D(t.created_at))}</small></div><span class="pts">${t.points_change>0?'+':''}${N(t.points_change).toLocaleString()}</span></div>`).join('')||empty('No transactions')}
  <h2>Withdrawals</h2>${r.withdrawals.map(w=>`<div class="card row"><div class="mid"><b>#${N(w.id)} · ${E(w.net_usdt)} USDT</b><small>${E(w.status)}</small></div></div>`).join('')||empty('None')}
  <h2>Deposits</h2>${r.deposits.map(w=>`<div class="card row"><div class="mid"><b>#${N(w.id)} · ${E(w.amount_usdt||'?')} USDT</b><small>${E(w.status)}</small></div></div>`).join('')||empty('None')}`})},
 async adjust(uid){const v=await ask('Adjust Points',[{k:'points',label:'Points (+ adds, − removes)',type:'number'},{k:'reason',label:'Reason (saved in ledger + audit)'}]);if(!v)return;
  await run(async()=>{const r=await A('adminUserAdjust',{userId:uid,points:N(v.points),reason:v.reason});note('Done · new balance '+N(r.balance).toLocaleString());await Admin.user(uid)})},
 async block(uid,blocked){let reason='';if(blocked){const v=await ask('Block user',[{k:'reason',label:'Reason'}]);if(!v)return;reason=v.reason}
  await run(async()=>{await A('adminUserBlock',{userId:uid,blocked,reason});note(blocked?'User blocked':'User unblocked');await Admin.user(uid)})},
 editTask(id){const t=cur.tasks.find(x=>N(x.id)===id);if(!t)return;$('tfh').textContent='Edit task #'+id;tf_id.value=id;tf_type.value=t.type;tf_type.disabled=true;tf_title.value=t.title||'';tf_desc.value=t.description||'';tf_link.value=t.link||'';tf_reward.value=t.reward;tf_target.value=t.target;tf_timer.value=t.timer_seconds;tf_chan.value=t.telegram_channel||'';window.scrollTo(0,0)},
 async saveTask(){await run(async()=>{const b={title:tf_title.value,description:tf_desc.value,link:tf_link.value,reward:tf_reward.value,target:tf_target.value||0,timerSeconds:tf_timer.value||30,telegramChannel:tf_chan.value};
  if(tf_id.value){await A('adminUpdateTask',{taskId:tf_id.value,...b});note('Task updated')}else{await A('adminCreateTask',{type:tf_type.value,...b});note('Task created')}await show()})},
 async taskOn(id,active){await run(async()=>{await A('adminSetTaskActive',{taskId:id,active});await show()})},
 async saveSettings(){const changes={};for(const i of cur.setItems){const el=$('st_'+i.key);if(!el)continue;let v=el.value;
   if(i.type==='bool')v=v==='true';else if(i.type==='int'||i.type==='dec')v=Number(v);else if(i.type==='list')v=v.split(/[\s,]+/).filter(Boolean);
   if(JSON.stringify(v)!==JSON.stringify(i.value))changes[i.key]=v}
  if(!Object.keys(changes).length){note('No changes');return}
  await run(async()=>{const r=await A('adminSettingsUpdate',{changes});note('Saved '+r.changed.length+' setting(s)'+(r.warnings.length?' ⚠️ '+r.warnings.join(' '):''));await show()})},
 async prfHide(id,hidden){await run(async()=>{await A('adminProofHide',{id,hidden});note('Proof #'+id+(hidden?' hidden':' shown'));await show()})},
 async prfMore(){await run(async()=>{const r=await A('adminProofList',{before:cur.prfNext});cur.prfNext=r.next;$('prfl').insertAdjacentHTML('beforeend',prfRows(r.items));if(!r.next)$('prfmore').remove()})},
 async more(){await run(async()=>{const f=$('audf').value,r=await A('adminAudit',{action:f==='all'?'':f,before:cur.audNext});cur.audNext=r.next;$('audl').insertAdjacentHTML('beforeend',audRows(r.items));if(!r.next)$('audmore').remove()})},
};
})();
