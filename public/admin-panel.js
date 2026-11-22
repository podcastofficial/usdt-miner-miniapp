// Dedicated Admin Panel: all users, full user profile, live activity. Read-only views + (role-checked) block / adjust Points.
// The server checks the Telegram login and the admin role on every request; this file is only the screen.
(() => {
const $ = (s) => document.querySelector(s);
const view = $('#view'), notice = $('#notice'), tabsEl = $('#tabs');
const tg = window.Telegram && window.Telegram.WebApp;
try { tg && tg.ready(); tg && tg.expand(); } catch (e) { /* not inside Telegram */ }
const init = (tg && tg.initData) || '';
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const n = (v) => Number(v || 0).toLocaleString();
const usdt = (v) => Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 4 });
const dt = (v) => (v ? new Date(v).toLocaleString() : '—');
const ago = (v) => {
  if (!v) return 'never';
  const s = Math.max(0, (Date.now() - new Date(v).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + ' min ago';
  if (s < 86400) return Math.floor(s / 3600) + ' h ago';
  if (s < 86400 * 30) return Math.floor(s / 86400) + ' d ago';
  return new Date(v).toLocaleDateString();
};
const name = (u) => esc(u.first_name || u.username || u.telegram_id);
const handle = (u) => (u.username ? '@' + esc(u.username) : 'ID ' + esc(u.telegram_id));

async function api(action, p = {}) {
  if (!init) throw Error('Telegram session missing. Please open this page from inside the Telegram Mini App (use the "Open Admin Panel" button in the app).');
  const r = await fetch('/api?action=' + encodeURIComponent(action), { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': init }, body: JSON.stringify(p) });
  let j = {}; try { j = await r.json(); } catch (e) { /* empty body */ }
  if (!r.ok) throw Error(j.error || 'Request failed (' + r.status + ')');
  return j;
}
function say(m, kind) { notice.hidden = !m; notice.textContent = m || ''; notice.className = 'notice' + (kind ? ' ' + kind : ''); }

let perms = [], tab = 'dash';
const can = (p) => perms.includes(p);
const U = { q: '', filter: 'all', sort: 'newest', page: 0 };
let feedKind = 'all';
const AD = { days: 14, day: '' };

const KIND = { ledger: ['🪙', 'Points'], join: ['🆕', 'Joined'], withdraw: ['💸', 'Withdraw'], deposit: ['⬇️', 'Deposit'], proof: ['🧾', 'Proof'], support: ['💬', 'Support'], referral: ['👥', 'Referral'] };
const STATUS_CLS = { paid: 'pos', approved: 'pos', confirmed: 'pos', answered: 'pos', rejected: 'neg', cancelled: 'neg', failed: 'neg' };

function timelineRows(items, showUser) {
  if (!items.length) return '<div class="empty">No activity found</div>';
  return '<div class="tl">' + items.map((x) => {
    const k = KIND[x.kind] || ['•', x.kind];
    let amt = '';
    if (x.kind === 'ledger' && x.amount != null) { const a = Number(x.amount); amt = `<span class="${a >= 0 ? 'pos' : 'neg'}">${a >= 0 ? '+' : ''}${n(a)}</span><br><small>MINER</small>`; }
    else if ((x.kind === 'withdraw' || x.kind === 'deposit') && x.amount != null) amt = `${usdt(x.amount)}<br><small>USDT</small>`;
    else if (x.kind === 'proof' && x.amount != null) amt = `+${n(x.amount)}<br><small>MINER</small>`;
    const st = x.status ? ` · <span class="${STATUS_CLS[x.status] || ''}">${esc(x.status)}</span>` : '';
    const who = showUser ? `<span class="who" data-uid="${esc(x.telegram_id)}" style="color:var(--accent);cursor:pointer">${name(x)} (${esc(x.telegram_id)})</span> · ` : '';
    return `<div class="it"><div class="ic">${k[0]}</div><div><div class="t">${esc(x.title)}</div><div class="d">${who}${esc(x.detail || '')}${st}</div><div class="d">${dt(x.happened_at)} · ${ago(x.happened_at)}</div></div><div class="amt">${amt}</div></div>`;
  }).join('') + '</div>';
}

// ---------------- Dashboard ----------------
async function dash() {
  const [s, f] = await Promise.all([api('adminPanelSummary'), api('adminActivityFeed', { limit: 12 })]);
  const stat = ([k, v]) => `<div class="stat"><small>${k}</small><b>${v}</b></div>`;
  const max = Math.max(1, ...s.daily_joins.map((d) => d.new_users));
  view.innerHTML = `
    <div class="card"><h2>Users</h2><div class="grid">${[
      ['Total users', n(s.users)], ['New (24h)', n(s.new_24h)], ['New (7 days)', n(s.new_7d)], ['Active (24h)', n(s.active_24h)],
      ['Active (7 days)', n(s.active_7d)], ['Blocked', n(s.blocked)], ['Bot blocked by user', n(s.bot_blocked)], ['Referrals qualified', n(s.referrals_qualified)],
    ].map(stat).join('')}</div></div>
    <div class="card"><h2>Money &amp; queues</h2><div class="grid">${[
      ['MINER in balances', n(s.points_total)], ['Ledger entries (24h)', n(s.tx_24h)], ['Paid out (USDT)', usdt(s.paid_usdt)], ['Deposited (USDT)', usdt(s.deposited_usdt)],
      ['Open withdrawals', n(s.open_withdrawals)], ['Deposits waiting', n(s.deposits_waiting)], ['Proofs pending', n(s.proofs_pending)], ['Open tickets', n(s.tickets_open)],
    ].map(stat).join('')}</div></div>
    <div class="card"><h2>New users · last 7 days</h2><div class="bars">${s.daily_joins.map((d) => `<div><i style="height:${Math.round((d.new_users / max) * 80)}px"></i>${n(d.new_users)}<br>${esc(d.day.slice(5))}</div>`).join('')}</div></div>
    <div class="card"><h2>Latest activity</h2>${timelineRows(f.items, true)}<div class="actions"><button data-tab-go="feed">See all activity →</button></div></div>`;
}

// ---------------- Users list ----------------
let searchTimer = null;
async function users() {
  view.innerHTML = `
    <div class="card"><div class="toolbar">
      <input id="q" placeholder="Search name, @username, Telegram ID or referral code" value="${esc(U.q)}" autocomplete="off">
      <select id="flt">${[['all', 'All users'], ['active24h', 'Active (24h)'], ['active7d', 'Active (7 days)'], ['new24h', 'New (24h)'], ['new7d', 'New (7 days)'], ['blocked', 'Blocked'], ['withdrew', 'Have withdrawn'], ['referrers', 'Have referrals'], ['miners', 'Own auto miners'], ['botblocked', 'Bot blocked'], ['admins', 'Admins']].map(([v, l]) => `<option value="${v}"${U.filter === v ? ' selected' : ''}>${l}</option>`).join('')}</select>
      <select id="srt">${[['newest', 'Newest first'], ['oldest', 'Oldest first'], ['active', 'Recently active'], ['points', 'Highest balance']].map(([v, l]) => `<option value="${v}"${U.sort === v ? ' selected' : ''}>${l}</option>`).join('')}</select>
    </div></div>
    <div id="ulist" class="list"><div class="empty">Loading…</div></div><div id="upager"></div>`;
  $('#q').oninput = (e) => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { U.q = e.target.value.trim(); U.page = 0; loadUsers(); }, 350); };
  $('#flt').onchange = (e) => { U.filter = e.target.value; U.page = 0; loadUsers(); };
  $('#srt').onchange = (e) => { U.sort = e.target.value; U.page = 0; loadUsers(); };
  await loadUsers();
}
async function loadUsers() {
  const box = $('#ulist'); if (!box) return;
  try {
    const r = await api('adminUsersDirectory', U);
    box.innerHTML = r.items.map((u) => `
      <div class="urow" data-uid="${esc(u.telegram_id)}">
        <div><b>${name(u)}</b><span class="meta">${handle(u)} · joined ${ago(u.created_at)}</span><br>
          ${u.is_blocked ? '<span class="badge bad">Blocked</span>' : ''}${u.is_admin ? '<span class="badge warn">Admin</span>' : ''}${u.bot_blocked ? '<span class="badge warn">Bot blocked</span>' : ''}
          <span class="badge">${n(u.invited)} invited</span><span class="badge">${n(u.tx_count)} entries</span>
          ${Number(u.withdrawn_usdt) > 0 ? `<span class="badge">withdrew ${usdt(u.withdrawn_usdt)} USDT</span>` : ''}${Number(u.deposited_usdt) > 0 ? `<span class="badge">deposited ${usdt(u.deposited_usdt)} USDT</span>` : ''}</div>
        <div class="right"><b>${n(u.points)}</b><span class="meta">MINER<br>active ${ago(u.last_active_at)}</span></div>
      </div>`).join('') || '<div class="empty">No users found</div>';
    const from = r.total ? r.page * r.pageSize + 1 : 0, to = r.page * r.pageSize + r.items.length;
    $('#upager').innerHTML = `<div class="pager"><button id="pprev" ${r.page ? '' : 'disabled'}>← Prev</button><small>${from}–${to} of ${n(r.total)}</small><button id="pnext" ${r.hasMore ? '' : 'disabled'}>Next →</button></div>`;
    $('#pprev').onclick = () => { U.page = Math.max(0, U.page - 1); loadUsers(); };
    $('#pnext').onclick = () => { U.page += 1; loadUsers(); };
    say('');
  } catch (e) { box.innerHTML = `<div class="empty">${esc(e.message)}</div>`; say(e.message, 'error'); }
}

// ---------------- Global activity ----------------
async function feed(more) {
  if (!more) {
    view.innerHTML = `<div class="card"><div class="chips">${Object.entries({ all: 'All', ledger: 'Points', join: 'New users', withdraw: 'Withdrawals', deposit: 'Deposits', proof: 'Proofs', support: 'Support' }).map(([k, l]) => `<button data-kind="${k}" class="${feedKind === k ? 'active' : ''}">${l}</button>`).join('')}</div></div>
      <div class="card"><div id="fbox"></div><div class="actions"><button id="fmore" hidden>Load more</button></div></div>`;
    view.querySelectorAll('[data-kind]').forEach((b) => { b.onclick = () => { feedKind = b.dataset.kind; feed(false); }; });
    feed.items = []; feed.next = null;
  }
  try {
    const r = await api('adminActivityFeed', { kind: feedKind, before: more ? feed.next : undefined, limit: 40 });
    feed.items = (feed.items || []).concat(r.items); feed.next = r.nextBefore;
    $('#fbox').innerHTML = timelineRows(feed.items, true);
    const m = $('#fmore'); m.hidden = !feed.next; m.onclick = () => feed(true);
    say('');
  } catch (e) { say(e.message, 'error'); }
}


// ---------------- Watch & Earn ads ----------------
async function ads() {
  const r = await api('adminAdStats', { days: AD.days, day: AD.day || undefined });
  AD.day = r.day;
  const t = r.daily.find((x) => x.day === r.today) || { watches: 0, viewers: 0, points: 0 };
  const stat = ([k, v]) => `<div class="stat"><small>${k}</small><b>${v}</b></div>`;
  view.innerHTML = `
    <div class="card"><h2>Watch &amp; Earn ads</h2>
      <p class="muted">${r.enabled ? 'Feature is ON' : '<span class="neg">Feature is OFF</span>'} · reward ${n(r.reward)} MINER per ad · limit ${n(r.dailyLimit)} ads per user per day${r.network ? ' · network: ' + esc(r.network) : ''}</p>
      <div class="grid">${[['Ads watched today', n(t.watches)], ['Users today', n(t.viewers)], ['MINER paid today', n(t.points)], ['Ads all time', n(r.totals.watches)], ['Users all time', n(r.totals.viewers)], ['MINER paid all time', n(r.totals.points)]].map(stat).join('')}</div></div>
    <div class="card"><div class="toolbar" style="grid-template-columns:1fr"><select id="adays">${[7, 14, 30].map((d) => `<option value="${d}"${AD.days === d ? ' selected' : ''}>Last ${d} days</option>`).join('')}</select></div>
      <div class="tablewrap" style="margin-top:10px"><table><tr><th>Date (UTC)</th><th>Ads watched</th><th>Users</th><th>MINER paid</th></tr>${r.daily.map((d) => `<tr data-adday="${esc(d.day)}" style="cursor:pointer;${d.day === r.day ? 'background:#162842' : ''}"><td>${esc(d.day)}${d.day === r.today ? ' <small>(today)</small>' : ''}</td><td>${n(d.watches)}</td><td>${n(d.viewers)}</td><td>${n(d.points)}</td></tr>`).join('')}</table></div>
      <p class="muted" style="margin-bottom:0"><small>Tap a date to see who watched on that day.</small></p></div>
    <div class="card"><h2>Who watched · ${esc(r.day)}</h2>${r.viewers.map((v) => `<div class="urow" data-uid="${esc(v.telegram_id)}" style="margin-bottom:8px"><div><b>${name(v)}</b><span class="meta">${handle(v)} · first ${dt(v.first_at)} · last ${dt(v.last_at)}</span></div><div class="right"><b>${n(v.watches)} ads</b><span class="meta">${n(v.points)} MINER<br>${n(v.all_time)} all time</span></div></div>`).join('') || '<div class="empty">Nobody watched an ad on this day</div>'}
      ${r.viewers.length >= 200 ? '<p class="muted"><small>Showing the top 200 users.</small></p>' : ''}</div>
    <p class="muted"><small>Counts only rewarded Watch &amp; Earn ads that were fully watched and paid. Popup ads are not tracked on the server.</small></p>`;
  $('#adays').onchange = (e) => { AD.days = Number(e.target.value); go('ads'); };
  view.querySelectorAll('[data-adday]').forEach((row) => { row.onclick = () => { AD.day = row.dataset.adday; go('ads'); }; });
}

// ---------------- One user ----------------
async function openUser(id, more) {
  if (!more) { view.innerHTML = '<div class="empty">Loading user…</div>'; tabsEl.hidden = true; openUser.tl = []; openUser.next = null; }
  try {
    const r = await api('adminUserFull', { userId: id, before: more ? openUser.next : undefined, limit: 40 });
    openUser.tl = (openUser.tl || []).concat(r.timeline); openUser.next = r.nextBefore;
    if (more) { $('#tlbox').innerHTML = timelineRows(openUser.tl, false); $('#tlmore').hidden = !openUser.next; return; }
    const u = r.user, s = r.stats;
    const kv = (rows) => '<dl class="kv">' + rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('') + '</dl>';
    const risk = r.risk ? `<span class="badge ${r.risk.band === 'high' ? 'bad' : r.risk.band === 'medium' ? 'warn' : ''}">Risk: ${esc(r.risk.band)} (${n(r.risk.score)})</span>` : '';
    view.innerHTML = `
      <div class="actions" style="margin:0"><button id="back">← Back</button></div>
      <div class="card"><h2>${name(u)} <small>${handle(u)}</small></h2>
        ${u.is_blocked ? '<span class="badge bad">Blocked</span>' : '<span class="badge">Active account</span>'}${u.is_admin ? '<span class="badge warn">Admin</span>' : ''}${u.bot_blocked ? '<span class="badge warn">Bot blocked</span>' : ''}${u.membership_verified ? '<span class="badge">Channels verified</span>' : '<span class="badge warn">Not verified</span>'}${risk}
        ${u.is_blocked && u.blocked_reason ? `<p class="muted">Block reason: ${esc(u.blocked_reason)} (${dt(u.blocked_at)})</p>` : ''}
        <div class="grid" style="margin-top:12px">${[['MINER balance', n(u.points)], ['Ad credits', n(u.ad_credits)], ['Total earned', n(s.earned)], ['Total spent', n(s.spent)]].map(([k, v]) => `<div class="stat"><small>${k}</small><b>${v}</b></div>`).join('')}</div>
      </div>
      <div class="card"><h2>Details</h2>${kv([
        ['Telegram ID', esc(u.telegram_id)], ['Name', esc([u.first_name, u.last_name].filter(Boolean).join(' ') || '—')], ['Username', u.username ? '@' + esc(u.username) : '—'],
        ['Telegram language', esc(u.language_code || '—')], ['App language', esc(u.user_lang || '—')], ['Joined', dt(u.created_at)], ['Last active', dt(u.last_active_at) + ' · ' + ago(u.last_active_at)],
        ['Signup start param', esc(u.signup_start_param || '—')], ['Referral code', esc(u.referral_code || '—')],
        ['Referred by', r.referrer ? `<a href="#" data-uid="${esc(r.referrer.telegram_id)}" style="color:var(--accent)">${name(r.referrer)} (${esc(r.referrer.telegram_id)})</a>` : '—'],
        ['Terms accepted', u.terms_accepted_at ? 'v' + esc(u.terms_version_accepted) + ' · ' + dt(u.terms_accepted_at) : 'No'],
        ['Booster', u.booster_until && new Date(u.booster_until) > new Date() ? esc(u.booster_pct) + '% until ' + dt(u.booster_until) : 'None'],
      ])}</div>
      <div class="card"><h2>Activity summary</h2><div class="grid">${[
        ['Tasks done', n(s.tasks_done)], ['Ads watched', n(s.ads_watched)], ['Ads today', n(s.ads_today)], ['Daily claims', n(s.daily_claims)], ['Games played', n(s.games_played)], ['Promo codes used', n(s.promos_used)],
        ['Invited friends', n(s.invited)], ['Qualified referrals', n(s.qualified)], ['Task proofs', n(s.proofs)], ['Support tickets', n(s.tickets)],
        ['Withdrawn (USDT)', usdt(s.withdrawn_usdt)], ['Pending withdraw (USDT)', usdt(s.pending_withdraw_usdt)], ['Withdraw requests', n(s.withdraw_count)],
        ['Deposited (USDT)', usdt(s.deposited_usdt)], ['Deposit requests', n(s.deposit_count)], ['Ledger entries', n(s.tx_count)],
      ].map(([k, v]) => `<div class="stat"><small>${k}</small><b>${v}</b></div>`).join('')}</div></div>
      ${(can('users_block') || can('users_adjust')) ? `<div class="card"><h2>Admin actions</h2><label for="reason">Reason (required, min 3 characters)</label><input id="reason" maxlength="200" placeholder="Why are you doing this?">
        ${can('users_adjust') ? '<label for="adj">Adjust MINER (use minus to remove, e.g. -500)</label><input id="adj" inputmode="numeric" placeholder="e.g. 1000">' : ''}
        <div class="actions">${can('users_block') ? (u.is_blocked ? '<button id="unblock" class="primary">Unblock user</button>' : '<button id="block" class="danger">Block user</button>') : ''}${can('users_adjust') ? '<button id="doadj" class="primary">Apply adjustment</button>' : ''}</div></div>` : ''}
      ${r.wallets.length ? `<div class="card"><h2>Wallet addresses used</h2><div class="tablewrap"><table><tr><th>Address</th><th>First seen</th></tr>${r.wallets.map((w) => `<tr><td style="word-break:break-all">${esc(w.address)}</td><td>${dt(w.first_seen_at)}</td></tr>`).join('')}</table></div></div>` : ''}
      ${r.miners.length ? `<div class="card"><h2>Auto miners</h2><div class="tablewrap"><table><tr><th>Plan</th><th>Paid</th><th>Rate/h</th><th>Claimed</th><th>Ends</th></tr>${r.miners.map((m) => `<tr><td>${esc(m.plan_name)}</td><td>${n(m.price_paid)}</td><td>${n(m.rate_per_hour)}</td><td>${n(m.total_claimed)}</td><td>${dt(m.ends_at)}</td></tr>`).join('')}</table></div></div>` : ''}
      <div class="card"><h2>Friends invited (latest ${r.referrals.length})</h2>${r.referrals.map((x) => `<div class="urow" data-uid="${esc(x.telegram_id)}" style="margin-bottom:8px"><div><b>${name(x)}</b><span class="meta">${handle(x)} · joined ${ago(x.created_at)}</span></div><div class="right">${x.qualified ? '<span class="badge">Qualified</span>' : '<span class="badge warn">Not yet</span>'}</div></div>`).join('') || '<div class="empty">No invited friends</div>'}</div>
      ${r.notes.length ? `<div class="card"><h2>Admin notes</h2>${r.notes.map((x) => `<p>${esc(x.note)}<br><small>${dt(x.created_at)} · admin ${esc(x.author_id)}</small></p>`).join('')}</div>` : ''}
      <div class="card"><h2>Full activity timeline</h2><div id="tlbox">${timelineRows(openUser.tl, false)}</div><div class="actions"><button id="tlmore" ${openUser.next ? '' : 'hidden'}>Load more</button></div></div>`;
    $('#back').onclick = () => { tabsEl.hidden = false; go(tab); };
    const more2 = $('#tlmore'); if (more2) more2.onclick = () => openUser(id, true);
    const reason = () => $('#reason').value.trim();
    const act = (sel, fn) => { const b = $(sel); if (b) b.onclick = async () => { try { b.disabled = true; await fn(); await openUser(id); say('Done.', 'ok'); } catch (e) { b.disabled = false; say(e.message, 'error'); } }; };
    act('#block', () => { if (!confirm('Block this user?')) throw Error('Cancelled'); return api('adminUserBlock', { userId: id, blocked: true, reason: reason() }); });
    act('#unblock', () => api('adminUserBlock', { userId: id, blocked: false, reason: reason() }));
    act('#doadj', () => { const v = Number($('#adj').value); if (!Number.isSafeInteger(v) || v === 0) throw Error('Enter a non-zero whole number'); if (!confirm('Apply ' + v + ' MINER to this user?')) throw Error('Cancelled'); return api('adminUserAdjust', { userId: id, points: v, reason: reason() }); });
    window.scrollTo(0, 0);
    say('');
  } catch (e) { say(e.message, 'error'); if (!more) { view.innerHTML = '<div class="actions"><button id="back">← Back</button></div>'; $('#back').onclick = () => { tabsEl.hidden = false; go(tab); }; } }
}

async function go(t) {
  tab = t;
  tabsEl.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('active', b.dataset.tab === t));
  view.innerHTML = '<div class="empty">Loading…</div>';
  try { if (t === 'dash') await dash(); else if (t === 'users') await users(); else if (t === 'ads') await ads(); else await feed(false); if (t === 'dash') say(''); } catch (e) { view.innerHTML = `<div class="empty">${esc(e.message)}</div>`; say(e.message, 'error'); }
}

// one click handler for every "open this user" / tab shortcut
document.addEventListener('click', (e) => {
  const u = e.target.closest('[data-uid]'); if (u) { e.preventDefault(); openUser(u.dataset.uid); return; }
  const g = e.target.closest('[data-tab-go]'); if (g) go(g.dataset.tabGo);
});
tabsEl.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => go(b.dataset.tab)));

(async () => {
  try {
    const b = await api('bootstrap');
    if (!b.admin) { $('#who').textContent = 'Access denied'; view.innerHTML = '<div class="empty">This page is only for admins.</div>'; return; }
    perms = b.admin_perms || [];
    $('#who').textContent = 'Role: ' + (b.admin_role || 'admin');
    if (!can('users_read')) { view.innerHTML = '<div class="empty">Your admin role cannot view users.</div>'; return; }
    tabsEl.hidden = false;
    go('dash');
  } catch (e) { $('#who').textContent = 'Not connected'; view.innerHTML = `<div class="empty">${esc(e.message)}</div>`; say(e.message, 'error'); }
})();
})();
