/* App shell: login, navigation, theme, and the page router. */
(function () {
  const { $, esc, api, toast, setToken, hasToken } = window.WC;
  const NAV = [['overview', 'Overview'], ['economics', 'Economics'], ['performance', 'Task performance'], ['tasks', 'Videos & tasks'], ['users', 'Users'], ['fraud', 'Fraud checks'], ['upgrades', 'Upgrades'], ['payments', 'Payments'], ['support', 'Support'], ['announce', 'Announcements'], ['audit', 'Audit log'], ['settings', 'Settings']];
  let me = null;

  function showLogin(msg) {
    me = null;
    $('#root').innerHTML = `<div class="login"><div class="card"><div class="brand" style="color:var(--ink);padding:0"><span class="coin">W</span>Watchcoin Admin</div>
      <h1>Sign in</h1><p class="muted small">Admin accounts only.</p>
      <form id="lf" autocomplete="on"><label for="lE">Email</label><input type="email" id="lE" autocomplete="username" required>
      <label for="lP">Password</label><input type="password" id="lP" autocomplete="current-password" required>
      <div class="err" id="lErr" role="alert">${esc(msg || '')}</div>
      <button class="btn" style="width:100%;margin-top:10px" type="submit">Sign in</button></form></div></div>`;
    $('#lf').onsubmit = async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector('button'); btn.disabled = true; $('#lErr').textContent = '';
      try {
        const r = await api('POST', '/auth/login', { email: $('#lE').value.trim(), password: $('#lP').value });
        if (r.user.role !== 'admin') throw new Error('This account is not an admin.');
        setToken(r.token); me = r.user; showShell();
      } catch (er) { $('#lErr').textContent = er.message; btn.disabled = false; }
    };
  }

  function showShell() {
    $('#root').innerHTML = `<div class="shell"><aside class="side"><div class="brand"><span class="coin">W</span>Watchcoin Admin</div>
      <nav class="nav" id="nav" aria-label="Main">${NAV.map(([k, l]) => `<a href="#/${k}" data-r="${k}">${l}${k === 'upgrades' || k === 'support' || k === 'payments' ? `<span class="badge hidden" id="b-${k}"></span>` : ''}</a>`).join('')}</nav>
      <div class="foot"><span class="small" id="who"></span><div class="tools"><button class="btn ghost sm" id="theme">Theme</button><button class="btn ghost sm" id="out">Sign out</button></div></div></aside>
      <main class="main" id="page" tabindex="-1"></main></div>`;
    $('#who').textContent = me.email;
    $('#out').onclick = () => { setToken(null); showLogin(); };
    $('#theme').onclick = () => { const r = document.documentElement, d = r.dataset.theme ? r.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme:dark)').matches; r.dataset.theme = d ? 'light' : 'dark'; };
    route();
  }

  async function badges() {
    try {
      const s = await api('GET', '/admin/stats');
      for (const [k, n] of [['upgrades', s.pendingUpgrades], ['support', s.openTickets], ['payments', s.paymentsToReview]]) {
        const b = $('#b-' + k); if (b) { b.textContent = n; b.classList.toggle('hidden', !n); }
      }
    } catch (e) { /* badges are optional */ }
  }

  async function route() {
    if (!me) return;
    const [path, qs] = (location.hash.slice(2) || 'overview').split('?');
    const [seg, param] = path.split('/');
    const key = window.WC.pages[seg] ? seg : 'overview', navKey = key === 'user' ? 'users' : key;
    document.querySelectorAll('#nav a').forEach((a) => (a.dataset.r === navKey ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
    const page = $('#page'), page_ = window.WC.pages[key];
    document.title = `${page_.title} · Watchcoin Admin`;
    page.innerHTML = '<div class="empty">Loading…</div>';
    try { await page_.render(page, { query: new URLSearchParams(qs || ''), refresh: badges, param }); }
    catch (e) {
      if (!hasToken()) return;
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
      if (r.user.role !== 'admin') throw new Error('not admin');
      me = r.user; showShell();
    } catch (e) { setToken(null); showLogin(); }
  })();
})();
