/* The six dashboard pages. Each page: { title, render(container, ctx) }. */
(function () {
  const { $, esc, fmt, usdt, when, api, toast, modal, confirmBox, bars, download, state, pages } = window.WC;
  const TYPE = { watch: 'Watch', like: 'Like', subscribe: 'Subscribe', poll: 'Poll' };
  const head = (title, tools = '') => `<div class="head"><h1>${esc(title)}</h1><div class="tools">${tools}</div></div>`;
  const tabs = (items, cur, attr) => `<div class="tabs" role="group">${items.map(([k, l]) => `<button data-${attr}="${k}" aria-pressed="${k === cur}">${esc(l)}</button>`).join('')}</div>`;
  const ytId = (u) => { const m = String(u || '').trim().match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/); return m ? m[1] : ''; };
  const abs = (u) => { try { return new URL(u, window.WC.cfg.apiUrl).href; } catch (e) { return u; } };
  const thumb = (t) => { const id = ytId(t.url), src = t.coverUrl ? abs(t.coverUrl) : (id ? `https://i.ytimg.com/vi/${id}/mqdefault.jpg` : ''); return `<span class="th">${src ? `<img src="${esc(src)}" alt="">` : ''}</span>`; };
  document.addEventListener('error', (e) => { if (e.target && e.target.tagName === 'IMG' && e.target.closest('.th')) e.target.style.display = 'none'; }, true);
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const dayLabel = (d) => new Date(d + 'T12:00:00Z').toLocaleDateString([], { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const addDays = (s, n) => new Date(Date.parse(s + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
  // A month calendar where the admin clicks the days a task should appear on. `sel` is a Set of YYYY-MM-DD dates.
  function mountCalendar(sel, today, startMode, setMode, focus) {
    const first = focus || [...sel].sort().find((d) => d >= today) || today, view = { y: +first.slice(0, 4), m: +first.slice(5, 7) - 1 };
    const draw = () => {
      const lead = (new Date(Date.UTC(view.y, view.m, 1)).getUTCDay() + 6) % 7, dim = new Date(Date.UTC(view.y, view.m + 1, 0)).getUTCDate();
      let cells = '<span></span>'.repeat(lead);
      for (let d = 1; d <= dim; d++) {
        const ds = `${view.y}-${String(view.m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        cells += `<button type="button" class="cd ${sel.has(ds) ? 'sel' : ''} ${ds === today ? 'today' : ''}" data-d="${ds}" ${ds < today ? 'disabled' : ''} aria-pressed="${sel.has(ds)}" aria-label="${ds}">${d}</button>`;
      }
      $('#fCal').innerHTML = `<div class="cal-head"><button type="button" class="btn ghost sm" data-nav="-1" aria-label="Previous month">‹</button><strong>${MONTHS[view.m]} ${view.y}</strong><button type="button" class="btn ghost sm" data-nav="1" aria-label="Next month">›</button></div><div class="cal-grid">${['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map((w) => `<i>${w}</i>`).join('')}${cells}</div>`;
      const all = [...sel].sort(), fut = all.filter((d) => d >= today), past = all.length - fut.length;
      $('#fCalInfo').innerHTML = all.length ? `<strong>${fut.length} day${fut.length === 1 ? '' : 's'} selected</strong>${fut.length ? ': ' + fut.slice(0, 6).map(dayLabel).join(', ') + (fut.length > 6 ? ` and ${fut.length - 6} more` : '') : ''}${past ? ` <span class="muted">(${past} past date${past === 1 ? '' : 's'} kept)</span>` : ''}` : '<span class="muted">No days picked yet.</span>';
    };
    const showMode = (m) => {
      setMode(m);
      document.querySelectorAll('[data-showfor]').forEach((el) => el.classList.toggle('hidden', !el.dataset.showfor.split(' ').includes(m)));
      document.querySelectorAll('#fWhen [data-w]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.w === m));
    };
    if ($('#fWhen')) $('#fWhen').onclick = (e) => { const b = e.target.closest('[data-w]'); if (b) showMode(b.dataset.w); };
    $('#fDates').onclick = (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.d) { if (sel.has(b.dataset.d)) sel.delete(b.dataset.d); else sel.add(b.dataset.d); }
      else if (b.dataset.nav) { view.m += +b.dataset.nav; if (view.m < 0) { view.m = 11; view.y--; } if (view.m > 11) { view.m = 0; view.y++; } }
      else if (b.dataset.cal === 'clear') sel.clear();
      else if (b.dataset.cal) for (let i = 0; i < +b.dataset.cal; i++) sel.add(addDays(today, i));
      draw();
    };
    showMode(startMode); draw();
  }
  const guard = (fn) => async (...a) => { try { await fn(...a); } catch (e) { toast(e.message, true); } };

  /* ================= Overview ================= */
  pages.overview = {
    title: 'Overview',
    async render(c) {
      const days = state.days || 7;
      const [s, cg, sc] = await Promise.all([api('GET', '/admin/stats'), api('GET', `/admin/charts?days=${days}`), api('GET', '/admin/schedule?days=14')]);
      const thin = sc.days.filter((d) => d.freeCount < sc.minFree).length;
      const last = cg.days[cg.days.length - 1], p = s.tokenPrice;
      const tile = (k, v, sub, href, alert) => `<${href ? `a href="${href}"` : 'div'} class="card tile ${alert ? 'alert' : ''}"><div class="k">${k}</div><div class="v">${v}</div>${sub ? `<div class="small muted">${sub}</div>` : ''}</${href ? 'a' : 'div'}>`;
      const lab = cg.days.map((d) => d.date.slice(5));
      c.innerHTML = head('Overview', '<a class="btn" href="#/tasks?new=1">Add video</a>' + tabs([[7, '7 days'], [14, '14 days'], [30, '30 days']], days, 'rng')) +
        `<div class="grid g-tiles">
          ${tile('Users', fmt(s.users), `+${last.signups} today`)}
          ${tile('Tasks completed today', fmt(s.tasksCompletedToday))}
          ${tile('WTC paid out', fmt(s.wtcPaidOut), `≈ ${usdt(s.wtcPaidOut * p)} USDT`)}
          ${tile('WTC in circulation', fmt(s.wtcInCirculation), `≈ ${usdt(s.wtcInCirculation * p)} USDT`)}
          ${tile('Premium members', fmt(s.premiumActive))}
          ${tile('Pending upgrades', fmt(s.pendingUpgrades), s.pendingUpgrades ? 'Needs review' : 'All clear', '#/upgrades', s.pendingUpgrades)}
          ${tile('Open support requests', fmt(s.openTickets), s.openTickets ? 'Needs a reply' : 'All clear', '#/support', s.openTickets)}
          ${tile('Days needing tasks', fmt(thin), thin ? 'Fewer than 5 tasks, in the next 14 days' : 'The next 14 days look full', '#/schedule', thin)}
          ${s.paymentsToReview ? tile('Payments to review', fmt(s.paymentsToReview), 'Amount did not match', '#/payments', 1) : ''}
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
      let tasks = [], today = '';
      const onToday = (t) => t.active && (t.schedule.mode === 'daily' || t.schedule.dates.includes(today));
      const whenCell = (t) => {
        if (t.schedule.mode === 'daily') return '<span class="chip">Every day</span>';
        const ds = t.schedule.dates, up = ds.filter((d) => d >= today);
        return `<div class="small"><strong>${ds.length} day${ds.length === 1 ? '' : 's'}</strong> ${up.includes(today) ? '<span class="chip ok">Today</span>' : ''}</div><div class="small muted">${up.length ? 'next: ' + dayLabel(up[0]) : 'all dates passed'}</div>`;
      };
      const load = async () => { const [r, sc] = await Promise.all([api('GET', '/admin/tasks'), api('GET', '/admin/schedule?days=1')]); tasks = r.tasks; today = sc.today; draw(); };
      c.innerHTML = head('Videos & tasks', `<input type="search" class="search" id="tq" placeholder="Search tasks" aria-label="Search tasks" value="${esc(S.q)}">${tabs([['all', 'All'], ['today', 'On today'], ['active', 'Active'], ['hidden', 'Hidden']], S.f, 'tf')}<button class="btn ghost" data-act="bulk">Bulk add</button><button class="btn" data-act="new">Add video</button>`) + '<p class="muted" style="margin-top:-8px">Each video becomes a task. People watch it, answer your question, and earn the reward. Likes, subscribes and polls are tasks too.</p><div class="card"><div class="tablewrap" id="tt"></div></div>';
      function draw() {
        c.querySelectorAll('.card > .err').forEach((e) => e.remove());
        const list = tasks.filter((t) => (S.f === 'all' || (S.f === 'today' ? onToday(t) : (S.f === 'active') === t.active)) && t.title.toLowerCase().includes(S.q.toLowerCase()));
        const act = tasks.filter((t) => t.active).length;
        $('#tt').innerHTML = list.length ? `<table><thead><tr><th>Video or task</th><th>When</th><th class="num">Reward</th><th class="num">Time</th><th class="num">Done</th><th>Budget</th><th>Status</th><th></th></tr></thead><tbody>${list.map((t) => {
          const i = tasks.indexOf(t), dbl = t.doubleUntil && t.doubleUntil > Date.now();
          return `<tr><td><div class="vt">${thumb(t)}<div><strong>${esc(t.title)}</strong><div class="small"><span class="chip">${TYPE[t.type]}</span> ${t.premium ? '<span class="chip gold">Premium</span>' : ''} ${dbl ? `<span class="chip ok">2x until ${esc(when(t.doubleUntil))}</span>` : ''}</div></div></div></td>
            <td>${whenCell(t)}</td><td class="num">${fmt(t.tokens)} WTC</td><td class="num">${t.secs ? t.secs + 's' : '-'}</td><td class="num">${fmt(t.completed)}</td>
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
        if (b.dataset.act === 'new') return taskForm(null, load, { today });
        if (b.dataset.act === 'bulk') return window.WC.bulkAdd(load, today);
        if (b.dataset.act === 'edit') return taskForm(t, load, { today });
        if (b.dataset.act === 'hide') { if (await confirmBox('Hide this task?', 'It disappears for all users. Past earnings stay in their wallets.', 'Hide', true)) { await api('DELETE', `/admin/tasks/${t.id}`); toast('Task hidden'); await load(); } }
        if (b.dataset.act === 'show') { await api('PATCH', `/admin/tasks/${t.id}`, { active: true }); toast('Task is active again'); await load(); }
        if (b.dataset.act === 'up') swap(+b.dataset.i, -1);
        if (b.dataset.act === 'down') swap(+b.dataset.i, 1);
      });
      $('#tq').oninput = (e) => { S.q = e.target.value; rm(); draw(); };
      await load();
      if (ctx && ctx.query.get('new')) taskForm(null, load, { today });
    },
  };

  // Turns the chosen picture into a small 16:9 JPEG. It reads the file directly (no blob: address), because this page's
  // security policy does not allow images from blob: addresses.
  function readImage(file) {
    const viaImage = () => new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onerror = () => rej(new Error('That picture could not be read.'));
      fr.onload = () => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('That picture could not be read. Try a JPEG or PNG.')); i.src = fr.result; };
      fr.readAsDataURL(file);
    });
    return window.createImageBitmap ? createImageBitmap(file).catch(viaImage) : viaImage();
  }
  async function shrink(file) {
    if (!/^image\//.test(file.type || '')) throw new Error('Choose a picture file (JPEG, PNG or WebP).');
    if (file.size > 15 * 1024 * 1024) throw new Error('That picture is too big. Choose one under 15 MB.');
    const img = await readImage(file), w = img.naturalWidth || img.width, h = img.naturalHeight || img.height, W = 640, H = 360;
    if (!w || !h) throw new Error('That picture could not be read.');
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const x = cv.getContext('2d'), k = Math.max(W / w, H / h);
    x.fillStyle = '#fff'; x.fillRect(0, 0, W, H); // white behind see-through PNGs
    x.drawImage(img, (W - w * k) / 2, (H - h * k) / 2, w * k, h * k);
    let q = 0.8, out = cv.toDataURL('image/jpeg', q);
    while (out.length > 150000 && q > 0.45) { q -= 0.1; out = cv.toDataURL('image/jpeg', q); }
    if (out.length > 190000) throw new Error('That picture is too detailed. Try a simpler one.');
    return out;
  }

  function taskForm(t, reload, opt = {}) {
    const today = opt.today || new Date().toISOString().slice(0, 10), sched = t ? t.schedule : (opt.preset || { mode: 'dates', dates: [] });
    const sel = new Set(sched.dates); let mode = sched.mode, pendingCover = '', coverBusy = Promise.resolve();
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
      <label>When should this appear?</label>
      <div class="tabs" id="fWhen" role="group"><button type="button" data-w="dates" aria-pressed="true">On chosen dates</button><button type="button" data-w="daily" aria-pressed="false">Every day</button></div>
      <div id="fDates" data-showfor="dates"><p class="small muted" style="margin:8px 0 6px">Pick the days this should appear. People see each task only on its days, so you can plan a whole week or month in one go.</p>
        <div class="cal-tools"><button type="button" class="btn ghost sm" data-cal="7">Next 7 days</button><button type="button" class="btn ghost sm" data-cal="14">Next 14 days</button><button type="button" class="btn ghost sm" data-cal="30">Next 30 days</button><button type="button" class="btn ghost sm" data-cal="clear">Clear</button></div>
        <div class="cal" id="fCal"></div><div class="small" id="fCalInfo" style="margin-top:6px"></div></div>
      <div id="fDaily" data-showfor="daily" class="hidden small muted" style="margin-top:8px">This task shows every day, so people will see the same task again each day. Use it only for things that should always be there.</div>
      <label for="fC">Cover picture (optional)</label>
      <div class="cvr"><div id="fCv" class="th big">${t && t.coverUrl ? `<img src="${esc(abs(t.coverUrl))}" alt="Current cover">` : ''}</div>
        <div style="flex:1;min-width:180px"><input type="file" id="fC" accept="image/jpeg,image/png,image/webp"><div class="small muted" id="fCm" style="margin-top:6px">${t && t.hasCover ? 'Choose a new picture to replace the current one.' : 'A wide (16:9) picture looks best. Without one, people see a blue play tile.'}</div>
        ${t && t.hasCover ? '<label class="check" style="margin-top:8px"><input type="checkbox" id="fCx"> Remove the current cover</label>' : ''}</div></div>`,
    [{ label: 'Cancel', cls: 'ghost', fn: (close) => close() },
      { label: t ? 'Save changes' : 'Add video', fn: async (close) => {
        const g = (id) => $('#' + id).value.trim(), type = g('fY');
        const body = { type, title: g('fT'), url: type === 'poll' ? '' : g('fU'), tokens: parseInt(g('fK')) || 0, secs: type === 'poll' ? 0 : parseInt(g('fS')) || 0,
          question: g('fQ'), options: g('fO').split(',').map((x) => x.trim()).filter(Boolean), answer: Math.max(0, (parseInt(g('fA')) || 1) - 1), premium: $('#fP').checked, budget: parseInt(g('fB')) || 0 };
        if (mode === 'dates' && !sel.size) throw new Error('Pick at least one date, or choose Every day.');
        body.schedule = mode === 'daily' ? { mode: 'daily', dates: [] } : { mode: 'dates', dates: [...sel].sort() };
        if (g('fD') !== '' || !t) body.doubleHours = parseFloat(g('fD')) || 0;
        await coverBusy; // wait if a picture is still being prepared
        if (pendingCover) body.cover = pendingCover; else if ($('#fCx') && $('#fCx').checked) body.cover = '';
        await api(t ? 'PATCH' : 'POST', t ? `/admin/tasks/${t.id}` : '/admin/tasks', body);
        close(); toast(t ? 'Saved' : 'Video added'); await reload();
      } }],
    (m) => {
      const sync = () => { const poll = $('#fY').value === 'poll'; $('#fVid').classList.toggle('hidden', poll); $('#fAns').classList.toggle('hidden', poll); };
      const prev = () => { const u = $('#fU').value.trim(), id = ytId(u); $('#fPrev').innerHTML = !u ? '' : id ? `<span class="th big"><img src="https://i.ytimg.com/vi/${id}/mqdefault.jpg" alt=""></span><a href="https://www.youtube.com/watch?v=${id}" target="_blank" rel="noopener noreferrer">Open the video to check it</a>` : '<span class="err">That does not look like a YouTube link.</span>'; };
      $('#fY').onchange = sync; sync(); $('#fU').oninput = prev; prev();
      mountCalendar(sel, today, mode, (m) => { mode = m; });
      $('#fC').onchange = () => {
        const f = $('#fC').files[0]; $('#mErr').textContent = ''; pendingCover = ''; if (!f) return;
        $('#fCm').textContent = 'Preparing your picture…';
        coverBusy = (async () => {
          try {
            const d = await shrink(f); pendingCover = d;
            $('#fCv').innerHTML = `<img src="${d}" alt="New cover">`; $('#fCm').textContent = `New cover ready (${Math.round(d.length * 0.75 / 1024)} KB). It is saved when you press the button below.`;
            if ($('#fCx')) $('#fCx').checked = false;
          } catch (e) { $('#fC').value = ''; $('#fCm').textContent = ''; $('#mErr').textContent = e.message; }
        })();
      };
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
        $('#ut').innerHTML = list.length ? `<table><thead><tr><th>User</th><th>Plan</th><th class="num">Balance</th><th class="num">Earned</th><th class="num">Invited</th><th class="num">Flags</th><th>Joined</th><th></th></tr></thead><tbody>${list.map((u) => `<tr><td><a href="#/user/${u.id}"><strong>${esc(u.name)}</strong></a> ${u.role === 'admin' ? '<span class="chip gold">Admin</span>' : ''} ${u.banned ? '<span class="chip bad">Banned</span>' : ''}<div class="small muted">${esc(u.email)}${u.emailVerified ? '' : ' · unverified'}</div></td>
          <td>${esc(u.plan)}</td><td class="num">${fmt(u.balance)}</td><td class="num">${fmt(u.lifetime)}</td><td class="num">${u.referrals}</td><td class="num">${u.flags ? `<span class="chip bad">${u.flags}</span>` : '0'}</td><td class="small nowrap">${esc(when(u.createdAt).split(',')[0])}</td>
          <td><div class="acts"><button class="btn ghost sm" data-act="adj" data-id="${u.id}">Adjust</button>${u.role === 'admin' ? '' : `<button class="btn ghost sm" data-act="ban" data-id="${u.id}">${u.banned ? 'Unban' : 'Ban'}</button>`}</div></td></tr>`).join('')}</tbody></table>` : '<div class="empty">No users found.</div>';
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
  window.WC.taskForm = taskForm;
  window.WC.cal = { mountCalendar, ytId, addDays, dayLabel };

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
      c.innerHTML = head('Premium upgrades', tabs([['pending', 'Pending'], ['approved', 'Approved'], ['rejected', 'Rejected']], S.s, 's')) + '<p class="muted">Check that the money arrived in your account with the same reference before you approve. Approving starts a 30-day plan.</p><div class="card"><div class="tablewrap" id="ug"></div></div><div id="ex"></div>';
      c.onclick = guard(async (e) => {
        const b = e.target.closest('button'); if (!b) return;
        if (b.dataset.s) { S.s = b.dataset.s; c.querySelectorAll('[data-s]').forEach((x) => x.setAttribute('aria-pressed', x === b)); return load(); }
        const ok = b.dataset.act === 'ok';
        const msg = ok ? `Have you received ${b.dataset.u} USDT from ${b.dataset.n} with reference ${b.dataset.r}? Approving gives them ${b.dataset.p} for 30 days.` : `Reject ${b.dataset.n}'s request? They will be told the payment could not be confirmed.`;
        if (await confirmBox(ok ? 'Approve upgrade' : 'Reject upgrade', msg, ok ? 'Approve' : 'Reject', !ok)) {
          await api('POST', `/admin/upgrades/${b.dataset.id}/decide`, { approve: ok }); toast(ok ? 'Plan activated' : 'Request rejected'); await load(); ctx.refresh();
        }
      });
      const loadExpiring = async () => {
        if (window.WC.role() !== 'admin') return;
        try {
          const r = await api('GET', '/admin/expiring?days=7'), box = $('#ex'); if (!box) return;
          box.innerHTML = `<div class="card" style="margin-top:16px"><div class="tools" style="justify-content:space-between"><h3>Plans ending in the next 7 days</h3><span class="chip ${r.users.length ? 'gold' : 'ok'}">${r.users.length} plan${r.users.length === 1 ? '' : 's'}${r.users.length ? ` · ${r.atRiskUsdt} USDT a month at stake` : ''}</span></div>
            <p class="muted small" style="margin:4px 0 8px">These people are reminded automatically 3 days and 1 day before, by notification, phone message and email.</p>
            ${r.users.length ? `<table><thead><tr><th>User</th><th>Plan</th><th>Ends</th></tr></thead><tbody>${r.users.map((u) => `<tr><td><a href="#/user/${u.id}"><strong>${esc(u.name)}</strong></a><div class="small muted">${esc(u.email)}</div></td><td>${esc(u.plan)} <span class="muted">(${u.priceUsdt} USDT)</span></td><td>${u.daysLeft <= 1 ? '<span class="chip bad">within a day</span>' : `in ${u.daysLeft} days`} <span class="small muted">${esc(when(u.expiresAt))}</span></td></tr>`).join('')}</tbody></table>` : '<div class="empty">No plans end this week.</div>'}</div>`;
        } catch (e) { /* only shown when it can be loaded */ }
      };
      await load(); loadExpiring();
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
      c.innerHTML = head('Settings') + `
        <div class="card"><h3>Paystack (card and mobile money)</h3>
          <p style="margin:6px 0">${s.paystack.configured ? `<span class="chip ok">Connected, ${esc(s.paystack.mode)} mode</span>` : '<span class="chip bad">Not connected</span>'} ${s.paystack.enabled ? '<span class="chip ok">Live for customers</span>' : '<span class="chip gold">Off for customers</span>'}</p>
          ${s.paystack.configured ? '' : '<p class="muted">To connect, add your Paystack secret key as <code>PAYSTACK_SECRET_KEY</code> on the backend service and redeploy. Start with a test key.</p>'}
          <label for="sR">Exchange rate: how many ${esc(s.paystack.currency)} equal 1 USDT</label>
          <input type="number" id="sR" step="0.01" min="0.01" value="${s.paystack.rate || ''}" placeholder="for example 15" aria-label="Exchange rate"><div class="small muted" id="sRp"></div>
          <div class="tools" style="margin-top:10px"><button class="btn" data-act="rate">Save rate</button></div>
          <label for="sH">Webhook address (paste this into Paystack under Settings, API Keys and Webhooks)</label>
          <div class="tools"><input type="text" id="sH" readonly value="${esc(s.paystack.webhookUrl)}" style="flex:1"><button class="btn ghost" data-act="copyhook">Copy</button></div></div>
        <div class="card"><h3>USDT payments (automatic, TRON network)</h3>
          <p style="margin:6px 0">${s.crypto.auto ? '<span class="chip ok">Automatic checking is on</span>' : '<span class="chip gold">Off</span>'}</p>
          <p class="muted">Add the TRON address that should receive USDT (TRC20). Every order gets its own exact amount, such as 5.0042 USDT. The app watches the network, and the plan starts on its own when that amount arrives. Use a wallet only you control.</p>
          <label for="sA">Receiving address (starts with T)</label><input type="text" id="sA" value="${esc(s.crypto.address || '')}" placeholder="T..." autocomplete="off" spellcheck="false">
          <div class="small muted">USDT contract checked: <code>${esc(s.crypto.contract)}</code></div>
          <div class="tools" style="margin-top:10px"><button class="btn" data-act="tron">Save address</button></div></div>
        <div class="card"><h3>Manual crypto instructions</h3><p class="muted">Only used when no address is set above. People send USDT, paste the transaction hash, and you approve it on the Upgrades page. Leave unchanged to keep the manual option hidden.</p>
          <textarea id="sP" rows="3" maxlength="500" aria-label="Payment details">${esc(s.paymentInfo)}</textarea><div class="tools" style="margin-top:10px"><button class="btn" data-act="pay">Save crypto details</button></div></div>
        <div class="card"><h3>Launch date</h3><p class="muted">Shown to users as the countdown to the WTC launch. Leave empty to show "Launch date coming soon".</p>
          <input type="datetime-local" id="sL" value="${local}" aria-label="Launch date"><div class="tools" style="margin-top:10px"><button class="btn" data-act="launch">Save launch date</button></div></div>
        <div class="card"><h3>Token price</h3><p class="muted">The USDT value of 1 WTC. This changes the USDT amount shown to every user.</p>
          <input type="number" id="sT" step="0.000001" min="0.000001" value="${s.tokenPrice}" aria-label="Token price in USDT"><div class="tools" style="margin-top:10px"><button class="btn" data-act="price">Save price</button></div></div>
        <div class="card"><h3>Export</h3><p class="muted">Download every user with balance, plan, and flags as a spreadsheet file.</p><button class="btn ghost" data-act="csv">Download users CSV</button></div>`;
      const showPrices = () => { const r = parseFloat($('#sR').value), el = $('#sRp'); el.textContent = r > 0 ? `Plus ${(5 * r).toFixed(2)} · Pro ${(15 * r).toFixed(2)} · VIP ${(30 * r).toFixed(2)} ${s.paystack.currency} (customers are charged these amounts)` : 'Customers can only pay with Paystack after you set a rate.'; };
      $('#sR').oninput = showPrices; showPrices();
      c.onclick = guard(async (e) => {
        const b = e.target.closest('[data-act]'); if (!b) return;
        if (b.dataset.act === 'tron') { await api('PUT', '/admin/settings', { tronAddress: $('#sA').value.trim() }); toast($('#sA').value.trim() ? 'Address saved. USDT payments are on.' : 'Address removed'); pages.settings.render(c); }
        if (b.dataset.act === 'rate') { const v = parseFloat($('#sR').value); if (!(v > 0)) throw new Error('Enter a rate above 0'); await api('PUT', '/admin/settings', { paystackRate: v }); toast('Rate saved'); pages.settings.render(c); }
        if (b.dataset.act === 'copyhook') { try { await navigator.clipboard.writeText($('#sH').value); toast('Webhook address copied'); } catch (er) { toast('Select the address and copy it', true); } }
        if (b.dataset.act === 'pay') { await api('PUT', '/admin/settings', { paymentInfo: $('#sP').value.trim() }); toast('Crypto payment details saved'); }
        if (b.dataset.act === 'launch') { const v = $('#sL').value; await api('PUT', '/admin/settings', { launchAt: v ? new Date(v).toISOString() : '' }); toast('Launch date saved'); }
        if (b.dataset.act === 'price') {
          const p = parseFloat($('#sT').value); if (!(p > 0)) throw new Error('Enter a price above 0');
          if (await confirmBox('Change the token price?', `1 WTC will be worth ${p} USDT for every user.`, 'Change price')) { await api('PUT', '/admin/settings', { tokenPrice: p }); toast('Price updated'); }
        }
        if (b.dataset.act === 'csv') { await download('/admin/export/users.csv', 'watchcoin-users.csv'); toast('Download started'); }
      });
    },
  };
})();
