/* Shared helpers: API client, formatting, dialogs, toasts, charts. Exposed as window.WC. */
(function () {
  const cfg = window.ADMIN_CONFIG || {};
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n) => Number(n || 0).toLocaleString();
  const usdt = (n) => Number(n || 0).toFixed(2);
  const when = (t) => (t ? new Date(t).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '');

  /* ---- session: kept in sessionStorage so it ends when the tab closes ---- */
  let token = null;
  try { token = sessionStorage.getItem('wca_token'); } catch (e) { /* storage blocked */ }
  const setToken = (t) => { token = t; try { t ? sessionStorage.setItem('wca_token', t) : sessionStorage.removeItem('wca_token'); } catch (e) { /* ignore */ } };
  let authLost = () => {}, need2fa = () => {};

  /* ---- roles: support < admin < owner. The backend enforces them; the dashboard only hides what you can't use. ---- */
  const RANK = { user: 0, support: 1, admin: 2, owner: 3 };
  const can = (min) => !!window.WC.me && (RANK[window.WC.me.role] || 0) >= RANK[min];
  const ROLE_LABEL = { owner: 'Owner', admin: 'Admin', support: 'Support', user: 'User' };
  const roleChip = (role) => (RANK[role] ? `<span class="chip gold">${ROLE_LABEL[role]}</span>` : '');

  async function api(method, path, body, raw) {
    if (!cfg.apiUrl) throw new Error('API_URL is not set on the dashboard server.');
    let r;
    try {
      r = await fetch(cfg.apiUrl + path, {
        method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: 'Bearer ' + token } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e) { throw new Error('Cannot reach the API. Check API_URL, and that the backend CORS_ORIGIN includes this dashboard address.'); }
    if (raw) return r;
    let j = {}; try { j = await r.json(); } catch (e) { /* no body */ }
    if (r.status === 401 && token && !path.startsWith('/auth/')) { setToken(null); authLost(); throw new Error(j.error || 'Session expired'); }
    if (r.status === 403 && j.code === '2fa_required') { need2fa(); }
    if (!r.ok) throw Object.assign(new Error(j.error || `Request failed (${r.status})`), { status: r.status, code: j.code });
    return j;
  }

  /* ---- toast ---- */
  function toast(msg, bad) {
    const t = $('#toast'); t.textContent = msg; t.className = 'on' + (bad ? ' bad' : '');
    clearTimeout(toast.h); toast.h = setTimeout(() => { t.className = ''; }, 3200);
  }

  /* ---- modal: buttons run async functions; thrown errors show inside the dialog ---- */
  let btns = [];
  function modal(title, body, buttons, onOpen) {
    btns = buttons;
    $('#mBody').innerHTML = `<h2>${esc(title)}</h2>${body}<div id="mErr" class="err" role="alert"></div><div class="mfoot">${buttons.map((b, i) => `<button class="btn ${b.cls || ''}" data-mb="${i}">${esc(b.label)}</button>`).join('')}</div>`;
    const d = $('#modal'); if (!d.open) d.showModal();
    if (onOpen) onOpen($('#mBody'));
  }
  const closeModal = () => { const d = $('#modal'); if (d.open) d.close(); };
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-mb]'); if (!b) return;
    const spec = btns[+b.dataset.mb]; if (!spec) return;
    b.disabled = true; $('#mErr').textContent = '';
    try { await spec.fn(closeModal); } catch (er) { const m = $('#mErr'); if (m) m.textContent = er.message; }
    b.disabled = false;
  });
  const confirmBox = (title, msg, okLabel, danger) => new Promise((res) => {
    modal(title, `<p>${esc(msg)}</p>`, [
      { label: 'Cancel', cls: 'ghost', fn: (close) => { close(); res(false); } },
      { label: okLabel || 'Confirm', cls: danger ? 'danger' : '', fn: (close) => { close(); res(true); } },
    ]);
    $('#modal').addEventListener('cancel', () => res(false), { once: true });
  });

  /* ---- charts ---- */
  function bars(title, vals, labels, cls) {
    const W = 340, H = 150, pl = 36, pb = 22, pt = 14, n = vals.length, m = Math.max(1, ...vals), bw = (W - pl - 6) / n, ch = H - pb - pt;
    const y = (v) => pt + ch - (v / m) * ch, step = Math.ceil(n / 7);
    const grid = [0, 0.5, 1].map((f) => { const v = Math.round(m * f); return `<line class="grid" x1="${pl}" x2="${W}" y1="${y(v)}" y2="${y(v)}"/><text x="${pl - 5}" y="${y(v) + 3}" text-anchor="end">${fmt(v)}</text>`; }).join('');
    const bs = vals.map((v, i) => {
      const x = pl + i * bw + bw * 0.14, w = bw * 0.72, yy = y(v);
      return `<rect class="${cls}" x="${x}" y="${yy}" width="${w}" height="${Math.max(0, pt + ch - yy)}" rx="3"><title>${esc(labels[i])}: ${fmt(v)}</title></rect>`
        + (n <= 10 && v ? `<text class="v" x="${x + w / 2}" y="${yy - 3}" text-anchor="middle">${fmt(v)}</text>` : '')
        + (i % step === 0 ? `<text x="${x + w / 2}" y="${H - 6}" text-anchor="middle">${esc(labels[i])}</text>` : '');
    }).join('');
    return `<div class="card"><h3>${esc(title)}</h3><svg class="chart" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${esc(title)}">${grid}${bs}</svg></div>`;
  }

  async function download(path, name) {
    const r = await api('GET', path, null, true);
    if (!r.ok) throw new Error('Download failed');
    const url = URL.createObjectURL(await r.blob());
    const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  window.WC = {
    cfg, $, esc, fmt, usdt, when, api, toast, modal, closeModal, confirmBox, bars, download, state: {}, pages: {},
    setToken, hasToken: () => !!token, onAuthLost: (f) => { authLost = f; }, on2faRequired: (f) => { need2fa = f; },
    me: null, can, RANK, ROLE_LABEL, roleChip,
  };
})();
