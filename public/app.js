'use strict';
/* USDT Miner - frontend (Part 6 screens + Part 7 redesign).
   No inline handlers anywhere: controls carry data-go (navigate), data-act (action) or data-input (live input),
   handled by the three delegated listeners at the bottom. That is what lets the CSP drop 'unsafe-inline' for scripts.
   Every server-provided string goes through esc() before it touches innerHTML. */
const tg = window.Telegram?.WebApp;
try { tg?.ready(); tg?.expand(); tg?.setHeaderColor('#050507'); tg?.setBackgroundColor('#050507'); } catch (e) {}
let init = tg?.initData || '';
let data = {}, filter = 'all', opened = {}, community = null, fin = null;

const $ = (id) => document.getElementById(id);
const N = (n) => Number(n).toLocaleString();
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ic = (e) => `<span class="ic" aria-hidden="true">${e}</span>`;
const short = (h) => (h ? String(h).slice(0, 10) + '…' + String(h).slice(-6) : '');
const dt = (x) => (x ? new Date(x).toLocaleDateString() : '');
const empty = (t) => `<div class="empty">${esc(t)}</div>`;
const skel = (n = 3) => '<div class="skel" aria-hidden="true"></div>'.repeat(n);
const badge = (cls, t) => `<span class="badge ${cls}">${esc(t)}</span>`;
const setHtml = (id, h) => { $(id).innerHTML = h; };

let toastT;
function say(m) {
  const t = $('toast'); t.textContent = m; t.classList.add('on');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 3800);
  try { tg?.HapticFeedback?.impactOccurred('light'); } catch (e) {}
}
const status = (m) => { $('status').textContent = m || ''; };

async function api(action, p = {}) {
  let r;
  try { r = await fetch('/api?action=' + action, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': init }, body: JSON.stringify(p) }); }
  catch (e) { throw Error('Network error - check your connection'); }
  let j = {}; try { j = await r.json(); } catch (e) {}
  if (!r.ok) throw Error(j.error || 'Request failed (' + r.status + ')');
  return j;
}
function confirmAsk(msg) {
  return new Promise((res) => { if (tg?.showConfirm) { try { tg.showConfirm(msg, (ok) => res(!!ok)); return; } catch (e) {} } res(window.confirm(msg)); });
}
function openUrl(u) {
  u = String(u || ''); if (!/^https:\/\//.test(u)) return;
  if (/^https:\/\/t\.me\//.test(u) && tg?.openTelegramLink) tg.openTelegramLink(u);
  else if (tg?.openLink) tg.openLink(u);
  else window.open(u, '_blank', 'noopener');
}
const chUrl = (c) => 'https://t.me/' + String(c).replace('@', '');
const btn = (label, act, attrs = '', cls = 'btn sm', aria = '') => `<button class="${cls}" data-act="${act}" ${attrs}${aria ? ` aria-label="${esc(aria)}"` : ''}>${label}</button>`;

/* ---------------- tasks ---------------- */
const taskIcon = (t) => (t === 'channel' ? '✈️' : t === 'bot' ? '🤖' : t === 'website' ? '🌐' : '🎯');
function taskBtn(t) {
  const a = `data-id="${Number(t.id)}"`, nm = ' — ' + t.title;
  if (t.done) return '<button class="btn sm done" disabled>Done ✓</button>';
  if (t.type === 'channel') return opened[t.id] ? btn('Verify ✓', 'complete', a, 'btn sm done', 'Verify' + nm) : btn('Join ›', 'openTask', a, 'btn sm', 'Join' + nm);
  if (t.started_at) return t.seconds_left > 0 ? `<button class="btn sm" disabled aria-label="Wait ${t.seconds_left} seconds">⏳ ${t.seconds_left}s</button>` : btn('Claim ✓', 'complete', a, 'btn sm done', 'Claim' + nm);
  return btn((t.type === 'website' ? 'Visit' : 'Start') + ' ›', 'openTask', a, 'btn sm', 'Start' + nm);
}
function renderTasks() {
  const list = (data.tasks || []).filter((t) => filter === 'all' || (filter === 'social' && ['channel', 'bot'].includes(t.type)) || (filter === 'other' && !['channel', 'bot'].includes(t.type)));
  setHtml('tasklist', list.map((t) => `<div class="card row">${ic(taskIcon(t.type))}<div class="mid"><b>${esc(t.title)}</b>${t.description ? `<small>${esc(t.description)}</small>` : ''}<span class="pts">🪙 +${N(t.reward)} Points</span>${t.type !== 'channel' && !t.done ? `<small>Stay ${Number(t.timer_seconds)}s on the task, then claim</small>` : ''}</div>${taskBtn(t)}</div>`).join('') || empty('No tasks right now'));
}
const initTimers = () => (data.tasks || []).forEach((t) => { t.deadline = Date.now() + (t.seconds_left || 0) * 1000; });
setInterval(() => {
  if (!$('tasks').classList.contains('on')) return;
  let ch = false;
  (data.tasks || []).forEach((t) => { if (t.started_at && !t.done && t.deadline) { const l = Math.max(0, Math.ceil((t.deadline - Date.now()) / 1000)); if (l !== t.seconds_left) { t.seconds_left = l; ch = true; } } });
  if (ch) renderTasks();
}, 1000);

/* ---------------- history / daily / referral / verify ---------------- */
let txNext = null;
function renderTx(items, append) {
  const h = items.map((t) => `<div class="card row">${ic(t.points_change >= 0 ? '🟢' : '🔴')}<div class="mid"><b>${esc(t.type)}</b><small>${esc(t.description || '')}</small></div><span class="pts">${t.points_change > 0 ? '+' : ''}${N(t.points_change)}</span></div>`).join('');
  const el = $('txlist'); if (append) el.insertAdjacentHTML('beforeend', h); else el.innerHTML = h || empty('No transactions yet');
  txNext = items.length >= 25 ? items[items.length - 1].id : null; $('moreTx').hidden = !txNext;
}
function renderDaily() { const b = $('dailybtn'), d = data.daily || {}; b.disabled = !!d.claimed; b.textContent = d.claimed ? 'Claimed ✓' : 'Claim ›'; }
let refLink = '';
function renderVerify() {
  const box = $('verifybox'), u = data.user || {};
  if (!u.verify_needed) { box.hidden = true; return; }
  const ch = (data.settings && data.settings.required_channels) || [];
  $('vtext').textContent = u.has_referrer ? 'Join these channels, then tap Verify. Your inviter gets rewarded after you verify.' : 'Join these channels, then tap Verify.';
  setHtml('vlinks', ch.map((c) => `<p><a href="${esc(chUrl(c))}" data-act="openCh" data-ch="${esc(c)}">${esc(c)}</a></p>`).join('')); box.hidden = false;
}

/* ---------------- finance (Part 4) ---------------- */
const WI = { pending: '⏳', approved: '👍', paid: '✅', rejected: '❌', cancelled: '🚫' }, DI = { pending: '⏳', verified: '🔎', confirmed: '✅', rejected: '❌' };
const BC = { pending: 'warn', approved: 'warn', paid: 'ok', rejected: 'no', cancelled: 'no', verified: 'warn', confirmed: 'ok', active: 'ok' };
const RS = { not_found: 'Transaction not found yet', confirming: 'Waiting for confirmations', tx_failed: 'Transaction failed on-chain', no_matching_transfer: 'No matching USDT transfer to our wallet from that address', below_minimum: 'Below the minimum deposit', not_found_expired: 'Transaction never appeared', chain_unavailable: 'Blockchain check unavailable, try again' };
function DS(r) { return r.status === 'confirmed' ? '✅ Deposit credited' : r.status === 'verified' ? '🔎 Verified on-chain - waiting for admin approval' : r.status === 'rejected' ? '❌ ' + (RS[r.reason] || r.reason || 'Rejected') : '⏳ ' + (RS[r.reason] || 'Pending') + (r.confirmations != null ? ' (' + r.confirmations + ')' : ''); }
async function getFin() { if (!fin) fin = await api('financeInfo'); return fin; }
let qt;
function quoteW() {
  clearTimeout(qt);
  qt = setTimeout(async () => {
    const v = $('amount').value.trim(); if (!v) { $('wquote').textContent = ''; return; }
    try { const q = await api('withdrawQuote', { amount: v }); $('wquote').textContent = 'Fee ' + q.fee + ' USDT · You receive ' + q.net + ' USDT · Reserves ' + N(q.points) + ' Points' + (q.enough ? '' : ' (not enough Points)'); }
    catch (e) { $('wquote').textContent = e.message; }
  }, 350);
}
async function loadWithdraw() {
  const f = await getFin(); $('amount').placeholder = 'USDT amount (min ' + f.withdraw.min + ')';
  $('wnote').textContent = f.withdraw.feePercent + '% fee. Points are reserved when you submit and refunded if rejected or cancelled.'; $('depbtn').hidden = !f.deposit.enabled;
  const r = await api('withdrawList');
  setHtml('wlist', r.items.map((w) => `<div class="card row">${ic(WI[w.status] || '•')}<div class="mid"><b>#${Number(w.id)} · ${esc(w.net_usdt)} USDT</b><small>${badge(BC[w.status] || 'warn', w.status)}${w.reject_reason ? ' ' + esc(w.reject_reason) : ''}${w.tx_hash ? ' · ' + esc(short(w.tx_hash)) : ''}</small></div>${w.status === 'pending' ? btn('Cancel', 'cancelW', `data-id="${Number(w.id)}"`, 'btn sm ghost', 'Cancel withdrawal ' + Number(w.id)) : ''}</div>`).join('') || empty('No withdrawals yet'));
}
async function loadDeposit() {
  const f = await getFin(), d = f.deposit;
  if (!d.enabled) { $('depinfo').textContent = 'Deposits are not enabled yet.'; $('depform').hidden = true; }
  else { $('depform').hidden = false; setHtml('depinfo', 'Send USDT on <b>BSC (BEP-20)</b> only, to:<br><span style="color:var(--or1);word-break:break-all">' + esc(d.wallet) + '</span><br>Minimum ' + esc(d.min) + ' USDT · ' + esc(d.confirmations) + ' confirmations needed.'); }
  const r = await api('depositList');
  setHtml('deplist', r.items.map((x) => `<div class="card row">${ic(DI[x.status] || '•')}<div class="mid"><b>${x.amount_usdt ? esc(x.amount_usdt) + ' USDT' : 'Deposit #' + Number(x.id)}</b><small>${badge(BC[x.status] || 'warn', x.status)}${x.reject_reason ? ' ' + esc(RS[x.reject_reason] || x.reject_reason) : ''} · ${esc(short(x.tx_hash))}</small></div>${x.status === 'pending' ? btn('Recheck', 'recheckD', `data-id="${Number(x.id)}"`, 'btn sm', 'Recheck deposit ' + Number(x.id)) : ''}</div>`).join('') || empty('No deposits yet'));
}

/* ---------------- community info (Part 6) ---------------- */
async function getCommunity() { if (!community) community = await api('communityInfo'); return community; }

/* leaderboard */
let rankPage = 1;
async function loadRank(page) {
  const want = page || rankPage; if (!$('ranklist').children.length) setHtml('ranklist', skel());
  const r = await api('leaderboard', { page: want }); rankPage = r.page;
  setHtml('rankme', r.me ? `<div class="card"><b>Your rank: #${N(r.me.rank)}</b> <span class="muted">of ${N(r.total)} miners · ${N(r.me.points)} Points</span>${r.me.rank > 200 ? '<small>Only the top 200 are listed.</small>' : ''}</div>` : '');
  setHtml('ranklist', r.items.map((u) => `<div class="card rk${u.me ? ' me' : ''}"><span class="n" role="img" aria-label="Rank ${u.rank}">${u.rank <= 3 ? ['🥇', '🥈', '🥉'][u.rank - 1] : u.rank}</span><span class="nm">${esc(u.name)}${u.me ? ' (you)' : ''}</span><span class="pt">${N(u.points)}</span></div>`).join('') || empty('No miners yet'));
  $('rankpager').hidden = r.pages <= 1; $('rankinfo').textContent = 'Page ' + r.page + ' of ' + r.pages;
  $('rankprev').disabled = r.page <= 1; $('ranknext').disabled = !r.hasMore;
}

/* advertise */
let ads = null;
const AD_HINT = { channel: 'Use a link like https://t.me/YourChannel and add this bot as an admin of your channel, so joins can be verified.', bot: 'Use your bot link, like https://t.me/YourBot.', website: 'Use a https:// link. People must stay on the page for the timer before they can claim.' };
function adcalc() {
  const t = $('c_type').value; $('c_hint').textContent = AD_HINT[t];
  $('c_link').placeholder = t === 'channel' ? 'https://t.me/YourChannel' : t === 'bot' ? 'https://t.me/YourBot' : 'https://example.com';
  const r = Number($('c_reward').value), n = Number($('c_target').value), el = $('c_budget'), ppu = Number(data.settings?.points_per_usdt) || 10000;
  if (!Number.isInteger(r) || !Number.isInteger(n) || r < 1 || n < 1) { el.textContent = ''; return; }
  const b = r * n, have = ads?.info?.points ?? Number(data.user?.points || 0);
  el.textContent = 'Budget: ' + N(b) + ' Points (≈ ' + (b / ppu).toFixed(2) + ' USDT)' + (b > have ? ' — more than your balance of ' + N(have) + ' Points' : '');
}
function campCard(c) {
  const pct = Math.min(Number(c.target), Number(c.completed));
  return `<div class="card"><div class="row" style="padding:0">${ic(taskIcon(c.type))}<div class="mid"><b>#${Number(c.id)} ${esc(c.title)}</b><small>${badge(BC[c.status] || 'warn', c.status === 'pending' ? 'in review' : c.status)} · +${N(c.reward)} × ${N(c.target)}</small></div></div>${c.status === 'active' ? `<progress value="${pct}" max="${Number(c.target)}" aria-label="Completed ${pct} of ${Number(c.target)}"></progress><small>${N(c.completed)} of ${N(c.target)} completed</small>` : ''}${c.reject_reason ? `<small>${esc(c.reject_reason)}</small>` : ''}${c.status === 'pending' ? `<div style="margin-top:8px">${btn('Cancel and refund', 'cancelCamp', `data-id="${Number(c.id)}"`, 'btn sm ghost', 'Cancel campaign ' + Number(c.id))}</div>` : ''}</div>`;
}
async function loadAds() {
  setHtml('camplist', skel(2)); ads = await api('campaignList'); const i = ads.info;
  $('adform').hidden = !i.enabled;
  $('adinfo').textContent = i.enabled ? 'Minimum ' + N(i.minReward) + ' Points per user and ' + N(i.minTarget) + ' completions. You have ' + N(i.points) + ' Points. Up to ' + i.maxPending + ' campaigns can wait for review.' : 'Advertising is paused right now. Your existing campaigns are not affected.';
  adcalc(); setHtml('camplist', ads.items.map(campCard).join('') || empty('No campaigns yet'));
}

/* official channel */
async function loadChannel() {
  const c = await getCommunity();
  const card = (icon, title, sub, url, label) => `<div class="card row">${ic(icon)}<div class="mid"><b>${esc(title)}</b><small>${esc(sub)}</small></div>${btn(label, 'openUrl', `data-url="${esc(url)}"`, 'btn sm', label + ' — ' + title)}</div>`;
  let h = '';
  if (c.officialChannel.url) h += card('📣', 'Official channel', c.officialChannel.name, c.officialChannel.url, 'Open ›');
  if (c.paymentsChannel.url) h += card('🧾', 'Payments channel', c.paymentsChannel.name, c.paymentsChannel.url, 'Open ›');
  if (c.support) h += card('🛟', 'Support', 'Ask for help', c.support, 'Chat ›');
  if (c.bot) h += card('🤖', 'Official bot', '@' + c.bot, 'https://t.me/' + c.bot, 'Open ›');
  setHtml('chlist', h + '<p class="hint">Admins and support will never ask for your private key, seed phrase or Telegram login code.</p>');
}

/* payment proof */
let proofNext = null, proofChannel = null;
async function loadProof(more) {
  if (!more) { setHtml('prooflist', skel()); setHtml('proofstats', ''); proofNext = null; }
  const r = await api('proofList', more ? { before: proofNext } : {});
  proofChannel = r.channel; $('proofch').hidden = !r.channel; $('proofch').dataset.url = r.channel || '';
  if (!r.enabled) { setHtml('prooflist', empty('Payment proof is not available right now.')); $('moreProof').hidden = true; return; }
  if (r.stats) setHtml('proofstats', `<div class="stats"><div class="card"><small>Paid out</small><b>${esc(r.stats.paid_usdt)} USDT</b></div><div class="card"><small>Payouts</small><b>${N(r.stats.payouts)}</b></div><div class="card"><small>Members</small><b>${N(r.stats.members)}</b></div></div>`);
  const h = r.items.map((p) => `<div class="card row">${ic('✅')}<div class="mid"><b>${esc(p.amount)} USDT</b><small>${esc(p.name)} · ${esc(dt(p.paid_at))}</small><small>${esc(short(p.tx))}</small></div>${p.url ? btn('View ›', 'openUrl', `data-url="${esc(p.url)}"`, 'btn sm', 'View payout transaction on BscScan, ' + p.amount + ' USDT') : ''}</div>`).join('');
  if (more) $('prooflist').insertAdjacentHTML('beforeend', h); else setHtml('prooflist', h || empty('No payouts to show yet'));
  proofNext = r.next; $('moreProof').hidden = !proofNext;
}

/* how to use (live numbers from the admin settings) */
async function loadHow() {
  const c = await getCommunity(), r = c.rates, chs = (c.requiredChannels || []).map(esc).join(', ');
  const steps = [
    `Open the official bot in Telegram and join the required channels (${chs}). Then tap <b>Verify</b> on the Home screen.`,
    `Claim your <b>Daily Reward</b> (${N(r.dailyReward)} Points) once every day.`,
    `Open <b>Points Miner</b> and finish tasks. Channel tasks check that you really joined. Other tasks need you to stay for the timer before you can claim.`,
    `Share your <b>Referral</b> link. You get ${N(r.referralReward)} Points after a friend joins and verifies the required channels.`,
    r.withdrawalsEnabled ? `<b>Withdraw</b>: ${N(r.pointsPerUsdt)} Points = 1 USDT. Minimum ${esc(r.minWithdraw)} USDT, fee ${esc(r.feePercent)}%. Enter your BEP-20 (BSC) address. Points are reserved when you submit and refunded if the request is rejected or cancelled. Every request is reviewed by an admin.` : `<b>Withdrawals</b> are paused right now. Your Points stay safe in your balance.`,
  ];
  if (r.depositsEnabled) steps.push(`<b>Deposit</b> USDT (BEP-20, minimum ${esc(r.minDeposit)} USDT) from the Withdraw screen. Deposits are checked on-chain.`);
  if (c.ads.enabled) steps.push(`<b>Advertise</b>: spend Points to promote your channel, bot or website. An admin reviews each campaign.`);
  const faq = [
    ['Why can’t I claim a task?', 'Timer tasks only unlock after the timer ends. Channel tasks need you to join first. A task can also be finished already or full.'],
    ['Verification says I have not joined', 'Join every listed channel with the same Telegram account, wait a few seconds, then tap Verify again.'],
    ['How long does a withdrawal take?', 'Each request is reviewed and paid manually by an admin. Follow its status on the Withdraw screen, and see recent payouts in Payment Proof.'],
    ['Will the rate or fee change?', 'The team can change them. The quote you see before you submit is what applies to your request.'],
    ['Is it safe?', 'Never share your private key, seed phrase or Telegram login code with anyone. Nobody from the team will ask for them.'],
    ['Are games available?', 'Not yet. See the Games screen for what is planned.'],
  ];
  setHtml('howbody', `<div class="card"><ol class="steps">${steps.map((s) => `<li>${s}</li>`).join('')}</ol></div><h3 style="margin:14px 2px 6px">FAQ</h3>${faq.map((f) => `<details class="card faq"><summary>${esc(f[0])}</summary><p>${esc(f[1])}</p></details>`).join('')}${c.support ? `<button class="btn" data-act="openUrl" data-url="${esc(c.support)}">Contact support ›</button>` : ''}`);
}

/* ---------------- navigation ---------------- */
const PARENT = { deposit: 'withdraw', rank: 'more', ads: 'more', channel: 'more', proof: 'more', howto: 'more', games: 'more', history: 'more' };
const NAVOF = { deposit: 'withdraw', rank: 'more', ads: 'more', channel: 'more', proof: 'more', howto: 'more', games: 'more', history: 'more' };
let cur = 'home', backBound = false;
function go(id) {
  if (!$(id)) return; cur = id;
  document.querySelectorAll('main>section').forEach((s) => s.classList.remove('on')); $(id).classList.add('on');
  const on = NAVOF[id] || id;
  document.querySelectorAll('#nav button').forEach((b) => { if (b.dataset.go === on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  window.scrollTo(0, 0);
  const h = $(id).querySelector('h2'); if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }); }
  try { if (tg?.BackButton) { if (!backBound) { tg.BackButton.onClick(() => go(PARENT[cur] || 'home')); backBound = true; } if (id === 'home') tg.BackButton.hide(); else tg.BackButton.show(); } } catch (e) {}
  load(id);
}
let adminTries = 0;
async function load(id) {
  try {
    if (id === 'admin') { if (window.Admin) Admin.open(); else if (++adminTries < 15) setTimeout(() => load('admin'), 400); }
    if (id === 'withdraw') await loadWithdraw();
    if (id === 'deposit') await loadDeposit();
    if (id === 'history' && !$('txlist').children.length) renderTx(data.transactions || [], false);
    if (id === 'ref') {
      const r = await api('referral'); refLink = r.link; $('refurl').textContent = r.link; $('refreward').textContent = N(r.reward); $('refcount').textContent = 'Qualified: ' + r.qualified + ' · Pending: ' + r.pending;
      setHtml('reflist', r.referrals.map((x) => `<div class="card row">${ic(x.qualified ? '✅' : '⏳')}<div class="mid"><b>${esc(x.name)}</b><small>${x.qualified ? 'Verified — reward paid' : 'Waiting for channel verification'}</small></div></div>`).join(''));
    }
    if (id === 'rank') await loadRank(1);
    if (id === 'ads') await loadAds();
    if (id === 'channel') await loadChannel();
    if (id === 'proof') await loadProof(false);
    if (id === 'howto') await loadHow();
  } catch (e) { say(e.message); }
}

/* ---------------- boot ---------------- */
async function boot() {
  try {
    data = await api('bootstrap'); status('');
    $('points').textContent = N(data.user.points);
    const s = data.settings || {}; $('rate').textContent = N(s.points_per_usdt || 10000) + ' Points = 1 USDT';
    const bn = $('banner'); bn.textContent = s.announcement || ''; bn.hidden = !s.announcement;
    initTimers(); renderDaily(); renderVerify(); renderTasks(); renderTx(data.transactions || [], false);
    if (data.admin) initAdmin();
  } catch (e) { status(e.message); say(e.message); }
}
function initAdmin() {
  if (!document.querySelector('#nav [data-go=admin]')) { const b = document.createElement('button'); b.dataset.go = 'admin'; b.innerHTML = '<span class="ic" aria-hidden="true">🛡</span>Admin'; $('nav').appendChild(b); }
  if (!$('admjs')) { const s = document.createElement('script'); s.id = 'admjs'; s.src = '/admin.js'; document.body.appendChild(s); }
}
function showGate() { $('gate').hidden = false; $('main').hidden = true; $('nav').hidden = true; status(''); }

/* ---------------- actions ---------------- */
const ACT = {
  async daily() { const r = await api('daily'); say('🎁 Claimed ' + N(r.reward) + ' Points'); await boot(); },
  async complete(d) { const r = await api('taskComplete', { taskId: Number(d.id) }); delete opened[d.id]; say('✅ Earned ' + N(r.reward) + ' Points'); await boot(); },
  async openTask(d) {
    const id = Number(d.id), t = (data.tasks || []).find((x) => x.id === id); if (!t) return;
    if (t.type !== 'channel') { const r = await api('taskStart', { taskId: id }); t.started_at = t.started_at || new Date().toISOString(); t.seconds_left = r.seconds_left; t.deadline = Date.now() + r.seconds_left * 1000; } else opened[id] = true;
    openUrl(t.link); renderTasks();
  },
  tab(d, el) {
    filter = d.f; document.querySelectorAll('[role=tab]').forEach((b) => { const on = b === el; b.setAttribute('aria-selected', on); b.tabIndex = on ? 0 : -1; });
    $('tasklist').setAttribute('aria-labelledby', el.id); renderTasks();
  },
  async verify() { const r = await api('referralVerify'); if (r.verified) { say(r.reward_granted ? '✅ Verified — your inviter was rewarded' : '✅ Channels verified'); await boot(); } else say('Join first: ' + r.missing.join(', ')); },
  openCh(d) { openUrl(chUrl(d.ch)); },
  openUrl(d) { openUrl(d.url); },
  openProofChannel() { openUrl(proofChannel); },
  async openOfficial() { openUrl((await getCommunity()).officialChannel.url); },
  async copyRef() { try { await navigator.clipboard.writeText($('refurl').textContent); say('Copied ✅'); } catch (e) { say('Copy failed'); } },
  shareRef() { if (!refLink) return; const u = 'https://t.me/share/url?url=' + encodeURIComponent(refLink) + '&text=' + encodeURIComponent('Mine Points & earn USDT 🚀'); if (tg?.openTelegramLink) tg.openTelegramLink(u); else window.open(u, '_blank', 'noopener'); },
  async moreTx() { const r = await api('history', { before: txNext }); renderTx(r.items, true); txNext = r.next; $('moreTx').hidden = !txNext; },
  async withdraw() { const r = await api('withdraw', { amount: $('amount').value, wallet: $('wallet').value }); say('Withdrawal request #' + r.id + ' submitted - ' + r.net + ' USDT after fee'); $('amount').value = ''; $('wquote').textContent = ''; await boot(); await loadWithdraw(); },
  async cancelW(d) { if (!(await confirmAsk('Cancel this withdrawal? Points will be refunded.'))) return; await api('withdrawCancel', { id: Number(d.id) }); say('Cancelled - Points refunded'); await boot(); await loadWithdraw(); },
  async deposit() { const r = await api('depositSubmit', { txHash: $('txhash').value.trim(), from: $('depfrom').value.trim() }); say(DS(r)); $('txhash').value = ''; await boot(); await loadDeposit(); },
  async recheckD(d) { const r = await api('depositRecheck', { id: Number(d.id) }); say(DS(r)); await boot(); await loadDeposit(); },
  async copyDep() { try { await navigator.clipboard.writeText(fin.deposit.wallet); say('Address copied ✅'); } catch (e) { say('Copy failed'); } },
  async rankPage(d) { await loadRank(rankPage + Number(d.d)); window.scrollTo(0, 0); },
  async campaign() {
    const r = await api('campaignCreate', { type: $('c_type').value, title: $('c_title').value, link: $('c_link').value, reward: $('c_reward').value.trim(), target: $('c_target').value.trim() });
    say('Campaign #' + r.id + ' submitted for review'); ['c_title', 'c_link', 'c_reward', 'c_target'].forEach((k) => { $(k).value = ''; }); await boot(); await loadAds();
  },
  async cancelCamp(d) { if (!(await confirmAsk('Cancel this campaign? The full budget is refunded.'))) return; const r = await api('campaignCancel', { id: Number(d.id) }); say('Cancelled - ' + N(r.refunded_points) + ' Points refunded'); await boot(); await loadAds(); },
  async moreProof() { await loadProof(true); },
};
const INPUT = { quote: quoteW, adcalc: adcalc };

/* ---------------- delegated events ---------------- */
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-go],[data-act]');
  if (!el || el.disabled || el.getAttribute('aria-disabled') === 'true') return;
  if (el.dataset.go) { go(el.dataset.go); return; }
  if (el.dataset.act === 'openCh') e.preventDefault();
  const fn = ACT[el.dataset.act]; if (fn) Promise.resolve().then(() => fn(el.dataset, el)).catch((err) => say(err.message));
});
document.addEventListener('input', (e) => { const f = INPUT[e.target.dataset && e.target.dataset.input]; if (f) f(); });
document.addEventListener('change', (e) => { const f = INPUT[e.target.dataset && e.target.dataset.input]; if (f) f(); });
document.addEventListener('keydown', (e) => { // arrow keys move between tabs (WAI-ARIA tabs pattern)
  const t = e.target.closest && e.target.closest('[role=tab]'); if (!t || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
  const tabs = [...t.parentElement.querySelectorAll('[role=tab]')]; let i = tabs.indexOf(t);
  i = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
  tabs[i].focus(); tabs[i].click(); e.preventDefault();
});

/* ---------------- start ---------------- */
(function start() {
  let n = 0;
  const t = setInterval(() => { init = window.Telegram?.WebApp?.initData || init; if (init) { clearInterval(t); boot(); } else if (++n >= 15) { clearInterval(t); showGate(); } }, 200);
})();
