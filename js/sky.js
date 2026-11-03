/* Weather Drone · visuals: wind waves, weather on the sky, animation level, frame loop */
'use strict';

/* ---------- wave visuals ---------- */
const cv = $('wave'), cx = cv.getContext('2d');
const acv = $('ambWave'), acx = acv.getContext('2d');
const css = getComputedStyle(document.documentElement);
let FG = css.getPropertyValue('--fg').trim(), DIM = css.getPropertyValue('--dim').trim(), LINE = css.getPropertyValue('--line').trim();
let ACC = css.getPropertyValue('--accent').trim() || '#7fd0ff';
const MONO = "'IBM Plex Mono', ui-monospace, monospace";
let phase = 0, lastT = 0;
const reduceMotion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

function fit(c, ctx) {
  const r = c.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
  if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { w, h };
}
// wx: { front: position of a passing gust front (or -1), push: its strength, hot: heat mirage 0..1 }
function drawWaves(ctx, w, top, bottom, N, aBase, aWind, g, windN, lw, wx) {
  const mid = (top + bottom) / 2, L = (N - 1) / 2, gap = (bottom - top) / (N - 1) * 0.8;
  const amp = (aBase + windN * aWind) * (0.5 + 0.5 * g), step = w > 1200 ? 4 : 3;
  const front = wx ? wx.front : -1, push = wx ? wx.push : 0, hot = wx ? wx.hot : 0, shimmer = Math.min(6, gap * 0.12) * hot;
  for (let i = 0; i < N; i++) {
    const y0 = mid + (i - L) * gap, lead = i === L, k = i / (N - 1) * 8;
    ctx.beginPath();
    for (let x = 0; x <= w + step; x += step) {
      const u = Math.min(1, x / w), env = Math.pow(Math.sin(Math.PI * u), 0.7);
      const boost = front > -0.5 ? 1 + push * Math.exp(-Math.pow((u - front) / 0.11, 2)) : 1;   // a gust front rolling through
      let y = y0 + env * amp * boost * (0.55 + 0.45 * Math.sin(k * 0.9 + phase * 0.2)) *
        (0.7 * Math.sin(u * 7 + phase * 1.3 + k * 0.55) + 0.9 * noise(u * 3.2 + phase * 0.8 + k * 0.4));
      // heat: the lower lines tremble like air over hot asphalt
      if (shimmer) y += shimmer * (i / (N - 1)) * Math.sin(x * 0.09 + FX.t * 7 + i * 1.7) * Math.sin(x * 0.013 + FX.t * 0.9);
      if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.globalAlpha = lead ? 1 : 0.12 + 0.26 * (1 - Math.abs(i - L) / L);
    ctx.strokeStyle = lead ? ACC : FG; ctx.lineWidth = lead ? lw * 1.5 : lw; ctx.stroke();
  }
  ctx.globalAlpha = 1;
}
/* ---------- weather on the sky: clouds, rain, snow, wind, storm, heat, frost, fog ---------- */
const fxc = $('fx'), fxx = fxc.getContext('2d');
const FX = { drops: [], snow: [], streaks: [], clouds: null, sprites: null, frostTex: null, frostLayer: null, front: -1, push: 0, gPrev: 0, shake: '', flash: 0, flash2: 0, t: 0, nextBolt: 0 };
function fitFx() {
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5), w = Math.max(1, innerWidth), h = Math.max(1, innerHeight);
  if (fxc.width !== Math.round(w * dpr) || fxc.height !== Math.round(h * dpr)) { fxc.width = Math.round(w * dpr); fxc.height = Math.round(h * dpr); }
  fxx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { w, h };
}
// three cloud shapes, each rendered once in a light and a storm-dark tint
function cloudSprites() {
  if (FX.sprites) return FX.sprites;
  const shapes = [0, 1, 2].map(() => Array.from({ length: 9 }, () => [70 + Math.random() * 370, 70 + Math.random() * 60, 40 + Math.random() * 60]));
  const make = rgb => shapes.map(blobs => {
    const c = document.createElement('canvas'); c.width = 512; c.height = 200; const x = c.getContext('2d');
    blobs.forEach(([cx, cy, r]) => { const gr = x.createRadialGradient(cx, cy, 0, cx, cy, r); gr.addColorStop(0, 'rgba(' + rgb + ',0.55)'); gr.addColorStop(1, 'rgba(' + rgb + ',0)'); x.fillStyle = gr; x.fillRect(0, 0, 512, 200); });
    return c;
  });
  FX.sprites = { light: make('255,255,255'), dark: make('46,52,62') };
  FX.clouds = Array.from({ length: 8 }, (_, i) => ({ x: Math.random() * 1.4 - 0.2, y: -0.04 + Math.random() * 0.2, s: 0.6 + Math.random() * 0.9, k: i % 3, v: 0.6 + Math.random() * 0.8 }));
  return FX.sprites;
}
function fxState() {
  const b = bft(W.wind), prec = W.precip > 0.05 ? clamp(W.precip / 4, 0.12, 1) : 0, snow = prec > 0 && W.temp <= 0.5;
  return {
    b, wn: clamp(W.wind / 60, 0, 2.2), cloud: W.cloud / 100,
    rain: snow ? 0 : prec, snow: snow ? prec : 0,
    storm: b >= 8 && (W.cloud > 55 || prec > 0) ? clamp((b - 7) / 5, 0.2, 1) : 0,
    heat: clamp((W.temp - 26) / 9, 0, 1), cold: clamp(-W.temp / 15, 0, 1),
    gale: clamp((b - 7) / 5, 0, 1),                                       // Bft 8 .. 12
    fog: W.hum >= 92 ? clamp((W.hum - 92) / 8, 0, 1) * clamp(1 - W.wind / 15, 0, 1) : 0
  };
}
/* frost on the glass: a soft, uneven rime haze that hugs the edges (thickest in the corners), a fine grain and short
   feathery branches at the very rim. Rendered once per screen size and colour scheme, then only faded in and out. */
function frostTexture(w, h, light) {
  const key = Math.round(w / 40) + 'x' + Math.round(h / 40) + (light ? 'L' : 'D');
  if (FX.frostTex && FX.frostTex.key === key) return FX.frostTex.c;
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const c = document.createElement('canvas'); c.width = Math.round(w); c.height = Math.round(h);
  const x = c.getContext('2d'), m = Math.min(w, h), band = m * 0.24;
  const col = light ? '135,160,185' : '228,239,252';
  const edgePoint = (depthMax, cornerBias) => {
    // a point near an edge; with cornerBias it prefers the corners
    const side = Math.floor(rnd() * 4); let u = rnd();
    if (rnd() < cornerBias) u = rnd() < 0.5 ? Math.pow(u, 3) * 0.3 : 1 - Math.pow(u, 3) * 0.3;
    const d = Math.pow(rnd(), 1.8) * depthMax;
    return { side, px: side === 0 ? d : side === 1 ? w - d : u * w, py: side === 2 ? d : side === 3 ? h - d : u * h, d };
  };
  // 1. rime haze: many soft blobs along the edges give an irregular frosted border
  for (let i = 0, n = Math.round((w + h) / 9); i < n; i++) {
    const q = edgePoint(band * 0.9, 0.45), r = band * (0.25 + rnd() * 0.6);
    const g = x.createRadialGradient(q.px, q.py, 0, q.px, q.py, r);
    g.addColorStop(0, 'rgba(' + col + ',' + (0.11 * (1 - q.d / band)).toFixed(3) + ')'); g.addColorStop(1, 'rgba(' + col + ',0)');
    x.fillStyle = g; x.fillRect(q.px - r, q.py - r, r * 2, r * 2);
  }
  // 2. grain: sparse soft specks right at the rim
  for (let i = 0, n = Math.round((w + h) * 1.6); i < n; i++) {
    const q = edgePoint(band * 0.7, 0.3);
    x.fillStyle = 'rgba(' + col + ',' + (0.22 * (1 - q.d / (band * 0.7))).toFixed(3) + ')';
    x.beginPath(); x.arc(q.px, q.py, 0.5 + rnd() * 0.7, 0, Math.PI * 2); x.fill();
  }
  // 3. feathers: short, finely forked branches that stay within the rim
  x.lineCap = 'round';
  const grow = (px, py, ang, len, wdt, gen) => {
    let L = len;
    x.beginPath(); x.moveTo(px, py);
    while (L > 0) {
      const st = 1.5 + rnd() * 2; ang += (rnd() - 0.5) * 0.35;
      px += Math.cos(ang) * st; py += Math.sin(ang) * st; L -= st;
      x.lineTo(px, py);
      if (gen < 2 && rnd() < 0.16) grow(px, py, ang + (rnd() < 0.5 ? -1 : 1) * (0.6 + rnd() * 0.4), L * 0.45, wdt * 0.75, gen + 1);
    }
    x.strokeStyle = 'rgba(' + col + ',' + (0.2 / (gen + 1)).toFixed(3) + ')';
    x.lineWidth = wdt; x.stroke();
  };
  for (let i = 0, n = Math.round((w + h) / 40); i < n; i++) {
    const q = edgePoint(band * 0.05, 0.5);
    const inward = [0, Math.PI, Math.PI / 2, -Math.PI / 2][q.side] + (rnd() - 0.5) * 1.4;
    grow(q.px, q.py, inward, band * (0.2 + rnd() * 0.45), 0.7, 0);
  }
  FX.frostTex = { key, c };
  return c;
}
// the frost texture, cut back to the edges: the colder it is, the further in it reaches (cached per 5 % of cold)
function frostLayer(w, h, light, cold) {
  const step = Math.round(cold * 20) / 20, tex = frostTexture(w, h, light);
  if (FX.frostLayer && FX.frostLayer.tex === tex && FX.frostLayer.step === step) return FX.frostLayer.c;
  const c = (FX.frostLayer && FX.frostLayer.c) || document.createElement('canvas');
  c.width = tex.width; c.height = tex.height;
  const x = c.getContext('2d');
  x.clearRect(0, 0, c.width, c.height); x.drawImage(tex, 0, 0);
  // erase an ellipse in the middle; its edge moves outwards as it warms up
  const reach = 0.1 + 0.5 * step, rin = Math.max(0.05, 1 - reach), rout = rin + 0.22;
  x.save(); x.globalCompositeOperation = 'destination-out';
  x.setTransform(c.width / 2, 0, 0, c.height / 2, c.width / 2, c.height / 2);
  const gr = x.createRadialGradient(0, 0, 0, 0, 0, rout);
  gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(rin / rout, 'rgba(0,0,0,1)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = gr; x.fillRect(-1.5, -1.5, 3, 3); x.restore();
  FX.frostLayer = { tex, step, c };
  return c;
}
// raindrops on the glass: most cling, now and then one lets go and runs down, leaving a faint trail
function newDrop(anywhere) {
  return { x: Math.random(), y: anywhere ? Math.random() : Math.random() * 0.85, r: 1.2 + Math.pow(Math.random(), 2) * 3.2,
           v: 0, run: 0, wait: 2 + Math.random() * 14, trail: [], ph: Math.random() * 6.3 };
}

// keep a particle pool at the target size
function pool(arr, n, make) { while (arr.length < n) arr.push(make()); if (arr.length > n) arr.length = n; return arr; }
function drawFx(ctx, w, h, dt, st, light) {
  const sp = cloudSprites(), area = clamp(w * h / (1920 * 1080), 0.3, 1.6) * (ANIM === 'calm' ? 0.5 : 1), slow = reduceMotion ? 0.25 : 1;
  ctx.save();
  // clouds: count follows cloud cover, speed follows wind, storms darken them
  const nc = Math.round(st.cloud * 8), cs = (0.004 + st.wn * 0.03) * slow;
  const aL = (light ? 0.6 : 0.13) * (1 - st.storm * 0.7), aD = st.storm * 0.38 + (st.rain || st.snow ? 0.1 : 0);
  for (let i = 0; i < nc; i++) {
    const c = FX.clouds[i]; c.x += cs * c.v * dt; if (c.x > 1.3) { c.x = -0.45; c.y = -0.04 + Math.random() * 0.2; }
    const cw = Math.min(w * 0.32, 520) * c.s, chh = cw * 200 / 512, px = c.x * w - cw * 0.3, py = c.y * h;
    ctx.globalAlpha = aL; ctx.drawImage(sp.light[c.k], px, py, cw, chh);
    if (aD > 0) { ctx.globalAlpha = aD; ctx.drawImage(sp.dark[c.k], px, py, cw, chh); }
  }
  // clouds belong to the upper sky: dissolve them before they reach the controls
  if (nc) {
    const fade = ctx.createLinearGradient(0, h * 0.18, 0, h * 0.5);
    fade.addColorStop(0, 'rgba(0,0,0,0)'); fade.addColorStop(1, 'rgba(0,0,0,1)');
    ctx.globalCompositeOperation = 'destination-out'; ctx.globalAlpha = 1; ctx.fillStyle = fade; ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'source-over';
  }
  // fog: soft drifting banks
  if (st.fog > 0) {
    for (let k = 0; k < 3; k++) {
      const cx = ((FX.t * 0.006 * (k % 2 ? 1 : -1) * slow + k * 0.37) % 1.4 + 1.4) % 1.4 * w - w * 0.2, cy = h * (0.3 + k * 0.25);
      const gr = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w, h) * 0.6);
      gr.addColorStop(0, light ? 'rgba(255,255,255,0.8)' : 'rgba(150,160,170,0.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.globalAlpha = 0.6 * st.fog; ctx.fillStyle = gr; ctx.fillRect(0, 0, w, h);
    }
  }
  // heat: warm haze and shimmering bands near the horizon
  if (st.heat > 0) {
    const gr = ctx.createLinearGradient(0, h * 0.4, 0, h);
    gr.addColorStop(0, 'rgba(255,150,60,0)'); gr.addColorStop(1, 'rgba(255,150,60,0.22)');
    ctx.globalAlpha = st.heat; ctx.fillStyle = gr; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgb(255,170,90)'; ctx.lineWidth = 22; ctx.globalAlpha = 0.05 * st.heat;
    for (let k = 0; k < 6; k++) {
      const y0 = h * (0.6 + k * 0.075) - ((FX.t * 14 * slow) % (h * 0.075));
      ctx.beginPath();
      for (let x = 0; x <= w + 12; x += 12) { const y = y0 + Math.sin(x * 0.012 + FX.t * 1.6 * slow + k) * 6 * (1 + st.heat); if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
      ctx.stroke();
    }
  }
  // wind streaks from Bft 5 up, a gale of them in a hurricane
  const ns = st.b >= 5 ? Math.round(clamp((st.b - 4) / 8, 0, 1) * (45 + st.gale * 30) * area) : 0;
  pool(FX.streaks, ns, () => ({ x: Math.random(), y: Math.random(), l: 0.04 + Math.random() * 0.12, v: 0.7 + Math.random() * 0.6, ph: Math.random() * 6.3 }));
  if (ns) {
    ctx.strokeStyle = light ? 'rgb(40,50,60)' : 'rgb(230,236,240)'; ctx.lineWidth = 1; ctx.globalAlpha = 0.08 + 0.1 * clamp((st.b - 4) / 8, 0, 1);
    ctx.beginPath();
    FX.streaks.forEach(q => {
      q.x += (0.25 + st.wn * 0.6) * q.v * dt * slow * (1 + st.gale);
      const l = q.l * (1 + st.gale * 1.5);
      if (q.x - l > 1) { q.x = -Math.random() * 0.2; q.y = Math.random(); }
      const X = q.x * w, Y = q.y * h + Math.sin(FX.t * 2 + q.ph) * 6 * (1 - st.gale * 0.6);
      ctx.moveTo(X, Y); ctx.quadraticCurveTo(X - l * w * 0.5, Y - 4, X - l * w, Y + 2);
    });
    ctx.stroke();
  }
  // rain: barely visible drops on the glass; a few at a time let go, trickle a short way and cling again
  const nr = Math.round(st.rain * 140 * area);
  pool(FX.drops, nr, () => newDrop(true));
  if (nr) {
    // a light sky needs a little more contrast for the same 'barely there' look
    const tint = 'rgb(' + (light ? '60,80,100' : '225,236,248') + ')', vis = (0.55 + st.rain * 0.45) * (light ? 1.6 : 1);
    const drift = Math.pow(Math.min(st.wn, 2.2), 2) * 0.02, maxRunning = Math.round(2 + st.rain * 8), now = FX.t;
    let running = 0; for (const q of FX.drops) if (q.v) running++;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = tint;
    for (const q of FX.drops) {
      if (q.v === 0) {
        q.wait -= dt * (0.6 + st.rain);                                  // heavier rain: drops let go sooner
        if (q.wait <= 0 && q.r > 1.7 && running < maxRunning) {
          q.v = 0.025 + Math.random() * 0.05 * (q.r / 3); q.run = 0.04 + Math.random() * 0.3; running++;
        }
      } else {
        const sx = q.x * w, sy = q.y * h, dy = q.v * dt * slow * (0.6 + 0.8 * Math.abs(Math.sin(now * 1.3 + q.ph)));  // run, hesitate, run
        q.y += dy; q.run -= dy;
        q.x += (drift + Math.sin(now * 2 + q.ph) * 0.0015) * dt * slow;
        const last = q.trail[q.trail.length - 1];
        if (!last || Math.hypot(sx - last[0], sy - last[1]) > 5) q.trail.push([sx, sy, now]);
        if (q.y > 1.04) { Object.assign(q, newDrop(false)); continue; }  // off the bottom: a fresh drop lands somewhere
        if (q.run <= 0) { q.v = 0; q.wait = 6 + Math.random() * 20; }     // clings again
      }
      // the wet trail dries out over ~5 s
      while (q.trail.length && now - q.trail[0][2] > 5) q.trail.shift();
    }
    // draw everything in four batched passes instead of several calls per drop
    ctx.globalAlpha = 0.055 * vis; ctx.beginPath();
    for (const q of FX.drops) {
      if (!q.trail.length) continue;
      ctx.moveTo(q.trail[0][0], q.trail[0][1]);
      for (let i = 1; i < q.trail.length; i++) ctx.lineTo(q.trail[i][0], q.trail[i][1]);
      ctx.lineTo(q.x * w, q.y * h);
    }
    ctx.lineWidth = 1.1; ctx.stroke();
    ctx.globalAlpha = 0.09 * vis; ctx.fillStyle = tint; ctx.beginPath();          // lens
    for (const q of FX.drops) { const X = q.x * w, Y = q.y * h; ctx.moveTo(X + q.r, Y); ctx.ellipse(X, Y, q.r, q.r * (q.v ? 1.25 : 1), 0, 0, Math.PI * 2); }
    ctx.fill();
    ctx.globalAlpha = 0.14 * vis; ctx.lineWidth = 0.7; ctx.beginPath();             // denser lower rim
    for (const q of FX.drops) { const X = q.x * w, Y = q.y * h, a0 = 0.15 * Math.PI; ctx.moveTo(X + Math.cos(a0) * q.r, Y + Math.sin(a0) * q.r); ctx.arc(X, Y, q.r, a0, 0.85 * Math.PI); }
    ctx.stroke();
    ctx.globalAlpha = 0.32 * vis; ctx.fillStyle = '#fff'; ctx.beginPath();         // pinpoint highlight
    for (const q of FX.drops) { const X = q.x * w - q.r * 0.35, Y = q.y * h - q.r * 0.35, hr = Math.max(0.5, q.r * 0.22); ctx.moveTo(X + hr, Y); ctx.arc(X, Y, hr, 0, Math.PI * 2); }
    ctx.fill();
  }
  // snow: drifting, swaying flakes
  const nf = Math.round(st.snow * 260 * area);
  pool(FX.snow, nf, () => ({ x: Math.random() * 1.2 - 0.1, y: Math.random(), r: 1 + Math.random() * 2.2, v: 0.6 + Math.random() * 0.6, ph: Math.random() * 6.3 }));
  if (nf) {
    ctx.beginPath();
    FX.snow.forEach(q => {
      q.y += 0.07 * q.v * (1 + st.snow * 0.5) * dt * slow;
      q.x += (Math.min(st.wn, 1.6) * 0.1 + Math.sin(FX.t * 0.8 + q.ph) * 0.01) * dt * slow;
      if (q.y > 1.03) { q.y = -0.03; q.x = Math.random() * 1.2 - 0.2; }
      if (q.x > 1.05) q.x -= 1.1;
      const X = q.x * w, Y = q.y * h; ctx.moveTo(X + q.r, Y); ctx.arc(X, Y, q.r, 0, Math.PI * 2);
    });
    ctx.globalAlpha = 0.9; ctx.fillStyle = '#fff'; ctx.fill();
    if (light) { ctx.globalAlpha = 0.18; ctx.strokeStyle = 'rgb(90,105,120)'; ctx.lineWidth = 0.8; ctx.stroke(); }
  }
  // frost: an icy vignette plus rime and fern-like frost creeping in from the edges
  if (st.cold > 0) {
    const gr = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75);
    gr.addColorStop(0, 'rgba(225,238,255,0)'); gr.addColorStop(1, 'rgba(225,238,255,0.6)');
    ctx.globalAlpha = 0.55 * st.cold; ctx.fillStyle = gr; ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = 0.5 + 0.5 * st.cold; ctx.drawImage(frostLayer(w, h, light, st.cold), 0, 0, w, h);
  }
  // gale: the edges of the sky darken, as if the light is closing in
  if (st.gale > 0) {
    const gr = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.75);
    gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, light ? 'rgba(40,48,58,0.38)' : 'rgba(0,0,0,0.6)');
    ctx.globalAlpha = st.gale * 0.7; ctx.fillStyle = gr; ctx.fillRect(0, 0, w, h);
  }
  if (FX.flash > 0) { ctx.globalAlpha = FX.flash * 0.3; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); FX.flash = Math.max(0, FX.flash - dt * 4); }
  ctx.restore();
}
// storm clock: thunder always, the lightning flash only with full animation and no reduced-motion preference
function stormTick(st, dt) {
  FX.t += dt;
  if (st.storm > 0) {
    if (FX.t >= FX.nextBolt) {
      if (FX.nextBolt) {
        thunder(rand(0.6, 2.8), 0.4 + st.storm * 0.6);
        if (ANIM === 'full' && !reduceMotion) { FX.flash = 1; FX.flash2 = FX.t + 0.12; }
      }
      FX.nextBolt = FX.t + rand(6, 18) / (0.5 + st.storm);
    }
    if (FX.flash2 && FX.t >= FX.flash2) { FX.flash = 0.7; FX.flash2 = 0; }
  } else FX.nextBolt = 0;
}

/* gust fronts: when a strong gust arrives, a pressure wave rolls across the wind lines from left to right */
function gustFront(st, dt, g) {
  if (FX.front > -0.5) { FX.front += dt * (0.35 + st.wn * 0.45); if (FX.front > 1.3) FX.front = -1; }
  else if (st.b >= 3 && g > 0.74 && FX.gPrev <= 0.74) { FX.front = -0.25; FX.push = clamp((st.b - 2) / 9, 0.2, 1) * 1.3; }
  FX.gPrev = g;
}
/* hurricane: on the strongest gusts the sky and the waves shudder by a pixel or two — never the controls */
function tremor(st, tt, g, still) {
  let x = 0, y = 0;
  if (st.gale > 0.3 && !still && !reduceMotion) {
    const a = (st.gale - 0.3) / 0.7 * (ANIM === 'full' ? 2.4 : 1.2) * Math.max(0, g - 0.45) * 1.8;
    x = noise(tt * 11) * a; y = noise(tt * 13 + 40) * a * 0.6;
  }
  const v = x || y ? 'translate(' + x.toFixed(2) + 'px,' + y.toFixed(2) + 'px)' : '';
  if (v !== FX.shake) { FX.shake = v; cv.style.transform = v; fxc.style.transform = v; acv.style.transform = v; }
}

/* ---------- animation level: full = 60 fps; calm = 30 fps (20 at night in ambient), half the particles, no flashes;
   off = a still picture redrawn twice a second so colours keep following the sky ---------- */
let ANIM = 'calm';
try { const a = localStorage.getItem('wd-anim'); if (a === 'full' || a === 'calm' || a === 'off') ANIM = a; else if (reduceMotion) ANIM = 'off'; } catch (e) { if (reduceMotion) ANIM = 'off'; }
let lastDraw = 0, fxCleared = false;
function renderAnim() {
  document.querySelectorAll('#animSeg button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.anim === ANIM)));
  document.documentElement.classList.toggle('anim-off', ANIM === 'off');
}
$('animSeg').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  ANIM = b.dataset.anim; FX.flash = 0; fxCleared = false; lastDraw = 0; renderAnim();
  try { localStorage.setItem('wd-anim', ANIM); } catch (err) { /* optional */ }
});
renderAnim();

function readColors() {
  const cs = getComputedStyle(document.documentElement);
  FG = cs.getPropertyValue('--fg').trim() || FG; DIM = cs.getPropertyValue('--dim').trim() || DIM;
  LINE = cs.getPropertyValue('--line').trim() || LINE; ACC = cs.getPropertyValue('--accent').trim() || ACC;
}
function frame(ms) {
  requestAnimationFrame(frame);
  const fps = ANIM === 'full' ? 0 : ANIM === 'off' ? 2 : (ambOn && W.night ? 20 : 30);
  if (fps && ms - lastDraw < 1000 / fps - 2) return;
  lastDraw = ms;
  readColors();
  const tt = ms / 1000, dt = Math.min(0.1, tt - lastT || 0.016); lastT = tt;
  const still = ANIM === 'off';
  const windN = clamp(W.wind / 50, 0, 1), g = still ? 0.6 : gust(tt);
  const st = fxState(), light = document.documentElement.style.colorScheme === 'light';
  // frost makes the air sluggish: the waves slow down as it gets colder
  if (!still) phase += dt * (0.35 + windN * 2.4) * (reduceMotion ? 0.25 : 1) * (0.6 + 0.8 * g) * (1 - st.cold * 0.45);
  stormTick(st, dt);
  const wx = { front: -1, push: 0, hot: still ? 0 : st.heat };
  if (!still) { gustFront(st, dt, g); wx.front = FX.front; wx.push = FX.push; }
  tremor(st, tt, g, still);
  if (ambOn) {
    const { w, h } = fit(acv, acx);
    acx.clearRect(0, 0, w, h);
    if (!still) drawFx(acx, w, h, dt, st, light);
    drawWaves(acx, w, h * 0.2, h * 0.8, 13, h * 0.02, h * 0.09, g, windN, 1.1, wx);
  } else {
    if (!still) { const fw = fitFx(); fxx.clearRect(0, 0, fw.w, fw.h); drawFx(fxx, fw.w, fw.h, dt, st, light); fxCleared = false; }
    else if (!fxCleared) { const fw = fitFx(); fxx.clearRect(0, 0, fw.w, fw.h); fxCleared = true; }
    const { w: cw, h: ch } = fit(cv, cx);
    cx.clearRect(0, 0, cw, ch);
    drawWaves(cx, cw, 8, ch - 34, 9, ch * 0.05, ch * 0.21, g, windN, 1, wx);
    // Beaufort scale 0..12
    const pad = 2, base = ch - 14, step = (cw - pad * 2) / 12, cur = bft(W.wind);
    cx.font = '10px ' + MONO; cx.textAlign = 'center'; cx.fillStyle = DIM;
    cx.strokeStyle = LINE; cx.lineWidth = 1; cx.beginPath(); cx.moveTo(0, base + 0.5); cx.lineTo(cw, base + 0.5); cx.stroke();
    for (let b = 0; b <= 12; b++) {
      const x = pad + b * step, major = b % 4 === 0;
      cx.strokeStyle = b === cur ? ACC : DIM; cx.lineWidth = b === cur ? 2 : 1;
      cx.beginPath(); cx.moveTo(x, base); cx.lineTo(x, base - (b === cur ? 12 : major ? 8 : 4)); cx.stroke();
      if (major) cx.fillText('Bft ' + b, Math.min(cw - 16, Math.max(16, x)), ch - 1);
    }
  }
}
