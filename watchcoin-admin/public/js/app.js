/* App shell: sign-in (with two-step), two-step setup, navigation by role, and the page router. */
(function () {
  const { $, esc, api, toast, setToken, hasToken, copyText } = window.WC;
  // [page, label, who can open it]. Support people get the "all" pages, read-only. The server enforces this as well.
  const NAV = [['overview', 'Overview', 'admin'], ['economics', 'Economics', 'admin'], ['performance', 'Task performance', 'admin'], ['tasks', 'Videos & tasks', 'all'], ['schedule', 'Schedule', 'all'],
    ['users', 'Users', 'all'], ['fraud', 'Fraud checks', 'all'], ['upgrades', 'Upgrades', 'all'], ['payments', 'Payments', 'all'], ['usdt', 'USDT payments', 'all'], ['support', 'Support', 'all'],
    ['announce', 'Announcements', 'admin'], ['audit', 'Audit log', 'admin'], ['team', 'Team', 'admin'], ['system', 'System', 'admin'], ['settings', 'Settings', 'admin'], ['security', 'Security', 'all']];
  const STAFF = ['admin', 'support'];
  let me = null;
  const isAdmin = () => !!me && me.role === 'admin';
  window.WC.role = () => (me ? me.role : null);
  const home = () => (isAdmin() ? 'overview' : 'users');
  const allowed = (k) => { const row = NAV.find((r) => r[0] === (k === 'user' ? 'users' : k)); return !!row && (row[2] === 'all' || isAdmin()); };

  const card = (inner) => { $('#root').innerHTML = `<div class="login"><div class="card"><div class="brand" style="color:var(--ink);padding:0"><span class="coin">W</span>Watchcoin Admin</div>${inner}</div></div>`; };

  /* ---------- sign in ---------- */
  function showLogin(msg) {
    me = null;
    card(`<h1>Sign in</h1><p class="muted small">For the Watchcoin team.</p>
      <form id="lf" autocomplete="on"><label for="lE">Email</label><input type="email" id="lE" autocomplete="username" required>
      <label for="lP">Password</label><input type="password" id="lP" autocomplete="current-password" required>
      <div class="err" id="lErr" role="alert">${esc(msg || '')}</div>
      <button class="btn" style="width:100%;margin-top:10px" type="submit">Sign in</button>
      <div class="tools" style="justify-content:space-between;margin-top:10px"><button class="btn ghost sm" id="goUp" type="button">Create account</button><button class="btn ghost sm" id="goForgot" type="button">Forgot password?</button></div></form>`);
    $('#goUp').onclick = () => showSignup(); $('#goForgot').onclick = () => showForgot();
    $('#lf').onsubmit = async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector('button'); btn.disabled = true; $('#lErr').textContent = '';
      try {
        const r = await api('POST', '/auth/login', { email: $('#lE').value.trim(), password: $('#lP').value });
        if (r.twoFactorRequired) return showCode(r.challenge);
        await accept(r);
      } catch (er) { $('#lErr').textContent = er.message; btn.disabled = false; }
    };
  }
  /* ---------- create account (owner email only) and password reset ---------- */
  function showSignup() {
    card(`<h1>Create account</h1><p class="muted small">Works only for the owner email set on the server.</p>
      <form id="sg" autocomplete="on"><label for="gN">Name</label><input id="gN" autocomplete="name" required maxlength="60">
      <label for="gE">Email</label><input type="email" id="gE" autocomplete="username" required>
      <label for="gP">Password (6+ characters)</label><input type="password" id="gP" autocomplete="new-password" minlength="6" required>
      <div class="err" id="gErr" role="alert"></div>
      <button class="btn" style="width:100%;margin-top:10px" type="submit">Create account</button><button class="btn ghost" id="gBack" type="button" style="width:100%;margin-top:8px">Back to sign in</button></form>`);
    $('#gBack').onclick = () => showLogin();
    $('#sg').onsubmit = async (e) => {
      e.preventDefault(); const btn = e.target.querySelector('button[type=submit]'); btn.disabled = true; $('#gErr').textContent = '';
      try {
        const r = await api('POST', '/auth/signup', { name: $('#gN').value.trim(), email: $('#gE').value.trim(), password: $('#gP').value, adminPortal: true });
        showAccountCode(r.recoveryCode, () => accept(r));
      } catch (er) { $('#gErr').textContent = er.message; btn.disabled = false; }
    };
  }
  function showAccountCode(code, next) {
    card(`<h1>Save your recovery code</h1><p class="muted small">If you forget your password, this code lets you reset it. It is shown only once.</p>
      <div class="codes" style="grid-template-columns:1fr"><code id="acCode">${esc(code)}</code></div>
      <div class="tools"><button class="btn ghost" id="acCopy" type="button">Copy</button></div>
      <label class="check"><input type="checkbox" id="acOk"> I have saved it</label><button class="btn" id="acGo" style="width:100%;margin-top:12px" disabled>Continue</button>`);
    $('#acCopy').onclick = async () => toast((await copyText(code)) ? 'Code copied' : 'Could not copy. Select it and copy by hand.');
    $('#acOk').onchange = (e) => { $('#acGo').disabled = !e.target.checked; };
    $('#acGo').onclick = async () => { try { await next(); } catch (er) { showLogin(er.message); } };
  }
  function showForgot() {
    card(`<h1>Reset password</h1><p class="muted small">Use the recovery code you saved when you created the account.</p>
      <form id="fg" autocomplete="off"><label for="fE">Email</label><input type="email" id="fE" required>
      <label for="fC">Recovery code</label><input id="fC" required maxlength="20" autocapitalize="characters">
      <label for="fP">New password (6+ characters)</label><input type="password" id="fP" autocomplete="new-password" minlength="6" required>
      <div class="err" id="fErr" role="alert"></div>
      <button class="btn" style="width:100%;margin-top:10px" type="submit">Reset password</button><button class="btn ghost" id="fBack" type="button" style="width:100%;margin-top:8px">Back to sign in</button></form>`);
    $('#fBack').onclick = () => showLogin();
    $('#fg').onsubmit = async (e) => {
      e.preventDefault(); const btn = e.target.querySelector('button[type=submit]'); btn.disabled = true; $('#fErr').textContent = '';
      try {
        const r = await api('POST', '/auth/reset-password', { email: $('#fE').value.trim(), recoveryCode: $('#fC').value.trim(), newPassword: $('#fP').value });
        showAccountCode(r.recoveryCode, async () => {
          if (r.token) { setToken(r.token); me = (await api('GET', '/me')).user; if (!STAFF.includes(me.role)) { setToken(null); throw new Error('This account is not part of the team.'); } begin(); }
          else showLogin('Password changed. Sign in with your new password and authenticator code.');
        });
      } catch (er) { $('#fErr').textContent = er.message; btn.disabled = false; }
    };
  }
  function showCode(challenge, msg) {
    card(`<h1>Two-step sign-in</h1><p class="muted small">Enter the 6-digit code from your authenticator app, or one of your recovery codes.</p>
      <form id="cf" autocomplete="off"><label for="cK">Code</label><input type="text" id="cK" autocomplete="one-time-code" required>
      <div class="err" id="cErr" role="alert">${esc(msg || '')}</div>
      <button class="btn" style="width:100%;margin-top:10px" type="submit">Continue</button><button class="btn ghost" id="cBack" type="button" style="width:100%;margin-top:8px">Back</button></form>`);
    $('#cK').focus(); $('#cBack').onclick = () => showLogin();
    $('#cf').onsubmit = async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector('button[type=submit]'); btn.disabled = true;
      try { await accept(await api('POST', '/auth/login/2fa', { challenge, code: $('#cK').value.trim() })); }
      catch (er) { if (er.status === 401 && /timed out|start again/i.test(er.message)) return showLogin(er.message); $('#cErr').textContent = er.message; btn.disabled = false; }
    };
  }
  async function accept(r) {
    if (!STAFF.includes(r.user.role)) throw new Error('This account is not part of the team.');
    setToken(r.token); me = r.user; begin();
  }
  function begin() {
    if (me.twoFactor && me.twoFactor.required && !me.twoFactor.enabled) return showSetup();
    showShell();
  }

  /* ---------- two-step setup ---------- */
  function qrSvg(text) {
    if (typeof qrcode !== 'function') return '';
    try {
      const q = qrcode(0, 'M'); q.addData(text); q.make(); const n = q.getModuleCount(); let d = '';
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += `M${c + 4} ${r + 4}h1v1h-1z`;
      return `<svg viewBox="0 0 ${n + 8} ${n + 8}" role="img" aria-label="QR code for your authenticator app" shape-rendering="crispEdges"><rect width="${n + 8}" height="${n + 8}" fill="#fff"/><path d="${d}" fill="#0F2A4D"/></svg>`;
    } catch (e) { return ''; }
  }
  async function showSetup() {
    card('<h1>Set up two-step sign-in</h1><p class="muted small">The team needs this. It takes about a minute.</p><div id="su" class="muted">Preparing…</div>');
    let s;
    try { s = await api('POST', '/me/2fa/setup'); } catch (e) { $('#su').innerHTML = `<div class="err">${esc(e.message)}</div><button class="btn" id="suBack">Back</button>`; $('#suBack').onclick = () => { setToken(null); showLogin(); }; return; }
    $('#su').innerHTML = `<ol style="padding-left:20px;line-height:1.6"><li>Install an authenticator app on your phone (Google Authenticator, Microsoft Authenticator, Authy or 1Password).</li><li>Scan this picture with it, or type the key by hand.</li><li>Type the 6-digit code it shows.</li></ol>
      <div class="qrbox">${qrSvg(s.uri)}</div><div class="small muted" style="text-align:center">Or type this key:</div><div class="tools" style="justify-content:center"><code id="suKey" style="font-size:14px;letter-spacing:.06em">${esc(s.secret.match(/.{1,4}/g).join(' '))}</code><button class="btn ghost sm" id="suCopy" type="button">Copy</button></div>
      <form id="sf" autocomplete="off"><label for="sC">6-digit code</label><input type="text" id="sC" inputmode="numeric" autocomplete="one-time-code" maxlength="8" required>
      <div class="err" id="sErr" role="alert"></div><button class="btn" style="width:100%;margin-top:10px" type="submit">Turn on</button></form>`;
    $('#suCopy').onclick = async () => toast((await copyText(s.secret)) ? 'Key copied' : 'Could not copy. Select it and copy by hand.');
    $('#sf').onsubmit = async (e) => {
      e.preventDefault(); const btn = e.target.querySelector('button[type=submit]'); btn.disabled = true;
      try { const r = await api('POST', '/me/2fa/enable', { code: $('#sC').value.trim() }); showRecovery(r.recoveryCodes); }
      catch (er) { $('#sErr').textContent = er.message; btn.disabled = false; }
    };
  }
  window.WC.setup2fa = () => showSetup();
  function showRecovery(codes) {
    card(`<h1>Save your recovery codes</h1><p class="muted small">If you lose your phone, each of these lets you in once. They are shown only now. Keep them somewhere safe, apart from your phone.</p>
      <div class="codes">${codes.map((k) => `<code>${esc(k)}</code>`).join('')}</div>
      <div class="tools"><button class="btn ghost" id="rcCopy" type="button">Copy all</button><button class="btn ghost" id="rcSave" type="button">Save as a file</button></div>
      <label class="check"><input type="checkbox" id="rcOk"> I have saved my recovery codes</label><button class="btn" id="rcGo" style="width:100%;margin-top:12px" disabled>Continue</button>`);
    $('#rcOk').onchange = (e) => { $('#rcGo').disabled = !e.target.checked; };
    $('#rcCopy').onclick = async () => toast((await copyText(codes.join('\n'))) ? 'Codes copied' : 'Could not copy. Select them and copy by hand.');
    $('#rcSave').onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([`Watchcoin recovery codes\nEach works once.\n\n${codes.join('\n')}\n`], { type: 'text/plain' })); a.download = 'watchcoin-recovery-codes.txt'; document.body.appendChild(a); a.click(); a.remove(); };
    $('#rcGo').onclick = async () => { try { me = (await api('GET', '/me')).user; } catch (e) { /* keep what we have */ } begin(); };
  }

  /* ---------- the dashboard ---------- */
  function showShell() {
    const links = NAV.filter((r) => r[2] === 'all' || isAdmin());
    $('#root').innerHTML = `<div class="shell"><aside class="side"><div class="brand"><span class="coin">W</span>Watchcoin Admin</div>
      <nav class="nav" id="nav" aria-label="Main">${links.map(([k, l]) => `<a href="#/${k}" data-r="${k}">${l}${['upgrades', 'support', 'payments'].includes(k) ? `<span class="badge hidden" id="b-${k}"></span>` : ''}</a>`).join('')}</nav>
      <div class="foot"><span class="small" id="who"></span><div class="tools"><button class="btn ghost sm" id="theme">Theme</button><button class="btn ghost sm" id="out">Sign out</button></div></div></aside>
      <main class="main" id="page" tabindex="-1"></main></div>`;
    document.body.classList.toggle('ro', !isAdmin());
    $('#who').textContent = me.email + (isAdmin() ? '' : ' (support)');
    $('#out').onclick = () => { setToken(null); showLogin(); };
    $('#theme').onclick = () => { const r = document.documentElement, d = r.dataset.theme ? r.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme:dark)').matches; r.dataset.theme = d ? 'light' : 'dark'; };
    route();
  }

  async function badges() {
    const set = (k, n) => { const b = $('#b-' + k); if (b) { b.textContent = n; b.classList.toggle('hidden', !n); } };
    try {
      if (isAdmin()) { const s = await api('GET', '/admin/stats'); set('upgrades', s.pendingUpgrades); set('support', s.openTickets); set('payments', s.paymentsToReview); }
      else {
        set('support', (await api('GET', '/admin/tickets')).tickets.length);
        set('upgrades', (await api('GET', '/admin/upgrades?status=pending')).upgrades.length);
        set('payments', (await api('GET', '/admin/payments')).needsReview);
      }
    } catch (e) { /* badges are optional */ }
  }

  async function route() {
    if (!me) return;
    const [path, qs] = (location.hash.slice(2) || home()).split('?'), [seg, param] = path.split('/');
    const key = window.WC.pages[seg] ? seg : home();
    if (!allowed(key)) { location.hash = '#/' + home(); return; }
    const navKey = key === 'user' ? 'users' : key;
    document.querySelectorAll('#nav a').forEach((a) => (a.dataset.r === navKey ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
    const page = $('#page'), page_ = window.WC.pages[key];
    document.title = `${page_.title} · Watchcoin Admin`;
    page.innerHTML = '<div class="empty">Loading…</div>';
    try { await page_.render(page, { query: new URLSearchParams(qs || ''), refresh: badges, param }); }
    catch (e) {
      if (!hasToken()) return;
      if (e.data && e.data.setup2fa) return showSetup();
      page.innerHTML = `<div class="card"><h3>Could not load this page</h3><p class="muted">${esc(e.message)}</p><button class="btn" id="retry">Try again</button></div>`;
      $('#retry').onclick = route;
    }
    badges();
  }

  window.addEventListener('hashchange', route);
  window.WC.onAuthLost(() => showLogin('Your session expired. Please sign in again.'));

  (async function boot() {
    if (!window.WC.cfg.apiUrl) return showLogin('The dashboard is missing its API_URL setting.');
    if (!hasToken()) return showLogin();
    try {
      const r = await api('GET', '/me');
      if (!STAFF.includes(r.user.role)) throw new Error('not staff');
      me = r.user; begin();
    } catch (e) { setToken(null); showLogin(); }
  })();
})();
