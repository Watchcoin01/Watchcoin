/* Extra pages: user detail, audit log, announcements, task performance, fraud checks, economics. */
(function () {
  const { $, esc, fmt, usdt, when, api, toast, confirmBox, bars, state, pages } = window.WC;
  const TYPE = { watch: 'Watch', like: 'Like', subscribe: 'Subscribe', poll: 'Poll' };
  const KIND = { task: 'Task', streak: 'Streak bonus', spin: 'Spin', bonus: 'Bonus', referral: 'Referral', challenge: 'Challenge', adjust: 'Admin adjustment' };
  const ACTION = { 'task.create': 'Added a task', 'task.update': 'Edited a task', 'task.hide': 'Hid a task', 'user.ban': 'Banned a user', 'user.unban': 'Unbanned a user',
    'user.adjust': 'Adjusted a balance', 'upgrade.approve': 'Approved an upgrade', 'upgrade.reject': 'Rejected an upgrade', 'ticket.resolve': 'Resolved a support request',
    'settings.update': 'Changed settings', 'broadcast.send': 'Sent an announcement' };
  const head = (title, tools = '') => `<div class="head"><h1>${esc(title)}</h1><div class="tools">${tools}</div></div>`;
  const tabs = (items, cur, attr) => `<div class="tabs" role="group">${items.map(([k, l]) => `<button data-${attr}="${k}" aria-pressed="${String(k) === String(cur)}">${esc(l)}</button>`).join('')}</div>`;
  const guard = (fn) => async (...a) => { try { await fn(...a); } catch (e) { toast(e.message, true); } };
  const userLink = (id, name) => `<a href="#/user/${id}">${esc(name)}</a>`;
  const pct = (x) => (x == null ? '-' : Math.round(x * 100) + '%');
  const statusChip = (s) => `<span class="chip ${{ done: 'ok', approved: 'ok', failed: 'bad', rejected: 'bad', started: 'gold', pending: 'gold' }[s] || ''}">${esc(s)}</span>`;

  /* ================= User detail ================= */
  pages.user = {
    title: 'User',
    async render(c, ctx) {
      const d = await api('GET', '/admin/users/' + encodeURIComponent(ctx.param || ''));
      const u = d.user; let ledger = d.ledger, more = ledger.length >= 50; const S = state.ud || (state.ud = { t: 'ledger' });
      const kv = (k, v) => `<div><div class="k">${k}</div><div class="v">${v}</div></div>`;
      c.innerHTML = '<p><a class="back" href="#/users">← All users</a></p>' + head(u.name,
        `<button class="btn ghost" data-act="adj">Adjust balance</button>${u.role === 'admin' ? '' : `<button class="btn ${u.banned ? '' : 'danger'}" data-act="ban">${u.banned ? 'Unban user' : 'Ban user'}</button>`}`) +
        `<div class="card"><div class="kv">
          ${kv('Email', esc(u.email) + (u.emailVerified ? '' : ' <span class="chip">unverified</span>'))}
          ${kv('Status', (u.role === 'admin' ? '<span class="chip gold">Admin</span> ' : '') + (u.banned ? '<span class="chip bad">Banned</span>' : '<span class="chip ok">Active</span>'))}
          ${kv('Plan', esc(u.plan) + (u.planExpiresAt ? ` <span class="muted small">until ${esc(when(u.planExpiresAt).split(',')[0])}</span>` : ''))}
          ${kv('Balance', `${fmt(u.balance)} WTC <span class="muted small">≈ ${u.balanceUsdt.toFixed(4)} USDT</span>`)}
          ${kv('Earned all time', fmt(u.lifetime) + ' WTC')}${kv('Level', esc(u.level))}${kv('Streak', u.streak + ' days')}
          ${kv('Flags', u.flags ? `<span class="chip bad">${u.flags}</span>` : '0')}${kv('Joined', esc(when(u.createdAt)))}${kv('Last activity', u.lastActivity ? esc(when(u.lastActivity)) : 'Never')}
          ${kv('Signup network', `<code>${esc(u.signupIp || 'unknown')}</code> <a href="#/fraud">shared networks</a>`)}
          ${kv('Invited by', d.invitedBy ? userLink(d.invitedBy.id, d.invitedBy.name) : 'Nobody')}</div></div>` +
        tabs([['ledger', 'Token history'], ['tasks', 'Task activity'], ['refs', `Referrals (${d.referrals.length})`], ['pay', 'Payments and support']], S.t, 't') + '<div class="card" id="ud"></div>';
      const draw = () => {
        const box = $('#ud');
        if (S.t === 'ledger') box.innerHTML = ledger.length ? `<div class="tablewrap"><table><thead><tr><th>When</th><th>Type</th><th>Details</th><th class="num">WTC</th></tr></thead><tbody>${ledger.map((l) => `<tr><td class="small nowrap">${esc(when(l.createdAt))}</td><td><span class="chip">${esc(KIND[l.kind] || l.kind)}</span></td><td>${esc(l.note)}</td><td class="num ${l.amount > 0 ? 'pos' : 'neg'}">${l.amount > 0 ? '+' : ''}${fmt(l.amount)}</td></tr>`).join('')}</tbody></table></div>${more ? '<div style="margin-top:12px"><button class="btn ghost" data-act="more">Load older</button></div>' : ''}` : '<div class="empty">No token movements yet.</div>';
        if (S.t === 'tasks') box.innerHTML = d.sessions.length ? `<div class="tablewrap"><table><thead><tr><th>Day</th><th>Task</th><th>Result</th><th class="num">Time taken</th></tr></thead><tbody>${d.sessions.map((s) => `<tr><td class="nowrap">${esc(s.day)}</td><td>${esc(s.title)} <span class="chip">${TYPE[s.type]}</span></td><td>${statusChip(s.status)}</td><td class="num">${s.finishedAt ? Math.round((s.finishedAt - s.startedAt) / 1000) + 's' : '-'}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">No tasks started yet.</div>';
        if (S.t === 'refs') box.innerHTML = d.referrals.length ? `<table><thead><tr><th>Friend</th><th>Status</th><th>Joined</th></tr></thead><tbody>${d.referrals.map((f) => `<tr><td>${userLink(f.id, f.name)} <span class="muted small">${esc(f.email)}</span></td><td>${f.banned ? '<span class="chip bad">Banned</span>' : f.active ? '<span class="chip ok">Finished a task</span>' : '<span class="chip">No task yet</span>'}</td><td class="small">${esc(when(f.createdAt))}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">This user has not invited anyone.</div>';
        if (S.t === 'pay') box.innerHTML = '<h3>Premium upgrades</h3>' + (d.upgrades.length ? `<table><tbody>${d.upgrades.map((g) => `<tr><td>${esc(g.planName)}</td><td><code>${esc(g.reference)}</code></td><td>${statusChip(g.status)}</td><td class="small">${esc(when(g.createdAt))}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">None.</p>') +
          '<h3 style="margin-top:18px">Paystack payments</h3>' + ((d.payments || []).length ? `<table><tbody>${d.payments.map((p) => `<tr><td>${esc(p.planName)}</td><td>${money(p)}</td><td><span class="chip ${(PAYST[p.status] || [''])[0]}">${esc((PAYST[p.status] || [0, p.status])[1])}</span></td><td class="small">${esc(when(p.createdAt))}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">None.</p>') +
          '<h3 style="margin-top:18px">Support requests</h3>' + (d.tickets.length ? d.tickets.map((t) => `<div class="note"><div class="small muted">${esc(when(t.createdAt))} · ${t.resolved ? 'Resolved' : 'Open'}</div><div style="white-space:pre-wrap">${esc(t.message)}</div></div>`).join('') : '<p class="muted">None.</p>');
      };
      c.onclick = guard(async (e) => {
        const b = e.target.closest('button'); if (!b) return;
        if (b.dataset.t) { S.t = b.dataset.t; c.querySelectorAll('[data-t]').forEach((x) => x.setAttribute('aria-pressed', x === b)); return draw(); }
        const act = b.dataset.act, again = () => pages.user.render(c, ctx);
        if (act === 'more') { const r = await api('GET', `/admin/users/${u.id}/ledger?before=${ledger[ledger.length - 1].id}`); ledger = ledger.concat(r.ledger); more = r.ledger.length >= 50; draw(); }
        if (act === 'adj') window.WC.adjust({ id: u.id, name: u.name, balance: u.balance }, again);
        if (act === 'ban') {
          const ban = !u.banned;
          if (await confirmBox(ban ? `Ban ${u.name}?` : `Unban ${u.name}?`, ban ? 'They are signed out and cannot earn until unbanned.' : 'They can use the app again.', ban ? 'Ban user' : 'Unban', ban)) { await api('POST', `/admin/users/${u.id}/ban`, { banned: ban }); toast(ban ? 'User banned' : 'User unbanned'); again(); }
        }
      });
      draw();
    },
  };

  /* ================= Payments (Paystack) ================= */
  const PAYST = { success: ['ok', 'Paid'], review: ['bad', 'Needs review'], pending: ['gold', 'Waiting'], abandoned: ['', 'Not completed'], failed: ['', 'Failed'] };
  const money = (p) => `${esc(p.currency)} ${(p.amountMinor / 100).toFixed(2)}`;
  pages.payments = {
    title: 'Payments',
    async render(c) {
      const S = state.pay || (state.pay = { s: 'all' });
      const load = async () => {
        const r = await api('GET', `/admin/payments?status=${S.s}`);
        $('#pt').innerHTML = `<div class="grid g-tiles">${r.totals.length ? r.totals.map((t) => `<div class="card tile"><div class="k">Received (${esc(t.currency)})</div><div class="v">${(t.minor / 100).toFixed(2)}</div><div class="small muted">${t.n} payment${t.n === 1 ? '' : 's'}</div></div>`).join('') : '<div class="card tile"><div class="k">Received</div><div class="v">0</div></div>'}
          <div class="card tile ${r.needsReview ? 'alert' : ''}"><div class="k">Need review</div><div class="v">${r.needsReview}</div><div class="small muted">${r.needsReview ? 'Amount did not match' : 'All clear'}</div></div></div>
          <div class="card" style="margin-top:16px"><div class="tablewrap">${r.payments.length ? `<table><thead><tr><th>When</th><th>User</th><th>Plan</th><th class="num">Amount</th><th>How</th><th>Status</th><th>Reference</th></tr></thead><tbody>${r.payments.map((p) => `<tr><td class="small nowrap">${esc(when(p.createdAt))}</td><td>${userLink(p.userId, p.name)}<div class="small muted">${esc(p.email)}</div></td><td>${esc(p.planName)}</td><td class="num">${money(p)}</td><td>${esc((p.channel || '').replace('_', ' ') || '-')}</td><td><span class="chip ${(PAYST[p.status] || [''])[0]}">${esc((PAYST[p.status] || [0, p.status])[1])}</span></td><td><code>${esc(p.reference)}</code></td></tr>`).join('')}</tbody></table>` : '<div class="empty">No payments here yet.</div>'}</div></div>
          <p class="muted small">Payments appear here as people pay through Paystack. A plan starts on its own once Paystack confirms the payment. If a payment needs review, the person paid a different amount than the plan costs, so no plan was given. Check it in your Paystack dashboard, then give the plan or refund them there.</p>`;
      };
      c.innerHTML = head('Payments', tabs([['all', 'All'], ['success', 'Paid'], ['review', 'Needs review'], ['pending', 'Waiting'], ['abandoned', 'Not completed']], S.s, 's')) + '<div id="pt"></div>';
      c.onclick = guard(async (e) => { const b = e.target.closest('[data-s]'); if (b) { S.s = b.dataset.s; c.querySelectorAll('[data-s]').forEach((x) => x.setAttribute('aria-pressed', x === b)); await load(); } });
      await load();
    },
  };

  /* ================= USDT payments (TRON) ================= */
  const USDTST = { pending: ['gold', 'Waiting'], paid: ['ok', 'Paid'], review: ['bad', 'In review'], expired: ['', 'Expired'] };
  pages.usdt = {
    title: 'USDT payments',
    async render(c) {
      const S = state.usdt || (state.usdt = { s: 'all' });
      const load = async () => {
        const r = await api('GET', `/admin/crypto-orders?status=${S.s}`);
        $('#ut2').innerHTML = `<div class="grid g-tiles"><div class="card tile"><div class="k">Received</div><div class="v">${(r.paid.micro / 1e6).toFixed(2)} USDT</div><div class="small muted">${r.paid.n} payment${r.paid.n === 1 ? '' : 's'}</div></div>
          <a href="#/upgrades" class="card tile ${r.inReview ? 'alert' : ''}"><div class="k">In review</div><div class="v">${r.inReview}</div><div class="small muted">${r.inReview ? 'Approve on the Upgrades page' : 'All clear'}</div></a>
          <a href="#/settings" class="card tile ${r.enabled ? '' : 'alert'}"><div class="k">Automatic checking</div><div class="v">${r.enabled ? 'On' : 'Off'}</div><div class="small muted">${r.enabled ? 'Watching your address' : 'Add your address in Settings'}</div></a></div>
          <div class="card" style="margin-top:16px"><div class="tablewrap">${r.orders.length ? `<table><thead><tr><th>When</th><th>User</th><th>Plan</th><th class="num">Exact amount</th><th>Status</th><th>Transaction</th></tr></thead><tbody>${r.orders.map((o) => { const late = o.status === 'pending' && Date.now() > o.expiresAt; return `<tr><td class="small nowrap">${esc(when(o.createdAt))}</td><td>${userLink(o.userId, o.name)}<div class="small muted">${esc(o.email)}</div></td><td>${esc(o.planName)}</td><td class="num"><code>${esc(o.amount)}</code></td><td><span class="chip ${late ? '' : (USDTST[o.status] || [''])[0]}">${late ? 'Window closed' : esc((USDTST[o.status] || [0, o.status])[1])}</span></td><td>${o.txid ? `<a href="https://tronscan.org/#/transaction/${esc(o.txid)}" target="_blank" rel="noopener noreferrer"><code>${esc(o.txid.slice(0, 10))}…</code></a>` : '<span class="muted">-</span>'}</td></tr>`; }).join('')}</tbody></table>` : '<div class="empty">No USDT payments yet.</div>'}</div></div>
          <p class="muted small">Each order has its own exact amount. When a confirmed USDT transfer of exactly that amount reaches your address, the plan starts on its own. Orders stay matchable for 24 hours after the payment window closes. If someone sent a different amount, they can send the transaction hash, and it appears on the Upgrades page for you to approve. Click a transaction to see it on Tronscan.</p>`;
      };
      c.innerHTML = head('USDT payments', tabs([['all', 'All'], ['pending', 'Waiting'], ['paid', 'Paid'], ['review', 'In review'], ['expired', 'Expired']], S.s, 's')) + '<div id="ut2"></div>';
      c.onclick = guard(async (e) => { const b = e.target.closest('[data-s]'); if (b) { S.s = b.dataset.s; c.querySelectorAll('[data-s]').forEach((x) => x.setAttribute('aria-pressed', x === b)); await load(); } });
      await load();
    },
  };

  /* ================= Schedule ================= */
  pages.schedule = {
    title: 'Schedule',
    async render(c) {
      const S = state.sched || (state.sched = { sel: null });
      const r = await api('GET', '/admin/schedule?days=42'), today = r.today, min = r.minFree;
      const thin = r.days.slice(0, 14).filter((d) => d.freeCount < min).length, lead = (new Date(today + 'T00:00:00Z').getUTCDay() + 6) % 7;
      const MS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const long = (d) => new Date(d + 'T12:00:00Z').toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
      const cell = (d) => { const dt = new Date(d.date + 'T00:00:00Z'), n = dt.getUTCDate(); return `<button class="sd ${d.freeCount < min ? 'low' : ''} ${S.sel === d.date ? 'on' : ''} ${d.date === today ? 'tdy' : ''}" data-day="${d.date}"><b>${n}${n === 1 || d.date === today ? ` <small>${MS[dt.getUTCMonth()]}</small>` : ''}</b><span>${d.freeCount} free</span>${d.premiumCount ? `<span class="muted">${d.premiumCount} premium</span>` : ''}</button>`; };
      c.innerHTML = head('Schedule') + `<p class="muted" style="margin-top:-8px">Each day, people see only the tasks set for that day, plus any set to "Every day". Red days have fewer than ${min} tasks for free users. Click a day to see or change it.</p>
        ${thin ? `<div class="card note-card"><strong>${thin} of the next 14 days ${thin === 1 ? 'has' : 'have'} fewer than ${min} tasks for free users.</strong> Click a red day, then add tasks for it.</div>` : `<div class="card"><strong>The next 14 days look full.</strong> Every day has at least ${min} tasks for free users.</div>`}
        <div class="card"><div class="sg-head">${['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map((w) => `<span>${w}</span>`).join('')}</div><div class="sg">${'<span></span>'.repeat(lead)}${r.days.map(cell).join('')}</div></div><div id="sdet"></div>`;
      const detail = () => {
        const d = r.days.find((x) => x.date === S.sel), box = $('#sdet'); if (!d) { box.innerHTML = ''; return; }
        box.innerHTML = `<div class="card"><div class="tools" style="justify-content:space-between"><h3>${esc(long(d.date))}</h3><span class="tools">${d.dated.length ? `<button class="btn ghost" data-copy="${d.date}">Copy this day…</button>` : ''}<button class="btn" data-add="${d.date}">Add a task for this day</button></span></div>
          <p class="muted" style="margin:6px 0">${d.freeCount} task${d.freeCount === 1 ? '' : 's'} for free users${d.freeCount < min ? ` <span class="chip bad">needs ${min - d.freeCount} more</span>` : ''} · ${d.premiumCount} premium-only${r.evergreen.length ? ` · includes ${r.evergreen.length} set to every day` : ''}</p>
          ${d.dated.length ? `<table><tbody>${d.dated.map((t) => `<tr><td><strong>${esc(t.title)}</strong> <span class="chip">${esc(t.type)}</span> ${t.premium ? '<span class="chip gold">Premium</span>' : ''}</td><td class="num">${fmt(t.tokens)} WTC</td><td class="right"><button class="btn ghost sm" data-rm="${t.id}" data-day="${d.date}">Remove from this day</button></td></tr>`).join('')}</tbody></table>` : '<div class="empty">Nothing is set for just this day.</div>'}</div>`;
        c.querySelectorAll('.sd').forEach((b) => b.classList.toggle('on', b.dataset.day === S.sel));
      };
      c.onclick = guard(async (e) => {
        const b = e.target.closest('button'); if (!b) return;
        if (b.classList.contains('sd')) { S.sel = b.dataset.day; return detail(); }
        if (b.dataset.copy) return window.WC.copyDay(b.dataset.copy, today, () => pages.schedule.render(c));
        if (b.dataset.add) return window.WC.taskForm(null, () => pages.schedule.render(c), { today, preset: { mode: 'dates', dates: [b.dataset.add] } });
        if (b.dataset.rm) {
          const all = (await api('GET', '/admin/tasks')).tasks, t = all.find((x) => x.id === +b.dataset.rm), left = t.schedule.dates.filter((x) => x !== b.dataset.day);
          if (!left.length) { if (!(await confirmBox('This is its only day', `"${t.title}" is only set for this day. Hide the task instead?`, 'Hide task', true))) return; await api('DELETE', `/admin/tasks/${t.id}`); }
          else await api('PATCH', `/admin/tasks/${t.id}`, { schedule: { mode: 'dates', dates: left } });
          toast('Updated'); pages.schedule.render(c);
        }
      });
      detail();
    },
  };

  /* ================= Audit log ================= */
  pages.audit = {
    title: 'Audit log',
    async render(c) {
      let rows = [], next = null;
      c.innerHTML = head('Audit log') + '<p class="muted">Every change made from the dashboard, with who did it and when. Entries cannot be edited or deleted here.</p><div class="card"><div class="tablewrap" id="al"></div><div id="am" style="margin-top:12px"></div></div>';
      const draw = () => {
        $('#al').innerHTML = rows.length ? `<table><thead><tr><th>When</th><th>Admin</th><th>Action</th><th>Details</th></tr></thead><tbody>${rows.map((a) => `<tr><td class="small nowrap">${esc(when(a.createdAt))}</td><td>${esc(a.adminName)}</td><td><strong>${esc(ACTION[a.action] || a.action)}</strong></td><td>${a.targetType === 'user' && a.targetId ? userLink(a.targetId, 'View user') + ' · ' : ''}${esc(a.detail)}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">Nothing has been changed yet.</div>';
        $('#am').innerHTML = next ? '<button class="btn ghost" data-act="more">Load older</button>' : '';
      };
      const load = async (more) => { const r = await api('GET', '/admin/audit' + (more && next ? `?before=${next}` : '')); rows = more ? rows.concat(r.entries) : r.entries; next = r.nextCursor; draw(); };
      c.onclick = guard(async (e) => { if (e.target.closest('[data-act=more]')) await load(true); });
      await load(false);
    },
  };

  /* ================= Announcements ================= */
  pages.announce = {
    title: 'Announcements',
    async render(c) {
      const r = await api('GET', '/admin/broadcasts'), AUD = { all: 'Everyone', premium: 'Premium members', free: 'Free users' };
      c.innerHTML = head('Announcements') + `<div class="card"><h3>New announcement</h3><p class="muted">It appears in each person's notifications inside the app. Keep it short and factual.</p>
        <label for="bM">Message</label><textarea id="bM" rows="3" maxlength="300"></textarea><div class="small muted right" id="bC">0 / 300</div>
        <label for="bA">Send to</label><select id="bA"><option value="all">Everyone (${r.counts.all})</option><option value="premium">Premium members (${r.counts.premium})</option><option value="free">Free users (${r.counts.free})</option></select>
        <label class="check"><input type="checkbox" id="bP"> Also send it to people's phones as a notification</label><div class="mfoot"><button class="btn" data-act="send">Send announcement</button></div></div>
        <div class="card"><h3 style="margin-bottom:6px">Sent so far</h3>${r.history.length ? `<table><thead><tr><th>When</th><th>Message</th><th>To</th><th class="num">Reached</th></tr></thead><tbody>${r.history.map((b) => `<tr><td class="small nowrap">${esc(when(b.createdAt))}<div class="muted">${esc(b.adminName)}</div></td><td>${esc(b.message)}</td><td>${AUD[b.audience]}</td><td class="num">${fmt(b.recipients)}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">No announcements sent yet.</div>'}</div>`;
      $('#bM').oninput = (e) => { $('#bC').textContent = `${e.target.value.length} / 300`; };
      c.onclick = guard(async (e) => {
        if (!e.target.closest('[data-act=send]')) return;
        const message = $('#bM').value.trim(), audience = $('#bA').value;
        if (message.length < 3) throw new Error('Write a message first');
        if (await confirmBox('Send this announcement?', `It goes to ${r.counts[audience]} user${r.counts[audience] === 1 ? '' : 's'} and cannot be unsent.`, 'Send')) {
          const s = await api('POST', '/admin/broadcasts', { message, audience, push: $('#bP').checked }); toast(`Sent to ${s.recipients} users`); pages.announce.render(c);
        }
      });
    },
  };

  /* ================= Task performance ================= */
  pages.performance = {
    title: 'Task performance',
    async render(c) {
      const S = state.perf || (state.perf = { days: 30, sort: 'started' });
      const load = async () => {
        const { tasks } = await api('GET', `/admin/tasks/stats?days=${S.days}`);
        const live = tasks.filter((t) => t.started > 0);
        const by = { started: (a, b) => b.started - a.started, low: (a, b) => (a.completionRate ?? 2) - (b.completionRate ?? 2), wrong: (a, b) => (b.wrongRate ?? -1) - (a.wrongRate ?? -1), paid: (a, b) => b.spent - a.spent };
        const list = [...tasks].sort(by[S.sort]);
        const best = [...live].sort((a, b) => b.completionRate - a.completionRate)[0], worst = [...live].filter((t) => t.started >= 3).sort((a, b) => a.completionRate - b.completionRate)[0];
        $('#pf').innerHTML = `<div class="grid g-tiles"><div class="card tile"><div class="k">Tasks started</div><div class="v">${fmt(tasks.reduce((a, t) => a + t.started, 0))}</div></div>
          <div class="card tile"><div class="k">Completed</div><div class="v">${fmt(tasks.reduce((a, t) => a + t.done, 0))}</div></div>
          <div class="card tile"><div class="k">Best completion</div><div class="v small-v">${best ? esc(best.title) : '-'}</div><div class="small muted">${best ? pct(best.completionRate) : ''}</div></div>
          <div class="card tile ${worst && worst.completionRate < 0.5 ? 'alert' : ''}"><div class="k">Needs a look</div><div class="v small-v">${worst ? esc(worst.title) : '-'}</div><div class="small muted">${worst ? pct(worst.completionRate) + ' finish it' : 'Not enough data'}</div></div></div>
          <div class="card" style="margin-top:16px"><div class="tablewrap">${list.length ? `<table><thead><tr><th>Task</th><th class="num">Started</th><th class="num">Completed</th><th class="num">Completion</th><th class="num">Wrong answer</th><th class="num">Unfinished</th><th class="num">Avg time</th><th class="num">WTC paid</th></tr></thead><tbody>${list.map((t) => `<tr><td><strong>${esc(t.title)}</strong><div class="small"><span class="chip">${TYPE[t.type]}</span> ${t.premium ? '<span class="chip gold">Premium</span>' : ''} ${t.active ? '' : '<span class="chip">Hidden</span>'}</div></td>
            <td class="num">${fmt(t.started)}</td><td class="num">${fmt(t.done)}</td><td class="num">${t.completionRate != null && t.started >= 3 && t.completionRate < 0.5 ? `<span class="chip bad">${pct(t.completionRate)}</span>` : pct(t.completionRate)}</td>
            <td class="num">${t.wrongRate != null && t.started >= 3 && t.wrongRate > 0.3 ? `<span class="chip gold">${pct(t.wrongRate)}</span>` : pct(t.wrongRate)}</td><td class="num">${fmt(t.unfinished)}</td><td class="num">${t.avgSeconds == null ? '-' : t.avgSeconds + 's'}</td><td class="num">${fmt(t.spent)}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">No tasks yet.</div>'}</div></div>
          <p class="muted small">A high wrong-answer rate can mean the question is unclear. A low completion rate can mean the video is too long or the reward is too small. Rates need at least 3 starts to be flagged.</p>`;
      };
      c.innerHTML = head('Task performance', `<label class="check" style="margin:0">Sort by <select id="ps" style="width:auto"><option value="started">Most started</option><option value="low">Lowest completion</option><option value="wrong">Highest wrong answers</option><option value="paid">Most WTC paid</option></select></label>${tabs([[7, '7 days'], [30, '30 days'], [90, '90 days']], S.days, 'd')}`) + '<div id="pf"></div>';
      $('#ps').value = S.sort; $('#ps').onchange = guard(async (e) => { S.sort = e.target.value; await load(); });
      c.onclick = guard(async (e) => { const b = e.target.closest('[data-d]'); if (b) { S.days = +b.dataset.d; c.querySelectorAll('[data-d]').forEach((x) => x.setAttribute('aria-pressed', x === b)); await load(); } });
      await load();
    },
  };

  /* ================= Fraud checks ================= */
  pages.fraud = {
    title: 'Fraud checks',
    async render(c) {
      const f = await api('GET', '/admin/fraud');
      const row = (u) => `<tr><td>${userLink(u.id, u.name)}<div class="small muted">${esc(u.email)}</div></td><td class="num">${fmt(u.balance)}</td><td class="num">${u.flags ? `<span class="chip bad">${u.flags}</span>` : '0'}</td><td>${u.banned ? '<span class="chip bad">Banned</span>' : '<span class="chip ok">Active</span>'}</td><td><div class="acts">${u.banned ? '' : `<button class="btn ghost sm" data-act="ban" data-id="${u.id}" data-n="${esc(u.name)}">Ban</button>`}</div></td></tr>`;
      const th = '<thead><tr><th>User</th><th class="num">Balance</th><th class="num">Flags</th><th>Status</th><th></th></tr></thead>';
      c.innerHTML = head('Fraud checks') + '<div class="card note-card"><strong>These are signals, not proof.</strong> Family members, students and people on the same mobile network can share one address. Look at the accounts before you ban anyone.</div>' +
        `<div class="card"><h3>Accounts that signed up from the same network</h3>${f.clusters.length ? f.clusters.map((g) => `<div class="cluster"><div class="tools" style="justify-content:space-between"><strong><code>${esc(g.ip)}</code></strong><span class="chip ${g.count >= 4 ? 'bad' : 'gold'}">${g.count} accounts</span></div><div class="tablewrap"><table>${th}<tbody>${g.users.map(row).join('')}</tbody></table></div></div>`).join('') : '<div class="empty">No shared networks found.</div>'}</div>` +
        `<div class="card"><h3>Accounts that answered questions too fast</h3><p class="muted small" style="margin:0 0 8px">Answering within 1.5 seconds of the timer ending counts as a bot signal and pays nothing.</p>${f.flagged.length ? `<div class="tablewrap"><table>${th}<tbody>${f.flagged.map(row).join('')}</tbody></table></div>` : '<div class="empty">No flagged accounts.</div>'}</div>` +
        `<div class="card"><h3>People inviting accounts from their own network</h3><p class="muted small" style="margin:0 0 8px">Two or more invited friends signed up from the same network as the person who invited them. This is a common way to farm referral bonuses.</p>${f.referralRings.length ? `<table><thead><tr><th>Inviter</th><th class="num">Balance</th><th class="num">Same-network friends</th></tr></thead><tbody>${f.referralRings.map((r) => `<tr><td>${userLink(r.id, r.name)}<div class="small muted">${esc(r.email)}</div></td><td class="num">${fmt(r.balance)}</td><td class="num"><span class="chip bad">${r.sameNetwork}</span></td></tr>`).join('')}</tbody></table>` : '<div class="empty">None found.</div>'}</div>`;
      c.onclick = guard(async (e) => {
        const b = e.target.closest('[data-act=ban]'); if (!b) return;
        if (await confirmBox(`Ban ${b.dataset.n}?`, 'They are signed out and cannot earn until unbanned.', 'Ban user', true)) { await api('POST', `/admin/users/${b.dataset.id}/ban`, { banned: true }); toast('User banned'); pages.fraud.render(c); }
      });
    },
  };

  /* ================= Economics ================= */
  pages.economics = {
    title: 'Economics',
    async render(c) {
      const S = state.eco || (state.eco = { days: 30 });
      const load = async () => {
        const e = await api('GET', `/admin/economics?days=${S.days}`), t = e.totals, lab = e.days.map((d) => d.date.slice(5)), max = Math.max(1, ...e.bySource.map((s) => s.wtc));
        const tile = (k, v, sub, cls) => `<div class="card tile ${cls || ''}"><div class="k">${k}</div><div class="v">${v}</div>${sub ? `<div class="small muted">${sub}</div>` : ''}</div>`;
        $('#ec').innerHTML = `<div class="grid g-tiles">
          ${tile('Premium revenue', usdt(t.revenueUsdt) + ' USDT', `${t.upgradesApproved} upgrade${t.upgradesApproved === 1 ? '' : 's'} approved`)}
          ${tile('Tokens issued', fmt(t.issuedWtc) + ' WTC', `≈ ${usdt(t.issuedUsdt)} USDT at ${e.price}`)}
          ${tile('Revenue minus token value', (t.netUsdt >= 0 ? '+' : '') + usdt(t.netUsdt) + ' USDT', t.netUsdt >= 0 ? 'Revenue covers the tokens issued' : 'Tokens issued are worth more than revenue', t.netUsdt < 0 ? 'alert' : '')}
          ${tile('Premium members now', fmt(t.premiumActive))}</div>
          <div class="grid g-charts" style="margin-top:16px">${bars('Premium revenue per day (USDT)', e.days.map((d) => d.revenueUsdt), lab, 'b1')}${bars('Tokens issued per day (WTC)', e.days.map((d) => d.issuedWtc), lab, 'b2')}</div>
          <div class="card" style="margin-top:16px"><h3>Where the tokens came from</h3>${e.bySource.length ? e.bySource.map((s) => `<div class="hb"><span>${esc({ task: 'Tasks', streak: 'Streak bonus', spin: 'Spin wheel', bonus: 'All-tasks bonus', referral: 'Referrals', challenge: 'Challenges' }[s.kind] || s.kind)}</span><div class="bar"><i style="width:${s.wtc / max * 100}%"></i></div><span class="num small">${fmt(s.wtc)}</span></div>`).join('') : '<div class="empty">No tokens issued in this period.</div>'}</div>
          <p class="muted small">${esc(e.note)} This is a guide, not an accounting report. WTC has no market price yet, so its value here is the app's own rate.</p>`;
      };
      c.innerHTML = head('Economics', tabs([[7, '7 days'], [30, '30 days'], [90, '90 days']], S.days, 'd')) + '<div id="ec"></div>';
      c.onclick = guard(async (e) => { const b = e.target.closest('[data-d]'); if (b) { S.days = +b.dataset.d; c.querySelectorAll('[data-d]').forEach((x) => x.setAttribute('aria-pressed', x === b)); await load(); } });
      await load();
    },
  };
})();
