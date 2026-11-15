// Part 5: Admin panel UI. Loaded only for admins (index.html injects this file after bootstrap says admin=true).
// All permissions are enforced server-side on every call; this file is just a remote control.
(()=>{
const $=id=>document.getElementById(id),E=esc,A=(a,p)=>api(a,p||{}),N=Number;
const D=x=>x?new Date(x).toLocaleString():'';
const short=h=>h?String(h).slice(0,10)+'…'+String(h).slice(-6):'';
const nm=x=>E(x.first_name||x.username||x.telegram_id||x.owner_id);
const TABS=[['home','📊','Home'],['wd','💸','Withdraw'],['dep','⬇️','Deposits'],['usr','👤','Users'],['tsk','📋','Tasks'],['cmp','📢','Campaigns'],['ntf','🔔','Notify'],['set','⚙️','Settings'],['prf','🧾','Proof'],['aud','🧾','Audit']];
let tab='home',cur={f:{},tasks:[],setItems:[],audNext:null,prfNext:null};

function note(m){const n=$('admnote');if(n)n.textContent=m;try{say(m)}catch(e){}}
async function run(fn){try{await fn()}catch(e){note(e.message)}}
function ask(title,fields){return new Promise(res=>{const o=document.createElement('div');o.className='admodal';
 o.innerHTML=`<div class="card" role="dialog" aria-modal="true" aria-labelledby="admdlg"><h2 id="admdlg">${E(title)}</h2>${fields.map((f,i)=>`<label for="adq${i}">${E(f.label)}</label><input id="adq${i}" data-k="${E(f.k)}" type="${f.type||'text'}" inputmode="${f.type==='number'?'numeric':'text'}" autocomplete="off" placeholder="${E(f.ph||'')}">`).join('')}<div class="acts"><button class="btn sm" data-ok>OK</button><button class="btn sm ghost" data-no>Cancel</button></div></div>`;
 const prev=document.activeElement;document.body.appendChild(o);const first=o.querySelector('input');if(first)first.focus();
 const done=v=>{document.removeEventListener('keydown',key);o.remove();try{prev&&prev.focus()}catch(e){}res(v)};
 const key=e=>{if(e.key==='Escape')done(null)};document.addEventListener('keydown',key);
 o.querySelector('[data-no]').onclick=()=>done(null);
 o.querySelector('[data-ok]').onclick=()=>{const v={};o.querySelectorAll('input').forEach(i=>v[i.dataset.k]=i.value.trim());done(v)}})}
const empty=t=>`<div class="empty">${t}</div>`;
const sel=(id,opts,tabKey,c,lbl)=>`<label class="sr" for="${id}">${E(lbl||'Filter')}</label><select id="${id}" data-admchg="go" data-p0="${tabKey}">${opts.map(o=>`<option${o===c?' selected':''}>${o}</option>`).join('')}</select>`;
const stat=(l,v)=>`<div class="card stat"><small>${l}</small><b>${E(v)}</b></div>`;

function shell(){$('adm').innerHTML=`<div id="admtabs">${TABS.map(t=>`<button class="tab${t[0]===tab?' on':''}"${t[0]===tab?' aria-current="true"':''} data-adm="go" data-p0="${t[0]}">${t[1]} ${t[2]}</button>`).join('')}</div><div id="admnote"></div><div id="admbody"></div>`}
async function show(){shell();const b=$('admbody');b.innerHTML=empty('Loading…');await run(async()=>{b.innerHTML=await VIEWS[tab]()})}
const VIEWS={
 async home(){const d=await A('adminDashboard');return `<div class="grid">${[
  ['Users',d.users],['New (24h)',d.new_24h],['Active (24h)',d.active_24h],['Blocked',d.blocked],
  ['Points in wallets',Number(d.points_total).toLocaleString()+' ≈ '+d.points_total_usdt+' USDT'],['Open withdrawals',d.open_withdrawals+' · owe '+d.owed_usdt+' USDT'],
  ['Paid out',d.paid_usdt+' USDT'],['Deposits to review',d.deposits_waiting],['Deposited',d.deposited_usdt+' USDT'],['Campaigns pending',d.campaigns_pending],
  ['Active tasks',d.tasks_active],['Qualified referrals',d.referrals_qualified],['Abuse flags (24h)',d.abuse_24h],['Maintenance',d.maintenance?'ON':'off']].map(x=>stat(x[0],x[1])).join('')}</div>
  <div class="acts"><button class="btn sm" data-adm="tool" data-p0="adminReconcile">Ledger check</button><button class="btn sm" data-adm="tool" data-p0="adminAbuseEvents">Abuse events</button><button class="btn sm" data-adm="tool" data-p0="adminDiagnostics">Server check</button></div><pre id="admout"></pre>`},
 async wd(){const f=cur.f.wdf||'open';const r=await A('adminWithdrawals',{status:f});
  return sel('wdf',['open','paid','rejected','cancelled'],'wd',f)+`<small class="muted">Owed (pending+approved): ${E(r.owed_usdt)} USDT</small>`+(r.items.map(x=>`<div class="card"><b>#${N(x.id)} · ${E(x.net_usdt)} USDT <small class="inl">(${E(x.status)})</small></b><small>${nm(x)} · ${E(D(x.created_at))}</small><p>${E(x.wallet_address)}</p>${x.reject_reason?`<small>${E(x.reject_reason)}</small>`:''}${x.tx_hash?`<small>${E(short(x.tx_hash))}</small>`:''}
  ${x.status==='pending'?`<div class="acts"><button class="btn sm" data-adm="w" data-p0="${N(x.id)}" data-p1="Approve">Approve</button><button class="btn sm ghost" data-adm="w" data-p0="${N(x.id)}" data-p1="Reject">Reject</button></div>`:x.status==='approved'?`<div class="acts"><button class="btn sm" data-adm="w" data-p0="${N(x.id)}" data-p1="Paid">Mark paid</button><button class="btn sm ghost" data-adm="w" data-p0="${N(x.id)}" data-p1="Reject">Reject</button></div>`:''}</div>`).join('')||empty('Nothing here'))},
 async dep(){const f=cur.f.depf||'verified';const r=await A('adminDeposits',{status:f});
  return sel('depf',['verified','pending','confirmed','rejected'],'dep',f)+(r.items.map(x=>`<div class="card"><b>#${N(x.id)} · ${E(x.amount_usdt||'?')} USDT <small class="inl">(${E(x.status)})</small></b><small>${nm(x)} · ${E(short(x.tx_hash))}</small><small>from ${E(short(x.from_address))}${x.reject_reason?' · '+E(x.reject_reason):''}</small>
  ${x.status==='verified'?`<div class="acts"><button class="btn sm" data-adm="d" data-p0="${N(x.id)}" data-p1="Approve">Approve</button><button class="btn sm ghost" data-adm="d" data-p0="${N(x.id)}" data-p1="Reject">Reject</button></div>`:x.status==='pending'?`<div class="acts"><button class="btn sm ghost" data-adm="d" data-p0="${N(x.id)}" data-p1="Reject">Reject</button></div>`:''}</div>`).join('')||empty('Nothing here'))},
 async usr(){return `<label class="sr" for="uq">Search users</label><input id="uq" placeholder="Search Telegram ID, @username or name" autocomplete="off"><button class="btn" data-adm="users">Search ›</button><div id="ulist"></div>`},
 async tsk(){const r=await A('adminTasks');cur.tasks=r.items;
  return `<div class="card"><h2 id="tfh">New task</h2><input type="hidden" id="tf_id"><label class="sr" for="tf_type">Task type</label><select id="tf_type"><option>channel</option><option>bot</option><option>website</option></select><label class="sr" for="tf_title">Title</label><input id="tf_title" placeholder="Title"><label class="sr" for="tf_desc">Description</label><input id="tf_desc" placeholder="Description (optional)"><label class="sr" for="tf_link">Link</label><input id="tf_link" placeholder="https:// link"><label class="sr" for="tf_reward">Reward (Points)</label><input id="tf_reward" type="number" placeholder="Reward (Points)"><label class="sr" for="tf_target">Target completions (0 = unlimited)</label><input id="tf_target" type="number" placeholder="Target completions (0 = unlimited)"><label class="sr" for="tf_timer">Timer seconds (10-600, default 30)</label><input id="tf_timer" type="number" placeholder="Timer seconds (10-600, default 30)"><label class="sr" for="tf_chan">Channel, e.g. @channel</label><input id="tf_chan" placeholder="@channel (channel tasks)"><div class="acts"><button class="btn sm" data-adm="saveTask">Save</button><button class="btn sm ghost" data-adm="go" data-p0="tsk">Reset</button></div></div>`+
  r.items.map(t=>`<div class="card row"><div class="ic">${t.active?'🟢':'⚪'}</div><div class="mid"><b>#${N(t.id)} ${E(t.title)}</b><small>${E(t.type)} · +${N(t.reward).toLocaleString()} · ${N(t.completed)}/${t.target?N(t.target):'∞'}</small></div><div class="acts"><button class="btn sm" data-adm="editTask" data-p0="${N(t.id)}">Edit</button><button class="btn sm ghost" data-adm="taskOn" data-p0="${N(t.id)}" data-p1="${!t.active}">${t.active?'Disable':'Enable'}</button></div></div>`).join('')},
 async cmp(){const f=cur.f.cmpf||'pending';const r=await A('adminCampaigns',{status:f});
  return sel('cmpf',['pending','active','rejected','cancelled'],'cmp',f)+(r.items.map(x=>`<div class="card"><b>#${N(x.id)} ${E(x.title)} <small class="inl">(${E(x.status)})</small></b><small>${nm(x)} · ${E(x.type)} · +${N(x.reward).toLocaleString()} × ${N(x.target)} · done ${N(x.completed)}</small><p>${E(x.link)}</p>${x.reject_reason?`<small>${E(x.reject_reason)}</small>`:''}
  ${x.status==='pending'?`<div class="acts"><button class="btn sm" data-adm="c" data-p0="${N(x.id)}" data-p1="Approve">Approve</button><button class="btn sm ghost" data-adm="c" data-p0="${N(x.id)}" data-p1="Close">Reject</button></div>`:x.status==='active'?`<div class="acts"><button class="btn sm ghost" data-adm="c" data-p0="${N(x.id)}" data-p1="Close">Cancel + refund rest</button></div>`:''}</div>`).join('')||empty('Nothing here'))},

 async ntf(){const r=await A('adminNotifyStatus'),q=r.queue||{},w=r.webhook;
  const ok=w&&w.url;
  return `<div class="card"><h2>Bot webhook</h2><small>${ok?'✅ Connected':'❌ Not connected'}${w&&w.url?' · '+E(w.url):''}${w&&w.last_error?' · last error: '+E(w.last_error):''}</small><small>Secrets: TG_WEBHOOK_SECRET ${r.secrets.webhook?'✅':'❌'} · CRON_SECRET ${r.secrets.cron?'✅':'❌'}</small><div class="acts"><button class="btn sm" data-adm="hook">Set / refresh webhook</button></div></div>
  <div class="grid">${[['Waiting',N(q.pending||0)+N(q.sending||0)],['Sent (7d)',q.sent||0],['Skipped (7d)',q.skipped||0],['Failed (7d)',q.failed||0]].map(x=>stat(x[0],x[1])).join('')}</div>
  <div class="acts"><button class="btn sm" data-adm="sendBatch">Send next batch ›</button></div>
  <div class="card"><h2>New broadcast</h2><label class="sr" for="bc_seg">Who receives it</label><select id="bc_seg"><option value="me">Only me (test)</option><option value="all">All users</option><option value="active7">Active in last 7 days</option><option value="balance">Users with Points</option><option value="new24">New in last 24 hours</option></select><label class="sr" for="bc_text">Message (plain text, max 1000 characters)</label><textarea id="bc_text" maxlength="1000" placeholder="Message (plain text, max 1000 characters)"></textarea><div class="acts"><button class="btn sm" data-adm="bcSend">Queue broadcast</button></div><small class="muted">Always test with “Only me” first. Users who blocked the bot are skipped automatically.</small></div>
  <h2>Recent broadcasts</h2>${(r.broadcasts||[]).map(b=>`<div class="card"><b>#${N(b.id)} · ${E(b.label)} <small class="inl">(${b.cancelled?'cancelled':N(b.waiting)>0?'sending':'done'})</small></b><small>${E(D(b.created_at))} · to ${N(b.total)} · sent ${N(b.sent)} · skipped ${N(b.skipped)} · failed ${N(b.failed)} · waiting ${N(b.waiting)}</small><p>${E(b.preview)}</p>${N(b.waiting)>0&&!b.cancelled?`<div class="acts"><button class="btn sm ghost" data-adm="bcCancel" data-p0="${N(b.id)}">Cancel rest</button></div>`:''}</div>`).join('')||empty('No broadcasts yet')}`},
 async set(){const r=await A('adminSettings');cur.setItems=r.items;const groups=[...new Set(r.items.map(i=>i.group))];
  return groups.map(g=>`<div class="card"><h2>${E(g)}</h2>${r.items.filter(i=>i.group===g).map(i=>{const id='st_'+i.key,v=i.value;
   const ctl=i.type==='bool'?`<select id="${id}"><option value="true"${v?' selected':''}>ON</option><option value="false"${v?'':' selected'}>OFF</option></select>`
    :i.type==='list'?`<textarea id="${id}">${E((v||[]).join('\n'))}</textarea>`
    :`<input id="${id}" type="${i.type==='text'?'text':'number'}" step="any" value="${E(v)}">`;
   return `<small><b>${E(i.label)}</b>${i.custom?'':' (default)'}${i.help?' — '+E(i.help):''}</small>${ctl}`}).join('')}</div>`).join('')+
  `<button class="btn" data-adm="saveSettings">Save settings ›</button><div class="card"><small>Secrets stay in Vercel env: ${Object.entries(r.env).map(([k,v])=>E(k)+(v?' ✅':' ❌')).join(' · ')}</small></div>`},
 async prf(){const r=await A('adminProofList');cur.prfNext=r.next;return `<small class="muted">Paid withdrawals shown on the public Payment Proof screen. Hide any you do not want shown.</small><div id="prfl">${prfRows(r.items)}</div>`+(r.next?`<button class="btn" id="prfmore" data-adm="prfMore">Load more</button>`:'')},
 async aud(){const f=cur.f.audf||'';const r=await A('adminAudit',{action:f==='all'?'':f});cur.audNext=r.next;
  return sel('audf',['all','withdrawal','deposit','user','task','campaign','proof','broadcast','notify','settings'],'aud',f||'all')+`<div id="audl">${audRows(r.items)}</div>`+(r.next?`<button class="btn" id="audmore" data-adm="more">Load more</button>`:'')},
};
function prfRows(items){return items.map(x=>`<div class="card row"><div class="mid"><b>#${N(x.id)} · ${E(x.amount)} USDT</b><small>${E(x.name)} · ${E(D(x.paid_at))} · ${E(short(x.tx))}</small><small>${x.hidden?'Hidden from users':'Visible to users'}</small></div><button class="btn sm ghost" data-adm="prfHide" data-p0="${N(x.id)}" data-p1="${!x.hidden}">${x.hidden?'Show':'Hide'}</button></div>`).join('')||empty('No paid withdrawals yet')}
function audRows(items){return items.map(a=>`<div class="card"><b>${E(a.action)}</b><small>#${N(a.id)} · ${E(D(a.created_at))} · by ${E(a.actor_id)}</small><small>${E(a.target_type||'')} ${E(a.target_id||'')}${a.reason?' · '+E(a.reason):''}</small>${a.after_data?`<pre>${E(JSON.stringify(a.after_data)).slice(0,300)}</pre>`:''}</div>`).join('')||empty('Nothing here')}

const NUM=new Set(['w','d','c','editTask','taskOn','prfHide','bcCancel']),BOOL=new Set(['block','taskOn','prfHide']);
function call(el,key){const n=el.dataset[key];if(!n||!Object.prototype.hasOwnProperty.call(Admin,n)||typeof Admin[n]!=='function')return;
 const a=[el.dataset.p0,el.dataset.p1].filter(x=>x!==undefined);if(NUM.has(n))a[0]=N(a[0]);if(BOOL.has(n)&&a.length>1)a[1]=a[1]==='true';
 Promise.resolve(Admin[n](...a)).catch(e=>note(e.message))}
document.addEventListener('click',e=>{const el=e.target.closest&&e.target.closest('[data-adm]');if(el&&$('adm').contains(el))call(el,'adm')});
document.addEventListener('change',e=>{const el=e.target;if(el&&el.dataset&&el.dataset.admchg&&$('adm').contains(el)){cur.f[el.id]=el.value;call(el,'admchg')}});
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
 async users(){await run(async()=>{const r=await A('adminUsers',{q:$('uq').value});$('ulist').innerHTML=r.items.map(u=>`<div class="card row"><div class="ic">${u.is_blocked?'⛔':'👤'}</div><div class="mid"><b>${nm(u)}</b><small>${E(u.telegram_id)} · ${N(u.points).toLocaleString()} pts</small></div><button class="btn sm" data-adm="user" data-p0="${E(u.telegram_id)}">Open</button></div>`).join('')||empty('No users found')})},
 async user(uid){await run(async()=>{const r=await A('adminUser',{userId:uid}),u=r.user;
  $('ulist').innerHTML=`<div class="card"><b>${E(u.first_name||'')} ${u.username?'@'+E(u.username):''}</b><small>ID ${E(u.telegram_id)} · joined ${E(D(u.created_at))} · last seen ${E(D(u.last_active_at))}</small><small>Points ${N(u.points).toLocaleString()} · verified ${u.membership_verified?'yes':'no'} · referred by ${E(u.referrer_id||'—')} · invited ${N(r.referrals.invited)} (${N(r.referrals.qualified)} qualified)</small>${u.is_blocked?`<small>⛔ Blocked: ${E(u.blocked_reason||'')}</small>`:''}
  <div class="acts"><button class="btn sm" data-adm="adjust" data-p0="${E(u.telegram_id)}">Adjust Points</button><button class="btn sm ghost" data-adm="block" data-p0="${E(u.telegram_id)}" data-p1="${!u.is_blocked}">${u.is_blocked?'Unblock':'Block'}</button><button class="btn sm ghost" data-adm="users">‹ Back</button></div></div>
  <h2>Ledger</h2>${r.transactions.map(t=>`<div class="card row"><div class="mid"><b>${E(t.type)}</b><small>${E(t.description||'')} · ${E(D(t.created_at))}</small></div><span class="pts">${t.points_change>0?'+':''}${N(t.points_change).toLocaleString()}</span></div>`).join('')||empty('No transactions')}
  <h2>Withdrawals</h2>${r.withdrawals.map(w=>`<div class="card row"><div class="mid"><b>#${N(w.id)} · ${E(w.net_usdt)} USDT</b><small>${E(w.status)}</small></div></div>`).join('')||empty('None')}
  <h2>Deposits</h2>${r.deposits.map(w=>`<div class="card row"><div class="mid"><b>#${N(w.id)} · ${E(w.amount_usdt||'?')} USDT</b><small>${E(w.status)}</small></div></div>`).join('')||empty('None')}`})},
 async adjust(uid){const v=await ask('Adjust Points',[{k:'points',label:'Points (+ adds, − removes)',type:'number'},{k:'reason',label:'Reason (saved in ledger + audit)'}]);if(!v)return;
  await run(async()=>{const r=await A('adminUserAdjust',{userId:uid,points:N(v.points),reason:v.reason});note('Done · new balance '+N(r.balance).toLocaleString());await Admin.user(uid)})},
 async block(uid,blocked){let reason='';if(blocked){const v=await ask('Block user',[{k:'reason',label:'Reason'}]);if(!v)return;reason=v.reason}
  await run(async()=>{await A('adminUserBlock',{userId:uid,blocked,reason});note(blocked?'User blocked':'User unblocked');await Admin.user(uid)})},
 editTask(id){const t=cur.tasks.find(x=>N(x.id)===id);if(!t)return;$('tfh').textContent='Edit task #'+id;$('tf_id').value=id;$('tf_type').value=t.type;$('tf_type').disabled=true;$('tf_title').value=t.title||'';$('tf_desc').value=t.description||'';$('tf_link').value=t.link||'';$('tf_reward').value=t.reward;$('tf_target').value=t.target;$('tf_timer').value=t.timer_seconds;$('tf_chan').value=t.telegram_channel||'';window.scrollTo(0,0)},
 async saveTask(){await run(async()=>{const v=k=>$('tf_'+k).value,b={title:v('title'),description:v('desc'),link:v('link'),reward:v('reward'),target:v('target')||0,timerSeconds:v('timer')||30,telegramChannel:v('chan')};
  if(v('id')){await A('adminUpdateTask',{taskId:v('id'),...b});note('Task updated')}else{await A('adminCreateTask',{type:v('type'),...b});note('Task created')}await show()})},
 async taskOn(id,active){await run(async()=>{await A('adminSetTaskActive',{taskId:id,active});await show()})},
 async saveSettings(){const changes={};for(const i of cur.setItems){const el=$('st_'+i.key);if(!el)continue;let v=el.value;
   if(i.type==='bool')v=v==='true';else if(i.type==='int'||i.type==='dec')v=Number(v);else if(i.type==='list')v=v.split(/[\s,]+/).filter(Boolean);
   if(JSON.stringify(v)!==JSON.stringify(i.value))changes[i.key]=v}
  if(!Object.keys(changes).length){note('No changes');return}
  await run(async()=>{const r=await A('adminSettingsUpdate',{changes});note('Saved '+r.changed.length+' setting(s)'+(r.warnings.length?' ⚠️ '+r.warnings.join(' '):''));await show()})},

 async hook(){await run(async()=>{const r=await A('adminWebhookSetup');note('Webhook set: '+r.url);await show()})},
 async sendBatch(){await run(async()=>{const r=await A('adminNotifyProcess');note('Sent '+N(r.sent)+' · skipped '+N(r.skipped)+' · failed '+N(r.failed)+' · remaining '+N(r.remaining));await show()})},
 async bcSend(){const text=$('bc_text').value,segment=$('bc_seg').value;if(text.trim().length<3){note('Write a message first');return}
  const v=await ask('Confirm broadcast',[{k:'ok',label:'Type SEND to queue this message for '+$('bc_seg').selectedOptions[0].text}]);if(!v||v.ok.toUpperCase()!=='SEND'){note('Cancelled');return}
  await run(async()=>{const r=await A('adminBroadcastCreate',{text,segment});note('Queued for '+N(r.recipients)+' users. Press “Send next batch” until Waiting is 0 (the daily cron also sends).');await show()})},
 async bcCancel(id){await run(async()=>{const r=await A('adminBroadcastCancel',{id});note('Cancelled '+N(r.cancelled)+' waiting message(s)');await show()})},
 async prfHide(id,hidden){await run(async()=>{await A('adminProofHide',{id,hidden});note('Proof #'+id+(hidden?' hidden':' shown'));await show()})},
 async prfMore(){await run(async()=>{const r=await A('adminProofList',{before:cur.prfNext});cur.prfNext=r.next;$('prfl').insertAdjacentHTML('beforeend',prfRows(r.items));if(!r.next)$('prfmore').remove()})},
 async more(){await run(async()=>{const f=cur.f.audf||'',r=await A('adminAudit',{action:f==='all'?'':f,before:cur.audNext});cur.audNext=r.next;$('audl').insertAdjacentHTML('beforeend',audRows(r.items));if(!r.next)$('audmore').remove()})},
};
})();
