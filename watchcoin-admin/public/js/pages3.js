/* Team, System (backups), Security (two-step login), bulk add, and copy-a-day. */
(function () {
  const { $, esc, fmt, when, api, toast, modal, confirmBox, state, pages, copyText } = window.WC;
  const head = (title, tools = '') => `<div class="head"><h1>${esc(title)}</h1><div class="tools">${tools}</div></div>`;
  const guard = (fn) => async (...a) => { try { await fn(...a); } catch (e) { toast(e.message, true); } };
  const ago = (t) => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 2880 ? `${Math.round(m / 60)} hours ago` : `${Math.round(m / 1440)} days ago`; };
  const size = (b) => (b == null ? '-' : b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

  /* ================= Team ================= */
  pages.team = {
    title: 'Team',
    async render(c) {
      const r = await api('GET', '/admin/staff');
      c.innerHTML = head('Team') + `<div class="card"><p style="margin:0"><strong>Admin</strong> can do everything. <strong>Support</strong> can look up users, payments and support requests and answer people, but cannot move money, change settings or edit tasks.${r.twoFactorRequired ? ' Everyone on the team must use two-step sign-in.' : ''}</p></div>
        <div class="card" style="margin-top:16px"><h3 style="margin-bottom:6px">Who is on the team</h3><table><thead><tr><th>Person</th><th>Role</th><th>Two-step sign-in</th><th></th></tr></thead><tbody>${r.staff.map((s) => `<tr><td><strong>${esc(s.name)}</strong><div class="small muted">${esc(s.email)}</div></td><td><span class="chip ${s.role === 'admin' ? 'gold' : ''}">${s.role === 'admin' ? 'Admin' : 'Support'}</span></td><td>${s.twoFactor ? '<span class="chip ok">On</span>' : '<span class="chip bad">Not set up</span>'}</td>
          <td><div class="acts">${s.role === 'support' ? `<button class="btn ghost sm" data-act="reset" data-id="${s.id}" data-n="${esc(s.name)}">Reset two-step</button><button class="btn ghost sm" data-act="remove" data-e="${esc(s.email)}" data-n="${esc(s.name)}">Remove</button>` : ''}</div></td></tr>`).join('')}</tbody></table></div>
        <div class="card" style="margin-top:16px"><h3>Add a support person</h3><p class="muted" style="margin:4px 0 0">They must already have an account in the app. Then they sign in here with the same email and password.</p>
          <label for="tE">Their email</label><input type="email" id="tE" placeholder="name@example.com" autocomplete="off"><div class="tools" style="margin-top:10px"><button class="btn" data-act="add">Add as support</button></div></div>`;
      c.onclick = guard(async (e) => {
        const b = e.target.closest('[data-act]'); if (!b) return; const a = b.dataset.act;
        if (a === 'add') { const email = $('#tE').value.trim(); if (!email) throw new Error('Enter their email'); await api('POST', '/admin/staff', { email, role: 'support' }); toast('Added to the support team'); pages.team.render(c); }
        if (a === 'remove' && await confirmBox(`Remove ${b.dataset.n}?`, 'They go back to a normal account and lose access to this dashboard.', 'Remove', true)) { await api('POST', '/admin/staff', { email: b.dataset.e, role: 'user' }); toast('Removed'); pages.team.render(c); }
        if (a === 'reset' && await confirmBox(`Reset ${b.dataset.n}'s two-step sign-in?`, 'Use this if they lost their phone. They will set it up again the next time they sign in.', 'Reset')) { await api('POST', `/admin/staff/${b.dataset.id}/reset-2fa`); toast('Reset'); pages.team.render(c); }
      });
    },
  };

  /* ================= System: backups ================= */
  pages.system = {
    title: 'System',
    async render(c) {
      const b = await api('GET', '/admin/backups');
      const tile = (k, v, sub, alertIt, href) => `<${href ? `a href="${href}"` : 'div'} class="card tile ${alertIt ? 'alert' : ''}"><div class="k">${k}</div><div class="v small-v">${v}</div>${sub ? `<div class="small muted">${sub}</div>` : ''}</${href ? 'a' : 'div'}>`;
      c.innerHTML = head('System', '<button class="btn" data-act="run">Back up now</button>') + `<div class="grid g-tiles">
        ${tile('Last backup', b.lastOk ? ago(b.lastOk) : 'Never', b.stale ? 'Overdue. Check the list below.' : `Every ${b.everyHours} hours`, b.stale)}
        ${tile('Copy in another place', b.remote.configured ? 'On' : 'Not set up', b.remote.configured ? esc(b.remote.bucket) : 'Copies on this server alone will not survive losing its disk', !b.remote.configured)}
        ${tile('Encryption', b.encrypted ? 'On' : 'Off', b.encrypted ? 'Backups cannot be read without your passphrase' : 'Set BACKUP_PASSPHRASE to turn it on', !b.encrypted)}
        ${tile('Alerts', b.alerts ? 'On' : 'Off', b.alerts ? 'You are told when a backup fails or the server errors' : 'Set ALERT_WEBHOOK_URL to get messages in Slack or Discord', !b.alerts)}</div>
        <div class="card" style="margin-top:16px"><h3 style="margin-bottom:6px">Recent backups</h3>${b.history.length ? `<div class="tablewrap"><table><thead><tr><th>When</th><th>Result</th><th class="num">Size</th><th>File</th><th>Other place</th></tr></thead><tbody>${b.history.map((h) => `<tr><td class="small nowrap">${esc(when(h.startedAt))}</td><td>${h.status === 'ok' ? '<span class="chip ok">Done</span>' : `<span class="chip bad">Failed</span><div class="small muted">${esc(h.error || '')}</div>`}</td><td class="num">${size(h.bytes)}</td><td class="small"><code>${esc(h.file || '-')}</code>${h.encrypted ? ' <span class="chip">encrypted</span>' : ''}</td><td class="small">${h.remote ? '<span class="chip ok">Copied</span>' : '<span class="muted">-</span>'}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">No backups yet. The first one runs soon after the server starts, or press "Back up now".</div>'}</div>
        <div class="card" style="margin-top:16px"><h3>Keeping your data safe</h3><ul class="muted" style="margin:8px 0 0;padding-left:20px;line-height:1.7">
          <li>A backup is a full copy of all users, balances and payments. The newest ${b.keep} are kept on the server.</li>
          <li><strong>Set up the copy in another place</strong> (Cloudflare R2, Backblaze B2 or Amazon S3). If the server's disk is lost, copies on that same disk are lost too.</li>
          <li>To check a backup works, restore it on your computer with <code>node scripts/restore-backup.js</code>. The README explains how.</li>
          <li>To be told when the whole site is down, add a free monitor (UptimeRobot or Better Stack) pointed at <code>/api/health</code>.</li></ul></div>`;
      c.onclick = guard(async (e) => {
        const r = e.target.closest('[data-act=run]'); if (!r) return;
        r.disabled = true; r.textContent = 'Backing up…';
        try { await api('POST', '/admin/backups/run'); toast('Backup finished'); } finally { pages.system.render(c); }
      });
    },
  };

  /* ================= Security: two-step sign-in ================= */
  const codesHTML = (codes) => `<div class="codes">${codes.map((k) => `<code>${esc(k)}</code>`).join('')}</div><div class="tools"><button class="btn ghost" data-copy-codes>Copy all</button><button class="btn ghost" data-save-codes>Save as a file</button></div>`;
  function wireCodes(root, codes) {
    root.querySelector('[data-copy-codes]').onclick = async () => toast((await copyText(codes.join('\n'))) ? 'Codes copied' : 'Could not copy. Select them and copy by hand.', false);
    root.querySelector('[data-save-codes]').onclick = () => {
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([`Watchcoin recovery codes\nEach works once.\n\n${codes.join('\n')}\n`], { type: 'text/plain' })); a.download = 'watchcoin-recovery-codes.txt'; document.body.appendChild(a); a.click(); a.remove();
    };
  }
  window.WC.showCodes = (codes, title = 'Your recovery codes') => {
    modal(title, `<p class="muted">Keep these somewhere safe. Each one works once if you lose your phone. They are shown only now.</p>${codesHTML(codes)}`, [{ label: 'I have saved them', fn: (close) => close() }], (m) => wireCodes(m, codes));
  };
  pages.security = {
    title: 'Security',
    async render(c) {
      const s = await api('GET', '/me/2fa');
      c.innerHTML = head('Security') + `<div class="card"><h3>Two-step sign-in</h3>
        <p style="margin:6px 0">${s.enabled ? '<span class="chip ok">On</span>' : '<span class="chip bad">Off</span>'} ${s.required ? '<span class="chip gold">Required for the team</span>' : ''}</p>
        <p class="muted">When you sign in, you also type a 6-digit code from an authenticator app on your phone. Even if someone learns your password, they cannot get in without your phone.</p>
        ${s.enabled ? `<p class="muted">Recovery codes left: <strong>${s.recoveryCodesLeft}</strong>. Each works once if you lose your phone.</p>
          <div class="tools"><button class="btn ghost" data-act="codes">Get new recovery codes</button>${s.required ? '' : '<button class="btn ghost" data-act="off">Turn off</button>'}</div>`
          : '<div class="tools"><button class="btn" data-act="on">Set up two-step sign-in</button></div>'}</div>`;
      const askBoth = (title, text, label, fn) => modal(title, `<p class="muted">${text}</p><label for="qP">Your password</label><input type="password" id="qP" autocomplete="current-password"><label for="qC">A code from your app, or a recovery code</label><input type="text" id="qC" autocomplete="one-time-code">`,
        [{ label: 'Cancel', cls: 'ghost', fn: (close) => close() }, { label, fn: async (close) => { await fn($('#qP').value, $('#qC').value.trim()); close(); } }]);
      c.onclick = guard(async (e) => {
        const b = e.target.closest('[data-act]'); if (!b) return;
        if (b.dataset.act === 'on') return window.WC.setup2fa();
        if (b.dataset.act === 'codes') return askBoth('Get new recovery codes', 'This replaces your old recovery codes.', 'Get codes', async (password, code) => { const r = await api('POST', '/me/2fa/recovery-codes', { password, code }); pages.security.render(c); setTimeout(() => window.WC.showCodes(r.recoveryCodes), 50); });
        if (b.dataset.act === 'off') return askBoth('Turn off two-step sign-in', 'Your account will be protected by your password alone.', 'Turn off', async (password, code) => { await api('POST', '/me/2fa/disable', { password, code }); toast('Turned off'); pages.security.render(c); });
      });
    },
  };

  /* ================= Bulk add ================= */
  window.WC.bulkAdd = (reload, today) => {
    const { ytId, addDays, dayLabel, mountCalendar } = window.WC.cal, sel = new Set(), tomorrow = addDays(today, 1);
    let mode = 'spread', rows = [];
    const FMT = {
      watch: ['link | title | question | answer options, separated by commas | correct answer number | reward (optional)', 'https://youtu.be/abc123 | Market update | What colour was the car? | Red, Blue | 2 | 15'],
      like: ['link | title | reward (optional)', 'https://youtu.be/abc123 | Weekly highlights | 8'],
      subscribe: ['link | title | reward (optional)', 'https://youtube.com/@channel | Our channel | 15'],
    };
    const parse = () => {
      const type = $('#bY').value, defK = parseInt($('#bK').value) || 0, secs = parseInt($('#bS').value) || 0, prem = $('#bP').checked, out = [];
      $('#bT').value.split('\n').forEach((raw, i) => {
        const line = raw.trim(); if (!line) return;
        const c = (line.includes('\t') ? line.split('\t') : line.split('|')).map((x) => x.trim()), n = out.length + 1;
        const fail = (error) => out.push({ n, line, task: null, error });
        if (!ytId(c[0]) && !/^https:\/\/(www\.|m\.)?youtube\.com\/@/.test(c[0])) return fail('The first part must be a YouTube link');
        if (!c[1]) return fail('Add a title after the link');
        const t = { type, title: c[1], url: c[0], tokens: defK, secs, question: '', options: [], answer: 0, premium: prem };
        if (type === 'watch') {
          if (!c[2]) return fail('Watch tasks need a question');
          const o = (c[3] || '').split(',').map((x) => x.trim()).filter(Boolean);
          if (o.length < 2) return fail('Give at least 2 answer options, separated by commas');
          const a = parseInt(c[4] || '1'); if (!(a >= 1 && a <= o.length)) return fail(`The correct answer must be a number from 1 to ${o.length}`);
          Object.assign(t, { question: c[2], options: o, answer: a - 1 }); if (c[5]) t.tokens = parseInt(c[5]) || 0;
        } else if (c[2]) t.tokens = parseInt(c[2]) || 0;
        if (!(t.tokens > 0)) return fail('The reward must be above 0');
        if (t.secs < 5) return fail('Watch time must be at least 5 seconds');
        out.push({ n, line, task: t, error: '' });
      });
      return out;
    };
    const spreadDays = (count) => {
      const per = Math.max(1, parseInt($('#bN').value) || 5), skip = $('#bW').checked, need = Math.ceil(count / per), days = [];
      let cur = $('#bD').value || tomorrow;
      while (days.length < need) { const wd = new Date(cur + 'T00:00:00Z').getUTCDay(); if (!(skip && (wd === 0 || wd === 6))) days.push(cur); cur = addDays(cur, 1); }
      return { per, days };
    };
    const refresh = () => {
      rows = parse(); const ok = rows.filter((r) => r.task), bad = rows.length - ok.length;
      $('#bFmt').innerHTML = `<strong>Each line:</strong> <code>${esc(FMT[$('#bY').value][0])}</code>`;
      $('#bPrev').innerHTML = rows.length ? `<div class="bprev"><table><tbody>${rows.map((r) => `<tr><td class="num" style="width:34px">${r.n}</td><td>${esc(r.task ? r.task.title : r.line.slice(0, 60))}</td><td>${r.error ? `<span class="chip bad">${esc(r.error)}</span>` : '<span class="chip ok">Ready</span>'}</td></tr>`).join('')}</tbody></table></div>` : '';
      let info = '';
      if (mode === 'spread' && ok.length) { const s = spreadDays(ok.length); info = `<strong>${ok.length} tasks over ${s.days.length} day${s.days.length === 1 ? '' : 's'}</strong>: ${dayLabel(s.days[0])} to ${dayLabel(s.days.at(-1))}, ${s.per} a day.`; }
      if ($('#bSpreadInfo')) $('#bSpreadInfo').innerHTML = info;
      const btn = document.querySelector('[data-mb="1"]');
      if (btn) { btn.textContent = ok.length ? `Add ${ok.length} task${ok.length === 1 ? '' : 's'}${bad ? ` (fix ${bad} first)` : ''}` : 'Add tasks'; btn.disabled = !ok.length || !!bad; }
    };
    modal('Add many videos at once', `
      <p class="small muted" style="margin:0 0 4px">Paste one task per line. Put <code>|</code> between the parts, or paste straight from a spreadsheet.</p>
      <div class="row2"><div><label for="bY">Type</label><select id="bY"><option value="watch">Watch</option><option value="like">Like</option><option value="subscribe">Subscribe</option></select></div><div><label for="bK">Reward (WTC)</label><input type="number" id="bK" min="1" value="10"></div></div>
      <div class="row2"><div><label for="bS">Watch time (seconds)</label><input type="number" id="bS" min="5" value="30"></div><label class="check" style="margin-top:34px"><input type="checkbox" id="bP"> Premium members only</label></div>
      <label for="bT">Your list</label><textarea id="bT" class="mono" rows="6" spellcheck="false" placeholder="${esc(FMT.watch[1])}"></textarea><div class="small muted" id="bFmt" style="margin-top:4px"></div><div id="bPrev"></div>
      <label>When should they appear?</label>
      <div class="tabs" id="fWhen" role="group"><button type="button" data-w="spread" aria-pressed="true">Spread over days</button><button type="button" data-w="dates" aria-pressed="false">Same days for all</button><button type="button" data-w="daily" aria-pressed="false">Every day</button></div>
      <div id="bSpread" data-showfor="spread"><div class="row2"><div><label for="bN">Tasks per day</label><input type="number" id="bN" min="1" value="5"></div><div><label for="bD">Starting on</label><input type="date" id="bD" value="${tomorrow}" min="${today}"></div></div>
        <label class="check"><input type="checkbox" id="bW"> Skip Saturdays and Sundays</label><div class="small" id="bSpreadInfo" style="margin-top:6px"></div></div>
      <div id="fDates" data-showfor="dates" class="hidden"><div class="cal-tools"><button type="button" class="btn ghost sm" data-cal="7">Next 7 days</button><button type="button" class="btn ghost sm" data-cal="14">Next 14 days</button><button type="button" class="btn ghost sm" data-cal="30">Next 30 days</button><button type="button" class="btn ghost sm" data-cal="clear">Clear</button></div><div class="cal" id="fCal"></div><div class="small" id="fCalInfo" style="margin-top:6px"></div></div>
      <div id="fDaily" data-showfor="daily" class="hidden small muted" style="margin-top:8px">These tasks show every day. People see the same ones again each day.</div>`,
    [{ label: 'Cancel', cls: 'ghost', fn: (close) => close() },
      { label: 'Add tasks', fn: async (close) => {
        const ok = rows.filter((r) => r.task); if (!ok.length) throw new Error('Paste at least one line first');
        if (rows.length !== ok.length) throw new Error('Fix the lines marked in red first');
        let schedules;
        if (mode === 'spread') { const s = spreadDays(ok.length); if (s.days[0] < today) throw new Error('The start date is in the past'); schedules = ok.map((_, i) => ({ mode: 'dates', dates: [s.days[Math.floor(i / s.per)]] })); }
        else if (mode === 'dates') { if (!sel.size) throw new Error('Pick at least one day'); schedules = ok.map(() => ({ mode: 'dates', dates: [...sel].sort() })); }
        else schedules = ok.map(() => ({ mode: 'daily', dates: [] }));
        let r; try { r = await api('POST', '/admin/tasks/bulk', { tasks: ok.map((x, i) => ({ ...x.task, schedule: schedules[i] })) }); }
        catch (e) { if (e.data && e.data.rows) throw new Error(`${e.message} ${e.data.rows.slice(0, 3).map((x) => `Line ${x.row}: ${x.error}`).join(' ')}`); throw e; }
        close(); toast(`Added ${r.created} task${r.created === 1 ? '' : 's'}${r.days ? ` across ${r.days} day${r.days === 1 ? '' : 's'}` : ''}`); await reload();
      } }],
    () => {
      mountCalendar(sel, today, 'spread', (m) => { mode = m; refresh(); });
      for (const id of ['bT', 'bY', 'bK', 'bS', 'bP', 'bN', 'bD', 'bW']) { const e = $('#' + id); e.oninput = refresh; e.onchange = refresh; }
      $('#bY').addEventListener('change', () => { $('#bT').placeholder = FMT[$('#bY').value][1]; $('#bS').disabled = false; });
      $('#fDates').addEventListener('click', refresh); refresh();
    });
  };

  /* ================= Copy a day ================= */
  window.WC.copyDay = (from, today, reload) => {
    const sel = new Set(), long = new Date(from + 'T12:00:00Z').toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
    modal('Copy this day to other days', `<p class="muted" style="margin:0 0 6px">Everything set just for <strong>${esc(long)}</strong> will also appear on the days you pick. Tasks set to "Every day" are already there.</p>
      <div id="fDates" data-showfor="dates"><div class="cal-tools"><button type="button" class="btn ghost sm" data-cal="7">Next 7 days</button><button type="button" class="btn ghost sm" data-cal="14">Next 14 days</button><button type="button" class="btn ghost sm" data-cal="clear">Clear</button></div><div class="cal" id="fCal"></div><div class="small" id="fCalInfo" style="margin-top:6px"></div></div>`,
    [{ label: 'Cancel', cls: 'ghost', fn: (close) => close() },
      { label: 'Copy', fn: async (close) => { sel.delete(from); if (!sel.size) throw new Error('Pick at least one other day'); const r = await api('POST', '/admin/schedule/copy', { from, to: [...sel].sort() }); close(); toast(`Copied ${r.tasks} task${r.tasks === 1 ? '' : 's'} to ${r.days} day${r.days === 1 ? '' : 's'}`); await reload(); } }],
    () => window.WC.cal.mountCalendar(sel, today, 'dates', () => {}, from)); // opens on the month of the day being copied
  };
})();
