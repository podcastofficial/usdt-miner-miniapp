'use strict';
/* MINER Miner - frontend (Part 6 screens + Part 7 redesign).
   No inline handlers anywhere: controls carry data-go (navigate), data-act (action) or data-input (live input),
   handled by the three delegated listeners at the bottom. That is what lets the CSP drop 'unsafe-inline' for scripts.
   Every server-provided string goes through esc() before it touches innerHTML. */
const tg = window.Telegram?.WebApp;
try { tg?.ready(); tg?.expand(); tg?.setHeaderColor('#050507'); tg?.setBackgroundColor('#050507'); } catch (e) {}
let init = tg?.initData || '';
/* Phase 2 / Part 5: theme (dark default, light, or follow Telegram). Stored per device; every storage call is guarded. */
const THEMES = ['dark', 'light', 'auto'];
const getTheme = () => { try { const v = localStorage.getItem('theme'); return THEMES.includes(v) ? v : 'dark'; } catch (e) { return 'dark'; } };
function applyTheme(pref) {
  const light = pref === 'light' || (pref === 'auto' && tg?.colorScheme === 'light');
  document.documentElement.dataset.theme = light ? 'light' : 'dark';
  const bg = light ? '#fff7ec' : '#050507';
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', bg);
  try { tg?.setHeaderColor(bg); tg?.setBackgroundColor(bg); } catch (e) {}
}
applyTheme(getTheme());
if (window.I18N) { const early = I18N.stored() || I18N.guess(tg?.initDataUnsafe?.user?.language_code); if (early !== 'en') I18N.set(early); }
let data = {}, filter = 'all', opened = {}, community = null, fin = null;

const $ = (id) => document.getElementById(id);
const T = (k, v, d) => (window.I18N ? I18N.t(k, v, d) : d !== undefined ? String(d).replace(/\{(\w+)\}/g, (m, n) => (v && n in v ? v[n] : m)) : k);
const N = (n) => Number(n).toLocaleString();
/* Part 17: estimated USDT value of MINER (price comes from Admin > Settings > MINER Value; display only) */
const minerPrice = () => (data.miner && data.miner.show !== false && Number(data.miner.price) > 0 ? Number(data.miner.price) : 0);
const fmtUsd = (v) => { if (!isFinite(v) || v <= 0) return '0'; if (v < 0.000001) return '<0.000001'; const d = v >= 100 ? 2 : v >= 1 ? 3 : v >= 0.01 ? 4 : 6; return Number(v.toFixed(d)).toLocaleString(undefined, { maximumFractionDigits: d }); };
const usd = (n) => { const p = minerPrice(); return p ? '≈ ' + fmtUsd(Number(n) * p) + ' USDT' : ''; };
const withUsd = (n) => { const u = usd(n); return u ? ' (' + u + ')' : ''; };
function renderUsdBalance() { const el = $('pointsusd'), u = usd(data.user.points); el.textContent = u; el.hidden = !u; }
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ic = (e, c) => `<span class="ic${c ? ' ' + c : ''}" aria-hidden="true">${e}</span>`;
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
  if (!r.ok) { const er = Error(j.error || 'Request failed (' + r.status + ')'); er.code = j.code; throw er; }
  return j;
}
function confirmAsk(msg) {
  return new Promise((res) => { if (tg?.showConfirm) { try { tg.showConfirm(msg, (ok) => res(!!ok)); return; } catch (e) {} } res(window.confirm(msg)); });
}
/* Fix: links saved as http://, t.me/..., telegram.me/... or @name used to be ignored silently (task "Start" did nothing). Now normalised, always opened. */
function normUrl(u) {
  u = String(u || '').trim(); if (!u) return '';
  if (/^@[A-Za-z0-9_]{4,}$/.test(u)) return 'https://t.me/' + u.slice(1);
  if (/^(www\.)?(t|telegram)\.me\//i.test(u)) u = 'https://' + u.replace(/^www\./i, '');
  if (/^http:\/\//i.test(u)) u = 'https://' + u.slice(7);
  return /^https:\/\//i.test(u) ? u : '';
}
function openUrl(u) {
  u = normUrl(u); if (!u) { say('Link is not valid'); return; }
  const tme = /^https:\/\/(t|telegram)\.me\//i.test(u);
  try {
    if (tme && tg?.openTelegramLink) { tg.openTelegramLink(u); return; }
    if (tg?.openLink) { tg.openLink(u); return; }
  } catch (e) { /* fall through to window.open */ }
  window.open(u, '_blank', 'noopener');
}
const chUrl = (c) => 'https://t.me/' + String(c).replace('@', '');
const btn = (label, act, attrs = '', cls = 'btn sm', aria = '') => `<button class="${cls}" data-act="${act}" ${attrs}${aria ? ` aria-label="${esc(aria)}"` : ''}>${label}</button>`;

/* ---------------- tasks ---------------- */
/* Icon follows what the task really is: the site in its link first (YouTube, X, Facebook ...), then words in its title, then the type. */
const LINK_ICONS = [[/youtu\.?be/i, '▶️'], [/(^|\/\/|\.)(twitter|x)\.com\//i, '🐦'], [/facebook\.com|fb\.com|fb\.me/i, '📘'], [/instagram\.com/i, '📸'], [/tiktok\.com/i, '🎵'], [/discord\.(gg|com)/i, '🎧'], [/wa\.me|whatsapp\.com/i, '💬'], [/reddit\.com/i, '👽'], [/github\.com/i, '💻'], [/linkedin\.com/i, '💼'], [/medium\.com/i, '📝']];
const WORD_ICONS = [[/tracker|chart|price|market|analytic/i, '📊'], [/nft/i, '🖼️'], [/airdrop|bonus|gift|giveaway/i, '🎁'], [/swap|dex|exchange|trade|trading|wallet/i, '💱'], [/news|update|announce/i, '📰'], [/signal|alert/i, '📡'], [/game|play/i, '🎮'], [/video|watch|stream/i, '🎬'], [/mining|miner/i, '⛏️'], [/crypto|coin|bitcoin|btc|eth|blockchain|token/i, '🪙']];
function taskIcon(type, link, title) {
  const l = String(link || ''), s = String(title || '');
  for (const [re, e] of LINK_ICONS) if (re.test(l)) return e;
  for (const [re, e] of WORD_ICONS) if (re.test(s)) return e;
  return type === 'channel' ? '✈️' : type === 'bot' ? '🤖' : type === 'website' ? '🌐' : '🎯';
}
/* Ledger type -> icon (History). Unknown types fall back to green / red dot. */
const TX_ICONS = { 'Task Reward': '✅', 'Daily Reward': '📅', 'Referral Reward': '👥', 'Milestone Reward': '🏅', 'Promo Code': '🎟️', 'Mission Reward': '🎯', 'Ad Reward': '📺', 'Campaign Budget': '📢', 'Campaign Refund': '↩️', 'Withdrawal': '💸', 'Withdrawal Refund': '↩️', 'Deposit': '⬇️', 'Game Entry': '🎮', 'Game Prize': '🏆', 'Lucky Draw Ticket': '🎫', 'Lucky Draw Win': '🎉', 'Lucky Draw Refund': '↩️', 'Booster Purchase': '⚡', 'Auto-Miner Purchase': '🤖', 'Auto-Miner Reward': '⛏️', 'Contest Prize': '🏁', 'Admin Adjustment': '🛠️' };
const txIcon = (t) => TX_ICONS[t.type] || (t.points_change >= 0 ? '🟢' : '🔴');
function taskBtn(t) {
  const a = `data-id="${Number(t.id)}"`, nm = ' — ' + t.title;
  if (t.done) return '<button class="btn sm done" disabled>Done ✓</button>';
  if (t.proof_required) {
    if (t.proof_status === 'pending') return '<button class="btn sm" disabled aria-label="Proof is in review">⏳ In review</button>';
    return btn(t.proof_status === 'rejected' ? 'Try again ›' : 'Send proof ›', 'proofOpen', a, 'btn sm', 'Send proof' + nm);
  }
  if (t.type === 'channel') return opened[t.id] ? btn('Verify ✓', 'complete', a, 'btn sm done', 'Verify' + nm) : btn('Join ›', 'openTask', a, 'btn sm', 'Join' + nm);
  if (t.started_at) return t.seconds_left > 0 ? `<button class="btn sm" disabled aria-label="Wait ${t.seconds_left} seconds">⏳ ${t.seconds_left}s</button>` : btn('Claim ✓', 'complete', a, 'btn sm done', 'Claim' + nm);
  return btn((t.type === 'website' ? 'Visit' : 'Start') + ' ›', 'openTask', a, 'btn sm', 'Start' + nm);
}
function renderTasks() {
  const list = (data.tasks || []).filter((t) => filter === 'all' || (filter === 'social' && ['channel', 'bot'].includes(t.type)) || (filter === 'other' && !['channel', 'bot'].includes(t.type)));
  setHtml('tasklist', list.map((t) => `<div class="card row">${ic(taskIcon(t.type, t.link, t.title))}<div class="mid"><b>${esc(t.title)}</b>${t.description ? `<small>${esc(t.description)}</small>` : ''}<span class="pts">🪙 +${N(t.reward)} MINER${esc(withUsd(t.reward))}</span>${t.proof_required && !t.done ? `<small>${t.proof_status === 'rejected' ? 'Rejected' + (t.proof_reason ? ': ' + esc(t.proof_reason) : '') + ' — you can try again' : 'Needs a proof, checked by an admin'}</small>` : ''}${t.type !== 'channel' && !t.proof_required && !t.done ? `<small>Stay ${Number(t.timer_seconds)}s on the task, then claim</small>` : ''}${t.started_at && !t.done && !t.proof_required ? `<small><a href="#" data-act="openTaskLink" data-id="${Number(t.id)}">Open task link again</a></small>` : ''}</div>${taskBtn(t)}</div>`).join('') || empty('No tasks right now'));
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
  const h = items.map((t) => `<div class="card row">${ic(txIcon(t), t.points_change >= 0 ? 'tx-in' : 'tx-out')}<div class="mid"><b>${esc(t.type)}</b><small>${esc(t.description || '')}</small>${minerPrice() ? `<small class="muted">${t.points_change > 0 ? '+' : '−'}${esc(usd(Math.abs(t.points_change)))}</small>` : ''}</div><span class="pts">${t.points_change > 0 ? '+' : ''}${N(t.points_change)}</span></div>`).join('');
  const el = $('txlist'); if (append) el.insertAdjacentHTML('beforeend', h); else el.innerHTML = h || empty('No transactions yet');
  txNext = items.length >= 25 ? items[items.length - 1].id : null; $('moreTx').hidden = !txNext;
}
function renderDaily() { const b = $('dailybtn'), d = data.daily || {}; b.disabled = !!d.claimed; b.textContent = d.claimed ? 'Claimed ✓' : 'Claim ›'; renderStreak(); renderBoostBox(d.booster); }
function leftText(sec) { const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60); return h > 0 ? h + 'h ' + m + 'm' : Math.max(1, m) + ' min'; }
function renderBoostBox(bs) {
  const box = $('boostbox'); if (!bs) { box.hidden = true; return; }
  box.hidden = false; $('boosttitle').textContent = 'Booster ' + bs.label + ' active';
  $('boosttext').textContent = (data.daily.claimed ? 'Your next daily reward' : 'Today’s daily reward') + ' is boosted: +' + N(data.daily.reward) + ' MINER' + withUsd(data.daily.reward) + ' (base ' + N(bs.base_reward) + '). ' + leftText(bs.seconds_left) + ' left.';
}

/* ---------------- engagement (Phase 2 / Part 2) ---------------- */
const lastDayOf = (c) => (c > 0 ? ((c - 1) % 7) + 1 : 0); // mirrors ladderDay() on the server
function renderStreak() {
  const st = (data.daily || {}).streak, box = $('streakbox');
  if (!st) { box.hidden = true; return; }
  box.hidden = false;
  $('streaktitle').textContent = st.current > 0 ? st.current + '-day streak' : 'Start your streak';
  const lad = $('ladder');
  if (st.enabled && Array.isArray(st.ladder)) {
    const last = lastDayOf(st.current), restart = st.next_day === 1 && !st.claimed_today;
    lad.hidden = false;
    lad.innerHTML = st.ladder.map((r, i) => {
      const d = i + 1, done = !restart && d <= last, next = d === st.next_day;
      const cls = 'day' + (done ? ' done' : '') + (next ? ' next' : ''), lbl = 'Day ' + d + ', ' + N(r) + ' MINER' + (done ? ', done' : next ? (st.claimed_today ? ', tomorrow' : ', today') : '');
      return `<div class="${cls}" role="listitem" aria-label="${esc(lbl)}"><b>${done ? '✓' : d}</b><small>${N(r)}</small></div>`;
    }).join('');
  } else lad.hidden = true;
  $('streaknote').textContent = st.claimed_today
    ? 'Claimed today ✓ Come back tomorrow' + (st.enabled ? ' for day ' + st.next_day + ' (+' + N(st.next_reward) + ' MINER' + withUsd(st.next_reward) + ')' : ' to keep your streak') + '.'
    : (st.current > 0 ? 'Claim today to keep your streak alive' : 'Claim today to start a streak') + (st.enabled ? ' — day ' + st.next_day + ' pays +' + N(st.next_reward) + ' MINER' + withUsd(st.next_reward) + '.' : '.')
      + (st.best > st.current ? ' Best: ' + st.best + ' days.' : '');
}
let refFilter = 'all', refPage = 1;
async function loadRefs(reset) {
  if (reset) refPage = 1;
  const r = await api('referralList', { page: refPage, filter: refFilter });
  const h = r.items.map((x) => `<div class="card row">${ic(x.qualified ? '✅' : '⏳')}<div class="mid"><b>${esc(x.name)}</b><small>${x.qualified ? 'Verified — reward paid' : 'Waiting for channel verification'} · ${esc(dt(x.joined))}</small></div></div>`).join('');
  const el = $('reflist'); if (reset) el.innerHTML = h || empty(refFilter === 'all' ? 'No referrals yet. Share your link to get started.' : 'Nothing here yet'); else el.insertAdjacentHTML('beforeend', h);
  $('moreRef').hidden = !r.has_more; $('refcount').textContent = 'Qualified: ' + r.qualified + ' · Pending: ' + r.pending;
}
function renderMilestonesBrief(m) {
  const box = $('refmilestones'); if (!m || !m.enabled) { box.hidden = true; return; }
  const nxt = m.items.find((x) => !x.paid);
  box.hidden = false;
  box.innerHTML = nxt ? `<b>🎯 Next bonus: ${nxt.milestone} referrals</b><small>${m.qualified} / ${nxt.milestone} qualified · +${N(nxt.reward)} MINER${esc(withUsd(nxt.reward))}</small><progress max="${nxt.milestone}" value="${Math.min(m.qualified, nxt.milestone)}" aria-label="Progress to ${nxt.milestone} referrals"></progress>` : '<b>🏆 All referral milestones collected</b>';
}
async function loadRewards() {
  const e = await api('engagement'), lv = e.level;
  $('lvlcard').innerHTML = `<div class="row">${ic(lv.icon)}<div class="mid"><b>${esc(lv.name)} miner</b><small>${N(e.lifetime_earned)} MINER${esc(withUsd(e.lifetime_earned))} earned in total</small></div></div>`
    + (lv.next_at ? `<progress max="100" value="${lv.progress}" aria-label="Progress to ${esc(lv.next_name)}"></progress><small>${N(Math.max(0, lv.next_at - e.lifetime_earned))} more MINER to reach ${esc(lv.next_name)}</small>` : '<small>Highest level reached 🎉</small>')
    + '<small class="hint">Levels count MINER you earned from daily rewards, tasks, referrals, bonuses and promo codes.</small>';
  const m = e.milestones;
  setHtml('mslist', m.enabled
    ? m.items.map((x) => `<div class="card row">${ic(x.paid ? '✅' : x.reached ? '🎁' : '🎯')}<div class="mid"><b>${x.milestone} qualified referrals</b><small>${x.paid ? 'Bonus paid' : x.reached ? 'Reached — bonus is added when you open the app' : m.qualified + ' / ' + x.milestone + ' so far'}</small></div><span class="pts">+${N(x.reward)}</span></div>`).join('')
    : empty('Referral milestone bonuses are not active right now.'));
  setHtml('badgelist', e.badges.map((b) => `<div class="card bdg${b.earned ? ' got' : ''}">${ic(b.icon)}<b>${esc(b.name)}</b><small>${esc(b.help)}</small>${badge(b.earned ? 'ok' : 'soon', b.earned ? 'Earned' : 'Locked')}</div>`).join(''));
  $('promocard').hidden = !e.promo_enabled;
}
let refLink = '';
let gateTitles = {};
const chName = (c) => (gateTitles[c] || (data.channel_titles || {})[c] || c); // channel NAME when Telegram gives it, else the @username
let gateMissing = null; // channels the user still has to join (set after a verify check); non-null = full-screen join gate
function renderVerify() {
  const box = $('verifybox'), u = data.user || {};
  if (u.membership_verified) gateMissing = null;
  if (!u.verify_needed) { box.hidden = true; box.classList.remove('gate'); return; }
  const ch = (gateMissing && gateMissing.length ? gateMissing : (data.settings && data.settings.required_channels) || []);
  const block = !data.admin && !u.membership_verified && gateMissing !== null; // blocks the app until the channels are joined (admins are never locked out)
  if (block && box.parentElement !== document.body) document.body.appendChild(box);
  box.classList.toggle('gate', block);
  $('vtext').textContent = block ? 'Join these channels to use the app, then tap Verify.' : u.has_referrer ? 'Join these channels, then tap Verify. Your inviter gets rewarded after you verify.' : 'Join these channels, then tap Verify.';
  setHtml('vlinks', ch.map((c) => `<p><a href="${esc(chUrl(c))}" data-act="openCh" data-ch="${esc(c)}">${esc(chName(c))}</a></p>`).join('')); box.hidden = false;
}

/* ---------------- finance (Part 4) ---------------- */
const WI = { pending: '⏳', approved: '👍', paid: '✅', rejected: '❌', cancelled: '🚫' }, DI = { pending: '⏳', verified: '🔎', confirmed: '✅', rejected: '❌' };
const BC = { pending: 'warn', approved: 'warn', paid: 'ok', rejected: 'no', cancelled: 'no', verified: 'warn', confirmed: 'ok', active: 'ok', finished: 'ok' };
const RS = { not_found: 'Transaction not found yet', confirming: 'Waiting for confirmations', tx_failed: 'Transaction failed on-chain', no_matching_transfer: 'No matching USDT transfer to our wallet from that address', below_minimum: 'Below the minimum deposit', not_found_expired: 'Transaction never appeared', chain_unavailable: 'Blockchain check unavailable, try again' };
function DS(r) { return r.status === 'confirmed' ? '✅ Deposit credited' : r.status === 'verified' ? '🔎 Verified on-chain - waiting for admin approval' : r.status === 'rejected' ? '❌ ' + (RS[r.reason] || r.reason || 'Rejected') : '⏳ ' + (RS[r.reason] || 'Pending') + (r.confirmations != null ? ' (' + r.confirmations + ')' : ''); }
async function getFin() { if (!fin) fin = await api('financeInfo'); return fin; }
let qt;
function quoteW() {
  clearTimeout(qt);
  qt = setTimeout(async () => {
    const v = $('amount').value.trim(); if (!v) { $('wquote').textContent = ''; return; }
    try { const q = await api('withdrawQuote', { amount: v }); $('wquote').textContent = 'Fee ' + q.fee + ' MINER · You receive ' + q.net + ' MINER' + withUsd(q.net) + ' · Reserves ' + N(q.points) + ' MINER' + (q.enough ? '' : ' (not enough MINER)'); }
    catch (e) { $('wquote').textContent = e.message; }
  }, 350);
}
async function loadWithdraw() {
  const f = await getFin(); $('amount').placeholder = 'MINER amount (min ' + f.withdraw.min + ')';
  $('wbal').textContent = 'Balance: ' + N(data.user.points) + ' MINER' + withUsd(data.user.points) + ' · Minimum: ' + N(f.withdraw.min) + ' MINER' + withUsd(f.withdraw.min);
  $('wnote').textContent = f.withdraw.feePercent + '% fee. MINER are reserved when you submit and refunded if rejected or cancelled.'; $('depbtn').hidden = !f.deposit.enabled;
  const r = await api('withdrawList');
  setHtml('wlist', r.items.map((w) => `<div class="card row">${ic(WI[w.status] || '•')}<div class="mid"><b>#${Number(w.id)} · ${esc(w.net_usdt)} MINER${esc(withUsd(w.net_usdt))}</b><small>${badge(BC[w.status] || 'warn', w.status)}${w.reject_reason ? ' ' + esc(w.reject_reason) : ''}${w.tx_hash ? ' · ' + esc(short(w.tx_hash)) : ''}</small></div>${w.status === 'pending' ? btn('Cancel', 'cancelW', `data-id="${Number(w.id)}"`, 'btn sm ghost', 'Cancel withdrawal ' + Number(w.id)) : ''}</div>`).join('') || empty('No withdrawals yet'));
}
async function loadDeposit() {
  const f = await getFin(), d = f.deposit, methods = d.methods || [];
  const legacy = d.enabled && d.wallet ? [{id:'legacy-bep20',asset:'USDT',network:'BEP20',address:d.wallet,min:d.min,enabled:true,qr:''}] : [];
  const available = d.enabled ? methods.filter(x => x.enabled).concat(methods.length ? [] : legacy) : [];
  if (!available.length) { $('depinfo').textContent = 'Deposits are not enabled yet.'; $('depform').hidden = true; }
  else {
    $('depform').hidden = false;
    setHtml('depmethod', available.map(x => `<option value="${esc(x.id)}">${esc(x.asset)} · ${esc(x.network)}</option>`).join(''));
    window.depositMethods = available; updateDepositMethod();
    $('depinfo').textContent = 'Choose the exact asset and blockchain you used. Send only on the selected network.';
  }
  const r = await api('depositList');
  setHtml('deplist', r.items.map((x) => `<div class="card row">${ic(DI[x.status] || '•')}<div class="mid"><b>${x.amount_native ? esc(x.amount_native)+' '+esc(x.asset||'') : 'Deposit #' + Number(x.id)}</b><small>${badge(BC[x.status] || 'warn', x.status)} · ${esc(x.network||'')} · ${esc(short(x.tx_hash))}${x.reject_reason ? ' · '+esc(x.reject_reason) : ''}</small></div></div>`).join('') || empty('No deposits yet'));
}
function updateDepositMethod() {
  const m = (window.depositMethods || []).find(x => x.id === $('depmethod')?.value) || (window.depositMethods || [])[0];
  if (!m || !$('depaddress')) return;
  $('depaddress').innerHTML = `<b>${esc(m.asset)} · ${esc(m.network)}</b><p class="wrap accent">${esc(m.address)}</p><small>Minimum: ${esc(m.min)} ${esc(m.asset)}</small>${m.qr ? `<p><img src="${esc(m.qr)}" alt="Deposit QR" style="max-width:180px;width:100%"></p>` : ''}`;
  $('depamount').min = String(m.min);
  $('depamount').placeholder = `Minimum ${m.min} ${m.asset}`;
}

/* ---------------- community info (Part 6) ---------------- */
async function getCommunity() { if (!community) community = await api('communityInfo'); return community; }

/* leaderboard */
let rankPage = 1;
async function loadRank(page) {
  const want = page || rankPage; if (!$('ranklist').children.length) setHtml('ranklist', skel());
  const r = await api('leaderboard', { page: want }); rankPage = r.page;
  setHtml('rankme', r.me ? `<div class="card"><b>Your rank: #${N(r.me.rank)}</b> <span class="muted">of ${N(r.total)} miners · ${N(r.me.points)} MINER${esc(withUsd(r.me.points))}</span>${r.me.rank > 200 ? '<small>Only the top 200 are listed.</small>' : ''}</div>` : '');
  setHtml('ranklist', r.items.map((u) => `<div class="card rk${u.me ? ' me' : ''}"><span class="n" role="img" aria-label="Rank ${u.rank}">${u.rank <= 3 ? ['🥇', '🥈', '🥉'][u.rank - 1] : u.rank}</span><span class="nm">${esc(u.name)}${u.me ? ' (you)' : ''}</span><span class="pt">${N(u.points)}</span></div>`).join('') || empty('No miners yet'));
  $('rankpager').hidden = r.pages <= 1; $('rankinfo').textContent = 'Page ' + r.page + ' of ' + r.pages;
  $('rankprev').disabled = r.page <= 1; $('ranknext').disabled = !r.hasMore;
}

/* advertise */
let ads = null;
const AD_HINT = { channel: 'Use a link like https://t.me/YourChannel and add this bot as an admin of your channel, so joins can be verified.', bot: 'Use your bot link, like https://t.me/YourBot.', website: 'Use a https:// link. People must stay on the page for the timer before they can claim.' };
function adcalc() {
  const t = $('c_type').value; $('c_hint').textContent = AD_HINT[t]; const bb = $('c_botbox'); if (bb) bb.hidden = t !== 'channel';
  $('c_link').placeholder = t === 'channel' ? 'https://t.me/YourChannel' : t === 'bot' ? 'https://t.me/YourBot' : 'https://example.com';
  const r = Number($('c_reward').value), n = Number($('c_target').value), el = $('c_budget'), ppu = Number(data.settings?.deposit_points_per_usdt) || 10000;
  if (!Number.isInteger(r) || !Number.isInteger(n) || r < 1 || n < 1) { el.textContent = ''; return; }
  const b = r * n, have = ads?.info?.points ?? Number(data.user?.points || 0);
  const sp = Number(ads?.info?.userSharePct) || 100, ur = Math.min(r, Math.max(1, Math.floor(r * sp / 100)));
  el.textContent = 'Budget: ' + N(b) + ' MINER (≈ ' + (b / ppu).toFixed(2) + ' USDT)' + (sp < 100 ? ' · each user gets ' + N(ur) + ' MINER (' + sp + '%), platform fee ' + N(r - ur) + ' MINER' : '') + (b > have ? ' — more than your balance of ' + N(have) + ' MINER' : '');
}
function campCard(c) {
  const pct = Math.min(Number(c.target), Number(c.completed));
  return `<div class="card"><div class="row flat">${ic(taskIcon(c.type, c.link, c.title))}<div class="mid"><b>#${Number(c.id)} ${esc(c.title)}</b><small>${badge(BC[c.status] || 'warn', c.status === 'pending' ? 'in review' : c.status)} · +${N(c.reward)} × ${N(c.target)}</small></div></div>${c.status === 'active' ? `<progress value="${pct}" max="${Number(c.target)}" aria-label="Completed ${pct} of ${Number(c.target)}"></progress><small>${N(c.completed)} of ${N(c.target)} completed</small>` : ''}${c.reject_reason ? `<small>${esc(c.reject_reason)}</small>` : ''}${c.status === 'active' || c.status === 'finished' ? `<small>Used ${N(c.spent)} of ${N(Number(c.reward) * Number(c.target))} MINER${c.status === 'active' ? ' · ' + N(c.unused) + ' unused' : ''}</small>` : ''}${c.status === 'pending' || c.status === 'active' ? `<div class="mt">${btn(c.status === 'pending' ? 'Cancel and refund' : 'Stop and refund unused', 'cancelCamp', `data-id="${Number(c.id)}" data-st="${c.status === 'active' ? 'active' : 'pending'}"`, 'btn sm ghost', (c.status === 'pending' ? 'Cancel campaign ' : 'Stop campaign ') + Number(c.id))}</div>` : ''}</div>`;
}
async function loadAds() {
  setHtml('camplist', skel(2)); ads = await api('campaignList'); const i = ads.info;
  $('adform').hidden = !i.enabled;
  $('adinfo').textContent = i.enabled ? 'Minimum ' + N(i.minReward) + ' MINER per user and ' + N(i.minTarget) + ' completions. You have ' + N(i.points) + ' MINER' + withUsd(i.points) + '. Up to ' + i.maxPending + ' campaigns can wait for review.' : 'Advertising is paused right now. Your existing campaigns are not affected.';
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
  if (r.stats) setHtml('proofstats', `<div class="stats"><div class="card"><small>Paid out</small><b>${esc(r.stats.paid_usdt)} MINER${esc(withUsd(r.stats.paid_usdt))}</b></div><div class="card"><small>Payouts</small><b>${N(r.stats.payouts)}</b></div><div class="card"><small>Members</small><b>${N(r.stats.members)}</b></div></div>`);
  const h = r.items.map((p) => `<div class="card row">${ic('✅')}<div class="mid"><b>${esc(p.amount)} MINER${esc(withUsd(p.amount))}</b><small>${esc(p.name)} · ${esc(dt(p.paid_at))}</small><small>${esc(short(p.tx))}</small></div>${p.url ? btn('View ›', 'openUrl', `data-url="${esc(p.url)}"`, 'btn sm', 'View payout transaction on BscScan, ' + p.amount + ' MINER') : ''}</div>`).join('');
  if (more) $('prooflist').insertAdjacentHTML('beforeend', h); else setHtml('prooflist', h || empty('No payouts to show yet'));
  proofNext = r.next; $('moreProof').hidden = !proofNext;
}

/* how to use (live numbers from the admin settings) */
async function loadHow() {
  const c = await getCommunity(), r = c.rates, chs = (c.requiredChannels || []).map(esc).join(', ');
  const steps = [
    `Open the official bot in Telegram and join the required channels (${chs}). Then tap <b>Verify</b> on the Home screen.`,
    `Claim your <b>Daily Reward</b> (${N(r.dailyReward)} MINER) once every day.`,
    `Open <b>MINER Miner</b> and finish tasks. Channel tasks check that you really joined. Other tasks need you to stay for the timer before you can claim.`,
    `Share your <b>Referral</b> link. You get ${N(r.referralReward)} MINER after a friend joins and verifies the required channels.`,
    r.withdrawalsEnabled ? `<b>Withdraw</b>: 1 Point = 1 MINER. Minimum ${esc(r.minWithdraw)} MINER, fee ${esc(r.feePercent)}%. Enter your BEP-20 (BSC) address. MINER are reserved when you submit and refunded if the request is rejected or cancelled. Every request is reviewed by an admin.` : `<b>Withdrawals</b> are paused right now. Your MINER stay safe in your balance.`,
  ];
  if (r.depositsEnabled) steps.push(`<b>Deposit</b> USDT (BEP-20, minimum ${esc(r.minDeposit)} USDT) from the Withdraw screen. Deposits are checked on-chain.`);
  if (c.games && c.games.enabled) steps.push(`<b>Play games</b> (More &gt; Games): Spin Wheel, Scratch Card and Lucky Box use MINER only, with daily free plays.`);
  if (c.games && c.games.boosterEnabled) steps.push(`<b>Booster</b>: spend MINER on a time-limited multiplier for your daily reward.`);
  if (c.ads.enabled) steps.push(`<b>Advertise</b>: spend MINER to promote your channel, bot or website. An admin reviews each campaign.`);
  const faq = [
    ['Why can’t I claim a task?', 'Timer tasks only unlock after the timer ends. Channel tasks need you to join first. A task can also be finished already or full.'],
    ['Verification says I have not joined', 'Join every listed channel with the same Telegram account, wait a few seconds, then tap Verify again.'],
    ['How long does a withdrawal take?', 'Each request is reviewed and paid manually by an admin. Follow its status on the Withdraw screen, and see recent payouts in Payment Proof.'],
    ['Will the rate or fee change?', 'The team can change them. The quote you see before you submit is what applies to your request.'],
    ['Is it safe?', 'Never share your private key, seed phrase or Telegram login code with anyone. Nobody from the team will ask for them.'],
    ['Are games available?', (c.games && c.games.enabled) ? 'Yes - open More > Games. Games use MINER only, the odds are shown on each game, and daily limits apply.' : 'Not yet. Follow the official channel to hear when they start.'],
  ];
  setHtml('howbody', `<div class="card"><ol class="steps">${steps.map((s) => `<li>${s}</li>`).join('')}</ol></div><h3 class="sub">FAQ</h3>${faq.map((f) => `<details class="card faq"><summary>${esc(f[0])}</summary><p>${esc(f[1])}</p></details>`).join('')}${c.support ? `<button class="btn" data-act="openUrl" data-url="${esc(c.support)}">Contact support ›</button>` : ''}`);
}

/* ---------------- games & boosters (Phase 2 / Part 3) ---------------- */
let gamesData = null, playing = false;
const reduceMotion = () => { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const costText = (g) => (g.plays_left === 0 ? 'No plays left today' : g.next_fee === 0 ? 'Free play' : 'Costs ' + N(g.next_fee) + ' MINER' + withUsd(g.next_fee)) + ' · ' + g.plays_left + ' left today';
function oddsList(g) { return `<details class="odds"><summary>Prizes &amp; odds</summary><ul>${g.prizes.map((p) => `<li><span>${esc(p.label)}</span><b>${p.pct}%</b></li>`).join('')}</ul><small>Max prize per day: ${N(g.win_cap)} MINER (${N(g.win_left)} left today)</small></details>`; }
function gameCard(g) {
  const head = `<div class="row flat">${ic(g.icon)}<div class="mid"><b>${esc(g.name)}</b><small>${esc(g.help)}</small></div></div>`;
  if (!g.enabled) return `<div class="card gcard">${head}<small class="muted">Not available right now</small></div>`;
  const off = playing || g.plays_left === 0 ? ' disabled' : '';
  let body;
  if (g.code === 'spin') body = `<div class="wheel" id="wheel" role="list" aria-label="Wheel segments">${g.prizes.map((p, i) => `<div class="seg" role="listitem" data-i="${i}"><b>${N(p.points)}</b><small>${esc(p.label)}</small></div>`).join('')}</div><button class="btn" data-act="play" data-game="spin"${off}>Spin ›</button>`;
  else if (g.code === 'scratch') body = `<div class="scratch" id="scratchtile" aria-live="polite"><span>Scratch to reveal</span></div><button class="btn" data-act="play" data-game="scratch"${off}>Scratch ›</button>`;
  else body = `<div class="boxes" id="boxes">${Array.from({ length: gamesData.box_count }, (_, i) => `<button class="gbox" data-act="play" data-game="box" data-pick="${i}" aria-label="Open box ${i + 1}"${off}><span aria-hidden="true">🎁</span></button>`).join('')}</div><small class="muted">Tap a box to open it</small>`;
  return `<div class="card gcard">${head}${body}<small class="muted">${esc(costText(g))}</small>${oddsList(g)}</div>`;
}
function boostCardHtml(b) {
  if (b.active) return `<div class="row flat">${ic('⚡')}<div class="mid"><b>Booster ${esc(b.active.label)} active</b><small>${leftText(b.active.seconds_left)} left · your daily reward is multiplied</small></div></div>`;
  if (!b.enabled) return '<div class="empty">Boosters are not available right now.</div>';
  return `<div class="row flat">${ic('⚡')}<div class="mid"><b>Daily reward ${esc(b.label)} for ${b.hours}h</b><small>Costs ${N(b.cost)} MINER${esc(withUsd(b.cost))} · one booster at a time · whole MINER, rounded down</small></div></div><button class="btn" data-act="boost">Buy booster ›</button>`;
}
function drawCardHtml(d) {
  const last = d.last ? `<small class="muted">Last draw: ${esc(d.last.winner)}${d.last.you_won ? ' (you!) 🎉' : ''} won ${N(d.last.prize)} MINER · ${N(d.last.tickets)} tickets</small>` : '';
  if (!d.enabled || !d.open) return `<div class="empty">${d.enabled ? 'No draw is open right now. Check back soon.' : 'Lucky Draw is not active right now.'}</div>${last}`;
  const o = d.open, room = Math.max(0, o.max_tickets - o.my_tickets), can = !o.ended && room > 0 && !playing;
  const sizes = [1, 5].filter((n) => n <= room), buy = (n) => `<button class="btn sm" data-act="drawBuy" data-n="${n}"${can ? '' : ' disabled'}>Buy ${n} ›</button>`;
  return `<div class="row flat">${ic('🎫')}<div class="mid"><b>${esc(o.title)}</b><small>Prize ${N(o.prize)} MINER · ticket ${N(o.ticket_price)} MINER</small></div></div>`
    + `<small class="muted">You hold ${o.my_tickets} of max ${o.max_tickets} tickets · ${N(o.total_tickets)} sold in total${o.ends_at ? ' · ' + (o.ended ? 'sales ended' : 'ends ' + esc(dt(o.ends_at))) : ''}</small>`
    + `<div class="acts">${sizes.map(buy).join('') || (o.ended ? '' : '<small class="muted">You hold the maximum number of tickets.</small>')}</div>${last}`;
}
function renderGames() {
  const g = gamesData; if (!g) return;
  $('gamebalv').textContent = N(g.balance); $('gamebalusd').textContent = 'Your MINER' + (minerPrice() ? ' · ' + usd(g.balance) : '');
  const note = $('gamenote'); note.hidden = g.enabled; note.innerHTML = g.enabled ? '' : '<b>Games are not open yet</b><small class="muted">Follow the official channel to hear when they start. Boosters and the Lucky Draw may still be available below.</small>';
  setHtml('gamelist', g.enabled ? g.games.map(gameCard).join('') : '');
  setHtml('boostcard', boostCardHtml(g.booster)); setHtml('drawcard', drawCardHtml(g.draw));
  const GI = { spin: '🎡', scratch: '🎟️', box: '🎁' };
  setHtml('playlist', g.recent.map((r) => `<div class="card row">${ic(GI[r.game] || '🎮')}<div class="mid"><b>${r.prize > 0 ? '+' + N(r.prize) + ' MINER' + withUsd(r.prize) : 'No prize'}</b><small>${esc(r.game)} · ${esc(dt(r.at))}${r.fee > 0 ? ' · entry ' + N(r.fee) : ''}</small></div></div>`).join('') || empty('No plays yet'));
}
async function loadGames() { gamesData = await api('games'); renderGames(); }
function showResult(r) {
  const el = $('gameresult'); el.hidden = false;
  const win = r.prize > 0;
  el.className = 'card result ' + (win ? 'win' : 'lose');
  el.innerHTML = `<b>${win ? '🎉 You won +' + N(r.prize) + ' MINER' + withUsd(r.prize) : '😅 No prize this time'}</b>`
    + `<small>${esc(r.label)}${r.capped ? ' · prize cut to today’s limit (' + N(r.prize_drawn) + ' drawn)' : ''}${r.fee > 0 ? ' · entry fee −' + N(r.fee) : ''} · balance ${N(r.balance)}</small>`;
}
async function animateSpin(index) {
  const segs = [...document.querySelectorAll('#wheel .seg')]; if (!segs.length) return;
  const mark = (i) => segs.forEach((e, k) => e.classList.toggle('hot', k === i));
  if (reduceMotion()) { mark(index); return; }
  const n = segs.length, steps = n * 2 + index + 1; // two laps, then land on the server's result
  for (let k = 0; k < steps; k++) { mark(k % n); await sleep(60 + Math.floor((k / steps) * 220)); }
  mark(index);
}
async function playGame(d) {
  if (playing) return; playing = true;
  document.querySelectorAll('#gamelist [data-act=play]').forEach((b) => { b.disabled = true; });
  try {
    const r = await api('gamePlay', { game: d.game, pick: d.pick === undefined ? undefined : Number(d.pick) });
    if (d.game === 'spin') await animateSpin(r.index);
    else if (d.game === 'scratch') { const t = document.getElementById('scratchtile'); if (t) { t.classList.add('open'); t.textContent = r.prize > 0 ? '+' + N(r.prize) : '—'; await sleep(reduceMotion() ? 0 : 500); } }
    else { const bx = [...document.querySelectorAll('#boxes .gbox')]; bx.forEach((e, i) => { e.classList.toggle('open', i === r.pick); if (i === r.pick) e.textContent = r.prize > 0 ? '+' + N(r.prize) : '—'; }); await sleep(reduceMotion() ? 0 : 500); }
    showResult(r); try { tg?.HapticFeedback?.notificationOccurred(r.prize > 0 ? 'success' : 'warning'); } catch (e) {}
  } finally { playing = false; }
  await boot(); await loadGames();
}

/* ---------------- contests (Phase 2 / Part 4) ---------------- */
let proofTask = null;
const fmtLeft = (sec) => { const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60); return d > 0 ? d + 'd ' + h + 'h' : h > 0 ? h + 'h ' + m + 'm' : m + 'm'; };
const medal = (r) => (r === 1 ? '🥇' : r === 2 ? '🥈' : r === 3 ? '🥉' : '#' + r);
const prizeTiers = (prizes) => { const out = []; (prizes || []).forEach((p, i) => { const last = out[out.length - 1]; if (last && last.p === p && i + 1 > 3) last.to = i + 1; else out.push({ from: i + 1, to: i + 1, p }); }); return out; };
const prizeLine = (prizes) => prizeTiers(prizes).map((t) => (t.from === t.to ? medal(t.from) : '#' + t.from + '-' + t.to) + ' ' + N(t.p)).join(' · ');
const ctRows = (rows) => rows.map((r) => `<div class="card row${r.me ? ' me' : ''}"><span class="ic" aria-hidden="true">${esc(medal(r.rank))}</span><div class="mid"><b>${esc(r.name)}${r.me ? ' (you)' : ''}</b><small>👥 ${N(r.referrals)} referral${r.referrals === 1 ? '' : 's'}</small></div>${r.prize > 0 ? `<span class="pts">🏆 +${N(r.prize)}</span>` : ''}</div>`).join('');
let ctTimer = null;
const fmtClock = (sec) => { sec = Math.max(0, Math.floor(sec)); const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60), x = sec % 60, z = (n) => String(n).padStart(2, '0'); return (d > 0 ? d + 'd ' : '') + z(h) + 'h ' + z(m) + 'm ' + z(x) + 's'; };
function startCtTimer() {
  if (ctTimer) clearInterval(ctTimer);
  const tick = () => { const el = document.getElementById('ctclock'); if (!el) { clearInterval(ctTimer); ctTimer = null; return; } const left = (Number(el.dataset.end) - Date.now()) / 1000; el.textContent = left > 0 ? fmtClock(left) : 'Contest ended'; if (left <= 0) { clearInterval(ctTimer); ctTimer = null; } };
  tick(); ctTimer = setInterval(tick, 1000);
}
function renderContests(c) {
  if (!c.enabled) return setHtml('ctlist', empty('Contests are not open yet'));
  let h = '';
  if (c.current) {
    const k = c.current, me = k.me;
    h += `<div class="card"><b>${esc(k.title)}</b><small>${esc(k.kind)} contest${k.over ? ' · ended, waiting for the payout' : ''}</small>${k.over ? '' : `<div class="ctclock-wrap"><small>⏳ Ends in</small><b id="ctclock" data-end="${Date.now() + Number(k.seconds_left) * 1000}">${esc(fmtClock(k.seconds_left))}</b></div>`}<small><b>🏆 Winning prizes (MINER)</b></small>${prizeTiers(k.prizes).map((t) => `<small>${esc(t.from === t.to ? medal(t.from) : 'Rank ' + t.from + '–' + t.to)}: <b>${N(t.p)}</b> MINER</small>`).join('')}<small>You need at least ${N(k.min_referrals)} qualified referral${k.min_referrals === 1 ? '' : 's'} to win.</small>`
      + `<span class="pts">Your referrals: ${N(me.referrals)}${me.rank ? ' · rank #' + N(me.rank) : me.qualifies ? '' : ' · not ranked yet'}</span>${btn('Invite friends ›', 'goRef', '', 'btn sm', 'Invite friends')}</div>`
      + `<h3 class="sub">Live leaderboard</h3>` + (k.top.length ? ctRows(k.top) : empty('No one has qualified yet — be the first!'));
  } else h += empty('No contest is running right now');
  if (c.last && c.last.winners.length) h += `<h3 class="sub">Last winners · ${esc(c.last.title)}</h3>` + ctRows(c.last.winners);
  setHtml('ctlist', h);
  startCtTimer();
}
async function loadContests() { setHtml('ctlist', skel(2)); renderContests(await api('contests')); }

/* ---------------- weekly missions + terms (Part 14) ---------------- */
let termsFrom = null;
const msCard = (m) => {
  const act = m.claimed ? '<button class="btn sm done" disabled>Claimed ✓</button>' : m.done ? btn('Claim ›', 'missionClaim', `data-m="${esc(m.id)}"`, 'btn sm', 'Claim ' + m.title) : '<button class="btn sm" disabled>In progress</button>';
  return `<div class="card"><div class="mtop"><b>${esc(m.icon)} ${esc(m.title)}</b><span class="pts">🪙 +${N(m.reward)}</span></div><small>${esc(m.hint)}</small><progress class="bar" max="${Number(m.target)}" value="${Number(m.progress)}" aria-label="${esc(m.title)} progress"></progress><div class="mtop"><small>${N(m.progress)} / ${N(m.target)}</small>${act}</div></div>`;
};
function renderMissions(m) {
  if (!m.enabled) return setHtml('mslist', empty('Weekly missions are not open yet'));
  let h = `<small class="hint">New week starts in ${esc(fmtLeft(m.seconds_left))}</small>` + m.items.map(msCard).join('');
  if (m.bonus && m.bonus.enabled) {
    const b = m.bonus, act = b.claimed ? '<button class="btn sm done" disabled>Claimed ✓</button>' : b.available ? btn('Claim bonus ›', 'missionClaim', 'data-m="bonus"', 'btn sm', 'Claim the all missions bonus') : '<button class="btn sm" disabled>Claim all three first</button>';
    h += `<div class="card"><div class="mtop"><b>🎁 All missions bonus</b><span class="pts">🪙 +${N(b.reward)}</span></div><small>Claim all three missions this week</small><div class="mtop"><span></span>${act}</div></div>`;
  }
  setHtml('mslist', h);
}
async function loadMissions() { setHtml('mslist', skel(3)); renderMissions(await api('missions')); }
const termsParas = (t) => String(t || '').split(/\n\s*\n/).filter((x) => x.trim()).map((x) => `<p class="wrap">${esc(x.trim())}</p>`).join('');
async function loadTerms() {
  setHtml('termsbox', skel(2));
  const t = await api('terms');
  setHtml('termsbox', `<div class="card"><h3 class="sub">Terms of Use</h3>${termsParas(t.terms)}</div><div class="card"><h3 class="sub">Privacy</h3>${termsParas(t.privacy)}</div>`
    + (t.accepted ? `<small class="hint">✅ You accepted version ${N(t.version)}${t.accepted_at ? ' on ' + esc(new Date(t.accepted_at).toLocaleDateString()) : ''}.</small>` : t.required ? '<small class="hint">You need to accept before your first withdrawal.</small>' : ''));
  $('termsbtn').hidden = !!t.accepted;
}

/* ---------------- Auto-Miner: live on Home + on the Auto-Miner screen ----------------
   The server sends the state once (autoMiner). The page then counts it up every second for display only.
   Nothing is paid from here: claims are always made on the server, which rounds each machine down to whole MINER. */
let amData = null, amAt = 0, amTimer = null, amBusy = false;
const amCap = (m) => m.rate_per_hour * amData.storage_hours;   // a machine holds at most rate x storage hours
const amEst = (m, t) => Math.min(amCap(m), m.pending + m.rate_per_hour * Math.max(0, Math.min(t, m.seconds_left)) / 3600);
const amRunning = (m, t) => m.status === 'running' && m.seconds_left - t > 0;
const amSet = (sel, txt) => document.querySelectorAll(sel).forEach((el) => { el.textContent = txt; });

function amTopHtml() {
  return `<div class="card"><div class="row flat">${ic('⛏️')}<div class="mid"><b><span data-amready>0.00</span> MINER ready to claim<span data-amreadyusd></span></b><small>Mining <span data-amrate>0</span> MINER per hour · storage ${N(amData.storage_hours)} h per machine</small></div></div>`
    + `<small class="muted">Balance: ${N(amData.balance)} MINER${esc(withUsd(amData.balance))} · claimed so far ${N(amData.claimed_total)}</small>`
    + `<button class="btn" data-act="amClaim" data-amclaim disabled>Nothing to claim yet</button></div>`;
}
const amMinerHtml = (m, i) => `<div class="card"><div class="row flat">${ic('⛏️')}<div class="mid"><b>${esc(m.name)}</b><small>${N(m.rate_per_hour)} MINER/h · <span data-amt="${i}"></span></small></div></div>`
  + `<small>Ready: <b data-amp="${i}">0.00</b> MINER<span data-amf="${i}"></span></small></div>`;

/* one tick = one second: recount every machine from the last server state */
function amTick() {
  const a = amData; if (!a || !a.enabled) return;
  const t = (Date.now() - amAt) / 1000;
  let total = 0, claim = 0, hour = 0;
  a.miners.forEach((m, i) => {
    const v = amEst(m, t), run = amRunning(m, t), full = v >= amCap(m) - 1e-9;
    total += v; claim += Math.floor(v); if (run) hour += m.rate_per_hour;
    const timeTxt = run ? leftText(Math.max(0, m.seconds_left - t)) + ' left' : 'finished';
    const fullTxt = full ? ' · storage full, claim to keep mining' : (run ? ' · storage full in ' + leftText(Math.max(0, m.full_in_seconds - t)) : '');
    amSet(`[data-amp="${i}"]`, v.toFixed(2)); amSet(`[data-amt="${i}"]`, timeTxt); amSet(`[data-amf="${i}"]`, fullTxt);
  });
  amSet('[data-amready]', total.toFixed(2));
  amSet('[data-amreadyusd]', withUsd(total));
  amSet('[data-amrate]', N(hour));
  // the big balance counts up too: server balance + what the miners hold right now (shown with decimals; it becomes real only on Claim)
  const shown = a.balance + total, fmt = { minimumFractionDigits: 2, maximumFractionDigits: 2 };
  const pt = $('points'); if (pt) pt.textContent = shown.toLocaleString(undefined, fmt);
  const pu = $('pointsusd'); if (pu) { const u = usd(shown); pu.textContent = u; pu.hidden = !u; }
  document.querySelectorAll('[data-amclaim]').forEach((b) => { b.disabled = claim < 1; b.textContent = claim >= 1 ? 'Claim ' + N(claim) + ' MINER ›' : 'Nothing to claim yet'; });
  if (t >= 300 && !document.hidden) amFetch(); // re-sync about every 5 min, never while the app is in the background (the counter runs locally)
}

/* fetch the state from the server (one request at a time) */
async function amFetch() {
  if (amBusy) return; amBusy = true;
  try {
    amData = await api('autoMiner'); amAt = Date.now();
    renderAutoMiner();
    if (amData.enabled && !amTimer) amTimer = setInterval(amTick, 1000);
  } catch (e) { /* keep the last numbers on screen */ }
  finally { amBusy = false; }
}

// coming back to the app after a while: sync once
document.addEventListener('visibilitychange', () => { if (!document.hidden && amData && amData.enabled && (Date.now() - amAt) / 1000 >= 60) amFetch(); });

/* Home: shows the live miners whenever Auto-Miner is ON */
function renderAutoHome() {
  if (data.auto_miner && data.auto_miner.enabled) amFetch();
  else { const w = $('amhome'); if (w) w.hidden = true; }
}

function renderAutoMiner() {
  const a = amData; if (!a) return;
  $('amhome').hidden = !a.enabled;
  $('amnote').hidden = !!a.enabled;
  if (!a.enabled) {
    $('amnote').innerHTML = '<b>Auto-Miner is not open yet</b><small class="muted">Follow the official channel to hear when it starts.</small>';
    ['amtop', 'amminers', 'amshop', 'amclaims', 'amhometop', 'amhomeminers'].forEach((id) => setHtml(id, ''));
    return;
  }
  $('amnote').innerHTML = '';
  const top = amTopHtml();
  const miners = a.miners.map(amMinerHtml).join('') || empty('You have no miners yet. Buy one in the shop.');
  setHtml('amhometop', top); setHtml('amhomeminers', miners);
  setHtml('amtop', top); setHtml('amminers', miners);
  setHtml('amshop', a.plans.map((p) => {
    const price = p.price > 0 ? N(p.price) + ' MINER' + esc(withUsd(p.price)) : 'Free';
    const can = p.can_buy && (p.price === 0 || a.balance >= p.price);
    const act = !p.can_buy ? '<button class="btn sm done" disabled>Owned max</button>'
      : `<button class="btn sm" data-act="amBuy" data-id="${String(Number(p.id))}"${can ? '' : ' disabled'}>${can ? 'Buy ›' : 'Not enough MINER'}</button>`;
    return `<div class="card"><div class="row flat">${ic('🤖')}<div class="mid"><b>${esc(p.name)}</b><small>${N(p.rate_per_hour)} MINER/h · runs ${N(p.duration_days)} days · ${N(p.rate_per_hour * 24)} MINER/day</small></div></div>`
      + `<small>Price: ${price} · you own ${N(p.owned)} of ${N(p.max_per_user)}</small><div class="acts">${act}</div></div>`;
  }).join('') || empty('No miners in the shop right now'));
  setHtml('amclaims', a.claims.map((c) => `<div class="card row">${ic('⛏️')}<div class="mid"><b>+${N(c.points)} MINER${esc(withUsd(c.points))}</b><small>${N(c.miners)} miner(s) · ${esc(dt(c.at))}</small></div></div>`).join('') || empty('No claims yet'));
  amTick();
}
async function loadAutoMiner() { await amFetch(); }

/* ---------------- navigation ---------------- */
const PARENT = { automine: 'more', deposit: 'withdraw', rewards: 'more', rank: 'more', ads: 'more', channel: 'more', proof: 'more', howto: 'more', games: 'more', contests: 'more', missions: 'more', terms: 'more', taskproof: 'tasks', history: 'more', prefs: 'more' };
const NAVOF = { automine: 'more', deposit: 'withdraw', rewards: 'more', rank: 'more', ads: 'more', channel: 'more', proof: 'more', howto: 'more', games: 'more', contests: 'more', missions: 'more', terms: 'more', taskproof: 'tasks', history: 'more', prefs: 'more' };
let cur = 'home', backBound = false;
function go(id) {
  if (!$(id)) return; cur = id;
  document.querySelectorAll('main>section').forEach((s) => s.classList.remove('on')); $(id).classList.add('on');
  const on = NAVOF[id] || id;
  document.querySelectorAll('#nav button').forEach((b) => { if (b.dataset.go === on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  window.scrollTo(0, 0);
  showPopupAd(id);
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
      const r = await api('referral'); refLink = r.link; $('refurl').textContent = r.link; $('refreward').textContent = N(r.reward); $('refusd').textContent = withUsd(r.reward); $('refcount').textContent = 'Qualified: ' + r.qualified + ' · Pending: ' + r.pending;
      await loadRefs(true);
      api('engagement').then((e) => renderMilestonesBrief(e.milestones)).catch(() => {}); // optional extra, never blocks the list
    }
    if (id === 'rewards') await loadRewards();
    if (id === 'rank') await loadRank(1);
    if (id === 'ads') await loadAds();
    if (id === 'channel') await loadChannel();
    if (id === 'proof') await loadProof(false);
    if (id === 'howto') await loadHow();
    if (id === 'games') await loadGames();
    if (id === 'automine') await loadAutoMiner();
    if (id === 'contests') await loadContests();
    if (id === 'missions') await loadMissions();
    if (id === 'terms') await loadTerms();
    if (id === 'prefs') loadPrefs();
  } catch (e) { say(e.message); }
}


/* ---------------- popup ads: Tasks / Ads / Games ---------------- */
const POPUP_FLAG = { tasks: 'on_tasks', taskproof: 'on_tasks', ads: 'on_ads', games: 'on_games' };
let popupBusy = false, adsgramLoading = null, monetagLoading = null;
let lastCsp = ''; // last thing the browser blocked (CSP): shown to admins so the missing domain is easy to find
const cspSeen = new Set();
document.addEventListener('securitypolicyviolation', (e) => {
  lastCsp = String(e.blockedURI || 'inline').replace(/^https?:\/\//, '').slice(0, 40) + ' [' + String(e.violatedDirective || '').split(' ')[0] + ']';
  // admin-only debug: show each new blocked thing once, so we can see what breaks the ad styling
  try { if (data && data.admin && !cspSeen.has(lastCsp) && cspSeen.size < 6) { cspSeen.add(lastCsp); say('CSP blocked: ' + lastCsp); } } catch (x) { /* data not ready yet */ }
});
function loadAdsgram() {
  if (window.Adsgram) return Promise.resolve();
  if (!adsgramLoading) adsgramLoading = new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'https://sad.adsgram.ai/js/sad.min.js'; s.onload = res; s.onerror = () => { adsgramLoading = null; rej(new Error('adsgram blocked')); }; document.head.appendChild(s); });
  return adsgramLoading;
}
function loadMonetag(zone) {
  if (typeof window['show_' + zone] === 'function') return Promise.resolve();
  if (!monetagLoading) monetagLoading = new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'https://libtl.com/sdk.js'; s.dataset.zone = zone; s.dataset.sdk = 'show_' + zone; s.onload = res; s.onerror = () => { monetagLoading = null; rej(new Error('monetag blocked')); }; document.head.appendChild(s); });
  return monetagLoading;
}
function showOwnPopup(p) {
  return new Promise((res) => {
    const box = $('popupad'), img = normUrl(p.image), link = normUrl(p.link);
    if (!box || (!p.title && !p.text && !img && !link)) { res(false); return; }
    $('pa_title').textContent = p.title || ''; $('pa_title').hidden = !p.title;
    $('pa_text').textContent = p.text || ''; $('pa_text').hidden = !p.text;
    const im = $('pa_img'); if (img) { im.src = img; im.hidden = false; } else { im.hidden = true; im.removeAttribute('src'); }
    const goBtn = $('pa_go'), x = $('pa_close');
    goBtn.hidden = !link; goBtn.textContent = p.button || 'Open';
    let left = Math.max(0, Number(p.wait) || 0), timer = null;
    const close = () => { clearInterval(timer); box.hidden = true; res(true); };
    const tick = () => { if (left > 0) { x.disabled = true; x.textContent = String(left); left -= 1; } else { clearInterval(timer); x.disabled = false; x.textContent = '✕'; } };
    tick(); if (left > 0) timer = setInterval(tick, 1000);
    x.onclick = () => { if (!x.disabled) close(); };
    goBtn.onclick = () => { openUrl(link); close(); };
    box.hidden = false;
  });
}
/* ---------------- Watch & Earn: rewarded ad -> MINER (server checks limit, cooldown, minimum watch time) ---------------- */
let adWatching = false;
let adTimer = null;
const mmss = (n) => Math.floor(n / 60) + ':' + String(n % 60).padStart(2, '0');
/** Watch & Earn card: shows reward + ads left today, and a live countdown to the next ad (server enforces the same gap). */
async function renderAdTile() {
  const w = data && data.watch_ad, tile = $('adtile'); if (!tile) return;
  clearInterval(adTimer);
  tile.hidden = !(w && w.enabled); if (tile.hidden) return;
  const sub = $('adtilesub'), btn = $('adtilebtn');
  let i; try { i = await api('adWatchInfo'); } catch (e) { btn.disabled = false; return; }
  if (!i.enabled) { tile.hidden = true; return; }
  if (i.left <= 0) { sub.textContent = 'Daily limit reached \u00b7 come back tomorrow'; btn.disabled = true; btn.textContent = 'Done \u2713'; return; }
  const until = Date.now() + (Number(i.cooldown_left) || 0) * 1000;
  const paint = () => {
    const cd = Math.max(0, Math.ceil((until - Date.now()) / 1000));
    if (cd > 0) { sub.textContent = '\u23f3 Next ad in ' + mmss(cd) + ' \u00b7 ' + i.left + ' left today'; btn.disabled = true; btn.textContent = mmss(cd); }
    else { clearInterval(adTimer); sub.textContent = '+' + N(i.reward) + ' MINER' + withUsd(i.reward) + ' per ad \u00b7 ' + i.left + ' left today'; btn.disabled = false; btn.textContent = 'Watch \u203a'; }
  };
  paint();
  if (until > Date.now()) adTimer = setInterval(paint, 1000);
}
/** Plays a rewarded ad from the configured network(s). -> 'done' | 'skipped' | 'none' */
async function playRewardAd() {
  const p = (data && data.popup_ad) || {}, net = (data && data.watch_ad && data.watch_ad.network) || 'monetag';
  const order = net === 'adsgram' ? ['adsgram'] : net === 'both' ? ['adsgram', 'monetag'] : ['monetag'];
  for (const n of order) {
    if (n === 'adsgram' && p.adsgram_block_id) {
      try { await loadAdsgram(); await window.Adsgram.init({ blockId: p.adsgram_block_id }).show(); return 'done'; }
      catch (e) { if (e && e.error === false) return 'skipped'; /* error: try the next network */ }
    }
    if (n === 'monetag' && /^\d{1,15}$/.test(p.monetag_zone_id || '')) {
      try { await loadMonetag(p.monetag_zone_id); await window['show_' + p.monetag_zone_id](); return 'done'; } catch (e) { /* try the next network */ }
    }
  }
  return 'none';
}
async function watchAd(el) {
  if (adWatching) return; adWatching = true; if (el) el.disabled = true;
  try {
    const st = await api('adWatchStart'), t0 = Date.now();
    const res = await playRewardAd();
    if (res === 'skipped') { say('Watch the full ad to earn MINER'); return; }
    if (res === 'none') { say('No ad available right now. Please try again in a little while.'); return; }
    const wait = st.min_seconds * 1000 - (Date.now() - t0) + 300; if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    const r = await api('adWatchClaim', { token: st.token });
    say('\ud83d\udcfa +' + N(r.reward) + ' MINER' + withUsd(r.reward) + ' \u00b7 ' + r.left + ' ads left today');
    await boot();
  } finally { adWatching = false; renderAdTile(); }
}
/* Monetag preloads its ads when the tag is on the page, so load it early (only when popup ads + a zone are set). */
function preloadPopupSdk() {
  const p = data && data.popup_ad, w = data && data.watch_ad; if (!p || !(p.enabled || (w && w.enabled))) return;
  if (((w && w.enabled) || p.type === 'monetag' || p.type === 'both') && /^\d{1,15}$/.test(p.monetag_zone_id || '')) loadMonetag(p.monetag_zone_id).catch(() => {});
}
let cspChecked = false;
/* admin-only debug: read the CSP header the server really sends (shows if the latest vercel.json is live) */
async function adminCspCheck() {
  if (cspChecked || !data || !data.admin) return; cspChecked = true;
  try {
    const c = (await fetch('/index.html', { cache: 'no-store' })).headers.get('content-security-policy') || 'none';
    say('Live CSP -> style: ' + (/style-src[^;]*'unsafe-inline'/.test(c) ? 'OK' : 'STRICT (old deploy)') + ' | script: ' + (/script-src[^;]*\shttps:(\s|;|$)/.test(c) ? 'OK' : 'STRICT (old deploy)'));
  } catch (e) { /* ignore */ }
}
async function showPopupAd(section) {
  adminCspCheck();
  const p = data && data.popup_ad, flag = POPUP_FLAG[section];
  if (!p || !flag || !p.enabled || !p[flag] || popupBusy) return;
  let last = 0; try { last = Number(localStorage.getItem('popup_ad_at')) || 0; } catch (e) { /* storage blocked: show every time */ }
  if (Date.now() - last < (Number(p.cooldown) || 120) * 1000) return;
  popupBusy = true;
  const why = []; // admins get a short reason on screen when no ad could be shown (easy to debug on a phone)
  const err = (e) => String((e && (e.message || e.description || e.error)) || e || 'no ad').slice(0, 60) + (lastCsp ? ' / blocked: ' + lastCsp : '');
  try {
    let shown = false;
    if (p.type === 'adsgram' || p.type === 'both') {
      if (!p.adsgram_block_id) why.push('Adsgram: block ID empty');
      else { try { await loadAdsgram(); await window.Adsgram.init({ blockId: p.adsgram_block_id }).show(); shown = true; } catch (e) { if (e && e.error === false) shown = true; /* user skipped a rewarded ad: it was shown, do not stack another */ else why.push('Adsgram: ' + err(e)); } }
    }
    if (!shown && (p.type === 'monetag' || p.type === 'both')) {
      if (!/^\d{1,15}$/.test(p.monetag_zone_id || '')) why.push('Monetag: zone ID empty');
      else { try { await loadMonetag(p.monetag_zone_id); await window['show_' + p.monetag_zone_id](); shown = true; } catch (e) { why.push('Monetag: ' + err(e)); } }
    }
    if (!shown && (p.type === 'own' || p.type === 'both')) { shown = await showOwnPopup(p); if (!shown) why.push('Own popup: title/text/image/link all empty'); }
    if (shown) { try { localStorage.setItem('popup_ad_at', String(Date.now())); } catch (e) { /* ignore */ } }
    else if (data.admin && why.length) say('Popup ad not shown (admin note) - ' + why.join(' | '));
  } finally { popupBusy = false; }
}

/* ---------------- settings: language + theme (Phase 2 / Part 5) ---------------- */
async function syncLang() {
  if (!window.I18N) return;
  const want = (data.user && data.user.lang) || I18N.stored() || (data.user && data.user.lang_guess) || 'en';
  if (want !== I18N.lang) await I18N.set(want);
}
let lastPrefs = '';
const FONTS = ['system', 'serif', 'mono', 'rounded', 'hand'], SIZES = ['small', 'normal', 'large'];
const getPref = (k, list, d) => { try { const v = localStorage.getItem(k); return list.includes(v) ? v : d; } catch (e) { return d; } };
function applyFont(f, z) { const r = document.documentElement; if (f === 'system') delete r.dataset.font; else r.dataset.font = f; if (z === 'normal') delete r.dataset.fsize; else r.dataset.fsize = z; }
const prefsKey = () => [$('pf_lang').value, $('pf_theme').value, $('pf_font').value, $('pf_fsize').value].join('|');
function loadPrefs() { $('pf_lang').value = window.I18N ? I18N.lang : 'en'; $('pf_theme').value = getTheme(); $('pf_font').value = getPref('font', FONTS, 'system'); $('pf_fsize').value = getPref('fsize', SIZES, 'normal'); lastPrefs = prefsKey(); }
async function savePrefs() {
  const th = $('pf_theme').value, lg = $('pf_lang').value, fo = $('pf_font').value, fz = $('pf_fsize').value;
  if (lastPrefs === prefsKey()) return; // a select fires both "input" and "change": handle the choice once
  lastPrefs = prefsKey();
  if (FONTS.includes(fo) && SIZES.includes(fz)) { try { localStorage.setItem('font', fo); localStorage.setItem('fsize', fz); } catch (e) {} applyFont(fo, fz); }
  if (THEMES.includes(th)) { try { localStorage.setItem('theme', th); } catch (e) {} applyTheme(th); }
  if (window.I18N && lg !== I18N.lang) {
    await I18N.set(lg);
    try { await api('setLang', { lang: lg }); if (data.user) data.user.lang = lg; } catch (e) { say(e.message); return; } // the choice is kept on this device even if the server call fails
  }
  say(T('prefs.saved', null, 'Saved'));
}

/* Referral fix: a referred user who already joined the channels used to get nothing until they found and tapped Verify.
   Now the check runs by itself once per app open (silent when channels are still missing). */
let waitBot = false; // set when the user was sent to Telegram to make the bot admin: check by itself when they come back
document.addEventListener('visibilitychange', () => {
  if (document.hidden || !waitBot || !$('c_link') || !$('c_link').value) return;
  api('channelBotCheck', { link: $('c_link').value }).then((r) => { if ($('c_botmsg')) $('c_botmsg').textContent = r.message; if (r.admin) { waitBot = false; say(r.message); } }).catch(() => {});
});
let autoTried = false;
async function autoVerify(force) {
  if ((autoTried && !force) || !data.user || !data.user.verify_needed) return;
  autoTried = true;
  try {
    const r = await api('referralVerify');
    if (r.verified) { gateMissing = null; if (r.reward_granted) say('✅ Verified — your inviter was rewarded'); await boot(); }
    else { gateTitles = r.titles || {}; gateMissing = r.missing || []; renderVerify(); } // not joined yet: show the join screen
  } catch (e) { /* check unavailable (bot not admin in a channel ...): never lock people out, the normal Verify card stays */ }
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && gateMissing !== null) autoVerify(true); }); // came back from joining -> check again by itself

/* ---------------- boot ---------------- */
async function boot() {
  try {
    data = await api('bootstrap'); status('');
    $('points').textContent = N(data.user.points); renderUsdBalance();
    const s = data.settings || {}; { const mp = minerPrice(); $('rate').textContent = mp ? '1 MINER ≈ ' + fmtUsd(mp) + ' USDT' : '1 Point = 1 MINER'; }
    const bn = $('banner'); bn.textContent = s.announcement || ''; bn.hidden = !s.announcement;
    $('promotile').hidden = s.promo_enabled !== true;
    await syncLang();
    initTimers(); renderDaily(); renderVerify(); renderAutoHome(); renderTasks(); renderTx(data.transactions || [], false);
    if (data.admin) initAdmin();
    autoVerify();
    autoGift(); preloadPopupSdk(); renderAdTile(); renderHomeExtras();
  } catch (e) { status(e.message); say(e.message); }
}
/* ---------------- Home extras (Part A): withdraw progress, payment-proof strip, contest banner ----------------
   Frontend only. Uses the existing actions financeInfo, proofList and contests; nothing new is stored or created.
   Each block stays hidden when its feature is OFF or has no real data (no fake payouts are ever shown). */
const homeX = { proofAt: 0, ctAt: 0, ct: null };
let ctbTimer = null;
async function renderWithdrawProgress() {
  const box = $('wprog'); if (!box) return;
  try {
    const f = await getFin(), w = f.withdraw || {}, min = Number(w.min), pts = Number((data.user || {}).points);
    if (!w.enabled || !(min > 0) || !Number.isFinite(pts)) { box.hidden = true; return; }
    const pct = Math.max(0, Math.min(100, Math.floor((pts / min) * 100)));
    box.hidden = false;
    $('wptext').textContent = pct >= 100 ? '🎉 You can withdraw now' : 'Minimum withdraw: ' + N(Math.floor(pts)) + ' / ' + N(min) + ' MINER';
    $('wppct').textContent = pct + '%';
    $('wpfill').style.width = pct + '%';
    $('wpfill').parentElement.setAttribute('aria-valuenow', String(pct));
    box.classList.toggle('done', pct >= 100);
  } catch (e) { box.hidden = true; }
}
async function renderProofStrip() {
  const box = $('proofstrip'); if (!box) return;
  if (Date.now() - homeX.proofAt < 60000 && homeX.proofHtml !== undefined) { box.hidden = !homeX.proofHtml; return; } // 1 min cache: boot() runs after every action
  try {
    const r = await api('proofList', {});
    homeX.proofAt = Date.now();
    const items = r.enabled && Array.isArray(r.items) ? r.items.slice(0, 10) : [];
    const one = items.map((p) => `<span class="ps-item"><b>${esc(p.name)}</b> withdrew <b>${esc(p.amount)} MINER</b></span>`).join('');
    homeX.proofHtml = one ? one + one : ''; // twice, so the scroll loops without a gap
    $('pstrack').innerHTML = homeX.proofHtml; $('pstrack').classList.toggle('still', items.length < 2);
    box.hidden = !homeX.proofHtml;
  } catch (e) { box.hidden = true; }
}
function paintCtBanner() {
  const b = $('ctbanner'), c = homeX.ct; if (!b) return;
  if (ctbTimer) { clearInterval(ctbTimer); ctbTimer = null; }
  if (!c || !c.enabled || !c.current || c.current.over) { b.hidden = true; return; }
  const k = c.current, me = k.me || {}, end = homeX.ctAt + Number(k.seconds_left) * 1000;
  const top = (k.top || []).slice(0, 3).map((r) => `<span class="ctb-r${r.me ? ' me' : ''}">${esc(medal(r.rank))} ${esc(r.name)} · ${N(r.referrals)}</span>`).join('') || '<span class="ctb-r">Be the first to qualify!</span>';
  b.hidden = false;
  b.setAttribute('aria-label', 'Open contest: ' + k.title);
  b.innerHTML = `<div class="ctb-top"><b>🏁 ${esc(k.title)}</b><span class="ctb-clock">⏳ <span id="ctbclock">${esc(fmtClock(k.seconds_left))}</span></span></div>`
    + `<div class="ctb-rows">${top}</div>`
    + `<div class="ctb-me">${me.rank ? 'Your rank: <b>#' + N(me.rank) + '</b> · ' : 'Not ranked yet · '}<b>${N(me.referrals || 0)}</b> referral${me.referrals === 1 ? '' : 's'}<span class="chev" aria-hidden="true"> ›</span></div>`;
  const tick = () => { const el = document.getElementById('ctbclock'); if (!el) { clearInterval(ctbTimer); ctbTimer = null; return; } const left = (end - Date.now()) / 1000; if (left <= 0) { b.hidden = true; clearInterval(ctbTimer); ctbTimer = null; return; } el.textContent = fmtClock(left); };
  tick(); ctbTimer = setInterval(tick, 1000);
}
async function renderContestBanner() {
  if (homeX.ct && Date.now() - homeX.ctAt < 30000) { paintCtBanner(); return; }
  try { homeX.ct = await api('contests', {}); homeX.ctAt = Date.now(); paintCtBanner(); }
  catch (e) { const b = $('ctbanner'); if (b) b.hidden = true; }
}
function renderHomeExtras() { renderWithdrawProgress(); renderProofStrip(); renderContestBanner(); } // not awaited: Home must never wait for these
/* Gift link: t.me/<bot>/<app>?startapp=gift_CODE opens the app and redeems the code once, by itself. */
let giftTried = false;
async function autoGift() {
  if (giftTried) return; giftTried = true;
  const sp = String(tg?.initDataUnsafe?.start_param || ''), m = /^gift_([A-Za-z0-9]{4,20})$/.exec(sp); if (!m) return;
  const key = 'gift_' + m[1].toUpperCase();
  try { if (localStorage.getItem(key)) return; } catch (e) { /* storage blocked: the server still enforces the limits */ }
  try { const r = await api('promoRedeem', { code: m[1] }); try { localStorage.setItem(key, '1'); } catch (e) { /* ignore */ } say('🎁 Gift code redeemed: +' + N(r.reward) + ' MINER'); await boot(); }
  catch (e) { say(e.message); }
}
function initAdmin() {
  if (!document.querySelector('#nav [data-go=admin]')) { const b = document.createElement('button'); b.dataset.go = 'admin'; b.innerHTML = '<span class="ic" aria-hidden="true">🛡</span><span data-i18n="nav.admin">' + esc(T('nav.admin', null, 'Admin')) + '</span>'; $('nav').appendChild(b); }
  if (!$('admjs')) { const s = document.createElement('script'); s.id = 'admjs'; s.src = '/admin.js'; document.body.appendChild(s); }
}
function showGate() { $('gate').hidden = false; $('main').hidden = true; $('nav').hidden = true; status(''); }

/* ---------------- actions ---------------- */
const ACT = {
  async daily() { const r = await api('daily'); say(T('toast.claimed', { n: N(r.reward) }, '🎁 Claimed {n} MINER') + withUsd(r.reward) + (r.streak > 1 ? T('toast.streak', { n: r.streak }, ' · 🔥 {n}-day streak') : '')); await boot(); },
  async refFilter(d) {
    refFilter = d.f; document.querySelectorAll('[data-act=refFilter]').forEach((b) => { const on = b.dataset.f === d.f; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
    await loadRefs(true);
  },
  async moreRef() { refPage += 1; await loadRefs(false); },
  async watchAd(d, el) { await watchAd(el); },
  async promo() {
    const code = $('promo').value.trim(); if (!code) { say('Enter a promo code first'); return; }
    const r = await api('promoRedeem', { code }); $('promo').value = ''; say('🎟️ +' + N(r.reward) + ' MINER' + withUsd(r.reward) + ' added'); await boot(); await loadRewards();
  },
  async complete(d) { const r = await api('taskComplete', { taskId: Number(d.id) }); delete opened[d.id]; say('✅ Earned ' + N(r.reward) + ' MINER' + withUsd(r.reward)); await boot(); },
  openTaskLink(d, el) { const t = (data.tasks || []).find((x) => Number(x.id) === Number(d.id)); if (t) openUrl(t.link); },
  async openTask(d) {
    const id = Number(d.id), t = (data.tasks || []).find((x) => Number(x.id) === id); if (!t) return;
    openUrl(t.link); // open FIRST, right inside the tap (it used to wait for the server and then did nothing if that call failed)
    if (t.type === 'channel') { opened[id] = true; renderTasks(); return; }
    try {
      const r = await api('taskStart', { taskId: id });
      t.started_at = t.started_at || new Date().toISOString(); t.seconds_left = r.seconds_left; t.deadline = Date.now() + r.seconds_left * 1000;
    } catch (e) { say(e.message); }
    renderTasks();
  },
  tab(d, el) {
    filter = d.f; document.querySelectorAll('[role=tab]').forEach((b) => { const on = b === el; b.setAttribute('aria-selected', on); b.tabIndex = on ? 0 : -1; });
    $('tasklist').setAttribute('aria-labelledby', el.id); renderTasks();
  },
  async verify() { const r = await api('referralVerify'); if (r.verified) { gateMissing = null; say(r.reward_granted ? '✅ Verified — your inviter was rewarded' : '✅ Channels verified'); await boot(); } else { gateTitles = r.titles || {}; gateMissing = r.missing || []; renderVerify(); say('Join first: ' + r.missing.map(chName).join(', ')); } },
  openCh(d) { openUrl(chUrl(d.ch)); },
  openUrl(d) { openUrl(d.url); },
  openProofChannel() { openUrl(proofChannel); },
  async openOfficial() { openUrl((await getCommunity()).officialChannel.url); },
  async copyRef() { try { await navigator.clipboard.writeText($('refurl').textContent); say('Copied ✅'); } catch (e) { say('Copy failed'); } },
  shareRef() { if (!refLink) return; const u = 'https://t.me/share/url?url=' + encodeURIComponent(refLink) + '&text=' + encodeURIComponent('Mine MINER tokens 🚀'); if (tg?.openTelegramLink) tg.openTelegramLink(u); else window.open(u, '_blank', 'noopener'); },
  async moreTx() { const r = await api('history', { before: txNext }); renderTx(r.items, true); txNext = r.next; $('moreTx').hidden = !txNext; },
  async withdraw() { let r; try { r = await api('withdraw', { amount: $('amount').value, wallet: $('wallet').value }); } catch (e) { if (e.code === 'terms_required') { termsFrom = 'withdraw'; say(e.message); go('terms'); return; } throw e; } say('Withdrawal request #' + r.id + ' submitted - ' + r.net + ' MINER after fee'); $('amount').value = ''; $('wquote').textContent = ''; await boot(); await loadWithdraw(); },
  async cancelW(d) { if (!(await confirmAsk('Cancel this withdrawal? MINER will be refunded.'))) return; await api('withdrawCancel', { id: Number(d.id) }); say('Cancelled - MINER refunded'); await boot(); await loadWithdraw(); },
  async deposit() { const r = await api('depositSubmit', { methodId: $('depmethod').value, amount: $('depamount').value, txHash: $('txhash').value.trim(), from: $('depfrom').value.trim() }); say('Deposit #'+r.id+' submitted for admin review'); $('txhash').value = ''; $('depamount').value = ''; await loadDeposit(); },
  async recheckD(d) { const r = await api('depositRecheck', { id: Number(d.id) }); say(DS(r)); await boot(); await loadDeposit(); },
  async copyDep() { const m=(window.depositMethods||[]).find(x=>x.id===$('depmethod').value); if(!m)return; try { await navigator.clipboard.writeText(m.address); say('Address copied ✅'); } catch (e) { say('Copy failed'); } },
  async rankPage(d) { await loadRank(rankPage + Number(d.d)); window.scrollTo(0, 0); },
  botAdd() { waitBot = true; openUrl(data.bot_add_url); }, // Telegram's own "add bot as administrator" screen
  async botCheck() { const r = await api('channelBotCheck', { link: $('c_link').value }); if ($('c_botmsg')) $('c_botmsg').textContent = r.message; say(r.message); },
  async campaign() {
    const r = await api('campaignCreate', { type: $('c_type').value, title: $('c_title').value, link: $('c_link').value, reward: $('c_reward').value.trim(), target: $('c_target').value.trim() });
    say('Campaign #' + r.id + ' submitted for review'); ['c_title', 'c_link', 'c_reward', 'c_target'].forEach((k) => { $(k).value = ''; }); await boot(); await loadAds();
  },
  async cancelCamp(d) { if (!(await confirmAsk(d.st === 'active' ? 'Stop this campaign? Only the unused budget is refunded; completions already paid stay paid.' : 'Cancel this campaign? The full budget is refunded.'))) return; const r = await api('campaignCancel', { id: Number(d.id) }); say((d.st === 'active' ? 'Stopped' : 'Cancelled') + ' - ' + N(r.refunded_points) + ' MINER refunded'); await boot(); await loadAds(); },
  proofOpen(d) {
    const t = (data.tasks || []).find((x) => Number(x.id) === Number(d.id)); if (!t) return;
    proofTask = t; $('pf_title').textContent = t.title; $('pf_hint').textContent = t.proof_hint || 'Send what the task asks for (for example your @username).';
    $('pf_note').textContent = t.proof_status === 'rejected' ? 'Your last proof was rejected' + (t.proof_reason ? ': ' + t.proof_reason : '') + '. You can send a new one.' : '';
    $('pf_text').value = ''; go('taskproof');
  },
  proofOpenLink() { if (proofTask) openUrl(proofTask.link); },
  async proofSend() {
    if (!proofTask) { go('tasks'); return; }
    const txt = $('pf_text').value.trim(); if (txt.length < 3) { say('Write your proof first'); return; }
    await api('taskProofSubmit', { taskId: Number(proofTask.id), proof: txt }); proofTask = null; say('🧾 Proof sent — an admin will check it'); await boot(); go('tasks');
  },
  goRef() { go('ref'); },
  async missionClaim(d) { const r = await api('missionClaim', { mission: d.m }); say('🎯 +' + N(r.reward) + ' MINER' + withUsd(r.reward)); await boot(); await loadMissions(); },
  async termsAccept() { await api('termsAccept'); say('Thank you ✅'); await loadTerms(); if (termsFrom) { const f = termsFrom; termsFrom = null; go(f); } },
  async moreProof() { await loadProof(true); },
  async play(d) { await playGame(d); },
  async boost() {
    const b = gamesData && gamesData.booster; if (!b) return;
    if (!(await confirmAsk('Buy a ' + b.label + ' booster for ' + N(b.cost) + ' MINER? It lasts ' + b.hours + ' hours.'))) return;
    await api('boosterBuy'); say('⚡ Booster active'); await boot(); await loadGames();
  },
  async amClaim() {
    const r = await api('autoMinerClaim'); say('⛏️ +' + N(r.points) + ' MINER' + withUsd(r.points)); await boot(); await loadAutoMiner();
  },
  async amBuy(d) {
    const p = amData && amData.plans && amData.plans.find((x) => Number(x.id) === Number(d.id)); if (!p) return;
    const cost = p.price > 0 ? N(p.price) + ' MINER' : 'free';
    if (!(await confirmAsk('Buy ' + p.name + ' for ' + cost + '? It mines ' + N(p.rate_per_hour) + ' MINER per hour for ' + N(p.duration_days) + ' days.'))) return;
    const r = await api('autoMinerBuy', { plan_id: Number(d.id) }); say('🤖 ' + r.name + ' is mining'); await boot(); await loadAutoMiner();
  },
  async drawBuy(d) {
    const o = gamesData && gamesData.draw && gamesData.draw.open; if (!o) return;
    const n = Number(d.n), cost = n * o.ticket_price;
    if (!(await confirmAsk('Buy ' + n + ' ticket(s) for ' + N(cost) + ' MINER?'))) return;
    const r = await api('drawBuy', { tickets: n }); say('🎫 You now hold ' + r.tickets + ' ticket(s)'); await boot(); await loadGames();
  },
};
const INPUT = { quote: quoteW, adcalc: adcalc, depositMethod: updateDepositMethod, prefs: () => { savePrefs().catch((e) => say(e.message)); } };

/* ---------------- delegated events ---------------- */
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-go],[data-act]');
  if (!el || el.disabled || el.getAttribute('aria-disabled') === 'true') return;
  if (el.dataset.go) { go(el.dataset.go); return; }
  if (el.dataset.act === 'openCh' || el.dataset.act === 'openTaskLink') e.preventDefault();
  const fn = ACT[el.dataset.act];
  if (fn) {
    // Invoke immediately in the trusted click event. Deferring to a microtask
    // loses Telegram WebView user activation and can block openTelegramLink/openLink.
    try {
      const result = fn(el.dataset, el);
      Promise.resolve(result).catch((err) => say(err.message));
    } catch (err) {
      say(err.message);
    }
  }
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
