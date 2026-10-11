/* Watchcoin service worker.
   Browsers only offer to install a website as an app when it has one. This one stores nothing: every request goes straight
   to the network, so people always get the latest version of the app. If the phone is offline, the page opens with a short
   message instead of the browser's error. */
const OFFLINE = '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
  + '<title>Watchcoin</title><body style="font-family:system-ui,sans-serif;background:#0b1330;color:#fff;display:grid;place-items:center;min-height:100vh;margin:0;text-align:center;padding:24px">'
  + '<div><h1 style="color:#E9BD4F;margin:0 0 8px">Watchcoin</h1><p>You are offline. Check your connection, then try again.</p>'
  + '<button onclick="location.reload()" style="padding:12px 20px;border:0;border-radius:12px;background:#E9BD4F;color:#14213D;font-weight:700;font-size:16px">Try again</button></div>';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  if (e.request.mode !== 'navigate') return; // everything else (data, images, scripts) is left alone
  e.respondWith(fetch(e.request).catch(() => new Response(OFFLINE, { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } })));
});
