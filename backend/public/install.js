/* Install-the-app banner.
   Shows a banner when someone visits, so they can put Watchcoin on their home screen like any other app.
   - Android and desktop Chrome/Edge: one tap on "Install app" opens the browser's own install box.
   - iPhone and iPad: Apple gives websites no install button, so the banner shows the two steps (Share, then Add to Home Screen).
   - Inside Facebook, Instagram, TikTok and similar: those cannot install apps, so the banner asks to open the page in a browser.
   Nothing is shown when the app is already installed, and "Not now" hides it for 7 days. */
(function () {
  'use strict';
  const KEY = 'wc_install', WAIT_DAYS = 7;
  const ua = navigator.userAgent || '';
  const standalone = () => (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  const ios = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const webview = /FBAN|FBAV|FB_IAB|Instagram|TikTok|musical_ly|Snapchat|MicroMessenger|Line\/|Twitter|; wv\)/i.test(ua);
  const get = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { return {}; } };
  const put = (o) => { try { localStorage.setItem(KEY, JSON.stringify({ ...get(), ...o })); } catch (e) { /* private mode: it just shows again next visit */ } };
  const tx = (k) => (typeof t === 'function' ? t(k) : k);

  // Needed so browsers allow the install. It stores nothing (see sw.js).
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
  }

  if (standalone()) return;
  const saved = get();
  if (saved.installed) return;
  const snoozed = () => saved.later && Date.now() - saved.later < WAIT_DAYS * 864e5;

  let deferred = null, mode = null, box = null;

  function hide() { if (box) { box.remove(); box = null; } }
  function render() {
    if (!mode) return;
    hide();
    const iosSteps = mode === 'ios';
    const title = iosSteps ? tx('install.iosTitle') : tx('install.title');
    const sub = mode === 'prompt' ? tx('install.sub') : iosSteps ? tx('install.ios') : tx('install.openBrowser');
    const goLabel = mode === 'prompt' ? tx('install.btn') : tx('install.gotIt');
    box = document.createElement('div');
    box.id = 'wcInstall'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', title);
    const img = document.createElement('img'); img.src = '/icons/icon-192.png'; img.alt = ''; img.width = 52; img.height = 52;
    const text = document.createElement('div'); text.className = 'wcT';
    const b = document.createElement('b'); b.textContent = title;
    const p = document.createElement('p'); p.textContent = sub;
    text.append(b, p);
    const btns = document.createElement('div'); btns.className = 'wcB';
    const go = document.createElement('button'); go.type = 'button'; go.className = 'wcGo'; go.textContent = goLabel;
    btns.append(go);
    if (mode === 'prompt') {
      const no = document.createElement('button'); no.type = 'button'; no.className = 'wcNo'; no.textContent = tx('install.later');
      no.onclick = () => { put({ later: Date.now() }); hide(); };
      btns.append(no);
    }
    go.onclick = async () => {
      if (mode !== 'prompt') { put({ later: Date.now() }); hide(); return; }
      if (!deferred) return hide();
      deferred.prompt();
      let outcome = 'dismissed';
      try { outcome = (await deferred.userChoice).outcome; } catch (e) { /* treat as dismissed */ }
      deferred = null; hide();
      if (outcome !== 'accepted') put({ later: Date.now() });
    };
    box.append(img, text, btns);
    document.body.append(box);
  }
  const show = (m) => { if (snoozed() || mode === 'prompt') return; mode = m; setTimeout(render, 800); };

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // keep the browser's own mini-bar away, we show our own banner
    deferred = e; mode = null; show('prompt');
  });
  window.addEventListener('appinstalled', () => { put({ installed: true }); deferred = null; mode = null; hide(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && box) { put({ later: Date.now() }); hide(); } });
  document.addEventListener('change', (e) => { if (e.target && e.target.id === 'lg' && box) render(); }); // language switch

  if (webview) show('browser');
  else if (ios) show('ios');
})();
