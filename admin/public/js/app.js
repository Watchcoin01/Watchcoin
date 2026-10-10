/* App shell: login (with two-step code and owner setup), navigation by role, theme, and the page router. */
(function () {
  const { $, esc, api, setToken, hasToken } = window.WC;
  // [route, label, lowest role that sees it]
  const NAV = [['overview', 'Overview', 'support'], ['economics', 'Economics', 'admin'], ['performance', 'Task performance', 'support'],
    ['tasks', 'Videos & tasks', 'admin'], ['users', 'Users', 'support'], ['fraud', 'Fraud checks', 'admin'], ['upgrades', 'Upgrades', 'support'],
    ['payments', 'Online payments', 'support'], ['support', 'Support', 'support'], ['announce', 'Announcements', 'admin'], ['staff', 'Staff', 'admin'],
    ['audit', 'Audit log', 'admin'], ['settings', 'Settings', 'admin'], ['security', 'My security', 'support']];
  const PAGE_ROLE = Object.fromEntries(NAV.map(([k, , r]) => [k, r]));
  PAGE_ROLE.user = 'support';
  let me = null, locked2fa = false;
  const setMe = (u) => { me = u; window.WC.me = u; };

  const card = (inner) => `<div class="login"><div class="card"><div class="brand" style="color:var(--ink);padding:0"><span class="coin">W</span>Watchcoin Admin</div>${inner}</div></div>`;

  function showLogin(msg) {
    setMe(null);
    $('#root').innerHTML = card(`<h1>Sign in</h1><p class="muted small">Staff accounts only.</p>
      <form id="lf" autocomplete="on"><label for="lE">Email</label><input type="email" id="lE" autocomplete="username" required>
      <label for="lP">Password</label><input type="password" id="lP" autocomplete="current-password" required>
      <div class="err" id="lErr" role="alert">${esc(msg || '')}</div>
      <button class="btn" style="width:100%;margin-top:10px" type="submit">Sign in</button></form>`);
    $('#lf').onsubmit = async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector('button'); btn.disabled = true; $('#lErr').textContent = '';
      try {
        const r = await api('POST', '/auth/login', { email: $('#lE').value.trim(), password: $('#lP').value });
        if (r.twoFactorRequired) return showCode(r.challenge);
        afterLogin(r);
      } catch (er) { $('#lErr').textContent = er.message; btn.disabled = false; }
    };
  }

  // Second step: the 6-digit code from the authenticator app, or a backup code.
  function showCode(challenge) {
    $('#root').innerHTML = card(`<h1>Two-step login</h1><p class="muted small">Enter the 6-digit code from your authenticator app. Lost your phone? Enter one of your backup codes instead.</p>
      <form id="cf"><label for="cC">Code</label><input type="text" id="cC" inputmode="numeric" autocomplete="one-time-code" maxlength="20" required>
      <div class="err" id="cErr" role="alert"></div>
      <button class="btn" style="width:100%;margin-top:10px" type="submit">Continue</button>
      <button class="btn ghost" style="width:100%;margin-top:8px" type="button" id="cBack">Back</button></form>`);
    $('#cC').focus();
    $('#cBack').onclick = () => showLogin();
    $('#cf').onsubmit = async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector('[type=submit]'); btn.disabled = true; $('#cErr').textContent = '';
      try {
        const r = await api('POST', '/auth/login/2fa', { challenge, code: $('#cC').value.trim() });
        if (r.backupCodesLeft !== undefined) window.WC.toast(`Backup code used. ${r.backupCodesLeft} left. Make new ones in My security.`);
        afterLogin(r);
      } catch (er) { $('#cErr').textContent = er.message; btn.disabled = false; }
    };
  }

  function afterLogin(r) {
    if (window.WC.RANK[r.user.role]) { setToken(r.token); setMe(r.user); return showShell(); }
    showClaim(r.token);
  }

  // Not staff. On a fresh install this is where the first person becomes the owner with ADMIN_SETUP_CODE.
  function showClaim(userToken) {
    $('#root').innerHTML = card(`<h1>Not a staff account</h1><p class="muted small">Only staff can use this dashboard. If you are setting up Watchcoin for the first time, enter the setup code (ADMIN_SETUP_CODE on the server) to become the owner. This works once.</p>
      <form id="of"><label for="oC">Setup code</label><input type="password" id="oC" autocomplete="off" required>
      <div class="err" id="oErr" role="alert"></div>
      <button class="btn" style="width:100%;margin-top:10px" type="submit">Become the owner</button>
      <button class="btn ghost" style="width:100%;margin-top:8px" type="button" id="oBack">Back to sign in</button></form>`);
    $('#oBack').onclick = () => showLogin();
    $('#of').onsubmit = async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector('[type=submit]'); btn.disabled = true; $('#oErr').textContent = '';
      setToken(userToken);
      try {
        const r = await api('POST', '/auth/claim-owner', { setupCode: $('#oC').value.trim() });
        setToken(r.token); setMe(r.user); showShell();
        window.WC.toast('You are the owner. Turn on two-step login now.');
      } catch (er) { setToken(null); $('#oErr').textContent = er.message; btn.disabled = false; }
    };
  }

  function showShell() {
    const nav = NAV.filter(([, , r]) => window.WC.can(r));
    $('#root').innerHTML = `<div class="shell"><aside class="side"><div class="brand"><span class="coin">W</span>Watchcoin Admin</div>
      <nav class="nav" id="nav" aria-label="Main">${nav.map(([k, l]) => `<a href="#/${k}" data-r="${k}">${l}${k === 'upgrades' || k === 'support' ? `<span class="badge hidden" id="b-${k}"></span>` : ''}</a>`).join('')}</nav>
      <div class="foot"><span class="small" id="who"></span><div class="tools"><button class="btn ghost sm" id="theme">Theme</button><button class="btn ghost sm" id="out">Sign out</button></div></div></aside>
      <main class="main" id="page" tabindex="-1"></main></div>`;
    $('#who').textContent = `${me.email} · ${window.WC.ROLE_LABEL[me.role]}`;
    $('#out').onclick = () => { setToken(null); showLogin(); };
    $('#theme').onclick = () => { const r = document.documentElement, d = r.dataset.theme ? r.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme:dark)').matches; r.dataset.theme = d ? 'light' : 'dark'; };
    route();
  }

  async function badges() {
    if (locked2fa) return;
    try {
      const s = await api('GET', '/admin/stats');
      for (const [k, n] of [['upgrades', s.pendingUpgrades], ['support', s.openTickets]]) {
        const b = $('#b-' + k); if (b) { b.textContent = n; b.classList.toggle('hidden', !n); }
      }
    } catch (e) { /* badges are optional */ }
  }

  async function route() {
    if (!me) return;
    const [path, qs] = (location.hash.slice(2) || 'overview').split('?');
    const [seg, param] = path.split('/');
    let key = window.WC.pages[seg] && window.WC.can(PAGE_ROLE[seg] || 'owner') ? seg : 'overview';
    if (locked2fa) key = 'security'; // staff must turn on two-step login before anything else
    const navKey = key === 'user' ? 'users' : key;
    document.querySelectorAll('#nav a').forEach((a) => (a.dataset.r === navKey ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
    const page = $('#page'), page_ = window.WC.pages[key];
    document.title = `${page_.title} · Watchcoin Admin`;
    page.innerHTML = '<div class="empty">Loading…</div>';
    try { await page_.render(page, { query: new URLSearchParams(qs || ''), refresh: badges, param, setMe, unlock }); }
    catch (e) {
      if (!hasToken() || e.code === '2fa_required') return;
      page.innerHTML = `<div class="card"><h3>Could not load this page</h3><p class="muted">${esc(e.message)}</p><button class="btn" id="retry">Try again</button></div>`;
      $('#retry').onclick = route;
    }
    badges();
  }
  // Called by the security page once two-step login is on.
  function unlock() { locked2fa = false; location.hash = '#/overview'; route(); }

  window.addEventListener('hashchange', route);
  window.WC.onAuthLost(() => showLogin('Your session ended. Please sign in again.'));
  window.WC.on2faRequired(() => { if (!locked2fa && me) { locked2fa = true; location.hash = '#/security'; route(); } });

  (async function boot() {
    if (!window.WC.cfg.apiUrl) return showLogin('The dashboard is missing its API_URL setting.');
    if (!hasToken()) return showLogin();
    try {
      const r = await api('GET', '/me');
      if (!window.WC.RANK[r.user.role]) throw new Error('not staff');
      setMe(r.user); showShell();
    } catch (e) { setToken(null); showLogin(); }
  })();
})();
