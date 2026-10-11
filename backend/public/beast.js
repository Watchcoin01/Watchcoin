/* The spin-wheel win show: the winning animal appears, breathes fire and smoke, the screen shakes,
   and the coins won burst out. The dragon (jackpot) gets the biggest version.
   Usage: WCBeast.play({ animal: 'dragon', prize: 500, name: 'Dragon', title: 'Jackpot!' }) -> Promise (resolves when closed). */
(function () {
  const ANIMALS = {
    //            emoji  colour of its wheel segment   power: 0..1 (size of fire, shake, coins)
    goat:   { e: '🐐', c: '#8A6A43', power: 0.25 },
    wolf:   { e: '🐺', c: '#4D5B6E', power: 0.4 },
    bull:   { e: '🐂', c: '#8E2F25', power: 0.45 },
    croc:   { e: '🐊', c: '#2F6B3A', power: 0.55 },
    eagle:  { e: '🦅', c: '#2B5C8A', power: 0.6 },
    lion:   { e: '🦁', c: '#C98A16', power: 0.8 },
    dragon: { e: '🐉', c: '#B3122E', power: 1 },
  };
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

  const css = `
  #beast{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;overflow:hidden;
    background:radial-gradient(ellipse at 50% 40%,rgba(60,20,0,.55),rgba(5,3,0,.92) 70%);opacity:0;transition:opacity .25s;touch-action:none}
  #beast.on{opacity:1}
  #beast canvas{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}
  #beast .flash{position:absolute;inset:0;pointer-events:none;opacity:0;background:radial-gradient(circle at 50% 55%,rgba(255,220,120,.95),rgba(255,90,0,.6) 45%,rgba(120,0,0,0) 75%)}
  #beast .flash.go{animation:bflash .9s ease-out}
  @keyframes bflash{0%{opacity:0}15%{opacity:1}100%{opacity:0}}
  #beast .ani{position:absolute;left:50%;top:34%;transform:translate(-50%,-50%) scale(.1);line-height:1;
    font-size:var(--sz);filter:drop-shadow(0 0 28px rgba(255,140,0,.75)) drop-shadow(0 10px 18px rgba(0,0,0,.6));
    font-family:"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif;user-select:none}
  #beast .ani.in{animation:bin .55s cubic-bezier(.2,1.6,.4,1) forwards}
  #beast .ani.rear{animation:brear .45s ease-in-out forwards}
  #beast .ani.breathe{animation:bbreathe var(--bt) ease-in-out forwards}
  @keyframes bin{0%{transform:translate(-50%,-50%) scale(.1) rotate(-25deg)}100%{transform:translate(-50%,-50%) scale(1) rotate(0)}}
  @keyframes brear{to{transform:translate(-50%,-62%) scale(1.08) rotate(-6deg)}}
  @keyframes bbreathe{0%{transform:translate(-50%,-62%) scale(1.08) rotate(-6deg)}12%{transform:translate(-50%,-45%) scale(1.22) rotate(4deg)}
    50%{transform:translate(-50%,-47%) scale(1.18) rotate(-2deg)}100%{transform:translate(-50%,-50%) scale(1) rotate(0)}}
  #beast .txt{position:absolute;left:0;right:0;bottom:12%;text-align:center;color:#fff;pointer-events:none;opacity:0;transform:scale(.6);transition:all .35s cubic-bezier(.2,1.6,.4,1)}
  #beast .txt.on{opacity:1;transform:scale(1)}
  #beast .ttl{font:800 clamp(22px,6vw,34px)/1.1 'Bricolage Grotesque',system-ui,sans-serif;letter-spacing:.02em;text-transform:uppercase;
    color:#FFD66B;-webkit-text-stroke:1.5px #5a2400;paint-order:stroke fill;text-shadow:0 0 18px rgba(255,120,0,.9),0 3px 0 #7a2d00,0 0 6px rgba(0,0,0,.9)}
  #beast .amt{font:800 clamp(52px,16vw,96px)/1 'Bricolage Grotesque',system-ui,sans-serif;color:#FFE08A;
    -webkit-text-stroke:2px #5a2400;paint-order:stroke fill;text-shadow:0 0 30px rgba(255,170,0,.9),0 5px 0 #8a4b00,0 0 6px rgba(0,0,0,.9),0 9px 18px rgba(0,0,0,.6)}
  #beast .amt small{font-size:.38em;margin-left:.15em}
  #beast .hint{margin-top:10px;font:600 13px system-ui,sans-serif;color:rgba(255,255,255,.65)}
  .quake{animation:bquake var(--qt,.12s) linear infinite}
  @keyframes bquake{0%{transform:translate(0,0)}20%{transform:translate(calc(var(--q)*-1),calc(var(--q)*.5))}40%{transform:translate(var(--q),calc(var(--q)*-.6))}
    60%{transform:translate(calc(var(--q)*-.7),calc(var(--q)*-.3))}80%{transform:translate(calc(var(--q)*.6),var(--q))}100%{transform:translate(0,0)}}`;
  const style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);

  // Pre-drawn soft dots for fire and smoke, so each frame only stamps images (fast on phones).
  function dot(r, stops) {
    const c = document.createElement('canvas'); c.width = c.height = r * 2;
    const g = c.getContext('2d'), gr = g.createRadialGradient(r, r, 0, r, r, r);
    stops.forEach(([o, col]) => gr.addColorStop(o, col)); g.fillStyle = gr; g.fillRect(0, 0, r * 2, r * 2); return c;
  }
  const FIRE = [
    dot(32, [[0, 'rgba(255,255,230,1)'], [0.35, 'rgba(255,230,120,.9)'], [1, 'rgba(255,200,60,0)']]),
    dot(32, [[0, 'rgba(255,220,90,1)'], [0.4, 'rgba(255,150,20,.85)'], [1, 'rgba(255,90,0,0)']]),
    dot(32, [[0, 'rgba(255,130,20,.95)'], [0.45, 'rgba(230,60,0,.7)'], [1, 'rgba(160,20,0,0)']]),
    dot(32, [[0, 'rgba(200,40,0,.8)'], [0.5, 'rgba(120,15,0,.45)'], [1, 'rgba(60,0,0,0)']]),
  ];
  const SMOKE = dot(48, [[0, 'rgba(90,85,80,.55)'], [0.5, 'rgba(70,66,62,.3)'], [1, 'rgba(50,48,46,0)']]);
  const COIN = (() => {
    const r = 22, c = document.createElement('canvas'); c.width = c.height = r * 2; const g = c.getContext('2d');
    const gr = g.createRadialGradient(r * 0.7, r * 0.6, 2, r, r, r); gr.addColorStop(0, '#FFF3B0'); gr.addColorStop(0.5, '#F5C21B'); gr.addColorStop(1, '#B07A00');
    g.fillStyle = gr; g.beginPath(); g.arc(r, r, r - 1, 0, 7); g.fill();
    g.lineWidth = 3; g.strokeStyle = '#8A5A00'; g.beginPath(); g.arc(r, r, r - 5, 0, 7); g.stroke();
    g.fillStyle = '#7A4A00'; g.font = '800 22px system-ui,sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('W', r, r + 1);
    return c;
  })();

  function play(opts) {
    const a = ANIMALS[opts.animal] || ANIMALS.goat, P = a.power, dragon = opts.animal === 'dragon', calm = reduced();
    return new Promise((done) => {
      const root = document.createElement('div'); root.id = 'beast'; root.setAttribute('role', 'dialog'); root.setAttribute('aria-label', `${opts.name} +${opts.prize} WTC`);
      root.innerHTML = `<canvas></canvas><div class="flash"></div><div class="ani" aria-hidden="true">${a.e}</div>
        <div class="txt"><div class="ttl"></div><div class="amt">+0<small>WTC</small></div><div class="hint"></div></div>`;
      document.body.appendChild(root);
      const cv = root.querySelector('canvas'), g = cv.getContext('2d'), ani = root.querySelector('.ani'), txt = root.querySelector('.txt');
      const amt = root.querySelector('.amt'), flash = root.querySelector('.flash');
      root.querySelector('.ttl').textContent = opts.title || opts.name;
      root.querySelector('.hint').textContent = opts.hint || '';
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      let W = 0, H = 0;
      const size = () => { W = innerWidth; H = innerHeight; cv.width = W * dpr; cv.height = H * dpr; g.setTransform(dpr, 0, 0, dpr, 0, 0); };
      size(); addEventListener('resize', size);
      const sz = Math.min(W * (dragon ? 0.62 : 0.5), H * (dragon ? 0.36 : 0.3), dragon ? 280 : 220);
      ani.style.setProperty('--sz', sz + 'px');
      requestAnimationFrame(() => root.classList.add('on'));

      // ---- timeline (ms) ----
      const T_IN = 0, T_REAR = 550, T_FIRE = 1000, FIRE_MS = calm ? 0 : 1300 + 1500 * P, T_COINS = T_FIRE + Math.max(FIRE_MS * 0.55, 400), T_END = T_COINS + 2600 + 900 * P;
      ani.style.setProperty('--bt', (FIRE_MS + 400) + 'ms');
      ani.classList.add('in');
      const parts = [], coins = [];
      let t0 = performance.now(), last = t0, closed = false, raf = 0, counted = false;
      const shakeEls = [root, document.querySelector('.wrap')].filter(Boolean);
      const shake = (on) => shakeEls.forEach((el) => { if (on && !calm) { el.style.setProperty('--q', (4 + 12 * P) + 'px'); el.classList.add('quake'); } else el.classList.remove('quake'); });
      const timers = [
        setTimeout(() => { ani.classList.remove('in'); ani.classList.add('rear'); }, T_REAR),
        setTimeout(() => {
          ani.classList.remove('rear'); ani.classList.add('breathe'); shake(true);
          if (dragon || P >= 0.8) flash.classList.add('go');
          try { navigator.vibrate && navigator.vibrate(dragon ? [120, 40, 160, 40, 260, 60, 320] : [60, 30, 90 + 120 * P]); } catch (e) { /* not supported */ }
        }, T_FIRE),
        setTimeout(() => shake(false), T_FIRE + FIRE_MS),
        setTimeout(burstCoins, T_COINS),
        setTimeout(close, T_END),
      ];

      // Where the fire comes from: just under the middle of the animal, pouring down and out at the viewer.
      const mouth = () => { const r = ani.getBoundingClientRect(); return { x: r.left + r.width * 0.5, y: r.top + r.height * 0.45 }; };

      function emitFire(dt) {
        // A jet: starts small at the head and widens quickly as it comes toward the viewer.
        const m = mouth(), n = Math.round((dragon ? 42 : 12 + 20 * P) * dt / 16);
        const el = performance.now() - t0 - T_FIRE, sway = Math.sin(el / 260) * 0.18; // the beast swings its head a little
        const spread = 0.22 + 0.3 * P, speed = 10 + 12 * P;
        for (let i = 0; i < n; i++) {
          const ang = Math.PI / 2 + sway + (Math.random() - 0.5) * spread * 2, v = speed * (0.7 + Math.random() * 0.6);
          parts.push({ k: 'f', x: m.x + (Math.random() - 0.5) * 8, y: m.y, vx: Math.cos(ang) * v, vy: Math.sin(ang) * v, life: 0, max: 26 + Math.random() * 22 + 16 * P, r: 5 + Math.random() * 6 });
        }
        if (Math.random() < 0.5 + 0.4 * P) parts.push({ k: 'e', x: m.x, y: m.y, vx: (Math.random() - 0.5) * 12 * (0.6 + P), vy: 2 + Math.random() * 10, life: 0, max: 50 + Math.random() * 40, r: 1.5 + Math.random() * 2 });
        if (Math.random() < 0.35) { const s = Math.random() < 0.5 ? -1 : 1; parts.push({ k: 's', x: m.x + s * sz * 0.12, y: m.y - sz * 0.2, vx: s * 0.6, vy: -1.2, life: 0, max: 80, r: 14 }); }
      }
      function burstCoins() {
        if (closed) return;
        const n = calm ? 0 : Math.round(8 + 42 * P), cx = W / 2, cy = H * 0.62;
        for (let i = 0; i < n; i++) coins.push({ x: cx + (Math.random() - 0.5) * 60, y: cy, vx: (Math.random() - 0.5) * (8 + 10 * P), vy: -(9 + Math.random() * (9 + 8 * P)), rot: Math.random() * 6, spin: 0.15 + Math.random() * 0.25, s: 0.6 + Math.random() * 0.6 });
        txt.classList.add('on'); countUp();
      }
      function countUp() {
        if (counted) return; counted = true;
        const start = performance.now(), dur = 700 + 500 * P;
        const step = (now) => { const k = Math.min(1, (now - start) / dur), v = Math.round(opts.prize * (1 - Math.pow(1 - k, 3)));
          amt.firstChild.textContent = '+' + v; if (k < 1 && !closed) requestAnimationFrame(step); };
        requestAnimationFrame(step);
      }

      function frame(now) {
        if (closed) return;
        const el = now - t0, dt = Math.min(48, now - last); last = now; const f = dt / 16;
        if (!calm && el >= T_FIRE && el < T_FIRE + FIRE_MS) emitFire(dt);
        g.clearRect(0, 0, W, H);
        // smoke first (normal blending), then fire and embers on top (additive, so they glow)
        g.globalCompositeOperation = 'source-over';
        for (let i = parts.length - 1; i >= 0; i--) {
          const p = parts[i]; p.life += f;
          if (p.life >= p.max) { if (p.k === 'f' && Math.random() < 0.18) parts.push({ k: 's', x: p.x, y: p.y, vx: p.vx * 0.2, vy: -0.8 - Math.random(), life: 0, max: 70 + Math.random() * 50, r: 18 }); parts.splice(i, 1); continue; }
          p.x += p.vx * f; p.y += p.vy * f;
          if (p.k === 's') { p.vx *= 0.99; p.vy -= 0.01 * f; p.r += 0.7 * f; const al = 0.55 * (1 - p.life / p.max); g.globalAlpha = al; g.drawImage(SMOKE, p.x - p.r, p.y - p.r, p.r * 2, p.r * 2); }
        }
        g.globalCompositeOperation = 'lighter';
        for (const p of parts) {
          if (p.k === 'f') {
            p.vx *= 0.975; p.vy = p.vy * 0.975 - 0.06 * f; const k = p.life / p.max, r = p.r * (1 + k * (5 + 5 * P)) * (0.85 + Math.random() * 0.3);
            g.globalAlpha = Math.max(0, 1 - k * k) * (0.42 + 0.2 * (1 - P)); g.drawImage(FIRE[Math.min(3, Math.floor(k * 3.2 + 0.4))], p.x - r, p.y - r, r * 2, r * 2);
          } else if (p.k === 'e') {
            p.vy += 0.12 * f; g.globalAlpha = (1 - p.life / p.max) * (0.6 + Math.random() * 0.4); g.fillStyle = '#FFD27A';
            g.beginPath(); g.arc(p.x, p.y, p.r, 0, 7); g.fill();
          }
        }
        g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
        for (let i = coins.length - 1; i >= 0; i--) {
          const c = coins[i]; c.vy += 0.45 * f; c.x += c.vx * f; c.y += c.vy * f; c.rot += c.spin * f;
          if (c.y > H + 40) { coins.splice(i, 1); continue; }
          const w = 44 * c.s * Math.abs(Math.cos(c.rot)) + 2, h = 44 * c.s;
          g.drawImage(COIN, c.x - w / 2, c.y - h / 2, w, h);
        }
        raf = requestAnimationFrame(frame);
      }
      raf = requestAnimationFrame(frame);

      function close() {
        if (closed) return; closed = true;
        timers.forEach(clearTimeout); shake(false); cancelAnimationFrame(raf); removeEventListener('resize', size);
        root.classList.remove('on'); setTimeout(() => { root.remove(); done(); }, 260);
      }
      // Tap to skip once the coins are out.
      root.addEventListener('click', () => { if (performance.now() - t0 > T_COINS) close(); else if (performance.now() - t0 > T_FIRE) { timers.forEach(clearTimeout); shake(false); burstCoins(); timers.push(setTimeout(close, 1800)); } });
      if (calm) { setTimeout(burstCoins, 600); }
    });
  }

  window.WCBeast = { play, ANIMALS };
})();
