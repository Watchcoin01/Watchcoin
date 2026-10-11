/* The six dashboard pages. Each page: { title, render(container, ctx) }. */
(function () {
  const { $, esc, fmt, usdt, when, api, toast, modal, confirmBox, bars, download, state, pages, can, roleChip, country } = window.WC;
  const TYPE = { watch: 'Watch', like: 'Like', subscribe: 'Subscribe', poll: 'Poll' };
  const head = (title, tools = '') => `<div class="head"><h1>${esc(title)}</h1><div class="tools">${tools}</div></div>`;
  const tabs = (items, cur, attr) => `<div class="tabs" role="group">${items.map(([k, l]) => `<button data-${attr}="${k}" aria-pressed="${k === cur}">${esc(l)}</button>`).join('')}</div>`;
  const ytId = (u) => { const m = String(u || '').trim().match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/); return m ? m[1] : ''; };
  const thumb = (t) => { const id = ytId(t.url), src = t.cover || (id ? `https://i.ytimg.com/vi/${id}/mqdefault.jpg` : ''); return `<span class="th">${src ? `<img src="${esc(src)}" alt="">` : ''}</span>`; };
  document.addEventListener('error', (e) => { if (e.target && e.target.tagName === 'IMG' && e.target.closest('.th')) e.target.style.display = 'none'; }, true);
  const guard = (fn) => async (...a) => { try { await fn(...a); } catch (e) { toast(e.message, true); } };

  /* ================= Overview ================= */
  pages.overview = {
    title: 'Overview',
    async render(c) {
      const days = state.days || 7;
      const [s, cg] = await Promise.all([api('GET', '/admin/stats'), api('GET', `/admin/charts?days=${days}`)]);
      const last = cg.days[cg.days.length - 1], p = s.tokenPrice;
      const tile = (k, v, sub, href, alert) => `<${href ? `a href="${href}"` : 'div'} class="card tile ${alert ? 'alert' : ''}"><div class="k">${k}</div><div class="v">${v}</div>${sub ? `<div class="small muted">${sub}</div>` : ''}</${href ? 'a' : 'div'}>`;
      const lab = cg.days.map((d) => d.date.slice(5));
      c.innerHTML = head('Overview', (can('admin') ? '<a class="btn" href="#/tasks?new=1">Add video</a>' : '') + tabs([[7, '7 days'], [14, '14 days'], [30, '30 days']], days, 'rng')) +
        `<div class="grid g-tiles">
          ${tile('Users', fmt(s.users), `+${last.signups} today`)}
          ${tile('Tasks completed today', fmt(s.tasksCompletedToday))}
          ${tile('WTC paid out', fmt(s.wtcPaidOut), `≈ ${usdt(s.wtcPaidOut * p)} USDT`)}
          ${tile('WTC in circulation', fmt(s.wtcInCirculation), `≈ ${usdt(s.wtcInCirculation * p)} USDT`)}
          ${tile('Premium members', fmt(s.premiumActive))}
          ${tile('Pending upgrades', fmt(s.pendingUpgrades), s.pendingUpgrades ? 'Needs review' : 'All clear', '#/upgrades', s.pendingUpgrades)}
          ${tile('Open support requests', fmt(s.openTickets), s.openTickets ? 'Needs a reply' : 'All clear', '#/support', s.openTickets)}
          ${tile('Flagged accounts', fmt(s.flaggedUsers), 'Answered quizzes too fast', '#/users?flagged=1', s.flaggedUsers)}
          ${tile('Banned users', fmt(s.banned))}
        </div>
        <div class="grid g-charts" style="margin-top:16px">
          ${bars('Signups per day', cg.days.map((d) => d.signups), lab, 'b1')}
          ${bars('Tasks completed per day', cg.days.map((d) => d.tasks), lab, 'b2')}
          ${bars('WTC issued per day', cg.days.map((d) => d.wtcIssued), lab, 'b3')}
        </div>
        <div class="card" style="margin-top:16px"><h3>Token economics</h3>
          <p class="muted" style="margin:6px 0 0">1 WTC = ${p} USDT. In the last ${days} days you issued ${fmt(cg.days.reduce((a, d) => a + d.wtcIssued, 0))} WTC
          (about ${usdt(cg.days.reduce((a, d) => a + d.wtcIssued, 0) * p)} USDT of value). Compare this with what premium plans and advertisers bring in before launch.</p></div>`;
      c.onclick = (e) => { const b = e.target.closest('[data-rng]'); if (b) { state.days = +b.dataset.rng; pages.overview.render(c); } };
    },
  };

  /* ================= Tasks ================= */
  pages.tasks = {
    title: 'Videos & tasks',
    async render(c, ctx) {
      const S = state.tasks || (state.tasks = { f: 'all', q: '' });
      let tasks = [];
      const load = async () => { tasks = (await api('GET', '/admin/tasks')).tasks; draw(); };
      c.innerHTML = head('Videos & tasks', `<input type="search" class="search" id="tq" placeholder="Search tasks" aria-label="Search tasks" value="${esc(S.q)}">${tabs([['all', 'All'], ['active', 'Active'], ['hidden', 'Hidden']], S.f, 'tf')}<button class="btn" data-act="new">Add video</button>`) + '<p class="muted" style="margin-top:-8px">Each video becomes a task. People watch it, answer your question, and earn the reward. Likes, subscribes and polls are tasks too.</p><div class="card"><div class="tablewrap" id="tt"></div></div>';
      function draw() {
        c.querySelectorAll('.card > .err').forEach((e) => e.remove());
        const list = tasks.filter((t) => (S.f === 'all' || (S.f === 'active') === t.active) && t.title.toLowerCase().includes(S.q.toLowerCase()));
        const act = tasks.filter((t) => t.active).length;
        $('#tt').innerHTML = list.length ? `<table><thead><tr><th>Video or task</th><th class="num">Reward</th><th class="num">Time</th><th class="num">Done</th><th>Budget</th><th>Status</th><th></th></tr></thead><tbody>${list.map((t) => {
          const i = tasks.indexOf(t), dbl = t.doubleUntil && t.doubleUntil > Date.now();
          return `<tr><td><div class="vt">${thumb(t)}<div><strong>${esc(t.title)}</strong><div class="small"><span class="chip">${TYPE[t.type]}</span> ${t.premium ? '<span class="chip gold">Premium</span>' : ''} ${dbl ? `<span class="chip ok">2x until ${esc(when(t.doubleUntil))}</span>` : ''}</div></div></div></td>
            <td class="num">${fmt(t.tokens)} WTC</td><td class="num">${t.secs ? t.secs + 's' : '-'}</td><td class="num">${fmt(t.completed)}</td>
            <td>${t.budget ? `<div class="bar"><i style="width:${Math.min(100, t.spent / t.budget * 100)}%"></i></div><div class="small muted">${fmt(t.spent)} / ${fmt(t.budget)}</div>` : '<span class="muted">No limit</span>'}</td>
            <td>${t.active ? '<span class="chip ok">Active</span>' : '<span class="chip">Hidden</span>'}</td>
            <td><div class="acts"><button class="btn ghost sm" data-act="up" data-i="${i}" ${i === 0 ? 'disabled' : ''} aria-label="Move up">↑</button><button class="btn ghost sm" data-act="down" data-i="${i}" ${i === tasks.length - 1 ? 'disabled' : ''} aria-label="Move down">↓</button><button class="btn ghost sm" data-act="edit" data-id="${t.id}">Edit</button><button class="btn ghost sm" data-act="${t.active ? 'hide' : 'show'}" data-id="${t.id}">${t.active ? 'Hide' : 'Show'}</button></div></td></tr>`;
        }).join('')}</tbody></table>` : '<div class="empty">No tasks match.</div>';
        const warn = act < 5 ? `<div class="err" style="margin-top:10px">Only ${act} active task${act === 1 ? '' : 's'}. Every user should have at least 5 a day.</div>` : '';
        $('#tt').insertAdjacentHTML('beforebegin', warn);
      }
      const rm = () => c.querySelectorAll('.card > .err').forEach((e) => e.remove());
      const swap = guard(async (i, d) => { const a = tasks[i], b = tasks[i + d]; await api('PATCH', `/admin/tasks/${a.id}`, { position: b.position }); await api('PATCH', `/admin/tasks/${b.id}`, { position: a.position }); await load(); });
      c.onclick = guard(async (e) => {
        const b = e.target.closest('button'); if (!b) return;
        if (b.dataset.tf) { S.f = b.dataset.tf; c.querySelectorAll('[data-tf]').forEach((x) => x.setAttribute('aria-pressed', x === b)); rm(); return draw(); }
        const t = tasks.find((x) => x.id === +b.dataset.id);
        if (b.dataset.act === 'new') return taskForm(null, load);
        if (b.dataset.act === 'edit') return taskForm(t, load);
        if (b.dataset.act === 'hide') { if (await confirmBox('Hide this task?', 'It disappears for all users. Past earnings stay in their wallets.', 'Hide', true)) { await api('DELETE', `/admin/tasks/${t.id}`); toast('Task hidden'); await load(); } }
        if (b.dataset.act === 'show') { await api('PATCH', `/admin/tasks/${t.id}`, { active: true }); toast('Task is active again'); await load(); }
        if (b.dataset.act === 'up') swap(+b.dataset.i, -1);
        if (b.dataset.act === 'down') swap(+b.dataset.i, 1);
      });
      $('#tq').oninput = (e) => { S.q = e.target.value; rm(); draw(); };
      await load();
      if (ctx && ctx.query.get('new')) taskForm(null, load);
    },
  };

  function shrink(file) {
    return new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => { const cv = document.createElement('canvas'); cv.width = 320; cv.height = 180; const x = cv.getContext('2d'), r = Math.max(320 / i.width, 180 / i.height); x.drawImage(i, (320 - i.width * r) / 2, (180 - i.height * r) / 2, i.width * r, i.height * r); res(cv.toDataURL('image/jpeg', 0.7)); };
      i.onerror = () => rej(new Error('That image could not be read')); i.src = URL.createObjectURL(file);
    });
  }

  function taskForm(t, reload) {
    const v = t || { type: 'watch', title: '', url: '', tokens: 10, secs: 30, question: '', options: [], answer: 0, premium: false, budget: 0 };
    modal(t ? 'Edit video or task' : 'Add a video', `
      <div id="fVid"><label for="fU">YouTube link</label><input type="url" id="fU" placeholder="Paste a YouTube link, for example https://youtu.be/..." value="${esc(v.url)}"><div id="fPrev" class="vprev"></div>
      <label for="fS">Watch time (seconds, minimum 5)</label><input type="number" id="fS" min="5" value="${v.secs || 30}"></div>
      <div class="row2"><div><label for="fY">Type</label><select id="fY">${Object.entries(TYPE).map(([k, l]) => `<option value="${k}" ${v.type === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div><label for="fK">Reward (WTC)</label><input type="number" id="fK" min="1" value="${v.tokens}"></div></div>
      <label for="fT">Title</label><input type="text" id="fT" maxlength="120" value="${esc(v.title)}">
      <label for="fQ">Question <span class="muted">(required for watch tasks, it proves the viewer watched)</span></label><input type="text" id="fQ" maxlength="200" value="${esc(v.question)}">
      <div class="row2"><div><label for="fO">Options, separated by commas</label><input type="text" id="fO" value="${esc(v.options.join(', '))}"></div>
      <div id="fAns"><label for="fA">Correct option number</label><input type="number" id="fA" min="1" value="${v.answer + 1}"></div></div>
      <div class="row2"><div><label for="fD">Double rewards for (hours)</label><input type="number" id="fD" min="0" placeholder="${t ? 'Leave blank to keep, 0 to stop' : '0'}"></div>
      <div><label for="fB">Budget (WTC, 0 = no limit)</label><input type="number" id="fB" min="0" value="${v.budget}"></div></div>
      <label class="check"><input type="checkbox" id="fP" ${v.premium ? 'checked' : ''}> Premium members only</label>
      <label for="fC">Cover image (optional)</label><input type="file" id="fC" accept="image/*">${t && t.cover ? `<img class="cover" src="${esc(t.cover)}" alt="Current cover">` : ''}`,
    [{ label: 'Cancel', cls: 'ghost', fn: (close) => close() },
      { label: t ? 'Save changes' : 'Add video', fn: async (close) => {
        const g = (id) => $('#' + id).value.trim(), type = g('fY');
        const body = { type, title: g('fT'), url: type === 'poll' ? '' : g('fU'), tokens: parseInt(g('fK')) || 0, secs: type === 'poll' ? 0 : parseInt(g('fS')) || 0,
          question: g('fQ'), options: g('fO').split(',').map((x) => x.trim()).filter(Boolean), answer: Math.max(0, (parseInt(g('fA')) || 1) - 1), premium: $('#fP').checked, budget: parseInt(g('fB')) || 0 };
        if (g('fD') !== '' || !t) body.doubleHours = parseFloat(g('fD')) || 0;
        const f = $('#fC').files[0]; if (f) body.cover = await shrink(f);
        await api(t ? 'PATCH' : 'POST', t ? `/admin/tasks/${t.id}` : '/admin/tasks', body);
        close(); toast(t ? 'Saved' : 'Video added'); await reload();
      } }],
    (m) => {
      const sync = () => { const poll = $('#fY').value === 'poll'; $('#fVid').classList.toggle('hidden', poll); $('#fAns').classList.toggle('hidden', poll); };
      const prev = () => { const u = $('#fU').value.trim(), id = ytId(u); $('#fPrev').innerHTML = !u ? '' : id ? `<span class="th big"><img src="https://i.ytimg.com/vi/${id}/mqdefault.jpg" alt=""></span><a href="https://www.youtube.com/watch?v=${id}" target="_blank" rel="noopener noreferrer">Open the video to check it</a>` : '<span class="err">That does not look like a YouTube link.</span>'; };
      $('#fY').onchange = sync; sync(); $('#fU').oninput = prev; prev();
    });
  }

  /* ================= Users ================= */
  pages.users = {
    title: 'Users',
    async render(c, ctx) {
      const S = state.users || (state.users = { q: '', off: 0, flag: false });
      if (ctx.query.get('flagged')) S.flag = true;
      const LIM = 50; let users = [];
      c.innerHTML = head('Users', `<input type="search" class="search" id="uq" placeholder="Search name or email" aria-label="Search users" value="${esc(S.q)}"><label class="check" style="margin:0"><input type="checkbox" id="uf" ${S.flag ? 'checked' : ''}> Flagged only</label>`) + '<div class="card"><div class="tablewrap" id="ut"></div><div class="tools" style="margin-top:12px;justify-content:space-between"><span class="muted small" id="up"></span><span class="tools"><button class="btn ghost sm" data-act="prev">Previous</button><button class="btn ghost sm" data-act="next">Next</button></span></div></div>';
      const load = async () => { users = (await api('GET', `/admin/users?search=${encodeURIComponent(S.q)}&limit=${LIM}&offset=${S.off}`)).users; draw(); };
      function draw() {
        const list = users.filter((u) => !S.flag || u.flags > 0);
        $('#ut').innerHTML = list.length ? `<table><thead><tr><th>User</th><th>Country</th><th>Plan</th><th class="num">Balance</th><th class="num">Earned</th><th class="num">Invited</th><th class="num">Flags</th><th>Joined</th><th></th></tr></thead><tbody>${list.map((u) => `<tr><td><a href="#/user/${u.id}"><strong>${esc(u.name)}</strong></a> ${roleChip(u.role)} ${u.banned ? '<span class="chip bad">Banned</span>' : ''}<div class="small muted">${esc(u.email)}${u.emailVerified ? '' : ' · unverified'}</div></td>
          <td class="nowrap">${esc(country(u.country)) || '<span class="muted">-</span>'}</td><td>${esc(u.plan)}</td><td class="num">${fmt(u.balance)}</td><td class="num">${fmt(u.lifetime)}</td><td class="num">${u.referrals}</td><td class="num">${u.flags ? `<span class="chip bad">${u.flags}</span>` : '0'}</td><td class="small nowrap">${esc(when(u.createdAt).split(',')[0])}</td>
          <td><div class="acts">${can('owner') ? `<button class="btn ghost sm" data-act="adj" data-id="${u.id}">Adjust</button>` : ''}${u.role !== 'user' || !can('admin') ? '' : `<button class="btn ghost sm" data-act="ban" data-id="${u.id}">${u.banned ? 'Unban' : 'Ban'}</button>`}</div></td></tr>`).join('')}</tbody></table>` : '<div class="empty">No users found.</div>';
        $('#up').textContent = `Showing ${S.off + 1}-${S.off + users.length}`;
        c.querySelector('[data-act=prev]').disabled = S.off === 0; c.querySelector('[data-act=next]').disabled = users.length < LIM;
      }
      c.onclick = guard(async (e) => {
        const b = e.target.closest('[data-act]'); if (!b) return;
        const a = b.dataset.act, u = users.find((x) => x.id === +b.dataset.id);
        if (a === 'prev') { S.off = Math.max(0, S.off - LIM); await load(); }
        if (a === 'next') { S.off += LIM; await load(); }
        if (a === 'ban') {
          const ban = !u.banned;
          if (await confirmBox(ban ? `Ban ${u.name}?` : `Unban ${u.name}?`, ban ? 'They are signed out and cannot earn until unbanned.' : 'They can use the app again.', ban ? 'Ban user' : 'Unban', ban)) { await api('POST', `/admin/users/${u.id}/ban`, { banned: ban }); toast(ban ? 'User banned' : 'User unbanned'); await load(); pages.users.afterChange && pages.users.afterChange(); }
        }
        if (a === 'adj') adjust(u, load);
      });
      let t; $('#uq').oninput = (e) => { clearTimeout(t); t = setTimeout(() => { S.q = e.target.value.trim(); S.off = 0; guard(load)(); }, 300); };
      $('#uf').onchange = (e) => { S.flag = e.target.checked; draw(); };
      await load();
    },
  };

  function adjust(u, reload) {
    modal(`Adjust balance: ${u.name}`, `<p class="muted">Current balance: <strong>${fmt(u.balance)} WTC</strong>. Use this for support cases such as missing tokens. Every change is written to the user's ledger and they get a notification.</p>
      <label for="aN">Amount (use a minus sign to remove tokens)</label><input type="number" id="aN" step="1" placeholder="e.g. 100 or -50"><div class="small muted" id="aPrev"></div>
      <label for="aR">Reason (shown to the user)</label><input type="text" id="aR" maxlength="200" placeholder="Missing tokens from task on Oct 9">`,
    [{ label: 'Cancel', cls: 'ghost', fn: (close) => close() },
      { label: 'Apply', fn: async (close) => {
        const amount = parseInt($('#aN').value), note = $('#aR').value.trim();
        if (!amount) throw new Error('Enter an amount that is not 0');
        if (note.length < 3) throw new Error('Add a short reason');
        await api('POST', `/admin/users/${u.id}/adjust`, { amount, note }); close(); toast('Balance updated'); await reload();
      } }],
    () => { $('#aN').oninput = (e) => { const n = parseInt(e.target.value); $('#aPrev').textContent = n ? `New balance: ${fmt(u.balance + n)} WTC` : ''; }; });
  }

  window.WC.adjust = adjust;

  /* ================= Upgrades ================= */
  pages.upgrades = {
    title: 'Upgrades',
    async render(c, ctx) {
      const S = state.upgrades || (state.upgrades = { s: 'pending' });
      const load = async () => {
        const { upgrades } = await api('GET', `/admin/upgrades?status=${S.s}`);
        $('#ug').innerHTML = upgrades.length ? `<table><thead><tr><th>User</th><th>Plan</th><th>Payment reference</th>${S.s === 'pending' ? '<th></th>' : ''}</tr></thead><tbody>${upgrades.map((g) => `<tr><td><strong>${esc(g.name)}</strong><div class="small muted">${esc(g.email)}</div></td><td>${esc(g.planName)} <span class="muted">(${g.priceUsdt} USDT)</span><div class="small muted">${esc(when(g.createdAt))}</div></td><td><code>${esc(g.reference)}</code></td>
          ${S.s === 'pending' ? `<td><div class="acts"><button class="btn sm" data-act="ok" data-id="${g.id}" data-n="${esc(g.name)}" data-p="${esc(g.planName)}" data-r="${esc(g.reference)}" data-u="${g.priceUsdt}">Approve</button><button class="btn ghost sm" data-act="no" data-id="${g.id}" data-n="${esc(g.name)}">Reject</button></div></td>` : ''}</tr>`).join('')}</tbody></table>` : `<div class="empty">No ${S.s} upgrade requests.</div>`;
      };
      c.innerHTML = head('Premium upgrades', tabs([['pending', 'Pending'], ['approved', 'Approved'], ['rejected', 'Rejected']], S.s, 's')) + '<p class="muted">Check that the money arrived in your account with the same reference before you approve. Approving starts a 30-day plan.</p><div class="card"><div class="tablewrap" id="ug"></div></div>';
      c.onclick = guard(async (e) => {
        const b = e.target.closest('button'); if (!b) return;
        if (b.dataset.s) { S.s = b.dataset.s; c.querySelectorAll('[data-s]').forEach((x) => x.setAttribute('aria-pressed', x === b)); return load(); }
        const ok = b.dataset.act === 'ok';
        const msg = ok ? `Have you received ${b.dataset.u} USDT from ${b.dataset.n} with reference ${b.dataset.r}? Approving gives them ${b.dataset.p} for 30 days.` : `Reject ${b.dataset.n}'s request? They will be told the payment could not be confirmed.`;
        if (await confirmBox(ok ? 'Approve upgrade' : 'Reject upgrade', msg, ok ? 'Approve' : 'Reject', !ok)) {
          await api('POST', `/admin/upgrades/${b.dataset.id}/decide`, { approve: ok }); toast(ok ? 'Plan activated' : 'Request rejected'); await load(); ctx.refresh();
        }
      });
      await load();
    },
  };

  /* ================= Support ================= */
  pages.support = {
    title: 'Support',
    async render(c, ctx) {
      const S = state.support || (state.support = { r: '0' });
      const load = async () => {
        const { tickets } = await api('GET', `/admin/tickets?resolved=${S.r}`);
        $('#tk').innerHTML = tickets.length ? tickets.map((t) => `<div class="card"><div class="tools" style="justify-content:space-between"><div><strong>${esc(t.name)}</strong> <span class="muted small">${esc(t.email)} · ${esc(when(t.createdAt))}</span></div>${S.r === '0' ? `<button class="btn sm" data-id="${t.id}">Mark resolved</button>` : '<span class="chip ok">Resolved</span>'}</div><p style="white-space:pre-wrap;margin:10px 0 0">${esc(t.message)}</p></div>`).join('') : `<div class="empty">No ${S.r === '0' ? 'open' : 'resolved'} requests.</div>`;
      };
      c.innerHTML = head('Support requests', tabs([['0', 'Open'], ['1', 'Resolved']], S.r, 'r')) + '<div id="tk"></div>';
      c.onclick = guard(async (e) => {
        const b = e.target.closest('button'); if (!b) return;
        if (b.dataset.r !== undefined) { S.r = b.dataset.r; c.querySelectorAll('[data-r]').forEach((x) => x.setAttribute('aria-pressed', x === b)); return load(); }
        await api('POST', `/admin/tickets/${b.dataset.id}/resolve`); toast('Marked resolved. The user was notified.'); await load(); ctx.refresh();
      });
      await load();
    },
  };

  /* ================= Settings ================= */
  pages.settings = {
    title: 'Settings',
    async render(c) {
      const s = await api('GET', '/admin/settings');
      const local = s.launchAt ? new Date(new Date(s.launchAt) - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 16) : '';
      c.innerHTML = head('Settings') + (can('owner') ? '' : '<div class="card note-card">Only the owner can change settings. You can look but not save.</div>') + `
        <div class="card"><h3>Payment details</h3><p class="muted">Shown to users when they upgrade to a premium plan. Add the account that receives payments, such as a USDT (TRC20) address or a mobile money number.</p>
          <textarea id="sP" rows="3" maxlength="500" aria-label="Payment details">${esc(s.paymentInfo)}</textarea><div class="tools" style="margin-top:10px"><button class="btn" data-act="pay">Save payment details</button></div></div>
        <div class="card"><h3>Launch date</h3><p class="muted">Shown to users as the countdown to the WTC launch. Leave empty to show "Launch date coming soon".</p>
          <input type="datetime-local" id="sL" value="${local}" aria-label="Launch date"><div class="tools" style="margin-top:10px"><button class="btn" data-act="launch">Save launch date</button></div></div>
        <div class="card"><h3>Token price</h3><p class="muted">The USDT value of 1 WTC. This changes the USDT amount shown to every user.</p>
          <input type="number" id="sT" step="0.000001" min="0.000001" value="${s.tokenPrice}" aria-label="Token price in USDT"><div class="tools" style="margin-top:10px"><button class="btn" data-act="price">Save price</button></div></div>
        <div class="card"><h3>Online payments (Paystack)</h3>${s.paystack.configured ? '' : '<p class="muted"><strong>Not connected.</strong> Set PAYSTACK_SECRET_KEY on the backend, then set the exchange rate here.</p>'}
          <p class="muted">How much 1 USDT costs in ${esc(s.paystack.currency)}. Plan prices are set in USDT and charged in ${esc(s.paystack.currency)} at this rate. Update it when the rate moves.</p>
          <input type="number" id="sF" step="0.01" min="0.01" value="${s.paystack.fxRate || ''}" placeholder="e.g. 15.5" aria-label="Exchange rate"><div class="tools" style="margin-top:10px"><button class="btn" data-act="fx">Save rate</button></div>
          ${s.paystack.fxRate ? `<table style="margin-top:12px"><tbody>${s.paystack.prices.map((p) => `<tr><td>${esc(p.plan)}</td><td class="num">${p.priceUsdt} USDT</td><td class="num">${p.amount.toFixed(2)} ${esc(s.paystack.currency)}</td></tr>`).join('')}</tbody></table>` : ''}
          <p class="small muted">${s.paystack.enabled ? 'Users can pay online now.' : 'Users cannot pay online yet.'} In your Paystack dashboard, set the webhook URL to <code>your-backend-address/api/webhooks/paystack</code>.</p></div>
        <div class="card"><h3>Export</h3><p class="muted">Download every user with balance, plan, and flags as a spreadsheet file.</p><button class="btn ghost" data-act="csv">Download users CSV</button></div>`;
      c.onclick = guard(async (e) => {
        const b = e.target.closest('[data-act]'); if (!b) return;
        if (b.dataset.act === 'pay') { await api('PUT', '/admin/settings', { paymentInfo: $('#sP').value.trim() }); toast('Payment details saved'); }
        if (b.dataset.act === 'launch') { const v = $('#sL').value; await api('PUT', '/admin/settings', { launchAt: v ? new Date(v).toISOString() : '' }); toast('Launch date saved'); }
        if (b.dataset.act === 'price') {
          const p = parseFloat($('#sT').value); if (!(p > 0)) throw new Error('Enter a price above 0');
          if (await confirmBox('Change the token price?', `1 WTC will be worth ${p} USDT for every user.`, 'Change price')) { await api('PUT', '/admin/settings', { tokenPrice: p }); toast('Price updated'); }
        }
        if (b.dataset.act === 'fx') {
          const r = parseFloat($('#sF').value); if (!(r > 0)) throw new Error('Enter a rate above 0');
          if (await confirmBox('Change the exchange rate?', `1 USDT = ${r} ${s.paystack.currency}. New online payments use this rate.`, 'Save rate')) { await api('PUT', '/admin/settings', { fxRate: r }); toast('Rate saved'); pages.settings.render(c); }
        }
        if (b.dataset.act === 'csv') { await download('/admin/export/users.csv', 'watchcoin-users.csv'); toast('Download started'); }
      });
    },
  };
})();
