const API = window.WATCHCOIN_API || '/api';
const $ = (id) => document.getElementById(id);
const LVMIN = [['Bronze', 0], ['Silver', 500], ['Gold', 2000], ['Platinum', 10000]];
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const TY={watch:'Watch',like:'Like',subscribe:'Subscribe',poll:'Poll'};
const SV=p=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
const IC={tasks:SV('<path d="M9 11l3 3 8-8"/><path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9"/>'),wallet:SV('<path d="M3 7a2 2 0 0 1 2-2h13v4"/><path d="M3 7v11a2 2 0 0 0 2 2h15V9H5a2 2 0 0 1-2-2z"/><circle cx="16.5" cy="14.5" r="1"/>'),top:SV('<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/>'),me:SV('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'),premium:SV('<path d="M3 8l4 4 5-7 5 7 4-4-2 11H5z"/>'),admin:SV('<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>')};

const I={fr:{Tasks:'Tâches',Wallet:'Portefeuille',Top:'Classement',Me:'Moi',Admin:'Admin',"Today's tasks":'Tâches du jour',Start:'Commencer',Earned:'Gagné',Claim:'Récupérer','Log in':'Se connecter','Sign up':"S'inscrire",'Create your account':'Créez votre compte',Email:'E-mail',Password:'Mot de passe',Name:'Nom','Log out':'Se déconnecter',', your balance':', votre solde','Coming soon':'Bientôt disponible',Activity:'Activité',Closed:'Fermé'},
ha:{Tasks:'Ayyuka',Wallet:'Walat',Top:'Gaba',Me:'Ni',"Today's tasks":'Ayyukan yau',Start:'Fara',Earned:'An samu',Claim:'Karɓa','Log in':'Shiga','Sign up':'Yi rajista','Create your account':'Buɗe asusunka',Email:'Imel',Password:'Kalmar sirri',Name:'Suna','Log out':'Fita',', your balance':', adadin ka','Coming soon':'Yana zuwa','Activity':'Tarihi',Closed:'An rufe'},
tw:{Tasks:'Nnwuma',Wallet:'Sika kotoku',Top:'Atifi',Me:'Me',"Today's tasks":'Ɛnnɛ nnwuma',Start:'Fi ase',Earned:'Woanya',Claim:'Fa','Log in':'Kɔ mu','Sign up':'Hyɛ nsa din','Create your account':'Bue wo akontaabu',Email:'Email',Password:'Nsɛmfua kokoam',Name:'Din','Log out':'Fi mu',', your balance':', wo sika dodow','Coming soon':'Ɛreba',Activity:'Nsɛm a atwa',Closed:'Wɔato mu'}};

function coverHTML(t){if(t.cover)return `<img class="cover" src="${t.cover}" alt="">`;let h=0;for(const c of t.title)h=(h*31+c.charCodeAt(0))%360;
 return `<div class="cover" style="background:linear-gradient(135deg,hsl(${h} 70% 45%),hsl(${(h+50)%360} 70% 30%))"><svg viewBox="0 0 24 24" fill="#fff"><path d="M8 5v14l11-7z"/></svg></div>`}

function confetti(){if(matchMedia('(prefers-reduced-motion:reduce)').matches)return;const c=['#F5B700','#2B4BFF','#1F9D6B','#C9344B','#fff'],h=document.querySelector('dialog[open]')||document.body;for(let i=0;i<40;i++){const e=document.createElement('i');e.className='cf';e.style.cssText=`left:${Math.random()*100}vw;background:${c[i%5]};animation-delay:${Math.random()*.4}s;--x:${Math.random()*160-80}px`;h.appendChild(e);setTimeout(()=>e.remove(),2600)}}


let tok = null, lang = 'en', S = {}, tab = 'tasks', am = 'login', cur = null, timer = null, pop = 0, pplan = 0, spinning = 0, delArm = 0;
try { tok = localStorage.getItem('wc_token'); lang = localStorage.getItem('wc_lang') || 'en'; } catch (e) {}
const tr = (k) => (I[lang] && I[lang][k]) || k;
const REF = new URLSearchParams(location.search).get('ref') || '';
if (REF) am = 'signup';
const eta = (t) => { const m = Math.max(0, Math.floor((new Date(t) - Date.now()) / 6e4)), d = Math.floor(m / 1440), h = Math.floor(m % 1440 / 60); return d ? `${d}d ${h}h` : `${h}h ${m % 60}m`; };
const store = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) {} };

function toast(m) { const t = $('toast'); t.textContent = m; t.classList.add('on'); clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove('on'), 3000); }
const err = (m) => { const e = $('err'); if (e) e.textContent = m; else toast(m); };

/* ---------- API ---------- */
async function api(method, path, body) {
  let r;
  try {
    r = await fetch(API + path, { method, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  } catch (e) { throw new Error('Cannot reach the server. Check your connection.'); }
  let j = {}; try { j = await r.json(); } catch (e) {}
  if (r.status === 401 && tok && !path.startsWith('/auth/')) { signOut(); throw new Error(j.error || 'Please log in again'); }
  if (!r.ok) throw Object.assign(new Error(j.error || 'Something went wrong'), { status: r.status, data: j });
  return j;
}
const all = async (m) => { const k = Object.keys(m), v = await Promise.all(k.map((x) => api('GET', m[x]))); k.forEach((x, i) => { S[x] = v[i]; }); };
function signOut() { tok = null; S = {}; store('wc_token', null); am = 'login'; R(); }

const TABQ = {
  tasks: { tasks: '/tasks', rw: '/rewards', ch: '/challenges', ln: '/launch' },
  premium: { pr: '/premium' }, wallet: { w: '/wallet' }, top: { lb: '/leaderboard' },
  me: { ach: '/achievements', rf: '/referrals', nt: '/notifications' },
};
async function go(t) {
  if (t) tab = t;
  try {
    await all({ me: '/me', ...(TABQ[tab] || {}) });
    S.fail = '';
    if (S.me.user.lang !== lang && !store.synced) { lang = S.me.user.lang; store('wc_lang', lang); store.synced = 1; }
  } catch (e) { if (tok) S.fail = e.message; }
  R();
  if (t) window.scrollTo(0, 0);
  if (tab === 'me' && S.me && S.me.user.unreadNotifications) { api('POST', '/notifications/read').catch(() => {}); S.me.user.unreadNotifications = 0; }
}

/* ---------- views ---------- */
function vAuth(m) {
  const s = am === 'signup', r = am === 'reset', p = S.pub;
  const landing = `<section style="padding:8px 0 20px"><h1 style="font-size:clamp(32px,8vw,52px);line-height:1.05">Watch videos. Finish tasks. Earn WTC.</h1><p style="font-size:18px;color:var(--mute);max-width:46ch">Every day you get at least 5 new tasks. Each one pays tokens straight into your wallet, with its value shown in USDT.</p><ol style="padding-left:20px;line-height:1.9"><li>Sign up free and open today's tasks.</li><li>Watch, like, subscribe or answer a poll.</li><li>Tokens land in your wallet as soon as you finish.</li></ol>${p ? `<div class="meta" style="margin-bottom:12px">${p.members} members so far · ${p.totalEarned.toLocaleString()} WTC earned · 1 WTC ≈ ${p.price} USDT</div>` : ''}<button class="btn" data-a="mode" data-v="signup" style="padding:14px 26px;font-size:17px">Get started</button><div><button class="link" data-a="about">About Watchcoin and the launch</button></div></section>`;
  return landing + `<div class="card auth"><h2 style="font-size:26px">${s ? tr('Create your account') : r ? 'Reset password' : tr('Log in')}</h2>
${s ? `<label for="fN">${tr('Name')}</label><input type="text" id="fN" autocomplete="name">` : ''}
<label for="fE">${tr('Email')}</label><input type="email" id="fE" autocomplete="email">
${r ? '<label for="fR">Recovery code</label><input type="text" id="fR">' : ''}
<label for="fP">${r ? 'New password' : tr('Password')}</label><input type="password" id="fP" autocomplete="${s || r ? 'new-password' : 'current-password'}"><button class="link" type="button" data-a="pw">Show password</button>
${s ? `<label for="fC">Invite code (optional)</label><input type="text" id="fC" value="${esc(REF)}"><label style="display:flex;gap:8px;align-items:center;font-weight:400"><input type="checkbox" id="fT" style="width:auto"> I agree to the <button class="link" data-a="terms">Terms and Privacy</button></label>` : ''}
<div class="warn" id="err" role="alert">${esc(m || '')}</div>
<button class="btn" data-a="auth" style="margin-top:14px;width:100%">${s ? tr('Sign up') : r ? 'Reset password' : tr('Log in')}</button>
<div style="display:flex;justify-content:space-between;margin-top:8px">${s || r ? '<button class="link" data-a="mode" data-v="login">Back to log in</button>' : '<button class="link" data-a="mode" data-v="signup">Create account</button><button class="link" data-a="mode" data-v="reset">Forgot password?</button>'}</div></div>`;
}

const wheel = (sp, lk) => {
  const W = sp.prizes, SG = 360 / W.length, rot = sp.spunToday ? 1800 - (sp.index * SG + SG / 2) : 0;
  return `<div class="wh${lk ? ' locked' : ''}"><b class="ptr">▼</b>${lk ? '<div class="lk"><svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg><span>Complete a task to unlock</span></div>' : ''}<div id="wl" style="background:conic-gradient(${W.map((v, i) => `hsl(${i * 51} 65% 48%) ${i * SG}deg ${(i + 1) * SG}deg`).join(',')});transform:rotate(${rot}deg)">${W.map((v, i) => `<span style="transform:rotate(${i * SG + SG / 2}deg) translateY(-88px)">${v}</span>`).join('')}</div></div>`;
};

function vTasks(u) {
  const T = S.tasks, st = S.rw.streak, sp = S.rw.spin, ln = S.ln, ok = sp.unlocked;
  const list = [...T.tasks].sort((a, b) => (a.status !== 'open') - (b.status !== 'open'));
  return (u.onboarded ? '' : '<div class="card"><h3>Welcome to Watchcoin</h3><ul class="meta" style="margin:6px 0 10px;padding-left:20px"><li>You get at least 5 new tasks every day.</li><li>Tokens are added to your wallet as soon as you finish a task.</li><li>Claim your streak bonus daily and spin the wheel after your first task.</li></ul><button class="btn" data-a="ob">Got it</button></div>') +
  `<div class="card"><h3>WTC launch</h3><div class="meta">${ln.launchAt ? (new Date(ln.launchAt) > new Date() ? 'Launching in ' + eta(ln.launchAt) : 'Launched') : 'Launch date coming soon'} · ${ln.totalEarned.toLocaleString()} WTC earned by everyone so far · you are #${ln.position} on the launch list</div></div>
<div class="card" style="display:flex;justify-content:space-between;align-items:center;gap:12px"><div><h3>${st.next}-day streak</h3><div class="meta">${st.claimedToday ? 'Claimed. Come back tomorrow for a bigger bonus.' : `Claim +${st.nextAmount} WTC today. Day 7 and later pays +35.`}</div></div>${st.claimedToday ? '<span class="done">Claimed</span>' : `<button class="btn" data-a="claim">${tr('Claim')}</button>`}</div>
<div class="card" style="text-align:center"><h3>Daily spin</h3>${wheel(sp, !ok && !sp.spunToday)}<div class="meta">${sp.spunToday ? `Today's prize: +${sp.prize} WTC. Come back tomorrow.` : ok ? 'Press Start to spin the wheel!' : 'Complete a task to unlock the wheel.'}</div><button class="btn" data-a="spin" style="margin-top:12px;padding:12px 44px;font-size:17px" ${ok ? '' : 'disabled'}>${ok || sp.spunToday ? 'Start' : 'Complete a task to unlock'}</button></div>
<div class="card"><h3>Weekly challenges</h3><div class="meta" style="margin-bottom:6px">Resets every Monday</div>${S.ch.challenges.map((c) => `<div style="padding:10px 0;border-top:1px solid var(--line)"><div style="display:flex;justify-content:space-between;gap:10px;align-items:center"><div><b>${esc(c.title)}</b><div class="meta">${c.progress} / ${c.target} · reward +${c.reward} WTC</div></div>${c.claimed ? '<span class="done">Claimed</span>' : `<button class="btn" data-a="chal" data-v="${c.id}" ${c.claimable ? '' : 'disabled'}>Claim</button>`}</div><div class="bar" style="margin:8px 0 0"><i style="width:${c.progress / c.target * 100}%"></i></div></div>`).join('')}</div>
<div class="daily"><h2>${tr("Today's tasks")}</h2><span class="meta">New tasks in ${eta(T.resetsAt)}</span></div>
<div class="meta">${T.done} of ${T.total} done · finish them all for a +${T.allDoneBonus} WTC bonus${T.potentialLeft ? ` · ${T.potentialLeft} WTC left to earn` : ''}</div><div class="bar"><i style="width:${T.total ? T.done / T.total * 100 : 0}%"></i></div>` +
  (list.length ? '<div class="tg vg">' + list.map((t) => `<div class="task ${t.status !== 'open' ? 'isdone' : ''}"><div class="cw">${coverHTML(t)}<span class="rw">+${t.reward}</span></div><div class="tb"><h3><span class="chip">${TY[t.type]}</span>${t.premium ? '<span class="chip" style="background:var(--gold);color:#3a2800">Premium</span>' : ''}${esc(t.title)}</h3><div class="pill"><span class="meta" style="font-weight:500">≈ ${t.rewardUsdt.toFixed(4)} USDT</span>${t.doubleUntil ? `<span class="chip" style="margin:0 0 0 6px">2x ends in ${eta(t.doubleUntil)}</span>` : ''}${t.secs ? `<span class="meta" style="font-weight:400">· ${t.secs}s</span>` : ''}</div></div><div class="act">${t.status === 'done' ? '<span class="done">' + tr('Earned') + '</span>' : t.status === 'missed' ? '<span class="meta">Missed today</span>' : t.status === 'closed' ? '<span class="meta">' + tr('Closed') + '</span>' : `<button class="btn" data-a="start" data-v="${t.id}">${tr('Start')}</button>`}</div></div>`).join('') + '</div>' : '<div class="empty">No tasks yet.</div>');
}

function vPrem(u) {
  const P = S.pr, p = P.current.id, byCard = !!(P.paystack && P.paystack.enabled), byCrypto = !!(P.manual && P.manual.enabled), canPay = byCard || byCrypto, how = [byCard && 'card or mobile money', byCrypto && 'USDT'].filter(Boolean).join(' or ');
  return `<div class="daily"><h2>Premium</h2></div><div class="card"><h3>Your plan: ${P.current.name}</h3><div class="meta">${u.plan.tasksPerDay} tasks a day${p ? ` · expires ${new Date(P.current.expiresAt).toLocaleDateString()}` : ''}${P.pending ? ' · upgrade pending review' : ''}</div></div>
<div class="tg">${P.plans.map((l) => `<div class="card" style="margin:0;${l.id === p ? 'border-color:var(--gold)' : ''}"><h3>${l.name}</h3><div class="disp" style="font-size:30px;margin:6px 0">${l.priceUsdt ? l.priceUsdt + ' USDT' : 'Free'}</div><div class="meta">${l.priceUsdt ? 'for ' + l.days + ' days' : 'always'}</div><ul class="meta" style="padding-left:18px"><li>${l.tasksPerDay} tasks every day</li><li>Earn up to ${l.maxWtcPerDay} WTC a day (≈ ${l.maxUsdtPerDay.toFixed(2)} USDT)</li>${l.id ? '<li>Access to premium-only tasks</li>' : ''}</ul>${l.id === p ? '<span class="done">Current plan</span>' + (l.id && canPay ? `<button class="btn" style="width:100%;margin-top:8px" data-a="checkout" data-v="${l.id}">Renew</button>` : '') : l.id < p || !l.id ? '' : canPay ? `<button class="btn" style="width:100%" data-a="checkout" data-v="${l.id}">Upgrade to ${l.name}</button><div class="meta" style="text-align:center;margin-top:6px">Pay by ${how}</div>` : '<span class="meta">Payments open soon</span>'}</div>`).join('')}</div>
${P.requests.length ? `<div class="card" style="margin-top:12px"><h3>Your upgrade requests</h3>${P.requests.slice(0, 3).map((x) => `<div class="row"><span>${P.plans[x.plan].name}</span><span class="meta">${x.status}</span></div>`).join('')}</div>` : ''}
${P.payments && P.payments.length ? `<div class="card" style="margin-top:12px"><h3>Your payments</h3>${P.payments.map((x) => `<div class="row"><div><div>${esc(P.plans[x.plan].name)} plan</div><div class="meta">${fmtDate(x.paidAt || x.createdAt)}</div></div><div style="text-align:right"><div>${money(x.amountMinor, x.currency)}</div><span class="chip" style="margin:0">${x.status === 'success' ? 'Paid' : 'Being checked'}</span></div></div>`).join('')}</div>` : ''}`;
}

function vWallet(u) {
  const w = S.w, soon = (t, d) => `<div class="card" style="opacity:.85"><div style="display:flex;justify-content:space-between;align-items:center"><h3>${t}</h3><span class="chip" style="margin:0">${tr('Coming soon')}</span></div><p class="meta" style="margin:6px 0 12px">${d}</p><button class="btn" disabled>${t}</button></div>`;
  return `<div class="stats"><div class="card"><span class="meta">Earned today</span><b>${w.earnedToday}</b><span class="meta">≈ ${(w.earnedToday * w.price).toFixed(4)} USDT</span></div><div class="card"><span class="meta">Earned all time</span><b>${w.earnedAllTime}</b><span class="meta">≈ ${w.earnedAllTimeUsdt.toFixed(4)} USDT</span></div></div>
<p class="meta">WTC has not launched yet. Your balance is safe, and the USDT value shown is an estimate. <button class="link" data-a="about" style="padding:0">About WTC and the launch</button></p>${soon('Transfer', 'Send your WTC to another wallet once the token launches.')}${soon('Convert', 'Convert your WTC on the platform once the token launches.')}
<div class="card"><h3 style="margin-bottom:6px">${tr('Activity')}</h3>${w.history.length ? w.history.map((h) => `<div class="row"><div><div>${esc(h.note || h.kind)}</div><div class="meta">${new Date(h.createdAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</div></div><span class="${h.amount > 0 ? 'plus' : 'meta'}">${h.amount > 0 ? '+' : ''}${h.amount}</span></div>`).join('') : '<div class="empty">Finish a task and your tokens show up here.</div>'}</div>`;
}

const vTop = (u) => `<div class="daily"><h2>Top earners this week</h2></div><div class="card">${S.lb.top.map((x) => `<div class="row" ${x.name === u.name ? 'style="font-weight:700"' : ''}><span><span class="rk r${x.rank - 1}">${x.rank}</span>${esc(x.avatar || '')} ${esc(x.name)}${x.name === u.name ? ' (you)' : ''}</span><span class="plus">${x.score} WTC</span></div>`).join('')}${S.lb.me && S.lb.me.rank > 10 ? `<div class="row" style="font-weight:700"><span><span class="rk">${S.lb.me.rank}</span>You</span><span class="plus">${S.lb.me.score} WTC</span></div>` : ''}</div>`;

function vMe(u) {
  const rf = S.rf, a = S.ach.achievements, un = u.level.next;
  return `<div class="card"><h3>${esc(u.avatar || '')} ${esc(u.name)}</h3><div class="meta">${esc(u.email)} · ${u.role}${u.emailVerified ? '' : ' · email not verified'}</div><div class="meta">${u.level.name} level · +${u.level.boost * 100}% on task rewards${un ? ` · ${un.remaining} WTC to ${un.name}` : ''}</div></div>
<div class="card"><h3>Achievements</h3><div class="meta" style="margin-bottom:10px">${a.filter((x) => x.unlocked).length} of ${a.length} unlocked</div><div class="ag">${a.map((x) => `<div class="ab ${x.unlocked ? 'on' : ''}"><span>${{ first: '🎯', t10: '🔟', s3: '🔥', s7: '🏅', ref: '🤝', spin: '🎡', k1: '💰', gold: '🥇' }[x.key]}</span><b>${esc(x.title)}</b><small>${esc(x.desc)}</small></div>`).join('')}</div></div>
<div class="card"><h3>Invite friends, earn ${rf.rewardPerFriend} WTC each</h3><p class="meta" style="margin:4px 0">You get ${rf.rewardPerFriend} WTC when a friend finishes their first task. ${rf.friends.length} joined so far.</p><input type="text" readonly value="${esc(rf.link)}" aria-label="Invite link"><div style="margin-top:10px"><button class="btn" data-a="copy" data-v="${esc(rf.link)}">Copy link</button> <button class="btn ghost" data-a="share" data-v="wa">WhatsApp</button> <button class="btn ghost" data-a="share" data-v="tg">Telegram</button> <button class="btn ghost" data-a="share" data-v="x">X</button></div>${rf.friends.map((x) => `<div class="row"><span>${esc(x.name)}</span><span class="meta">${x.active ? 'Active. You earned ' + rf.rewardPerFriend + ' WTC' : 'Joined, no task yet'}</span></div>`).join('')}</div>
<div class="card"><h3 style="margin-bottom:6px">Notifications</h3>${S.nt.notifications.length ? S.nt.notifications.slice(0, 30).map((x) => `<div class="row ${x.read ? '' : 'unread'}"><span>${esc(x.message)}</span><span class="meta">${new Date(x.createdAt).toLocaleDateString()}</span></div>`).join('') : '<div class="empty">Nothing yet.</div>'}</div>
<div class="card"><h3>Profile settings</h3><label>Avatar</label><div>${['🦊', '🐼', '🦁', '🐯', '🐸', '🦄', '🐙', '🚀'].map((e) => `<button class="btn ghost" data-a="av" data-v="${e}" aria-label="Avatar ${e}" style="padding:6px 10px;font-size:20px;${u.avatar === e ? 'border-color:var(--acc)' : ''}">${e}</button>`).join(' ')}</div>
<label for="pN">Name</label><input type="text" id="pN" value="${esc(u.name)}"><button class="btn" data-a="sn" style="margin-top:10px">Save name</button>
<label for="pO">Current password</label><input type="password" id="pO" autocomplete="current-password"><label for="pW">New password</label><input type="password" id="pW" autocomplete="new-password"><button class="btn" data-a="cp" style="margin-top:10px">Change password</button>
<hr style="border:0;border-top:1px solid var(--line);margin:18px 0"><button class="btn ghost" data-a="dacc" style="color:var(--bad)">Delete my account</button><p class="meta">To delete, type your current password above first.</p></div>
<div class="card"><h3>Report a problem</h3><input type="text" id="sM" placeholder="Describe the problem, for example missing tokens"><button class="btn" data-a="ticket" style="margin-top:10px">Send</button></div>
<div class="card"><h3>Reminders</h3><p class="meta" style="margin:4px 0 10px">Get a browser alert when your streak bonus is waiting. Works while Watchcoin is open in a tab.</p><button class="btn ghost" data-a="rem">Turn on reminders</button></div>
<button class="btn ghost" data-a="out">${tr('Log out')}</button> <button class="link" data-a="terms">Terms and Privacy</button> <button class="link" data-a="about">About WTC</button>`;
}

function R() {
  const u = S.me && S.me.user;
  if (!tok || !u) { $('app').innerHTML = vAuth(S.authErr || ''); S.authErr = ''; return; }
  if (S.fail) { $('app').innerHTML = `<div class="card"><h3>Could not load</h3><p class="meta">${esc(S.fail)}</p><button class="btn" data-a="retry">Try again</button></div>`; return; }
  document.documentElement.lang = lang;
  const tabs = [['tasks', tr('Tasks')], ['premium', 'Premium'], ['wallet', tr('Wallet')], ['top', tr('Top')], ['me', tr('Me') + (u.unreadNotifications ? ` (${u.unreadNotifications})` : '')]];
  let lo = 0, hi = null; LVMIN.forEach((l, i) => { if (u.lifetime >= l[1]) { lo = l[1]; hi = LVMIN[i + 1] ? LVMIN[i + 1][1] : null; } });
  const pc = hi ? Math.round((u.lifetime - lo) / (hi - lo) * 100) : 100, dataReady = !!S[{ tasks: 'tasks', premium: 'pr', wallet: 'w', top: 'lb', me: 'ach' }[tab]];
  const body = !dataReady ? '<div class="empty">Loading…</div>' : tab === 'tasks' ? vTasks(u) : tab === 'premium' ? vPrem(u) : tab === 'wallet' ? vWallet(u) : tab === 'top' ? vTop(u) : vMe(u);
  $('app').innerHTML = `<section class="hero" aria-live="polite"><div class="hh"><span>${esc(u.avatar || '')} ${esc(u.name)}</span><span class="lv">${u.level.name}</span>${u.plan.id ? `<span class="lv" style="background:#fff">${u.plan.name}</span>` : ''}</div><div class="bal-l">${tr(', your balance').slice(2)}</div><div class="bal ${pop ? 'pop' : ''}">${u.balance.toLocaleString()}<small>WTC</small></div><div class="usd">≈ ${u.balanceUsdt.toFixed(4)} USDT</div><div class="lvb"><i style="width:${pc}%"></i></div><div class="bal-l">${u.level.next ? `${u.level.next.remaining} WTC to ${u.level.next.name}` : 'Top level reached'}</div><span class="coin big" aria-hidden="true">W</span></section>
<nav aria-label="Main">${tabs.map((t) => `<button data-a="tab" data-v="${t[0]}" ${t[0] === tab ? 'aria-current="page"' : ''}>${IC[t[0]]}<span>${t[1]}</span></button>`).join('')}</nav>` + body;
  pop = 0;
}

/* ---------- task flow ---------- */
function openTask(id) {
  const t = S.tasks.tasks.find((x) => x.id === +id); if (!t) return;
  cur = { t };
  $('dT').textContent = t.title;
  $('dD').textContent = { watch: `Watch for ${t.secs}s, then answer a quick question.`, like: `Open the video, like it, and stay for ${t.secs}s.`, subscribe: `Open the channel, subscribe, and stay for ${t.secs}s.`, poll: 'Answer the poll to earn tokens.' }[t.type];
  $('dQ').innerHTML = ''; $('dB').style.width = '0'; $('dS').textContent = `Reward: +${t.reward} WTC (≈ ${t.rewardUsdt.toFixed(4)} USDT)`;
  $('dGo').hidden = false; $('dGo').disabled = false; $('dGo').textContent = t.type === 'poll' ? 'Answer poll' : 'Open video & start';
  $('dlg').showModal();
}
async function beginTask() {
  const t = cur.t; $('dGo').disabled = true;
  try { cur.s = await api('POST', `/tasks/${t.id}/start`); } catch (e) { toast(e.message); $('dlg').close(); return; }
  if (t.type === 'poll') return quiz();
  window.open(cur.s.url, '_blank', 'noopener');
  let left = cur.s.secs; $('dGo').textContent = 'Watching…'; $('dS').textContent = left + 's left'; $('dB').style.width = '0';
  requestAnimationFrame(() => { $('dB').style.width = 100 / cur.s.secs + '%'; });
  clearInterval(timer);
  timer = setInterval(() => { left--; $('dB').style.width = (cur.s.secs - left + 1) / cur.s.secs * 100 + '%'; $('dS').textContent = left > 0 ? left + 's left' : 'Time is up'; if (left <= 0) { clearInterval(timer); cur.s.question ? quiz() : finish(); } }, 1000);
}
function quiz() {
  $('dGo').hidden = true; $('dS').textContent = '';
  $('dQ').innerHTML = `<h3 style="font-size:17px;margin:12px 0 8px">${esc(cur.s.question)}</h3>` + cur.s.options.map((o, i) => `<button class="btn ghost opt" data-a="ans" data-v="${i}">${esc(o)}</button>`).join('');
}
async function finish(answer) {
  const t = cur.t;
  try {
    const r = await api('POST', `/tasks/${t.id}/complete`, answer === undefined ? undefined : { answer });
    $('dlg').close();
    if (r.ok) { pop = 1; toast(`+${r.reward} WTC added to your wallet`); confetti(); (r.achievements || []).forEach((k) => setTimeout(() => toast('Achievement unlocked: ' + k), 3200)); }
    else toast(r.message);
  } catch (e) {
    if (e.data && e.data.waitMs) return setTimeout(() => finish(answer), e.data.waitMs + 300);
    $('dlg').close(); toast(e.message);
  }
  go();
}
async function doSpin() {
  if (spinning) return;
  try {
    const r = await api('POST', '/rewards/spin'), SG = 360 / r.prizes.length, l = $('wl');
    spinning = 1; document.querySelector('[data-a=spin]').disabled = true;
    l.style.transition = 'none'; l.style.transform = 'rotate(0deg)'; void l.offsetWidth;
    l.style.transition = 'transform 4s cubic-bezier(.12,.7,.1,1)'; l.style.transform = `rotate(${1800 - (r.index * SG + SG / 2)}deg)`;
    setTimeout(async () => { spinning = 0; pop = 1; await go(); toast(`You won +${r.prize} WTC`); confetti(); }, 4200);
  } catch (e) { toast(e.message); }
}

/* ---------- actions ---------- */
const ADM = async (fn, ok) => { try { await fn(); if (ok) toast(ok); go(); } catch (e) { toast(e.message); } };
function showRecovery(code) { $('rcC').textContent = code; $('rc').showModal(); }
async function auth() {
  const v = (i) => ($(i) ? $(i).value.trim() : ''), email = v('fE').toLowerCase(), password = $('fP').value;
  if (!/^\S+@\S+\.\S+$/.test(email)) return err('Enter a valid email.');
  if (password.length < 6) return err('Password must be at least 6 characters.');
  try {
    let r;
    if (am === 'signup') {
      if (!v('fN')) return err('Enter your name.');
      if (!$('fT').checked) return err('Please accept the Terms and Privacy Policy.');
      r = await api('POST', '/auth/signup', { name: v('fN'), email, password, inviteCode: v('fC') || undefined });
    } else if (am === 'reset') {
      r = await api('POST', '/auth/reset-password', { email, recoveryCode: v('fR'), newPassword: password });
      tok = r.token; store('wc_token', tok); await go('tasks'); return showRecovery(r.recoveryCode);
    } else r = await api('POST', '/auth/login', { email, password });
    tok = r.token; store('wc_token', tok); S.me = { user: r.user };
    if (r.user.lang) { lang = r.user.lang; store('wc_lang', lang); }
    await go('tasks');
    if (r.recoveryCode) showRecovery(r.recoveryCode);
  } catch (e) { err(e.message); }
}
function aboutHTML(launchAt, price) {
  const launch = launchAt ? (new Date(launchAt) > new Date() ? 'WTC is set to launch in ' + eta(launchAt) : 'WTC has launched') : 'The WTC launch date is coming soon';
  return `<h2>About Watchcoin (WTC)</h2>
<p>Watchcoin is a task-and-earn app. You do short, simple tasks, such as watching a video, liking, subscribing or answering a poll, and you earn WTC tokens for each one.</p>
<h3 style="margin-top:14px">How you earn</h3>
<ul class="meta" style="padding-left:20px;margin:6px 0">
<li>At least 5 new tasks every day, each with its own reward</li>
<li>A daily streak bonus and a spin of the prize wheel</li>
<li>Weekly challenges and achievements</li>
<li>50 WTC for every friend you invite who finishes a task</li>
<li>Premium plans give you more tasks each day</li></ul>
<h3 style="margin-top:14px">The launch</h3>
<p class="meta">${launch}. Until then, your WTC balance stays safe in the app. Transfers and converting your WTC will open after launch, and the details will be shared in the app before they do.</p>
<h3 style="margin-top:14px">What the USDT value means</h3>
<p class="meta">The USDT amount you see is an estimate. It uses the app's own rate${price ? ` of 1 WTC = ${price} USDT` : ''} and is not a price on any market. After launch, the real market value of WTC can be higher, lower, or nothing at all.</p>
<div class="card" style="border-color:var(--gold);margin:14px 0 0"><h3>Please read</h3>
<p class="meta" style="margin:0">Nobody can promise that WTC will be worth money, or that anyone will make a profit by holding it. Earn WTC for fun or as a bonus. Only pay for a premium plan if you are comfortable losing that money, and never borrow money to take part.</p></div>
<h3 style="margin-top:14px">Fair play</h3>
<p class="meta">One account per person. Bots, fake accounts and cheating lead to a ban and loss of tokens. Have a question or a problem? Send it from the Me tab.</p>
<div class="mfoot" style="margin-top:16px"><button class="btn" data-a="aclose" style="width:100%">Close</button></div>`;
}
const SHARE = (v) => { const l = encodeURIComponent(S.rf.link), m = encodeURIComponent('Earn WTC tokens by watching videos. Join with my link:'); return { wa: `https://wa.me/?text=${m}%20${l}`, tg: `https://t.me/share/url?url=${l}&text=${m}`, x: `https://twitter.com/intent/tweet?text=${m}&url=${l}` }[v]; };
/* ---------- checkout: order summary, then Paystack, then a receipt ---------- */
const money = (minor, cur) => `${cur} ${(minor / 100).toFixed(2)}`;
const fmtDate = (t) => new Date(t).toLocaleDateString([], { dateStyle: 'medium' });
const ICON = (d) => `<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const LOCK = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex:none;margin-top:1px"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';
function openCheckout(id, method) {
  const P = S.pr, l = P.plans[+id], u = S.me.user, ps = P.paystack && P.paystack.enabled ? P.paystack : null, mn = P.manual && P.manual.enabled ? P.manual : null;
  if (!l || !(ps || mn)) return;
  pplan = +id;
  const m = method === 'crypto' && mn ? 'crypto' : method === 'paystack' && ps ? 'paystack' : ps ? 'paystack' : 'crypto';
  const cur = u.plan.id, same = cur === l.id, ends = same && u.plan.expiresAt ? u.plan.expiresAt : Date.now(), label = ps ? `${ps.currency} ${ps.prices[l.id].toFixed(2)}` : '';
  const note = same ? `Your ${l.name} plan ends on ${fmtDate(ends)}. This adds 30 days, so it will end on ${fmtDate(ends + 30 * 864e5)}.`
    : cur ? `You are on ${P.current.name} now. ${l.name} starts today and replaces it, so any days left on ${P.current.name} are not carried over.`
    : `${l.name} starts as soon as your payment is confirmed and lasts 30 days.`;
  const chooser = ps && mn ? `<div class="co-k2">Pay with</div><div class="co-choose"><button class="co-opt" data-a="comethod" data-v="paystack" aria-pressed="${m === 'paystack'}"><b>Card or mobile money</b><span>${label} · confirmed instantly</span></button><button class="co-opt" data-a="comethod" data-v="crypto" aria-pressed="${m === 'crypto'}"><b>Crypto (USDT)</b><span>${l.priceUsdt} USDT · we confirm it</span></button></div>` : '';
  const perks = `<ul class="co-list"><li>${l.tasksPerDay} tasks every day</li><li>Premium-only tasks unlocked</li><li>Earn up to ${l.maxWtcPerDay} WTC a day (≈ ${l.maxUsdtPerDay.toFixed(2)} USDT) if you finish every task</li></ul><div class="co-note">${note}</div>`;
  const fine = '<p class="co-fine">A plan gives you more daily tasks. It does not promise any earnings, or any value for WTC.</p>';
  const body = m === 'paystack'
    ? `<div class="co-price"><span class="co-amt">${label}</span><span class="meta">about ${l.priceUsdt} USDT · 30 days</span></div>${perks}
<div class="co-row"><span>Total today</span><b>${label}</b></div>
<div class="co-methods"><span>Pay with</span><i>Card</i><i>Mobile money</i></div>
<div class="err" id="coErr" role="alert"></div>
<button class="btn co-pay" id="coPay" data-a="paynow" data-l="${esc(label)}">Pay ${label}</button>
<div class="co-secure">${LOCK}<span>Secured by Paystack. You choose card or mobile money on their page. Watchcoin never sees your card details or PIN.</span></div>${fine}`
    : `<div class="co-price"><span class="co-amt">${l.priceUsdt} USDT</span><span class="meta">30 days · confirmed by our team</span></div>${perks}
<div class="co-k2" style="margin-top:14px">Send exactly ${l.priceUsdt} USDT to</div><div class="co-addr" id="coAddr">${esc(mn.info)}</div>
<button class="btn ghost sm" data-a="cocopy" style="margin-bottom:6px">Copy details</button>
<label for="coRef" style="display:block;font-weight:700;margin-top:10px">Transaction hash or reference</label><input type="text" id="coRef" placeholder="Paste it here after you pay" autocomplete="off">
<div class="err" id="coErr" role="alert">${P.pending ? 'You already have a payment waiting for review. Please wait for it to be confirmed.' : ''}</div>
<button class="btn co-pay" id="coSend" data-a="cosend" ${P.pending ? 'disabled' : ''}>I have sent it</button>
<div class="co-secure">${LOCK}<span>Only send USDT on the network shown above. The wrong coin or network can lose your money for good. We check your payment by hand, then start your plan.</span></div>${fine}`;
  $('co').innerHTML = `<div class="co-head"><div><div class="co-k">Checkout</div><h2>${same ? 'Renew ' : ''}${esc(l.name)} plan</h2></div><button class="co-x" data-a="coclose" aria-label="Close checkout">✕</button></div><div class="co-body">${chooser}${body}</div>`;
  if (!$('co').open) $('co').showModal();
}
async function sendCrypto() {
  const b = $('coSend'), ref = $('coRef').value.trim(), l = S.pr.plans[pplan];
  $('coErr').textContent = '';
  if (ref.length < 4) { $('coErr').textContent = 'Paste your transaction hash or reference so we can find your payment.'; return; }
  b.disabled = true;
  try {
    await api('POST', '/premium/upgrade', { plan: pplan, reference: ref });
    await go('premium');
    coState('wait', 'Payment sent for review', 'We will check that your payment arrived, then start your plan. You will get a notification when it is active.',
      `<div class="co-receipt"><div><span>Plan</span><b>${esc(l.name)}</b></div><div><span>Amount</span><b>${l.priceUsdt} USDT</b></div><div><span>Reference</span><code>${esc(ref)}</code></div></div>`, '<button class="btn" data-a="coclose">Done</button>');
  } catch (e) { $('coErr').textContent = e.message; b.disabled = false; }
}
async function payNow() {
  const b = $('coPay'); b.disabled = true; b.innerHTML = '<span class="spin"></span> Opening Paystack…'; $('coErr').textContent = '';
  try {
    const r = await api('POST', '/premium/paystack/initialize', { plan: pplan });
    if (window.WATCHCOIN_PREVIEW) return paymentReturn(r.reference); // the preview skips Paystack's own page
    window.location.href = r.authorizationUrl;
  } catch (e) { $('coErr').textContent = e.message; b.disabled = false; b.textContent = 'Pay ' + b.dataset.l; }
}
function coState(kind, title, text, body, buttons) {
  $('co').innerHTML = `<div class="co-state"><div class="${kind === 'load' ? 'spin big' : 'tick ' + kind}">${kind === 'ok' ? ICON('<path d="M5 12.5l4.5 4.5L19 7.5"/>') : kind === 'bad' ? ICON('<path d="M6 6l12 12M18 6L6 18"/>') : kind === 'wait' ? ICON('<circle cx="12" cy="12" r="8"/><path d="M12 8v4.5l3 1.5"/>') : ''}</div><h2>${title}</h2><p class="meta" style="margin:0">${text}</p>${body || ''}<div style="display:grid;gap:8px;margin-top:6px">${buttons || ''}</div></div>`;
  if (!$('co').open) $('co').showModal();
}
// Shown when the person comes back from Paystack (or right after paying in the preview).
async function paymentReturn(ref, tries = 0) {
  if (!tries) coState('load', 'Confirming your payment…', 'This usually takes a few seconds. Please keep this page open.');
  let r;
  try { r = await api('POST', '/premium/paystack/verify', { reference: ref }); } catch (e) { r = { status: 'error', message: e.message }; }
  if (r.status === 'pending' && tries < 4) { await new Promise((res) => setTimeout(res, window.WATCHCOIN_PREVIEW ? 300 : 3500)); return paymentReturn(ref, tries + 1); }
  const refRow = `<div class="co-receipt"><div><span>Reference</span><code>${esc(ref)}</code></div></div>`;
  if (r.status === 'success') {
    await go('premium');
    coState('ok', 'Payment received', `Your ${esc(r.plan)} plan is active.`, `<div class="co-receipt"><div><span>Plan</span><b>${esc(r.plan)}</b></div><div><span>Amount paid</span><b>${money(r.amountMinor, r.currency)}</b></div><div><span>Paid on</span><b>${fmtDate(r.paidAt || Date.now())}</b></div><div><span>Plan ends</span><b>${r.planExpiresAt ? fmtDate(r.planExpiresAt) : '-'}</b></div><div><span>Reference</span><code>${esc(ref)}</code></div></div>`,
      '<button class="btn" data-a="cotasks">Start earning</button><button class="link" data-a="coclose">Close</button>');
    confetti();
  } else if (r.status === 'review') coState('wait', 'We need to check your payment', 'We received a payment, but the amount did not match the plan price, so no plan was added yet. We will look into it.', refRow, '<button class="btn" data-a="cosupport">Message support</button><button class="link" data-a="coclose">Close</button>');
  else if (r.status === 'pending') coState('wait', 'Still confirming', 'Your payment has not been confirmed yet. Mobile money can take a minute. Your plan will start by itself once it is confirmed.', refRow, `<button class="btn" data-a="cocheck" data-v="${esc(ref)}">Check again</button><button class="link" data-a="coclose">Close</button>`);
  else if (r.status === 'error') coState('bad', 'We could not check your payment', esc(r.message), refRow, `<button class="btn" data-a="cocheck" data-v="${esc(ref)}">Try again</button><button class="link" data-a="coclose">Close</button>`);
  else coState('bad', 'Payment not completed', 'No plan was added. If money left your account, send us the reference below and we will sort it out.', refRow, '<button class="btn" data-a="coretry">Try again</button><button class="link" data-a="coclose">Close</button>');
}

const A = {
  tab: (v) => go(v), mode: (v) => { am = v; R(); }, auth, retry: () => go(),
  pw: (v, b) => { const i = $('fP'); i.type = i.type === 'password' ? 'text' : 'password'; b.textContent = i.type === 'password' ? 'Show password' : 'Hide password'; },
  start: (v) => openTask(v), ans: (v) => finish(+v), spin: doSpin,
  claim: () => ADM(async () => { const r = await api('POST', '/rewards/streak/claim'); pop = 1; toast(`+${r.amount} WTC streak bonus`); confetti(); }),
  chal: (v) => ADM(async () => { const r = await api('POST', `/challenges/${v}/claim`); pop = 1; toast(`+${r.reward} WTC challenge reward`); confetti(); }),
  ob: () => ADM(() => api('PATCH', '/me', { onboarded: true })),
  av: (v) => ADM(() => api('PATCH', '/me', { avatar: v })),
  sn: () => ADM(() => api('PATCH', '/me', { name: $('pN').value }), 'Name saved'),
  cp: () => ADM(() => api('POST', '/me/password', { currentPassword: $('pO').value, newPassword: $('pW').value }), 'Password changed'),
  dacc: async () => {
    if (!$('pO').value) return toast('Type your current password first');
    if (!delArm) { delArm = 1; return toast('Tap Delete my account again to confirm. This cannot be undone.'); }
    delArm = 0; try { await api('DELETE', '/me', { password: $('pO').value }); signOut(); } catch (e) { toast(e.message); }
  },
  ticket: () => ADM(() => api('POST', '/support', { message: $('sM').value }), 'Sent. We will get back to you.'),
  rem: () => { if (!window.Notification) return toast('Not supported in this browser'); Notification.requestPermission().then((p) => toast(p === 'granted' ? 'Reminders on' : 'Permission was not granted')); },
  copy: (v) => { try { navigator.clipboard.writeText(v); toast('Link copied'); } catch (e) { toast('Select the link and copy it'); } },
  share: (v) => window.open(SHARE(v), '_blank', 'noopener'),
  about: async () => { try { S.pub = await api('GET', '/public/stats'); } catch (e) { /* show what we know */ } const p = S.pub || {}; $('abB').innerHTML = aboutHTML(p.launchAt, p.price); $('ab').showModal(); }, aclose: () => $('ab').close(),
  out: () => signOut(), terms: () => $('tm').showModal(), tclose: () => $('tm').close(), rclose: () => $('rc').close(),
  checkout: (v) => openCheckout(v), comethod: (v) => openCheckout(pplan, v), cosend: sendCrypto, cocopy: () => { try { navigator.clipboard.writeText(S.pr.manual.info); toast('Payment details copied'); } catch (e) { toast('Select the details and copy them'); } }, paynow: payNow, coclose: () => $('co').close(), coretry: () => openCheckout(pplan, 'paystack'), cocheck: (v) => paymentReturn(v),
  cotasks: () => { $('co').close(); go('tasks'); }, cosupport: () => { $('co').close(); go('me'); },
};
document.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b && b.dataset.a && A[b.dataset.a]) A[b.dataset.a](b.dataset.v, b); });
document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.closest('.auth')) auth(); });
$('dGo').onclick = beginTask; $('dX').onclick = () => { clearInterval(timer); $('dlg').close(); }; $('dlg').addEventListener('cancel', () => clearInterval(timer));
$('theme').onclick = () => { const r = document.documentElement, d = r.dataset.theme ? r.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme:dark)').matches; r.dataset.theme = d ? 'light' : 'dark'; };
$('lg').value = lang;
$('lg').onchange = () => { lang = $('lg').value; store('wc_lang', lang); if (tok) api('PATCH', '/me', { lang }).catch(() => {}); R(); };

/* ---------- start ---------- */
(async function boot() {
  // Coming back from Paystack: confirm the payment with the server so the plan shows straight away.
  const payRef = new URLSearchParams(location.search).get('reference');
  if (tok && payRef && /^wtc-/.test(payRef)) {
    try { history.replaceState(null, '', location.pathname); } catch (e) { /* ignore */ }
    await go('premium'); paymentReturn(payRef);
  } else if (tok) await go('tasks');
  else { try { S.pub = await api('GET', '/public/stats'); } catch (e) {} R(); }
  setInterval(() => { if (tok && tab === 'tasks' && !spinning && !$('dlg').open) go(); }, 60000);
  setInterval(() => { const x = S.rw; if (x && window.Notification && Notification.permission === 'granted' && !x.streak.claimedToday && new Date().getHours() >= 18) new Notification('Watchcoin', { body: 'Your streak bonus is waiting.' }); }, 36e5);
})();
