// "Install app" banner: the files are served and wired into the page, and (when jsdom is available) the banner behaves.
process.env.NODE_ENV = 'test';
process.env.DB_PATH = ':memory:';
process.env.JWT_SECRET = 'test-secret';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createApp } = require('../src/server');

const PUB = path.join(__dirname, '..', 'public');
const html = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8');
let server, origin;
before(() => new Promise((resolve) => { server = createApp().listen(0, () => { origin = `http://127.0.0.1:${server.address().port}`; resolve(); }); }));
after(() => server.close());

test('the service worker is served from the site root as JavaScript and has a fetch handler (browsers require it to offer the install)', async () => {
  const res = await fetch(`${origin}/sw.js`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /javascript/);
  const code = await res.text();
  assert.match(code, /addEventListener\('fetch'/);
  assert.doesNotMatch(code, /caches\./, 'it must not store pages, so people always get the newest version');
});

test('the banner script and styles are loaded by the page, and are served', async () => {
  assert.match(html, /<link rel="stylesheet" href="\/install\.css">/);
  assert.match(html, /<script src="\/install\.js"><\/script>/);
  assert.ok(html.indexOf('/install.js') > html.indexOf('/app.js'), 'install.js needs t() from app.js');
  assert.equal((await fetch(`${origin}/install.css`)).status, 200);
  assert.equal((await fetch(`${origin}/install.js`)).status, 200);
});

test('the security policy lets the page run its own scripts and the service worker (and nothing inline)', async () => {
  const csp = (await fetch(`${origin}/`)).headers.get('content-security-policy');
  assert.match(csp, /script-src 'self'/);
  assert.doesNotMatch(csp, /worker-src(?! 'self')/);
  assert.doesNotMatch(csp, /script-src[^;]*unsafe-inline/);
});

test('the manifest has an id and icons, so the browser treats the site as installable', async () => {
  const m = await (await fetch(`${origin}/manifest.webmanifest`)).json();
  assert.equal(m.id, '/');
  assert.equal(m.start_url, '/');
  assert.equal(m.display, 'standalone');
});

test('every language has the banner texts', () => {
  const keys = ['install.title', 'install.sub', 'install.btn', 'install.later', 'install.iosTitle', 'install.ios', 'install.gotIt', 'install.openBrowser'];
  for (const code of ['en', 'fr', 'es', 'zh', 'sw', 'ha', 'tw']) {
    const ui = require(`../i18n/${code}.json`).ui;
    for (const k of keys) assert.ok(typeof ui[k] === 'string' && ui[k].trim(), `${code}: ${k}`);
  }
});

// ---- behaviour in a simulated browser (needs: npm i --no-save jsdom). Skipped when jsdom is not installed. ----
let JSDOM; try { ({ JSDOM } = require('jsdom')); } catch { /* optional */ }
const code = fs.readFileSync(path.join(PUB, 'install.js'), 'utf8');
const TEXT = { 'install.title': 'Install Watchcoin', 'install.sub': 'sub', 'install.btn': 'Install app', 'install.later': 'Not now', 'install.iosTitle': 'iOS title', 'install.ios': 'Tap Share', 'install.gotIt': 'Got it', 'install.openBrowser': 'Open in browser' };
const ANDROID = 'Mozilla/5.0 (Linux; Android 13) Chrome/120 Mobile Safari/537.36';

function visit({ ua = ANDROID, standalone = false, saved = null, platform = 'Linux armv8l' } = {}) {
  const dom = new JSDOM('<body><select id="lg"></select></body>', { runScripts: 'outside-only', url: 'https://watchcoin.example/', pretendToBeVisual: true });
  const w = dom.window, regs = [];
  Object.defineProperty(w.navigator, 'userAgent', { value: ua });
  Object.defineProperty(w.navigator, 'platform', { value: platform });
  Object.defineProperty(w.navigator, 'maxTouchPoints', { value: 5 });
  Object.defineProperty(w.navigator, 'serviceWorker', { value: { register: (u) => { regs.push(u); return Promise.resolve(); } } });
  w.matchMedia = (q) => ({ matches: standalone && q.includes('standalone') });
  if (saved) w.localStorage.setItem('wc_install', JSON.stringify(saved));
  w.t = (k) => TEXT[k] || k;
  const real = w.setTimeout; w.setTimeout = (f) => real(f, 0);
  w.eval(code); w.dispatchEvent(new w.Event('load'));
  return { w, regs, banner: () => w.document.getElementById('wcInstall'), wait: () => new Promise((r) => real(r, 25)) };
}
function installEvent(w, outcome = 'accepted') {
  const e = new w.Event('beforeinstallprompt', { cancelable: true }); e.calls = 0;
  e.prompt = () => { e.calls++; }; e.userChoice = Promise.resolve({ outcome });
  w.dispatchEvent(e); return e;
}
const sim = { skip: JSDOM ? false : 'jsdom not installed (npm i --no-save jsdom to run this)' };

test('Android/Chrome: the banner appears and one tap opens the install box', sim, async () => {
  const v = visit(); const e = installEvent(v.w); await v.wait();
  assert.ok(e.defaultPrevented);
  assert.ok(v.banner().textContent.includes('Install Watchcoin'));
  assert.equal(v.regs[0], '/sw.js');
  v.banner().querySelector('.wcGo').click(); await v.wait();
  assert.equal(e.calls, 1);
  assert.equal(v.banner(), null);
});

test('"Not now" hides it for 7 days, then it comes back', sim, async () => {
  let v = visit(); installEvent(v.w); await v.wait(); v.banner().querySelector('.wcNo').click();
  assert.equal(v.banner(), null);
  v = visit({ saved: { later: Date.now() - 2 * 864e5 } }); installEvent(v.w); await v.wait(); assert.equal(v.banner(), null);
  v = visit({ saved: { later: Date.now() - 8 * 864e5 } }); installEvent(v.w); await v.wait(); assert.ok(v.banner());
});

test('never shown inside the installed app, or after installing', sim, async () => {
  let v = visit({ standalone: true }); installEvent(v.w); await v.wait(); assert.equal(v.banner(), null);
  v = visit({ saved: { installed: true } }); installEvent(v.w); await v.wait(); assert.equal(v.banner(), null);
  v = visit(); installEvent(v.w); await v.wait(); v.w.dispatchEvent(new v.w.Event('appinstalled')); await v.wait();
  assert.equal(v.banner(), null);
  assert.ok(JSON.parse(v.w.localStorage.getItem('wc_install')).installed);
});

test('iPhone gets the Share steps, and Facebook/Instagram browsers are told to open a real browser', sim, async () => {
  let v = visit({ ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1', platform: 'iPhone' });
  await v.wait();
  assert.ok(v.banner().textContent.includes('Tap Share'));
  v = visit({ ua: 'Mozilla/5.0 (Linux; Android 13; wv) Chrome/120 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/440.0]' }); await v.wait();
  assert.ok(v.banner().textContent.includes('Open in browser'));
});

test('browsers that cannot install see nothing, and text is never treated as HTML', sim, async () => {
  let v = visit({ ua: 'Mozilla/5.0 (Windows NT 10.0) Firefox/120.0', platform: 'Win32' }); await v.wait(); assert.equal(v.banner(), null);
  v = visit(); v.w.t = () => '<img src=x onerror=alert(1)>'; installEvent(v.w); await v.wait();
  assert.equal(v.banner().querySelector('img[src="x"]'), null);
});
