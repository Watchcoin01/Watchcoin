const API = window.WATCHCOIN_API || '/api';
const $ = (id) => document.getElementById(id);
const LVMIN = [['Bronze', 0], ['Silver', 500], ['Gold', 2000], ['Platinum', 10000]];
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const SV=p=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
const IC={tasks:SV('<path d="M9 11l3 3 8-8"/><path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9"/>'),wallet:SV('<path d="M3 7a2 2 0 0 1 2-2h13v4"/><path d="M3 7v11a2 2 0 0 0 2 2h15V9H5a2 2 0 0 1-2-2z"/><circle cx="16.5" cy="14.5" r="1"/>'),top:SV('<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/>'),me:SV('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'),premium:SV('<path d="M3 8l4 4 5-7 5 7 4-4-2 11H5z"/>'),admin:SV('<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>')};

/* ---------- languages and countries ----------
   All text lives in i18n.js (built from the i18n/ folder). t('key', {vars}) gives the text in the current language.
   Messages that come from the server are in English; srv() translates them, including ones with names and numbers. */
const L = window.WCI18N;
const SUPPORTED = L.LANGS.map((x) => x.code);
let tok = null, lang = 'en', S = {}, tab = 'tasks', am = 'login', cur = null, timer = null, pop = 0, pplan = 0, spinning = 0, delArm = 0;
const store = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) {} };
const load = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };

function t(k, v) {
  let s = (L.STR[lang] && L.STR[lang].ui[k]) || L.STR.en.ui[k] || k;
  if (v) s = s.replace(/\{(\w+)\}/g, (m, n) => (v[n] === undefined ? m : v[n]));
  return s;
}
const ACH_EN = Object.fromEntries(Object.keys(L.STR.en.ui).filter((k) => /^ach\.\w+\.t$/.test(k)).map((k) => [L.STR.en.ui[k], k]));
const SRV_TPL = Object.keys(L.STR.en.srv).filter((k) => k.includes('{')).map((k) => {
  const names = [], re = new RegExp('^' + k.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\{(\w+)\}/g, (m, n) => { names.push(n); return '(.+?)'; }) + '$');
  return { k, re, names };
});
function srv(msg) {
  if (!msg) return msg;
  const d = (L.STR[lang] || L.STR.en).srv;
  if (d[msg]) return d[msg];
  for (const tp of SRV_TPL) {
    const m = tp.re.exec(msg);
    if (!m) continue;
    const vals = {};
    tp.names.forEach((n, i) => { vals[n] = ACH_EN[m[i + 1]] ? t(ACH_EN[m[i + 1]]) : m[i + 1]; });
    return d[tp.k].replace(/\{(\w+)\}/g, (x, n) => vals[n]);
  }
  return msg; // unknown text, e.g. a message an admin wrote: shown as written
}
const locale = () => ({ zh: 'zh-CN', tw: 'en-GH', ha: 'ha-NG', sw: 'sw' }[lang] || lang);
const num = (n) => Number(n || 0).toLocaleString(locale());

// The country this device is in, worked out from its time zone (no location permission or outside service needed).
// ?country=TG in the address overrides it, which is handy for testing.
function detectCountry() {
  const q = (new URLSearchParams(location.search).get('country') || '').toUpperCase();
  if (/^[A-Z]{2}$/.test(q)) return q;
  try { const tz = Intl.DateTimeFormat().resolvedOptions().timeZone; if (L.TZ[tz]) return L.TZ[tz]; } catch (e) {}
  const r = (navigator.languages || [navigator.language || '']).map((x) => (x.split('-')[1] || '')).find((x) => x.length === 2);
  return r ? r.toUpperCase() : '';
}
const langForCountry = (c) => L.COUNTRY_LANG[c] || 'en';
function countryName(c) {
  try { return new Intl.DisplayNames([locale(), 'en'], { type: 'region' }).of(c) || c; } catch (e) { return c; }
}
function countryOptions(sel) {
  const list = L.COUNTRIES.map((c) => [c, countryName(c)]).sort((a, b) => a[1].localeCompare(b[1], locale()));
  return `<option value="">—</option>` + list.map(([c, n]) => `<option value="${c}" ${c === sel ? 'selected' : ''}>${esc(n)}</option>`).join('');
}

tok = load('wc_token');
S.country = detectCountry();
{ // first visit: no saved language yet, so use the official language of the visitor's country
  const q = new URLSearchParams(location.search).get('lang'), saved = load('wc_lang');
  lang = SUPPORTED.includes(q) ? q : SUPPORTED.includes(saved) ? saved : langForCountry(S.country);
}
const REF = new URLSearchParams(location.search).get('ref') || '';
if (REF) am = 'signup';
const eta = (x) => { const m = Math.max(0, Math.floor((new Date(x) - Date.now()) / 6e4)), d = Math.floor(m / 1440), h = Math.floor(m % 1440 / 60); return d ? t('eta.dh', { d, h }) : t('eta.hm', { h, m: m % 60 }); };
const dateStr = (x) => new Date(x).toLocaleDateString(locale());
const dateTimeStr = (x) => new Date(x).toLocaleString(locale(), { dateStyle: 'medium', timeStyle: 'short' });

function coverHTML(x){if(x.cover)return `<img class="cover" src="${esc(x.cover)}" alt="">`;let h=0;for(const c of x.title)h=(h*31+c.charCodeAt(0))%360;
 return `<div class="cover" style="background:linear-gradient(135deg,hsl(${h} 70% 45%),hsl(${(h+50)%360} 70% 30%))"><svg viewBox="0 0 24 24" fill="#fff"><path d="M8 5v14l11-7z"/></svg></div>`}

function confetti(){if(matchMedia('(prefers-reduced-motion:reduce)').matches)return;const c=['#F5B700','#2B4BFF','#1F9D6B','#C9344B','#fff'],h=document.querySelector('dialog[open]')||document.body;for(let i=0;i<40;i++){const e=document.createElement('i');e.className='cf';e.style.cssText=`left:${Math.random()*100}vw;background:${c[i%5]};animation-delay:${Math.random()*.4}s;--x:${Math.random()*160-80}px`;h.appendChild(e);setTimeout(()=>e.remove(),2600)}}

function toast(m) { const x = $('toast'); x.textContent = m; x.classList.add('on'); clearTimeout(toast.h); toast.h = setTimeout(() => x.classList.remove('on'), 3000); }
const err = (m) => { const e = $('err'); if (e) e.textContent = m; else toast(m); };

/* ---------- API ---------- */
async function api(method, path, body) {
  let r;
  try {
    r = await fetch(API + path, { method, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  } catch (e) { throw new Error(t('err.network')); }
  let j = {}; try { j = await r.json(); } catch (e) {}
  if (r.status === 401 && tok && !path.startsWith('/auth/')) { signOut(); throw new Error(srv(j.error) || t('err.relogin')); }
  if (!r.ok) throw Object.assign(new Error(srv(j.error) || t('err.generic')), { status: r.status, data: j });
  return j;
}
const all = async (m) => { const k = Object.keys(m), v = await Promise.all(k.map((x) => api('GET', m[x]))); k.forEach((x, i) => { S[x] = v[i]; }); };
function signOut() { tok = null; const c = S.country; S = { country: c }; store('wc_token', null); am = 'login'; R(); }

const TABQ = {
  tasks: { tasks: '/tasks', rw: '/rewards', ch: '/challenges', ln: '/launch' },
  premium: { pr: '/premium' }, wallet: { w: '/wallet' }, top: { lb: '/leaderboard' },
  me: { ach: '/achievements', rf: '/referrals', nt: '/notifications' },
};
async function go(x) {
  if (x) tab = x;
  try {
    await all({ me: '/me', ...(TABQ[tab] || {}) });
    S.fail = '';
    // The account's saved language wins once, when the app opens; after that the picker at the top decides.
    // A language picked on this device wins and is saved to the account; otherwise the account's language is used.
    if (S.me.user.lang !== lang && !store.synced) {
      if (load('wc_lang')) api('PATCH', '/me', { lang }).catch(() => {});
      else if (SUPPORTED.includes(S.me.user.lang)) setLang(S.me.user.lang, false);
    }
    store.synced = 1;
  } catch (e) { if (tok) S.fail = e.message; }
  R();
  if (x) window.scrollTo(0, 0);
  if (tab === 'me' && S.me && S.me.user.unreadNotifications) { api('POST', '/notifications/read').catch(() => {}); S.me.user.unreadNotifications = 0; }
}

// Switch the whole app to another language. save=true remembers it on this device and on the account.
function setLang(l, save = true) {
  if (!SUPPORTED.includes(l)) return;
  lang = l;
  if (save) { store('wc_lang', l); if (tok) api('PATCH', '/me', { lang: l }).catch(() => {}); }
  $('lg').value = l;
}

/* ---------- views ---------- */
function vAuth(m) {
  const s = am === 'signup', r = am === 'reset', p = S.pub;
  const landing = `<section style="padding:8px 0 20px"><h1 style="font-size:clamp(32px,8vw,52px);line-height:1.05">${t('land.title')}</h1><p style="font-size:18px;color:var(--mute);max-width:46ch">${t('land.sub')}</p><ol style="padding-left:20px;line-height:1.9"><li>${t('land.s1')}</li><li>${t('land.s2')}</li><li>${t('land.s3')}</li></ol>${p ? `<div class="meta" style="margin-bottom:12px">${t('land.stats', { members: num(p.members), earned: num(p.totalEarned), price: p.price })}</div>` : ''}<button class="btn" data-a="mode" data-v="signup" style="padding:14px 26px;font-size:17px">${t('land.cta')}</button><div><button class="link" data-a="about">${t('land.about')}</button></div></section>`;
  return landing + `<div class="card auth"><h2 style="font-size:26px">${s ? t('auth.create') : r ? t('auth.reset') : t('auth.login')}</h2>
${s ? `<label for="fN">${t('auth.name')}</label><input type="text" id="fN" autocomplete="name">` : ''}
<label for="fE">${t('auth.email')}</label><input type="email" id="fE" autocomplete="email">
${s ? `<label for="fK">${t('auth.country')}</label><select id="fK" autocomplete="country">${countryOptions(S.country)}</select><div class="meta" style="margin-top:4px">${t('auth.countryHint')}</div>` : ''}
${r ? `<label for="fR">${t('auth.recovery')}</label><input type="text" id="fR">` : ''}
<label for="fP">${r ? t('auth.newPassword') : t('auth.password')}</label><input type="password" id="fP" autocomplete="${s || r ? 'new-password' : 'current-password'}"><button class="link" type="button" data-a="pw">${t('auth.show')}</button>
${s ? `<label for="fC">${t('auth.invite')}</label><input type="text" id="fC" value="${esc(REF)}"><label style="display:flex;gap:8px;align-items:center;font-weight:400"><input type="checkbox" id="fT" style="width:auto"> ${t('auth.agree')} <button class="link" data-a="terms">${t('auth.terms')}</button></label>` : ''}
<div class="warn" id="err" role="alert">${esc(m || '')}</div>
<button class="btn" data-a="auth" style="margin-top:14px;width:100%">${s ? t('auth.signup') : r ? t('auth.reset') : t('auth.login')}</button>
<div style="display:flex;justify-content:space-between;margin-top:8px">${s || r ? `<button class="link" data-a="mode" data-v="login">${t('auth.back')}</button>` : `<button class="link" data-a="mode" data-v="signup">${t('auth.createAccount')}</button><button class="link" data-a="mode" data-v="reset">${t('auth.forgot')}</button>`}</div></div>`;
}

const wheel = (sp, lk) => {
  const W = sp.prizes, SG = 360 / W.length, rot = sp.spunToday ? 1800 - (sp.index * SG + SG / 2) : 0;
  const AN = (window.WCBeast && window.WCBeast.ANIMALS) || {}, an = sp.animals || [];
  return `<div class="wh${lk ? ' locked' : ''}"><b class="ptr" aria-hidden="true"><svg width="26" height="22" viewBox="0 0 26 22"><path d="M13 22L1 2h24z" fill="currentColor" stroke="#fff" stroke-width="2" stroke-linejoin="round"/></svg></b>${lk ? `<div class="lk"><svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg><span>${t('spin.lock')}</span></div>` : ''}<div id="wl" style="background:conic-gradient(${W.map((v, i) => `${(AN[an[i]] || {}).c || `hsl(${i * 51} 65% 48%)`} ${i * SG}deg ${(i + 1) * SG}deg`).join(',')});transform:rotate(${rot}deg)">${W.map((v, i) => `<span class="${an[i] === 'dragon' ? 'jp' : ''}" style="transform:rotate(${i * SG + SG / 2}deg) translateY(-82px)" title="${esc(t('an.' + an[i]))}"><i>${(AN[an[i]] || {}).e || ''}</i><b>${v}</b></span>`).join('')}</div></div>`;
};

function vTasks(u) {
  const T = S.tasks, st = S.rw.streak, sp = S.rw.spin, ln = S.ln, ok = sp.unlocked;
  const list = [...T.tasks].sort((a, b) => (a.status !== 'open') - (b.status !== 'open'));
  const launch = ln.launchAt ? (new Date(ln.launchAt) > new Date() ? t('launch.in', { t: eta(ln.launchAt) }) : t('launch.done')) : t('launch.soon');
  const spinMsg = sp.spunToday ? t('spin.won', { n: sp.prize }) : ok ? t('spin.ready') : t('spin.locked', { done: sp.tasksFinished || 0, total: sp.tasksTotal || T.total });
  return (u.onboarded ? '' : `<div class="card"><h3>${t('welcome.title')}</h3><ul class="meta" style="margin:6px 0 10px;padding-left:20px"><li>${t('welcome.1')}</li><li>${t('welcome.2')}</li><li>${t('welcome.3')}</li></ul><button class="btn" data-a="ob">${t('welcome.ok')}</button></div>`) +
  `<div class="card"><h3>${t('launch.title')}</h3><div class="meta">${t('launch.line', { status: launch, earned: num(ln.totalEarned), pos: ln.position })}</div></div>
<div class="card" style="display:flex;justify-content:space-between;align-items:center;gap:12px"><div><h3>${t('streak.title', { n: st.next })}</h3><div class="meta">${st.claimedToday ? t('streak.claimed') : t('streak.claim', { n: st.nextAmount })}</div></div>${st.claimedToday ? `<span class="done">${t('common.claimed')}</span>` : `<button class="btn" data-a="claim">${t('common.claim')}</button>`}</div>
<div class="card" style="text-align:center"><h3>${t('spin.title')}</h3>${wheel(sp, !ok && !sp.spunToday)}<div class="meta">${spinMsg}</div><button class="btn" data-a="spin" style="margin-top:12px;padding:12px 44px;font-size:17px" ${ok ? '' : 'disabled'}>${ok || sp.spunToday ? t('common.start') : t('spin.lock')}</button></div>
<div class="card"><h3>${t('chal.title')}</h3><div class="meta" style="margin-bottom:6px">${t('chal.resets')}</div>${S.ch.challenges.map((c) => `<div style="padding:10px 0;border-top:1px solid var(--line)"><div style="display:flex;justify-content:space-between;gap:10px;align-items:center"><div><b>${esc(t('chal.' + c.id) === 'chal.' + c.id ? c.title : t('chal.' + c.id))}</b><div class="meta">${t('chal.progress', { p: c.progress, t: c.target, r: c.reward })}</div></div>${c.claimed ? `<span class="done">${t('common.claimed')}</span>` : `<button class="btn" data-a="chal" data-v="${c.id}" ${c.claimable ? '' : 'disabled'}>${t('common.claim')}</button>`}</div><div class="bar" style="margin:8px 0 0"><i style="width:${c.progress / c.target * 100}%"></i></div></div>`).join('')}</div>
<div class="daily"><h2>${t('tasks.today')}</h2><span class="meta">${t('tasks.newIn', { t: eta(T.resetsAt) })}</span></div>
<div class="meta">${t('tasks.progress', { done: T.done, total: T.total, bonus: T.allDoneBonus })}${T.potentialLeft ? ` · ${t('tasks.left', { n: T.potentialLeft })}` : ''}</div><div class="bar"><i style="width:${T.total ? T.done / T.total * 100 : 0}%"></i></div>` +
  (list.length ? '<div class="tg vg">' + list.map((x) => `<div class="task ${x.status !== 'open' ? 'isdone' : ''}"><div class="cw">${coverHTML(x)}<span class="rw">+${x.reward}</span></div><div class="tb"><h3><span class="chip">${t('type.' + x.type)}</span>${x.premium ? `<span class="chip" style="background:var(--gold);color:#3a2800">${t('tasks.premium')}</span>` : ''}${esc(x.title)}</h3><div class="pill"><span class="meta" style="font-weight:500">≈ ${x.rewardUsdt.toFixed(4)} USDT</span>${x.doubleUntil ? `<span class="chip" style="margin:0 0 0 6px">${t('tasks.double', { t: eta(x.doubleUntil) })}</span>` : ''}${x.secs ? `<span class="meta" style="font-weight:400">· ${x.secs}s</span>` : ''}</div></div><div class="act">${x.status === 'done' ? `<span class="done">${t('tasks.earned')}</span>` : x.status === 'missed' ? `<span class="meta">${t('tasks.missed')}</span>` : x.status === 'closed' ? `<span class="meta">${t('tasks.closed')}</span>` : `<button class="btn" data-a="start" data-v="${x.id}">${t('common.start')}</button>`}</div></div>`).join('') + '</div>' : `<div class="empty">${t('tasks.none')}</div>`);
}

const planName = (p) => (p.id === 0 ? t('prem.free') : p.name);
function vPrem(u) {
  const P = S.pr, p = P.current.id;
  return `<div class="daily"><h2>${t('prem.title')}</h2></div><div class="card"><h3>${t('prem.yourPlan', { name: planName(P.current) })}</h3><div class="meta">${t('prem.perDay', { n: u.plan.tasksPerDay })}${p ? ` · ${t('prem.expires', { date: dateStr(P.current.expiresAt) })}` : ''}${P.pending ? ` · ${t('prem.pending')}` : ''}</div></div>
<div class="tg">${P.plans.map((l) => `<div class="card" style="margin:0;${l.id === p ? 'border-color:var(--gold)' : ''}"><h3>${esc(planName(l))}</h3><div class="disp" style="font-size:30px;margin:6px 0">${l.priceUsdt ? l.priceUsdt + ' USDT' : t('prem.free')}</div><div class="meta">${l.priceUsdt ? t('prem.forDays', { n: l.days }) : t('prem.always')}</div><ul class="meta" style="padding-left:18px"><li>${t('prem.tasksEvery', { n: l.tasksPerDay })}</li><li>${t('prem.earnUpTo', { w: l.maxWtcPerDay, u: l.maxUsdtPerDay.toFixed(2) })}</li>${l.id ? `<li>${t('prem.premiumTasks')}</li>` : ''}</ul>${l.id === p ? `<span class="done">${t('prem.current')}</span>` : l.id < p || !l.id ? '' : `<button class="btn" style="width:100%" data-a="buy" data-v="${l.id}" ${P.pending ? 'disabled' : ''}>${t('prem.upgradeTo', { name: l.name })}</button>`}</div>`).join('')}</div>
${P.requests.length ? `<div class="card" style="margin-top:12px"><h3>${t('prem.requests')}</h3>${P.requests.slice(0, 3).map((x) => `<div class="row"><span>${esc(P.plans[x.plan].name)}</span><span class="meta">${t('status.' + x.status)}</span></div>`).join('')}</div>` : ''}`;
}

function histLabel(h) {
  if (h.kind === 'task') return h.note || t('type.watch');
  if (h.kind === 'referral') { const m = /^(.*) finished their first task$/.exec(h.note || ''); return m ? t('kind.referral', { name: m[1] }) : t('kind.referral0'); }
  if (h.kind === 'adjust') return t('kind.adjust') + (h.note ? ': ' + h.note : '');
  const k = 'kind.' + h.kind;
  return t(k) === k ? (h.note || h.kind) : t(k);
}
function vWallet(u) {
  const w = S.w, soon = (title, d) => `<div class="card" style="opacity:.85"><div style="display:flex;justify-content:space-between;align-items:center"><h3>${title}</h3><span class="chip" style="margin:0">${t('common.comingSoon')}</span></div><p class="meta" style="margin:6px 0 12px">${d}</p><button class="btn" disabled>${title}</button></div>`;
  return `<div class="stats"><div class="card"><span class="meta">${t('wal.today')}</span><b>${num(w.earnedToday)}</b><span class="meta">≈ ${(w.earnedToday * w.price).toFixed(4)} USDT</span></div><div class="card"><span class="meta">${t('wal.all')}</span><b>${num(w.earnedAllTime)}</b><span class="meta">≈ ${w.earnedAllTimeUsdt.toFixed(4)} USDT</span></div></div>
<p class="meta">${t('wal.note')} <button class="link" data-a="about" style="padding:0">${t('wal.about')}</button></p>${soon(t('wal.transfer'), t('wal.transferD'))}${soon(t('wal.convert'), t('wal.convertD'))}
<div class="card"><h3 style="margin-bottom:6px">${t('wal.activity')}</h3>${w.history.length ? w.history.map((h) => `<div class="row"><div><div>${esc(histLabel(h))}</div><div class="meta">${dateTimeStr(h.createdAt)}</div></div><span class="${h.amount > 0 ? 'plus' : 'meta'}">${h.amount > 0 ? '+' : ''}${num(h.amount)}</span></div>`).join('') : `<div class="empty">${t('wal.empty')}</div>`}</div>`;
}

const vTop = (u) => `<div class="daily"><h2>${t('top.title')}</h2></div><div class="card">${S.lb.top.map((x) => `<div class="row" ${x.name === u.name ? 'style="font-weight:700"' : ''}><span><span class="rk r${x.rank - 1}">${x.rank}</span>${esc(x.avatar || '')} ${esc(x.name)}${x.name === u.name ? ' ' + t('top.you') : ''}</span><span class="plus">${num(x.score)} WTC</span></div>`).join('')}${S.lb.me && S.lb.me.rank > 10 ? `<div class="row" style="font-weight:700"><span><span class="rk">${S.lb.me.rank}</span>${t('top.You')}</span><span class="plus">${num(S.lb.me.score)} WTC</span></div>` : ''}</div>`;

function vMe(u) {
  const rf = S.rf, a = S.ach.achievements, un = u.level.next;
  return `<div class="card"><h3>${esc(u.avatar || '')} ${esc(u.name)}</h3><div class="meta">${esc(u.email)}${u.role !== 'user' ? ' · ' + esc(u.role) : ''}${u.country ? ' · ' + esc(countryName(u.country)) : ''}${u.emailVerified ? '' : ' · ' + t('me.unverified')}</div><div class="meta">${t('me.levelLine', { level: t('lvl.' + u.level.name), p: Math.round(u.level.boost * 100) })}${un ? ` · ${t('hero.toNext', { n: num(un.remaining), name: t('lvl.' + un.name) })}` : ''}</div></div>
<div class="card"><h3>${t('me.ach')}</h3><div class="meta" style="margin-bottom:10px">${t('me.achCount', { n: a.filter((x) => x.unlocked).length, t: a.length })}</div><div class="ag">${a.map((x) => `<div class="ab ${x.unlocked ? 'on' : ''}"><span>${{ first: '🎯', t10: '🔟', s3: '🔥', s7: '🏅', ref: '🤝', spin: '🎡', k1: '💰', gold: '🥇' }[x.key] || '⭐'}</span><b>${esc(t('ach.' + x.key + '.t'))}</b><small>${esc(t('ach.' + x.key + '.d'))}</small></div>`).join('')}</div></div>
<div class="card"><h3>${t('me.invite', { n: rf.rewardPerFriend })}</h3><p class="meta" style="margin:4px 0">${t('me.inviteD', { n: rf.rewardPerFriend, c: rf.friends.length })}</p><input type="text" readonly value="${esc(rf.link)}" aria-label="${t('me.inviteLink')}"><div style="margin-top:10px"><button class="btn" data-a="copy" data-v="${esc(rf.link)}">${t('me.copy')}</button> <button class="btn ghost" data-a="share" data-v="wa">WhatsApp</button> <button class="btn ghost" data-a="share" data-v="tg">Telegram</button> <button class="btn ghost" data-a="share" data-v="x">X</button></div>${rf.friends.map((x) => `<div class="row"><span>${esc(x.name)}</span><span class="meta">${x.active ? t('me.friendActive', { n: rf.rewardPerFriend }) : t('me.friendNew')}</span></div>`).join('')}</div>
<div class="card"><h3 style="margin-bottom:6px">${t('me.notes')}</h3>${S.nt.notifications.length ? S.nt.notifications.slice(0, 30).map((x) => `<div class="row ${x.read ? '' : 'unread'}"><span>${esc(srv(x.message))}</span><span class="meta">${dateStr(x.createdAt)}</span></div>`).join('') : `<div class="empty">${t('me.nothing')}</div>`}</div>
<div class="card"><h3>${t('me.profile')}</h3><label>${t('me.avatar')}</label><div>${['🦊', '🐼', '🦁', '🐯', '🐸', '🦄', '🐙', '🚀'].map((e) => `<button class="btn ghost" data-a="av" data-v="${e}" aria-label="${t('me.avatar')} ${e}" style="padding:6px 10px;font-size:20px;${u.avatar === e ? 'border-color:var(--acc)' : ''}">${e}</button>`).join(' ')}</div>
<label for="pN">${t('me.name')}</label><input type="text" id="pN" value="${esc(u.name)}"><button class="btn" data-a="sn" style="margin-top:10px">${t('me.saveName')}</button>
<label for="pK">${t('me.country')}</label><select id="pK" autocomplete="country">${countryOptions(u.country || '')}</select>
<label for="pO">${t('me.curPw')}</label><input type="password" id="pO" autocomplete="current-password"><label for="pW">${t('me.newPw')}</label><input type="password" id="pW" autocomplete="new-password"><button class="btn" data-a="cp" style="margin-top:10px">${t('me.changePw')}</button>
<hr style="border:0;border-top:1px solid var(--line);margin:18px 0"><button class="btn ghost" data-a="dacc" style="color:var(--bad)">${t('me.delete')}</button><p class="meta">${t('me.deleteHint')}</p></div>
<div class="card"><h3>${t('me.report')}</h3><input type="text" id="sM" placeholder="${esc(t('me.reportPh'))}"><button class="btn" data-a="ticket" style="margin-top:10px">${t('common.send')}</button></div>
<div class="card"><h3>${t('me.rem')}</h3><p class="meta" style="margin:4px 0 10px">${t('me.remD')}</p><button class="btn ghost" data-a="rem">${t('me.remOn')}</button></div>
<button class="btn ghost" data-a="out">${t('me.logout')}</button> <button class="link" data-a="terms">${t('me.terms')}</button> <button class="link" data-a="about">${t('me.aboutWtc')}</button>`;
}

// Fixed text in index.html (dialogs, buttons) carries data-i18n="key" and is filled in here.
function applyStatic() {
  document.documentElement.lang = lang;
  document.querySelectorAll('[data-i18n]').forEach((e) => { e.textContent = t(e.dataset.i18n); });
  document.querySelectorAll('[data-i18n-label]').forEach((e) => { e.setAttribute('aria-label', t(e.dataset.i18nLabel)); });
}

function R() {
  applyStatic();
  const u = S.me && S.me.user;
  if (!tok || !u) { $('app').innerHTML = vAuth(S.authErr || ''); S.authErr = ''; return; }
  if (S.fail) { $('app').innerHTML = `<div class="card"><h3>${t('common.couldNotLoad')}</h3><p class="meta">${esc(S.fail)}</p><button class="btn" data-a="retry">${t('common.tryAgain')}</button></div>`; return; }
  const tabs = [['tasks', t('nav.tasks')], ['premium', t('nav.premium')], ['wallet', t('nav.wallet')], ['top', t('nav.top')], ['me', t('nav.me') + (u.unreadNotifications ? ` (${u.unreadNotifications})` : '')]];
  let lo = 0, hi = null; LVMIN.forEach((l, i) => { if (u.lifetime >= l[1]) { lo = l[1]; hi = LVMIN[i + 1] ? LVMIN[i + 1][1] : null; } });
  const pc = hi ? Math.round((u.lifetime - lo) / (hi - lo) * 100) : 100, dataReady = !!S[{ tasks: 'tasks', premium: 'pr', wallet: 'w', top: 'lb', me: 'ach' }[tab]];
  const body = !dataReady ? `<div class="empty">${t('common.loading')}</div>` : tab === 'tasks' ? vTasks(u) : tab === 'premium' ? vPrem(u) : tab === 'wallet' ? vWallet(u) : tab === 'top' ? vTop(u) : vMe(u);
  $('app').innerHTML = `<section class="hero" aria-live="polite"><div class="hh"><span>${esc(u.avatar || '')} ${esc(u.name)}</span><span class="lv">${t('lvl.' + u.level.name)}</span>${u.plan.id ? `<span class="lv" style="background:#fff">${esc(u.plan.name)}</span>` : ''}</div><div class="bal-l">${t('hero.balance')}</div><div class="bal ${pop ? 'pop' : ''}">${num(u.balance)}<small>WTC</small></div><div class="usd">≈ ${u.balanceUsdt.toFixed(4)} USDT</div><div class="lvb"><i style="width:${pc}%"></i></div><div class="bal-l">${u.level.next ? t('hero.toNext', { n: num(u.level.next.remaining), name: t('lvl.' + u.level.next.name) }) : t('hero.topLevel')}</div><span class="coin big" aria-hidden="true">W</span></section>
<nav aria-label="Main">${tabs.map((x) => `<button data-a="tab" data-v="${x[0]}" ${x[0] === tab ? 'aria-current="page"' : ''}>${IC[x[0]]}<span>${x[1]}</span></button>`).join('')}</nav>` + body;
  pop = 0;
}

/* ---------- task flow ---------- */
function openTask(id) {
  const x = S.tasks.tasks.find((y) => y.id === +id); if (!x) return;
  cur = { t: x };
  $('dT').textContent = x.title;
  $('dD').textContent = t('dlg.' + x.type, { s: x.secs });
  $('dQ').innerHTML = ''; $('dB').style.width = '0'; $('dS').textContent = t('dlg.reward', { n: x.reward, u: x.rewardUsdt.toFixed(4) });
  $('dGo').hidden = false; $('dGo').disabled = false; $('dGo').textContent = x.type === 'poll' ? t('dlg.answerPoll') : t('dlg.open');
  $('dlg').showModal();
}
async function beginTask() {
  const x = cur.t; $('dGo').disabled = true;
  try { cur.s = await api('POST', `/tasks/${x.id}/start`); } catch (e) { toast(e.message); $('dlg').close(); return; }
  if (x.type === 'poll') return quiz();
  window.open(cur.s.url, '_blank', 'noopener');
  let left = cur.s.secs; $('dGo').textContent = t('dlg.watching'); $('dS').textContent = t('dlg.left', { s: left }); $('dB').style.width = '0';
  requestAnimationFrame(() => { $('dB').style.width = 100 / cur.s.secs + '%'; });
  clearInterval(timer);
  timer = setInterval(() => { left--; $('dB').style.width = (cur.s.secs - left + 1) / cur.s.secs * 100 + '%'; $('dS').textContent = left > 0 ? t('dlg.left', { s: left }) : t('dlg.timeUp'); if (left <= 0) { clearInterval(timer); cur.s.question ? quiz() : finish(); } }, 1000);
}
function quiz() {
  $('dGo').hidden = true; $('dS').textContent = '';
  $('dQ').innerHTML = `<h3 style="font-size:17px;margin:12px 0 8px">${esc(cur.s.question)}</h3>` + cur.s.options.map((o, i) => `<button class="btn ghost opt" data-a="ans" data-v="${i}">${esc(o)}</button>`).join('');
}
async function finish(answer) {
  const x = cur.t;
  try {
    const r = await api('POST', `/tasks/${x.id}/complete`, answer === undefined ? undefined : { answer });
    $('dlg').close();
    if (r.ok) { pop = 1; toast(t('task.toast', { n: r.reward })); confetti(); (r.achievements || []).forEach((k) => setTimeout(() => toast(t('ach.toast', { t: t('ach.' + k + '.t') })), 3200)); }
    else toast(srv(r.message));
  } catch (e) {
    if (e.data && e.data.waitMs) return setTimeout(() => finish(answer), e.data.waitMs + 300);
    $('dlg').close(); toast(e.message);
  }
  go();
}
async function doSpin() {
  if (spinning) return;
  const media = (S.rw && S.rw.spin && S.rw.spin.media) || {};
  if (window.WCBeast) window.WCBeast.prime(Object.values(media)[0]); // must happen inside the tap, so the clip may play with sound
  try {
    const r = await api('POST', '/rewards/spin'), SG = 360 / r.prizes.length, l = $('wl');
    const won = r.animal || (r.animals || [])[r.index], clip = media[won] ? API.replace(/\/api$/, '') + media[won] : null;
    if (clip && window.WCBeast) window.WCBeast.preload(clip); // download while the wheel spins
    spinning = 1; document.querySelector('[data-a=spin]').disabled = true;
    // People who asked their phone for less motion get a shorter spin with fewer turns. Both end at the same angle
    // (a whole number of turns), so the wheel looks identical when the screen redraws afterwards.
    const calm = matchMedia('(prefers-reduced-motion:reduce)').matches, secs = calm ? 2 : 4, turns = calm ? 1080 : 1800;
    l.style.transition = 'none'; l.style.transform = 'rotate(0deg)'; void l.offsetWidth;
    l.style.transition = `transform ${secs}s cubic-bezier(.12,.7,.1,1)`; l.style.transform = `rotate(${turns - (r.index * SG + SG / 2)}deg)`;
    setTimeout(async () => {
      const animal = r.animal || (r.animals || [])[r.index] || 'goat';
      if (window.WCBeast) await window.WCBeast.play({ animal, video: clip, prize: r.prize, name: t('an.' + animal), title: animal === 'dragon' ? t('spin.jackpot') : t('an.' + animal), hint: t('spin.tap') });
      else confetti();
      spinning = 0; pop = 1; await go(); toast(t('spin.toast', { n: r.prize }));
    }, secs * 1000 + 200);
  } catch (e) { toast(e.message); }
}

/* ---------- actions ---------- */
const ADM = async (fn, ok) => { try { await fn(); if (ok) toast(t(ok)); go(); } catch (e) { toast(e.message); } };
// Accounts with two-step login on need a code from their authenticator app after the password.
async function second(r) {
  if (!r.twoFactorRequired) return r;
  const code = (prompt(t('auth.code2fa')) || '').trim();
  if (!code) { err(t('auth.need2fa')); return null; }
  return { ...(await api('POST', '/auth/login/2fa', { challenge: r.challenge, code })), recoveryCode: r.recoveryCode };
}
function showRecovery(code) { $('rcC').textContent = code; $('rc').showModal(); }
async function auth() {
  const v = (i) => ($(i) ? $(i).value.trim() : ''), email = v('fE').toLowerCase(), password = $('fP').value;
  if (!/^\S+@\S+\.\S+$/.test(email)) return err(t('auth.badEmail'));
  if (password.length < 6) return err(t('auth.shortPw'));
  try {
    let r;
    if (am === 'signup') {
      if (!v('fN')) return err(t('auth.noName'));
      if (!$('fT').checked) return err(t('auth.noTerms'));
      r = await api('POST', '/auth/signup', { name: v('fN'), email, password, inviteCode: v('fC') || undefined, country: v('fK') || undefined, lang });
      store('wc_lang', lang);
    } else if (am === 'reset') {
      r = await second(await api('POST', '/auth/reset-password', { email, recoveryCode: v('fR'), newPassword: password }));
      if (!r) return;
      tok = r.token; store('wc_token', tok); await go('tasks'); return showRecovery(r.recoveryCode);
    } else if (!(r = await second(await api('POST', '/auth/login', { email, password })))) return;
    tok = r.token; store('wc_token', tok); S.me = { user: r.user };
    await go('tasks');
    if (r.recoveryCode) showRecovery(r.recoveryCode);
  } catch (e) { err(e.message); }
}
function aboutHTML(launchAt, price) {
  const launch = launchAt ? (new Date(launchAt) > new Date() ? t('about.launchIn', { t: eta(launchAt) }) : t('about.launched')) : t('about.launchSoon');
  return `<h2>${t('about.title')}</h2>
<p>${t('about.p1')}</p>
<h3 style="margin-top:14px">${t('about.how')}</h3>
<ul class="meta" style="padding-left:20px;margin:6px 0">
<li>${t('about.h1')}</li><li>${t('about.h2')}</li><li>${t('about.h3')}</li><li>${t('about.h4')}</li><li>${t('about.h5')}</li></ul>
<h3 style="margin-top:14px">${t('about.launchH')}</h3>
<p class="meta">${t('about.launchP', { launch })}</p>
<h3 style="margin-top:14px">${t('about.usdtH')}</h3>
<p class="meta">${t('about.usdtP', { p: price || '—' })}</p>
<div class="card" style="border-color:var(--gold);margin:14px 0 0"><h3>${t('about.readH')}</h3>
<p class="meta" style="margin:0">${t('about.readP')}</p></div>
<h3 style="margin-top:14px">${t('about.fairH')}</h3>
<p class="meta">${t('about.fairP')}</p>
<div class="mfoot" style="margin-top:16px"><button class="btn" data-a="aclose" style="width:100%">${t('common.close')}</button></div>`;
}
const SHARE = (v) => { const l = encodeURIComponent(S.rf.link), m = encodeURIComponent(t('share.msg')); return { wa: `https://wa.me/?text=${m}%20${l}`, tg: `https://t.me/share/url?url=${l}&text=${m}`, x: `https://twitter.com/intent/tweet?text=${m}&url=${l}` }[v]; };

// Re-render the sign-up form without losing what the person already typed.
function rerenderKeepingForm() {
  const ids = ['fN', 'fE', 'fP', 'fC', 'fR'], vals = Object.fromEntries(ids.map((i) => [i, $(i) ? $(i).value : null]));
  const terms = $('fT') ? $('fT').checked : false, pwType = $('fP') ? $('fP').type : 'password';
  R();
  ids.forEach((i) => { if ($(i) && vals[i] !== null) $(i).value = vals[i]; });
  if ($('fT')) $('fT').checked = terms;
  if ($('fP')) $('fP').type = pwType;
}

const A = {
  tab: (v) => go(v), mode: (v) => { am = v; rerenderKeepingForm(); }, auth, retry: () => go(),
  pw: (v, b) => { const i = $('fP'); i.type = i.type === 'password' ? 'text' : 'password'; b.textContent = i.type === 'password' ? t('auth.show') : t('auth.hide'); },
  start: (v) => openTask(v), ans: (v) => finish(+v), spin: doSpin,
  claim: () => ADM(async () => { const r = await api('POST', '/rewards/streak/claim'); pop = 1; toast(t('streak.toast', { n: r.amount })); confetti(); }),
  chal: (v) => ADM(async () => { const r = await api('POST', `/challenges/${v}/claim`); pop = 1; toast(t('chal.toast', { n: r.reward })); confetti(); }),
  ob: () => ADM(() => api('PATCH', '/me', { onboarded: true })),
  av: (v) => ADM(() => api('PATCH', '/me', { avatar: v })),
  sn: () => ADM(() => api('PATCH', '/me', { name: $('pN').value }), 'me.nameSaved'),
  cp: () => ADM(async () => { const r = await api('POST', '/me/password', { currentPassword: $('pO').value, newPassword: $('pW').value }); tok = r.token; store('wc_token', tok); }, 'me.pwChanged'),
  dacc: async () => {
    if (!$('pO').value) return toast(t('me.deleteNeedPw'));
    if (!delArm) { delArm = 1; return toast(t('me.deleteConfirm')); }
    delArm = 0; try { await api('DELETE', '/me', { password: $('pO').value }); signOut(); } catch (e) { toast(e.message); }
  },
  ticket: () => ADM(() => api('POST', '/support', { message: $('sM').value }), 'me.reportSent'),
  rem: () => { if (!window.Notification) return toast(t('me.remUnsupported')); Notification.requestPermission().then((p) => toast(p === 'granted' ? t('me.remYes') : t('me.remNo'))); },
  copy: (v) => { try { navigator.clipboard.writeText(v); toast(t('me.copied')); } catch (e) { toast(t('me.copyFail')); } },
  share: (v) => window.open(SHARE(v), '_blank', 'noopener'),
  about: async () => { try { S.pub = await api('GET', '/public/stats'); } catch (e) { /* show what we know */ } const p = S.pub || {}; $('abB').innerHTML = aboutHTML(p.launchAt, p.price); $('ab').showModal(); }, aclose: () => $('ab').close(),
  out: () => signOut(), terms: () => $('tm').showModal(), tclose: () => $('tm').close(), rclose: () => $('rc').close(),
  buy: (v) => { const p = S.pr.plans[+v]; pplan = +v; $('pT').textContent = t('prem.upgradeTo', { name: p.name }); $('pA').textContent = t('pay.amount', { p: p.priceUsdt, d: p.days }); $('pD').textContent = S.pr.paymentInfo; $('pR').value = '';
    const o = S.pr.onlinePayment || {}, pr = o.enabled && o.prices.find((x) => x.plan === pplan);
    $('pK').hidden = !pr; if (pr) $('pK').textContent = t('pay.online', { a: pr.amount.toFixed(2), c: o.currency });
    if (pr) $('pD').textContent = t('pay.manual', { info: S.pr.paymentInfo });
    $('py').showModal(); },
  paynow: async (v, b) => { b.disabled = true; try { const r = await api('POST', '/premium/checkout', { plan: pplan }); location.href = r.authorizationUrl; } catch (e) { toast(e.message); b.disabled = false; } },
  pclose: () => $('py').close(),
  pay: async () => { try { await api('POST', '/premium/upgrade', { plan: pplan, reference: $('pR').value.trim() }); $('py').close(); toast(t('pay.sent')); go(); } catch (e) { toast(e.message); } },
};
document.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b && b.dataset.a && A[b.dataset.a]) A[b.dataset.a](b.dataset.v, b); });
document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.closest('.auth')) auth(); });
document.addEventListener('change', (e) => {
  // Picking a country switches the app to that country's official language.
  if (e.target.id === 'fK') { S.country = e.target.value; setLang(langForCountry(S.country)); rerenderKeepingForm(); }
  if (e.target.id === 'pK') { const c = e.target.value || null; setLang(langForCountry(c)); ADM(() => api('PATCH', '/me', { country: c, lang }), 'me.countrySaved'); }
});
$('dGo').onclick = beginTask; $('dX').onclick = () => { clearInterval(timer); $('dlg').close(); }; $('dlg').addEventListener('cancel', () => clearInterval(timer));
$('theme').onclick = () => { const r = document.documentElement, d = r.dataset.theme ? r.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme:dark)').matches; r.dataset.theme = d ? 'light' : 'dark'; };
$('lg').innerHTML = L.LANGS.map((x) => `<option value="${x.code}">${esc(x.name)}</option>`).join('');
$('lg').value = lang;
$('lg').onchange = () => { setLang($('lg').value); if ($('fN') || $('fE')) rerenderKeepingForm(); else R(); };

/* ---------- start ---------- */
// Back from the payment page: ask the server whether the payment went through.
async function checkPaid() {
  const ref = new URLSearchParams(location.search).get('paid') || new URLSearchParams(location.search).get('reference');
  if (!ref || !tok) return;
  history.replaceState(null, '', location.pathname);
  try {
    const r = await api('GET', '/premium/checkout/' + encodeURIComponent(ref));
    toast(r.status === 'success' ? t('pay.ok', { plan: r.plan }) : r.status === 'pending' ? t('pay.processing') : r.status === 'review' ? t('pay.review') : t('pay.failed'));
    go('premium');
  } catch (e) { toast(e.message); }
}

(async function boot() {
  if (tok) { await go('tasks'); checkPaid(); }
  else { R(); try { S.pub = await api('GET', '/public/stats'); } catch (e) {} rerenderKeepingForm(); }
  setInterval(() => { if (tok && tab === 'tasks' && !spinning && !$('dlg').open) go(); }, 60000);
  setInterval(() => { const x = S.rw; if (x && window.Notification && Notification.permission === 'granted' && !x.streak.claimedToday && new Date().getHours() >= 18) new Notification('Watchcoin', { body: t('me.remNotify') }); }, 36e5);
})();
