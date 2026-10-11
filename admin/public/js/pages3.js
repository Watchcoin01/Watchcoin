/* Pages for account security, online payments and staff roles. */
(function () {
  const { $, esc, fmt, when, api, toast, modal, confirmBox, setToken, state, pages, can, roleChip, ROLE_LABEL } = window.WC;
  const head = (title, tools = '') => `<div class="head"><h1>${esc(title)}</h1><div class="tools">${tools}</div></div>`;
  const tabs = (items, cur, attr) => `<div class="tabs" role="group">${items.map(([k, l]) => `<button data-${attr}="${k}" aria-pressed="${String(k) === String(cur)}">${esc(l)}</button>`).join('')}</div>`;
  const guard = (fn) => async (...a) => { try { await fn(...a); } catch (e) { toast(e.message, true); } };
  const userLink = (id, name) => `<a href="#/user/${id}">${esc(name)}</a>`;

  function showBackupCodes(codes) {
    modal('Save your backup codes', `<p>Each code works once, if you lose your phone. Store them somewhere safe, such as a password manager. They are not shown again.</p>
      <pre class="codes">${codes.map(esc).join('\n')}</pre>`,
    [{ label: 'Copy', cls: 'ghost', fn: async () => { try { await navigator.clipboard.writeText(codes.join('\n')); toast('Copied'); } catch (e) { toast('Select the codes and copy them', true); } } },
      { label: 'I have saved them', fn: (close) => close() }]);
  }

  /* ================= My security ================= */
  pages.security = {
    title: 'My security',
    async render(c, ctx) {
      const st = await api('GET', '/me/2fa');
      const required = st.requiredForAdmin;
      const intro = !st.enabled && required ? '<div class="card note-card"><strong>Two-step login is required for staff.</strong> Set it up below to use the rest of the dashboard.</div>' : '';
      const twoStep = st.enabled
        ? `<div class="card"><h3>Two-step login <span class="chip ok">On</span></h3><p class="muted">You have <strong>${st.backupCodesLeft}</strong> backup code${st.backupCodesLeft === 1 ? '' : 's'} left.${st.backupCodesLeft < 4 ? ' Make new ones soon.' : ''}</p>
            <label for="sC">Code from your authenticator app</label><input type="text" id="sC" inputmode="numeric" autocomplete="one-time-code" maxlength="6" style="max-width:200px">
            <div class="tools" style="margin-top:10px"><button class="btn ghost" data-act="codes">Make new backup codes</button></div>
            <details style="margin-top:16px"><summary>Turn off two-step login</summary>
              <p class="muted small">${required ? 'Staff cannot use the dashboard without it. ' : ''}You can set it up again on a new phone afterwards.</p>
              <label for="sOffP">Password</label><input type="password" id="sOffP" autocomplete="current-password" style="max-width:300px">
              <label for="sOffC">Code or backup code</label><input type="text" id="sOffC" maxlength="20" style="max-width:300px">
              <div class="tools" style="margin-top:10px"><button class="btn danger" data-act="off">Turn off</button></div></details></div>`
        : `<div class="card"><h3>Two-step login <span class="chip bad">Off</span></h3><p class="muted">After your password, you will also enter a 6-digit code from an app on your phone, such as Google Authenticator, Microsoft Authenticator, Authy or 1Password. Someone who learns your password still can't get in.</p>
            <div id="setup"><label for="sP">Confirm your password to start</label><input type="password" id="sP" autocomplete="current-password" style="max-width:300px">
            <div class="tools" style="margin-top:10px"><button class="btn" data-act="start">Set up two-step login</button></div></div></div>`;
      c.innerHTML = head('My security') + intro + twoStep +
        `<div class="card"><h3>Change password</h3><p class="muted">Other devices are signed out. This one stays signed in.</p>
          <label for="pO">Current password</label><input type="password" id="pO" autocomplete="current-password" style="max-width:300px">
          <label for="pN">New password (at least 10 characters for staff)</label><input type="password" id="pN" autocomplete="new-password" style="max-width:300px">
          <div class="tools" style="margin-top:10px"><button class="btn" data-act="pw">Change password</button></div></div>
        <div class="card"><h3>Sign out everywhere</h3><p class="muted">Ends every session on every device, including this one. Use it if you signed in on a computer you don't trust.</p>
          <button class="btn ghost" data-act="all">Sign out everywhere</button></div>`;

      c.onclick = guard(async (e) => {
        const b = e.target.closest('[data-act]'); if (!b) return;
        const act = b.dataset.act;
        if (act === 'start') {
          const r = await api('POST', '/me/2fa/setup', { password: $('#sP').value });
          $('#setup').innerHTML = `<ol class="steps"><li>Open your authenticator app and add an account by scanning this code.</li></ol>
            <img class="qr" src="${esc(r.qr)}" alt="QR code for your authenticator app" width="220" height="220">
            <p class="small muted">Can't scan? Type this key into the app instead:<br><code class="secret">${esc(r.secret.replace(/(.{4})/g, '$1 ').trim())}</code></p>
            <ol class="steps" start="2"><li>Enter the 6-digit code the app shows.</li></ol>
            <input type="text" id="sE" inputmode="numeric" autocomplete="one-time-code" maxlength="6" style="max-width:200px">
            <div class="tools" style="margin-top:10px"><button class="btn" data-act="enable">Turn on</button></div>`;
          $('#sE').focus();
        }
        if (act === 'enable') {
          const r = await api('POST', '/me/2fa/enable', { code: $('#sE').value.trim() });
          setToken(r.token); ctx.setMe(r.user);
          showBackupCodes(r.backupCodes);
          toast('Two-step login is on');
          if (required) ctx.unlock(); else pages.security.render(c, ctx);
        }
        if (act === 'codes') {
          const r = await api('POST', '/me/2fa/backup-codes', { code: $('#sC').value.trim() });
          showBackupCodes(r.backupCodes); pages.security.render(c, ctx);
        }
        if (act === 'off') {
          if (!(await confirmBox('Turn off two-step login?', required ? 'You will not be able to use the dashboard until you turn it on again.' : 'Your account will be protected by your password only.', 'Turn off', true))) return;
          const r = await api('POST', '/me/2fa/disable', { password: $('#sOffP').value, code: $('#sOffC').value.trim() });
          setToken(r.token); ctx.setMe(r.user); toast('Two-step login is off');
          if (required) location.reload(); else pages.security.render(c, ctx);
        }
        if (act === 'pw') {
          const np = $('#pN').value;
          if (np.length < 10) throw new Error('Use at least 10 characters for a staff password');
          const r = await api('POST', '/me/password', { currentPassword: $('#pO').value, newPassword: np });
          setToken(r.token); $('#pO').value = ''; $('#pN').value = ''; toast('Password changed. Other devices were signed out.');
        }
        if (act === 'all') {
          if (!(await confirmBox('Sign out everywhere?', 'Every session ends, including this one. You will sign in again.', 'Sign out everywhere', true))) return;
          await api('POST', '/me/logout-all'); setToken(null); location.reload();
        }
      });
    },
  };

  /* ================= Online payments ================= */
  const PAY_CHIP = { success: 'ok', pending: 'gold', review: 'bad', failed: '' };
  const PAY_LABEL = { success: 'Paid', pending: 'Not finished', review: 'Wrong amount', failed: 'Failed' };
  pages.payments = {
    title: 'Online payments',
    async render(c) {
      const S = state.payments || (state.payments = { s: 'all' });
      let rows = [], next = null, enabled = true;
      const draw = () => {
        $('#pyl').innerHTML = (enabled ? '' : '<div class="card note-card"><strong>Paystack is not switched on.</strong> Set PAYSTACK_SECRET_KEY on the backend and an exchange rate in Settings. Until then users can only pay manually (see Upgrades).</div>') +
          `<div class="card"><div class="tablewrap">${rows.length ? `<table><thead><tr><th>User</th><th>Plan</th><th class="num">Amount</th><th>Status</th><th>Reference</th><th></th></tr></thead><tbody>${rows.map((p) => `<tr>
            <td>${userLink(p.userId, p.name)}<div class="small muted">${esc(p.email)}</div></td><td>${esc(p.planName)}<div class="small muted">${esc(when(p.createdAt))}</div></td>
            <td class="num nowrap">${p.amount.toFixed(2)} ${esc(p.currency)}</td>
            <td><span class="chip ${PAY_CHIP[p.status]}">${PAY_LABEL[p.status] || esc(p.status)}</span>${p.note ? `<div class="small muted">${esc(p.note)}</div>` : ''}</td>
            <td><code class="small">${esc(p.reference)}</code></td>
            <td><div class="acts">${can('admin') && p.status === 'pending' ? `<button class="btn ghost sm" data-act="re" data-id="${p.id}">Check again</button>` : ''}${can('admin') && p.status === 'review' ? `<button class="btn sm" data-act="ok" data-id="${p.id}" data-n="${esc(p.name)}" data-a="${p.amount.toFixed(2)} ${esc(p.currency)}" data-note="${esc(p.note)}" data-p="${esc(p.planName)}">Approve</button>` : ''}</div></td></tr>`).join('')}</tbody></table>` : '<div class="empty">No payments here yet.</div>'}</div>
            ${next ? '<div style="margin-top:12px"><button class="btn ghost" data-act="more">Load older</button></div>' : ''}</div>`;
      };
      const load = async (more) => {
        const r = await api('GET', `/admin/payments?status=${S.s}${more && next ? `&before=${next}` : ''}`);
        rows = more ? rows.concat(r.payments) : r.payments; next = r.nextCursor; enabled = r.enabled; draw();
      };
      c.innerHTML = head('Online payments', tabs([['all', 'All'], ['success', 'Paid'], ['review', 'Wrong amount'], ['pending', 'Not finished'], ['failed', 'Failed']], S.s, 's')) +
        '<p class="muted">Payments made with Mobile Money or card through Paystack. Paid plans switch on by themselves. A payment for the wrong amount waits here for you to check.</p><div id="pyl"></div>';
      c.onclick = guard(async (e) => {
        const b = e.target.closest('button'); if (!b) return;
        if (b.dataset.s) { S.s = b.dataset.s; c.querySelectorAll('[data-s]').forEach((x) => x.setAttribute('aria-pressed', x === b)); return load(); }
        if (b.dataset.act === 'more') return load(true);
        if (b.dataset.act === 're') { const r = await api('POST', `/admin/payments/${b.dataset.id}/recheck`); toast(`Paystack says: ${PAY_LABEL[r.status] || r.status}`); return load(); }
        if (b.dataset.act === 'ok' && await confirmBox('Approve this payment?', `${b.dataset.n} paid ${b.dataset.a} (${b.dataset.note}). Approving gives them ${b.dataset.p} for 30 days. Only do this after checking the money in Paystack.`, 'Approve')) {
          await api('POST', `/admin/payments/${b.dataset.id}/approve`); toast('Plan activated'); return load();
        }
      });
      await load();
    },
  };

  /* ================= Staff ================= */
  pages.staff = {
    title: 'Staff',
    async render(c) {
      const { staff } = await api('GET', '/admin/staff');
      const owner = can('owner'), me = window.WC.me;
      const roleSel = (s) => `<select data-role="${s.id}" aria-label="Role for ${esc(s.name)}" style="width:auto">${['support', 'admin', 'user'].map((r) => `<option value="${r}" ${s.role === r ? 'selected' : ''}>${r === 'user' ? 'Remove staff access' : ROLE_LABEL[r]}</option>`).join('')}</select>`;
      c.innerHTML = head('Staff') + `<div class="card"><table><thead><tr><th>Person</th><th>Role</th><th>Two-step login</th><th></th></tr></thead><tbody>${staff.map((s) => `<tr>
          <td>${userLink(s.id, s.name)}<div class="small muted">${esc(s.email)}</div></td>
          <td>${owner && s.role !== 'owner' ? roleSel(s) : roleChip(s.role)}</td>
          <td>${s.twoFactor ? '<span class="chip ok">On</span>' : '<span class="chip bad">Off</span>'}</td>
          <td><div class="acts">${s.id !== me.id && (owner || s.role === 'support') ? `<button class="btn ghost sm" data-act="out" data-id="${s.id}" data-n="${esc(s.name)}">Sign out</button>` : ''}${owner && s.id !== me.id && s.twoFactor ? `<button class="btn ghost sm" data-act="r2" data-id="${s.id}" data-n="${esc(s.name)}">Reset two-step login</button>` : ''}</div></td></tr>`).join('')}</tbody></table></div>
        ${owner ? `<div class="card"><h3>Add a staff member</h3><p class="muted">They must already have an account in the app. They sign in here with the same email and password, then set up two-step login.</p>
          <div class="tools"><input type="email" id="nE" placeholder="their@email.com" aria-label="Email" style="max-width:280px"><select id="nR" aria-label="Role" style="width:auto"><option value="support">Support</option><option value="admin">Admin</option></select><button class="btn" data-act="add">Add</button></div></div>` : ''}
        <div class="card"><h3>What each role can do</h3><table><tbody>
          <tr><td><strong>Support</strong></td><td>See users, stats, payments and upgrade requests. Answer support requests.</td></tr>
          <tr><td><strong>Admin</strong></td><td>Everything support can do, plus manage tasks, ban users, approve upgrades, send announcements, and see fraud checks, economics and the audit log.</td></tr>
          <tr><td><strong>Owner</strong></td><td>Everything, plus change balances, settings and staff roles, and download user data. There is one owner.</td></tr></tbody></table></div>`;

      const setRole = async (id, role, name) => {
        const msg = role === 'user' ? `${name} loses access to the dashboard.` : `${name} becomes ${ROLE_LABEL[role]}. They are signed out and sign in again with the new role.`;
        if (!(await confirmBox('Change role?', msg, 'Change role', role === 'user'))) return false;
        await api('POST', `/admin/users/${id}/role`, { role }); toast('Role changed'); return true;
      };
      c.onchange = guard(async (e) => {
        const sel = e.target.closest('[data-role]'); if (!sel) return;
        const s = staff.find((x) => x.id === +sel.dataset.role);
        if (!(await setRole(s.id, sel.value, s.name))) sel.value = s.role;
        pages.staff.render(c);
      });
      c.onclick = guard(async (e) => {
        const b = e.target.closest('[data-act]'); if (!b) return;
        if (b.dataset.act === 'out' && await confirmBox(`Sign out ${b.dataset.n}?`, 'Every session they have ends now. They can sign in again.', 'Sign out')) {
          await api('POST', `/admin/users/${b.dataset.id}/logout`); toast('Signed out');
        }
        if (b.dataset.act === 'r2' && await confirmBox(`Reset two-step login for ${b.dataset.n}?`, 'Only do this if they lost their phone and backup codes, and you have confirmed it is really them. They set it up again on their next sign-in.', 'Reset', true)) {
          await api('POST', `/admin/users/${b.dataset.id}/reset-2fa`); toast('Reset. They can set it up again.'); pages.staff.render(c);
        }
        if (b.dataset.act === 'add') {
          const email = $('#nE').value.trim().toLowerCase();
          if (!email) throw new Error('Enter their email');
          const { users } = await api('GET', `/admin/users?search=${encodeURIComponent(email)}&limit=10`);
          const u = users.find((x) => x.email === email);
          if (!u) throw new Error('No account with that email. Ask them to sign up in the app first.');
          if (await setRole(u.id, $('#nR').value, u.name)) pages.staff.render(c);
        }
      });
    },
  };
})();

/* ================= Wheel animals: video clips ================= */
(function () {
  const { $, esc, fmt, api, toast, confirmBox, upload, cfg, pages } = window.WC;
  const head = (title) => `<div class="head"><h1>${esc(title)}</h1></div>`;
  const guard = (fn) => async (...a) => { try { await fn(...a); } catch (e) { toast(e.message, true); } };
  const INFO = {
    dragon: ['🐉', 'Dragon', 'a colossal ancient dragon with crimson and gold scales, glowing amber eyes, a huge horned head and vast leathery wings spread wide'],
    lion: ['🦁', 'Lion', 'a majestic male lion with a thick golden mane and intense amber eyes'],
    eagle: ['🦅', 'Eagle', 'a fierce bald eagle with its huge wings spread wide and razor-sharp talons'],
    croc: ['🐊', 'Crocodile', 'a huge Nile crocodile rising out of dark water with its jaws wide open'],
    wolf: ['🐺', 'Wolf', 'a powerful grey wolf with thick fur and glowing blue eyes'],
    bull: ['🐂', 'Bull', 'a massive black bull with long sharp horns, snorting and stamping'],
    goat: ['🐐', 'Goat', 'a rugged mountain goat with big curled horns standing on a rock'],
  };
  const prompt = (animal) => {
    const d = INFO[animal][2], big = animal === 'dragon';
    return `Vertical 9:16 video, ${big ? '6' : '5'} seconds, photorealistic cinematic CGI, pure black background, dramatic warm rim lighting, 4K. ` +
      `${d[0].toUpperCase() + d.slice(1)} faces the camera. It rears its head back, then lunges toward the camera and breathes a powerful jet of fire ` +
      `with thick billowing smoke and glowing embers straight at the viewer. The camera shakes from the blast. ` +
      (big ? 'Epic scale: the fire fills the whole frame and the ground trembles. ' : '') +
      `It ends staring proudly at the camera as the flames fade to embers. Deep ${big ? 'thunderous roar' : 'roar'} sound. No text, no logos, no people.`;
  };
  const mb = (b) => (b / 1048576).toFixed(1) + ' MB';

  pages.wheel = {
    title: 'Wheel animals',
    async render(c) {
      const d = await api('GET', '/admin/wheel'), origin = cfg.apiUrl.replace(/\/api$/, '');
      const seen = new Set(), rows = d.segments.filter((s) => !seen.has(s.animal) && seen.add(s.animal)).sort((a, b) => b.prize - a.prize);
      c.innerHTML = head('Wheel animals') +
        `<div class="card note-card"><strong>Make the wheel look like the AI videos people love.</strong> Upload a short video for each animal. When someone wins, the app plays that animal's video full screen, with the screen shake, coin burst and prize on top. Animals without a video use the built-in animation.</div>
        <div class="card"><h3>How to make the videos</h3><ol class="steps">
          <li>Open an AI video tool, such as Google Veo, Kling, Runway, Sora or Pika.</li>
          <li>Copy the prompt for an animal below and generate the video. Pick the best take.</li>
          <li>Download it as <strong>MP4</strong>, vertical (9:16), 4 to 8 seconds. Keep it under ${mb(d.maxBytes)}; under 4 MB loads fast on mobile data.</li>
          <li>Upload it here. Use only videos you made or have the rights to use.</li></ol>
          <p class="small muted">A black background blends best with the app. If the tool adds sound, the roar plays too (on phones that allow it).</p></div>
        <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(260px,1fr))">${rows.map((s) => { const m = d.media[s.animal], [e, name] = INFO[s.animal] || ['', s.animal];
          return `<div class="card"><div class="tools" style="justify-content:space-between"><h3 style="margin:0">${e} ${esc(name)}</h3><span class="chip ${s.animal === 'dragon' ? 'gold' : ''}">${fmt(s.prize)} WTC</span></div>
            ${m ? `<video src="${esc(origin + m.url)}" controls playsinline preload="metadata" style="width:100%;aspect-ratio:9/16;max-height:340px;background:#000;border-radius:12px;margin:10px 0"></video><div class="small muted">${mb(m.size)} · uploaded ${esc(new Date(m.uploadedAt).toLocaleDateString())}</div>`
              : `<div class="empty" style="margin:10px 0">No video yet. The built-in animation is used.</div>`}
            <div class="tools" style="margin-top:10px"><label class="btn sm" style="cursor:pointer">${m ? 'Replace video' : 'Upload video'}<input type="file" accept="video/mp4,video/webm" data-up="${s.animal}" hidden></label>
              ${m ? `<button class="btn ghost sm" data-rm="${s.animal}">Remove</button>` : ''}<button class="btn ghost sm" data-pr="${s.animal}">Copy AI prompt</button></div>
            <div class="small muted" id="pg-${s.animal}" style="margin-top:6px"></div></div>`; }).join('')}</div>`;

      c.onchange = guard(async (e) => {
        const inp = e.target.closest('[data-up]'); if (!inp || !inp.files[0]) return;
        const f = inp.files[0], animal = inp.dataset.up, pg = $('#pg-' + animal);
        if (!['video/mp4', 'video/webm'].includes(f.type)) throw new Error('Choose an MP4 or WebM video');
        if (f.size > d.maxBytes) throw new Error(`This video is ${mb(f.size)}. The limit is ${mb(d.maxBytes)}. Export it shorter or at 720p.`);
        await upload(`/admin/wheel/${animal}/video`, f, (k) => { pg.textContent = `Uploading… ${Math.round(k * 100)}%`; });
        toast(`${INFO[animal][1]} video saved. It shows the next time someone wins it.`); pages.wheel.render(c);
      });
      c.onclick = guard(async (e) => {
        const pr = e.target.closest('[data-pr]');
        if (pr) { const text = prompt(pr.dataset.pr); try { await navigator.clipboard.writeText(text); toast('Prompt copied'); } catch (er) { window.prompt('Copy this prompt', text); } return; }
        const rm = e.target.closest('[data-rm]');
        if (rm && await confirmBox(`Remove the ${INFO[rm.dataset.rm][1]} video?`, 'The built-in animation is used for this animal again.', 'Remove', true)) {
          await api('DELETE', `/admin/wheel/${rm.dataset.rm}/video`); toast('Video removed'); pages.wheel.render(c);
        }
      });
    },
  };
})();
