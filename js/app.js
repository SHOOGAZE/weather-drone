/* Weather Drone · interface: rendering, live weather, day replay, settings, ambient, hotkeys, start-up */
'use strict';

/* ---------- UI render ---------- */
const fmt = {
  temp: v => v.toFixed(1).replace('.0', '') + ' °C', wind: v => Math.round(v) + ' ' + t('kmh'), precip: v => v.toFixed(1) + ' ' + t('mmh'),
  cloud: v => Math.round(v) + ' %', hum: v => Math.round(v) + ' %', press: v => Math.round(v) + ' ' + t('hpa')
};
const KEYS = ['temp', 'wind', 'precip', 'cloud', 'hum', 'press'];
const placeName = () => W.live ? (W.place || t('yourLoc')) : t('city');

function renderParams() {
  KEYS.forEach(k => {
    const el = $('r-' + k), v = W[k];
    el.value = v; el.disabled = W.live || !!RP;
    el.style.setProperty('--p', ((v - el.min) / (el.max - el.min) * 100) + '%');
    $('v-' + k).textContent = fmt[k](v);
  });
  $('segDay').setAttribute('aria-pressed', String(!W.night)); $('segNight').setAttribute('aria-pressed', String(W.night));
  $('segDay').disabled = W.live || !!RP; $('segNight').disabled = W.live || !!RP;
  $('segLive').setAttribute('aria-pressed', String(W.live)); $('segMan').setAttribute('aria-pressed', String(!W.live));
  $('paramHint').textContent = RP ? t('hintReplay') : W.live ? t('hintLive') : t('hintManual');
  renderCta();
  $('place').textContent = placeName(); $('ambPlace').textContent = placeName(); $('coords').textContent = W.coords;
  const tag = $('srcTag'); tag.textContent = W.live ? t('live') : t('sample'); tag.classList.toggle('live', W.live);
  const b = bft(W.wind), wr = Math.round(W.wind) + ' ' + t('kmh') + ' · Bft ' + b + ' ' + t('bft')[b];
  $('windRead').textContent = wr; $('ambWind').textContent = wr;
  cv.setAttribute('aria-label', t('windAnim', { n: Math.round(W.wind) }));
}
function renderScore() {
  $('sc-key').textContent = NOTES[P.rootMidi % 12] + (usesProg() ? ' · ' + PROG_LABEL[P.prog] : ' ' + P.mode);
  $('sc-cut').textContent = Math.round(S ? S.curCut : P.cutoff) + ' ' + t('hz');
  $('sc-voices').textContent =
    STYLE === 'tape' ? t('voicesTape', { n: Math.round(P.bpm) }) :
    STYLE === 'airport' ? t('voicesAir', { n: Math.round(ENO[0][1] * P.loopScale), m: Math.round(ENO[6][1] * P.loopScale) }) :
    STYLE === 'pearl' ? t('voicesPearl', { n: Math.round(60 / P.bpm * 8 * (P.night ? 1.3 : 1) * 1.1) }) :
    STYLE === 'loops' ? t('voicesLoops', { n: S && S.loop ? Math.round(S.loop.deg * 100) : 0 }) :
    t('voicesDesc', { n: Math.round(P.swellRate * 60) });
  $('sc-aeol').textContent = Math.round(P.aeol * 100) + ' % · Bft ' + P.bft;
  $('sc-rain').textContent = P.snow ? t('snowDesc') : P.rain ? t('rainDesc', { n: Math.round(P.dropRate) }) : t('none');
  $('sc-night').textContent = W.night ? t('nightDesc') : t('dayDesc');
}

const at = (a, x) => { const i = Math.min(a.length - 1, Math.floor(x)), j = Math.min(a.length - 1, i + 1); return a[i] + (a[j] - a[i]) * (x - i); };
function lineChart(el, arr, now, minSpan) {
  const n = arr.length, mn = Math.min(...arr), mx = Math.max(...arr), span = Math.max(mx - mn, minSpan);
  const lo = (mn + mx) / 2 - span * 0.62, hi = (mn + mx) / 2 + span * 0.62;
  const X = i => i / (n - 1) * 240, Y = v => 48 - (v - lo) / (hi - lo) * 44 - 2;
  const pts = arr.map((v, i) => X(i).toFixed(1) + ',' + Y(v).toFixed(1));
  const nx = X(now);
  el.innerHTML = '<svg viewBox="0 0 240 48" preserveAspectRatio="none" aria-hidden="true">' +
    '<line class="base" x1="0" x2="240" y1="47.5" y2="47.5" vector-effect="non-scaling-stroke"/>' +
    '<path class="area" d="M0,48 L' + pts.join(' L') + ' L240,48Z"/>' +
    '<path class="ln" d="M' + pts.join(' L') + '" vector-effect="non-scaling-stroke"/>' +
    '<line class="now" x1="' + nx + '" x2="' + nx + '" y1="0" y2="48" vector-effect="non-scaling-stroke"/></svg>' +
    '<i class="pt" style="left:' + (nx / 240 * 100) + '%;top:' + (Y(at(arr, now)) / 48 * 100) + '%"></i>';
}
function barChart(el, arr, now) {
  const n = arr.length, mx = Math.max(1, ...arr), bw = 240 / n;
  let r = '';
  arr.forEach((v, i) => { if (v > 0.01) { const h = Math.max(1.5, v / mx * 44); r += '<rect x="' + (i * bw + bw * 0.15).toFixed(1) + '" y="' + (48 - h).toFixed(1) + '" width="' + (bw * 0.7).toFixed(1) + '" height="' + h.toFixed(1) + '"/>'; } });
  const nx = (now + 0.5) * bw;
  el.innerHTML = '<svg viewBox="0 0 240 48" preserveAspectRatio="none" aria-hidden="true">' +
    '<line class="base" x1="0" x2="240" y1="47.5" y2="47.5" vector-effect="non-scaling-stroke"/>' + r +
    '<line class="now" x1="' + nx + '" x2="' + nx + '" y1="0" y2="48" vector-effect="non-scaling-stroke"/></svg>';
}
function demoHourly() {
  const nh = new Date().getHours(), T = [], Wd = [], Pr = [];
  for (let i = 0; i < 24; i++) {
    const h = (nh - 6 + i + 24) % 24;
    T.push(W.temp + 3.2 * (Math.cos((h - 15) / 24 * 2 * Math.PI) - Math.cos((nh - 15) / 24 * 2 * Math.PI)));
    Wd.push(Math.max(0, W.wind * (1 + 0.35 * Math.sin((i - 6) * 0.45))));
    Pr.push(W.precip > 0 ? Math.max(0, W.precip * (1 + 0.9 * Math.sin((i - 6) * 0.55))) : 0);
  }
  return { t: T, w: Wd, p: Pr, now: 6 };
}
function renderCharts() {
  const H = RP ? { t: RP.T, w: RP.Wd, p: RP.Pr, now: RP.x } : (W.live && W.hourly ? W.hourly : demoHourly());
  lineChart($('sp-temp'), H.t, H.now, 4); lineChart($('sp-wind'), H.w, H.now, 10); barChart($('sp-rain'), H.p, H.now);
  const r = (a, d) => Math.min(...a).toFixed(d) + ' … ' + Math.max(...a).toFixed(d);
  $('rg-temp').textContent = r(H.t, 0); $('rg-wind').textContent = r(H.w, 0); $('rg-rain').textContent = '0 … ' + Math.max(...H.p).toFixed(1);
  $('chartSrc').textContent = RP ? t('chartReplay') : W.live && W.hourly ? t('chartForecast') : t('chartSample');
  $('axL').textContent = RP ? t('axisDay') : t('axisBack');
  $('axN').textContent = t('axisNow'); $('axN').style.visibility = RP ? 'hidden' : '';
  $('axR').textContent = RP ? t('axisNow') : t('axisFwd');
}
function renderState() {
  const on = !!S;
  $('play').setAttribute('aria-pressed', String(on)); $('play').setAttribute('aria-label', on ? t('stopSound') : t('startSound'));
  $('dot').classList.toggle('on', on); $('stateTxt').textContent = on ? t('playing') : t('silent');
  $('ambDot').classList.toggle('on', on); $('ambState').textContent = on ? t('playing') : t('silent');
  $('ambPlay').textContent = on ? t('stopSound') : t('startSound');
  try { if ('mediaSession' in navigator) navigator.mediaSession.playbackState = on ? 'playing' : 'paused'; } catch (e) { /* optional */ }
  renderSleep();
}
/* accent follows the sky: night indigo, rain teal, fog steel, clear sky blue */
function sunTimesNow() { return W.live && W.sunTimes ? W.sunTimes : sunTimes(new Date(), BRNO.lat, BRNO.lon); }
function skyNow() {
  if (RP) return sunAt(RP.min, sunTimesNow());
  if (W.sunFix != null) return { sun: W.sunFix, rising: true, p: 0.5 };
  if (W.live && W.sunTimes) return sunAt(Date.now() / 60000 + W.tzOff, W.sunTimes);
  return manualSun();
}
/* the page colour follows the sun; CSS animates every change over 2.5 s */
function applyTheme() {
  const { sun, rising, p } = skyNow(), { light, pal } = skyPalette(sun, rising), root = document.documentElement;
  for (const k in pal) root.style.setProperty('--' + k, pal[k]);
  // the glow crosses the sky left to right; low on the horizon at sunrise / sunset, high at noon (and the moon at midnight)
  root.style.setProperty('--sunX', (8 + 84 * clamp(p == null ? 0.5 : p, 0, 1)).toFixed(1) + '%');
  root.style.setProperty('--sunY', (sun >= 0 ? 100 - sun * 85 : 100 + sun * 70).toFixed(1) + '%');
  root.style.setProperty('--stars', clamp(-sun / 0.3, 0, 1).toFixed(2));
  root.style.colorScheme = light ? 'light' : 'dark';
  const m = document.querySelector('meta[name="theme-color"]'); if (m) m.content = pal.sky1;
}
// once a minute: move the sky, and in manual mode let night fall / day break by the real clock
setInterval(() => {
  if (RP) return;
  if (!W.live && W.sunFix == null) { const n = skyNow().sun < 0; if (n !== W.night) { W.night = n; refresh(); return; } }
  applyTheme();
}, 60000);
function refresh() { P = derive(W); applyAudio(); applyTheme(); renderParams(); renderScore(); renderCharts(); }

/* ---------- live weather ---------- */
async function getJson(url, ms) {
  const ctl = new AbortController(), id = setTimeout(() => ctl.abort(), ms);
  try { const r = await fetch(url, { signal: ctl.signal }); if (!r.ok) throw new Error('http ' + r.status); return await r.json(); }
  finally { clearTimeout(id); }
}
async function loadWeather(lat, lon) {
  const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + lat.toFixed(3) + '&longitude=' + lon.toFixed(3) +
    '&current=temperature_2m,relative_humidity_2m,is_day,precipitation,cloud_cover,pressure_msl,wind_speed_10m' +
    '&hourly=temperature_2m,wind_speed_10m,precipitation,cloud_cover,relative_humidity_2m,pressure_msl,is_day&daily=sunrise,sunset&past_hours=24&forecast_hours=19&wind_speed_unit=kmh&timezone=auto';
  const j = await getJson(url, 10000), cur = j.current;
  W.temp = cur.temperature_2m; W.wind = cur.wind_speed_10m; W.precip = cur.precipitation || 0;
  W.cloud = cur.cloud_cover; W.hum = cur.relative_humidity_2m; W.press = cur.pressure_msl; W.night = cur.is_day === 0;
  const key = String(cur.time).slice(0, 13) + ':00';
  let idx = j.hourly.time.indexOf(key); if (idx < 0) idx = Math.min(24, j.hourly.time.length - 1);
  const a = Math.max(0, idx - 6), b = Math.min(j.hourly.time.length, idx + 19), num = x => x.slice(a, b).map(v => Number(v) || 0);
  W.hourly = { t: num(j.hourly.temperature_2m), w: num(j.hourly.wind_speed_10m), p: num(j.hourly.precipitation), now: idx - a };
  const hv = (k, i) => Number(j.hourly[k] && j.hourly[k][i]) || 0, day = [];
  for (let i = Math.max(0, idx - 24); i <= idx; i++) day.push({
    h: Number(String(j.hourly.time[i]).slice(11, 13)) || 0,
    temp: hv('temperature_2m', i), wind: hv('wind_speed_10m', i), precip: hv('precipitation', i),
    cloud: hv('cloud_cover', i), hum: hv('relative_humidity_2m', i), press: hv('pressure_msl', i) || 1013,
    night: j.hourly.is_day ? j.hourly.is_day[i] === 0 : W.night
  });
  W.day = day;
  W.tzOff = (Number(j.utc_offset_seconds) || 0) / 60;
  const hm = x => { const t = String(x).slice(11, 16).split(':'); return Number(t[0]) * 60 + Number(t[1]); };
  if (j.daily && j.daily.sunrise && j.daily.sunrise.length) {
    const di = Math.max(0, j.daily.time.indexOf(String(cur.time).slice(0, 10)));
    W.sunTimes = { sr: hm(j.daily.sunrise[di]), ss: hm(j.daily.sunset[di]) };
  }
}
async function nameLocation() {
  if (!coords) return;
  try {
    const g = await getJson('https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=' + coords.lat + '&longitude=' + coords.lon + '&localityLanguage=' + lang, 8000);
    W.place = g.city || g.locality || g.principalSubdivision || null; renderParams(); setupMedia();
  } catch (e) { /* place name is optional */ }
}
/* first-visit prompt: offered while the sample plays, until the listener has used live mode once.
   A listener who chose live keeps it: next time it starts on its own if location access is already granted. */
let everLive = false, firstVisit = false;
try { everLive = localStorage.getItem('wd-mode') !== null; firstVisit = !localStorage.getItem('wd-lang'); } catch (e) { /* optional */ }
function rememberMode(m) { everLive = true; try { localStorage.setItem('wd-mode', m); } catch (e) { /* optional */ } }
function renderCta() {
  const c = $('liveCta');
  c.hidden = W.live || liveBusy || !!RP || everLive;
  c.classList.toggle('first', firstVisit);
}
$('liveCta').addEventListener('click', () => { if (!S) { startAudio(); renderState(); } goLive(); });
function autoLive() {
  let m = null; try { m = localStorage.getItem('wd-mode'); } catch (e) { /* optional */ }
  if (m !== 'live' || !navigator.permissions) return;
  navigator.permissions.query({ name: 'geolocation' }).then(r => { if (r.state === 'granted' && !W.live) goLive(); }).catch(() => {});
}

async function goLive() {
  if (liveBusy) return; liveBusy = true; renderCta();
  try {
    setNote('locating');
    try {
      if (!navigator.geolocation) throw new Error('geo');
      const pos = await new Promise((res, rej) => navigator.geolocation.getCurrentPosition(res, rej, { timeout: 12000, maximumAge: 600000 }));
      coords = { lat: pos.coords.latitude, lon: pos.coords.longitude };
    } catch (e) { W.live = false; refresh(); setNote('locFail'); return; }
    setNote('loadingW');
    try { await loadWeather(coords.lat, coords.lon); }
    catch (e) { W.live = false; refresh(); setNote('apiFail'); return; }
    W.live = true; W.sunFix = null;
    W.coords = Math.abs(coords.lat).toFixed(2) + '° ' + (coords.lat >= 0 ? 'N' : 'S') + ' · ' + Math.abs(coords.lon).toFixed(2) + '° ' + (coords.lon >= 0 ? 'E' : 'W');
    W.place = null;
    rememberMode('live');
    refresh(); setNote('liveNote');
    nameLocation();
    clearInterval(refreshTimer);
    refreshTimer = setInterval(async () => {
      if (RP) return;
      try { await loadWeather(coords.lat, coords.lon); refresh(); } catch (e) { setNote('refreshFail'); }
    }, 600000);
  } finally { liveBusy = false; renderCta(); }
}
function goManual() {
  rememberMode('manual');
  clearInterval(refreshTimer); W.live = false; W.coords = SAMPLE_COORDS;
  W.sunFix = null; W.night = manualSun().sun < 0;
  setNote('manualNote'); refresh(); setupMedia();
}
const toggleSource = () => { if (RP) stopReplay(); if (W.live) goManual(); else goLive(); };
const togglePlay = () => { if (S) stopAudio(); else startAudio(); renderState(); };

/* ---------- day replay: the last 24 hours played back in a few minutes ---------- */
// manual mode: a plausible day that ends exactly on the current slider values
function demoDay() {
  const nh = new Date().getHours(), out = [];
  for (let k = 0; k <= 24; k++) {
    const back = 24 - k, h = (nh - back + 48) % 24;
    const dT = 3.2 * (Math.cos((h - 15) / 24 * 2 * Math.PI) - Math.cos((nh - 15) / 24 * 2 * Math.PI));
    out.push({
      h,
      temp: W.temp + dT,
      wind: clamp(W.wind + 14 * Math.sin(back * 0.33) + 6 * Math.sin(back * 0.9), 0, 80),
      precip: clamp(W.precip + 2.4 * Math.sin(back * 0.5) * Math.sin(back * 0.13), 0, 10),
      cloud: clamp(W.cloud + 40 * Math.sin(back * 0.27), 0, 100),
      hum: clamp(W.hum - 1.5 * dT + 10 * Math.sin(back * 0.31), 15, 100),
      press: W.press + 8 * Math.sin(back * 0.12),
      night: back === 0 ? W.night : sunAt(h * 60 + 30, sunTimes(new Date(), BRNO.lat, BRNO.lon)).sun < 0
    });
  }
  return out;
}
const rpProgress = () => RP ? clamp((performance.now() - RP.t0) / RP.dur, 0, 1) : 0;
function toggleReplay() {
  if (RP) { stopReplay(); return; }
  const series = W.live && W.day && W.day.length >= 2 ? W.day : demoDay();
  const snap = {}; KEYS.concat('night', 'sunFix').forEach(k => { snap[k] = W[k]; });
  RP = { series, snap, x: 0, min: 0, t0: performance.now(), dur: replayMin * 60000, label: '',
         T: series.map(q => q.temp), Wd: series.map(q => q.wind), Pr: series.map(q => q.precip) };
  if (!S) { startAudio(); renderState(); }
  RP.timer = setInterval(replayStep, 250);
  replayStep();
}
function replayStep() {
  if (!RP) return;
  const s = RP.series, n = s.length, p = rpProgress();
  const x = p * (n - 1), i = Math.min(n - 2, Math.floor(x)), f = x - i, a = s[i], b = s[i + 1];
  RP.x = x;
  KEYS.forEach(k => { W[k] = a[k] + (b[k] - a[k]) * f; });
  W.night = f < 0.5 ? a.night : b.night;
  const vh = f >= 1 ? b.h : a.h, vm = f >= 1 ? 0 : Math.floor(f * 60);
  RP.label = '↺ ' + String(vh).padStart(2, '0') + ':' + String(vm).padStart(2, '0');
  RP.min = vh * 60 + (f >= 1 ? 0 : f * 60);
  P = derive(W); applyAudio(); applyTheme(); renderParams(); renderScore(); renderCharts();
  renderReplay(p);
  if (p >= 1) stopReplay();
}
function stopReplay() {
  if (!RP) return;
  clearInterval(RP.timer);
  const snap = RP.snap; RP = null;
  Object.assign(W, snap);
  refresh(); renderReplay(0); clock();
}
function renderReplay(p) {
  const on = !!RP;
  $('rpBtn').setAttribute('aria-pressed', String(on));
  $('rpLabel').textContent = on ? t('replayStop') : t('replay');
  $('rp').hidden = !on;
  $('note').hidden = on;   // the progress line replaces the hint while the day plays
  if (on && RP.label) {
    $('rpFill').style.width = (p * 100).toFixed(1) + '%';
    $('rpTime').textContent = RP.label + ' · ' + Math.round(p * 100) + ' %';
    $('clock').textContent = RP.label; $('ambClock').textContent = RP.label;
  }
  document.querySelectorAll('#rpSeg button').forEach(x => x.setAttribute('aria-pressed', String(parseInt(x.dataset.min, 10) === replayMin)));
}
$('rpBtn').addEventListener('click', toggleReplay);
$('rpSeg').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  const p = rpProgress();
  replayMin = parseInt(b.dataset.min, 10);
  if (RP) { RP.dur = replayMin * 60000; RP.t0 = performance.now() - p * RP.dur; }   // keep the position, change the speed
  try { localStorage.setItem('wd-rp', String(replayMin)); } catch (err) { /* optional */ }
  renderReplay(p);
});
try { const v = parseInt(localStorage.getItem('wd-rp'), 10); if ([5, 10, 20].includes(v)) replayMin = v; } catch (e) { /* optional */ }

/* ---------- events ---------- */
KEYS.forEach(k => $('r-' + k).addEventListener('input', e => { if (W.live || RP) return; W[k] = parseFloat(e.target.value); refresh(); }));
$('segDay').addEventListener('click', () => { if (W.live || RP) return; W.night = false; W.sunFix = 0.85; refresh(); });
$('segNight').addEventListener('click', () => { if (W.live || RP) return; W.night = true; W.sunFix = -0.8; refresh(); });
$('segLive').addEventListener('click', () => { if (RP) stopReplay(); if (!W.live) goLive(); });
$('segMan').addEventListener('click', () => { if (RP) stopReplay(); if (W.live) goManual(); });
$('play').addEventListener('click', togglePlay);

/* ---------- settings drawer ---------- */
let drawerOpen = false;
function renderDrawer() {
  document.body.classList.toggle('drawer-open', drawerOpen);
  const d = $('drawer'); d.setAttribute('aria-hidden', String(!drawerOpen)); d.inert = !drawerOpen;
  $('setBtn').setAttribute('aria-expanded', String(drawerOpen));
  $('setLabel').textContent = t('settings'); $('drawerTitle').textContent = t('settings');
  $('drawerClose').setAttribute('aria-label', t('close'));
}
function setDrawer(open) {
  drawerOpen = open; renderDrawer();
  try { (open ? $('drawerClose') : $('setBtn')).focus({ preventScroll: true }); } catch (e) { /* optional */ }
}
$('setBtn').addEventListener('click', () => setDrawer(!drawerOpen));
$('drawerClose').addEventListener('click', () => setDrawer(false));
$('scrim').addEventListener('click', () => setDrawer(false));
renderDrawer();

/* ---------- style ---------- */
$('styleSeg').addEventListener('click', e => { const b = e.target.closest('button'); if (b && b.dataset.style !== STYLE) setStyle(b.dataset.style); });
renderStyle();

/* ---------- character ---------- */
function renderChar() {
  const v = Math.round(CHAR * 100), el = $('r-char');
  el.value = v; el.style.setProperty('--p', ((v + 100) / 2) + '%');
  $('v-char').textContent = v === 0 ? '0' : (v > 0 ? '+' : '−') + Math.abs(v);
}
$('r-char').addEventListener('input', e => {
  CHAR = parseInt(e.target.value, 10) / 100; renderChar();
  if (RP) replayStep(); else refresh();
  try { localStorage.setItem('wd-char', String(Math.round(CHAR * 100))); } catch (err) { /* optional */ }
});
$('r-char').addEventListener('dblclick', () => { CHAR = 0; renderChar(); if (RP) replayStep(); else refresh(); try { localStorage.setItem('wd-char', '0'); } catch (err) { /* optional */ } });
renderChar();

/* ---------- volume ---------- */
function renderVol() {
  const el = $('r-vol'); el.value = vol;
  el.style.setProperty('--p', vol + '%');
  $('v-vol').textContent = vol + ' %';
}
$('r-vol').addEventListener('input', e => {
  vol = parseInt(e.target.value, 10); renderVol();
  if (S) S.vol.gain.setTargetAtTime(volGain(), S.ctx.currentTime, 0.05);
  try { localStorage.setItem('wd-vol', String(vol)); } catch (err) { /* optional */ }
});
try { const v = parseInt(localStorage.getItem('wd-vol'), 10); if (v >= 0 && v <= 100) vol = v; } catch (e) { /* optional */ }
renderVol();

/* ---------- sleep timer (fade scheduled on the audio clock, survives throttling) ---------- */
function armSleep(fresh) {
  sleepEnd = (S && sleepMin) ? Date.now() + sleepMin * 60000 : null;
  if (S) {
    const g = S.master.gain, now = S.ctx.currentTime;
    if (!fresh) { g.cancelScheduledValues(now); g.setValueAtTime(g.value, now); g.setTargetAtTime(0.6, now, 0.3); }
    if (sleepEnd) g.setTargetAtTime(0, now + Math.max(0, sleepMin * 60 - 25), 7);
  }
  renderSleep();
}
function renderSleep() {
  document.querySelectorAll('#sleepSeg button').forEach(b => b.setAttribute('aria-pressed', String(parseInt(b.dataset.min, 10) === sleepMin)));
  let txt = '';
  if (sleepEnd) { const r = Math.max(0, Math.ceil((sleepEnd - Date.now()) / 1000)); txt = Math.floor(r / 60) + ':' + String(r % 60).padStart(2, '0'); }
  else if (sleepMin) txt = sleepMin + ':00';
  $('sleepRead').textContent = txt;
}
function finishSleep() { sleepMin = 0; sleepEnd = null; stopAudio(); renderState(); setNote('sleepEnded'); }
$('sleepSeg').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  sleepMin = parseInt(b.dataset.min, 10); armSleep(false);
});
setInterval(() => { if (sleepEnd) { if (Date.now() >= sleepEnd) finishSleep(); else renderSleep(); } }, 1000);

/* ---------- keep playing with the screen off / lock screen ---------- */
function silentWav() {
  const sr = 8000, n = sr, b = new Uint8Array(44 + n * 2), dv = new DataView(b.buffer);
  const w = (o, str) => { for (let i = 0; i < str.length; i++) b[o + i] = str.charCodeAt(i); };
  w(0, 'RIFF'); dv.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, sr, true); dv.setUint32(28, sr * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
  w(36, 'data'); dv.setUint32(40, n * 2, true);
  let str = ''; for (let i = 0; i < b.length; i++) str += String.fromCharCode(b[i]);
  return 'data:audio/wav;base64,' + btoa(str);
}
function keepAlive(on) {
  try {
    if (!silentEl) { silentEl = new Audio(); silentEl.src = silentWav(); silentEl.loop = true; silentEl.setAttribute('playsinline', ''); }
    if (on) { const pr = silentEl.play(); if (pr && pr.catch) pr.catch(() => {}); } else silentEl.pause();
  } catch (e) { /* optional */ }
}
function setupMedia() {
  try {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({ title: 'Weather Drone', artist: placeName() });
    navigator.mediaSession.setActionHandler('play', () => { if (!S) { startAudio(); renderState(); } });
    navigator.mediaSession.setActionHandler('pause', () => { if (S) { stopAudio(); renderState(); } });
  } catch (e) { /* optional */ }
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  if (S && S.ctx.state !== 'running') S.ctx.resume().catch(() => {});
  if (S || ambOn) requestWake();
});

/* ---------- ambient / fullscreen mode ---------- */
const amb = $('ambient');
let ambOn = false, ambNative = false, idleT = null;
const fsEl = () => document.fullscreenElement || document.webkitFullscreenElement;
function ambWake() {
  if (!ambOn) return;
  amb.classList.remove('idle'); clearTimeout(idleT);
  idleT = setTimeout(() => amb.classList.add('idle'), 3000);
}
function openAmbient() {
  if (ambOn) return;
  ambOn = true;
  amb.classList.add('on'); amb.setAttribute('aria-hidden', 'false');
  document.documentElement.classList.add('amb-lock');
  const el = document.documentElement, rq = el.requestFullscreen || el.webkitRequestFullscreen;
  if (rq && !fsEl()) {
    try { const p = rq.call(el); ambNative = true; if (p && p.catch) p.catch(() => { ambNative = false; }); }
    catch (e) { ambNative = false; }   // iPhone Safari: no element fullscreen, the overlay alone is the ambient mode
  }
  requestWake(); ambWake();
  try { $('ambExit').focus({ preventScroll: true }); } catch (e) { /* optional */ }
}
function closeAmbient() {
  if (!ambOn) return;
  ambOn = false; clearTimeout(idleT);
  amb.classList.remove('on', 'idle'); amb.setAttribute('aria-hidden', 'true');
  document.documentElement.classList.remove('amb-lock');
  if (fsEl()) {
    const ex = document.exitFullscreen || document.webkitExitFullscreen;
    try { const p = ex.call(document); if (p && p.catch) p.catch(() => {}); } catch (e) { /* optional */ }
  }
  ambNative = false;
  if (!S) releaseWake();
  try { $('ambBtn').focus({ preventScroll: true }); } catch (e) { /* optional */ }
}
const toggleAmbient = () => { if (ambOn) closeAmbient(); else openAmbient(); };
function onFsChange() { if (!fsEl() && ambOn && ambNative) closeAmbient(); }
document.addEventListener('fullscreenchange', onFsChange);
document.addEventListener('webkitfullscreenchange', onFsChange);
$('ambBtn').addEventListener('click', openAmbient);
$('ambExit').addEventListener('click', closeAmbient);
$('ambPlay').addEventListener('click', () => { togglePlay(); ambWake(); });
['pointermove', 'pointerdown', 'touchstart'].forEach(ev => amb.addEventListener(ev, ambWake, { passive: true }));

/* ---------- hotkeys: Space play/pause, M live/manual, F ambient, Esc exit (layout-independent via e.code) ---------- */
document.addEventListener('keydown', e => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const tg = e.target, tag = tg && tg.tagName;
  if (tag === 'SELECT' || tag === 'TEXTAREA' || (tag === 'INPUT' && tg.type !== 'range') || (tg && tg.isContentEditable)) return;
  closeSplash();
  const code = e.code, k = (e.key || '').toLowerCase();
  if (code === 'Space' || k === ' ') {
    e.preventDefault();
    if (e.repeat) return;
    if (tag === 'BUTTON') tg.blur();   // stop the focused button from also firing a click on keyup
    togglePlay(); ambWake();
  } else if (code === 'KeyM' || k === 'm') {
    if (e.repeat) return;
    e.preventDefault(); toggleSource(); ambWake();
  } else if (code === 'KeyF' || k === 'f') {
    if (e.repeat) return;
    e.preventDefault(); toggleAmbient();
  } else if (code === 'KeyD' || k === 'd') {
    if (e.repeat) return;
    e.preventDefault(); toggleReplay(); ambWake();
  } else if (code === 'Escape' && ambOn) {
    closeAmbient();
  } else if (code === 'Escape' && drawerOpen) {
    setDrawer(false);
  } else if (code === 'KeyS' || k === 's') {
    if (e.repeat) return;
    e.preventDefault(); setDrawer(!drawerOpen);
  } else ambWake();
});

/* ---------- clock, language, splash ---------- */
function clock() {
  if (RP) return;
  const d = new Date(), s = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  $('clock').textContent = s; $('ambClock').textContent = s;
}
clock(); setInterval(clock, 15000);

function setLang(code) {
  lang = STR[code] ? code : 'en';
  document.documentElement.lang = lang;
  document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-aria]').forEach(el => el.setAttribute('aria-label', t(el.dataset.i18nAria)));
  $('lang').value = lang;
  $('ambExit').textContent = t('exitAmbient');
  amb.setAttribute('aria-label', t('ambient'));
  $('kbdHint').innerHTML = '<kbd>' + t('keySpace') + '</kbd> ' + t('keysPlay') + ' · <kbd>M</kbd> ' + t('keysMode') + ' · <kbd>F</kbd> ' + t('keysFull') + ' · <kbd>D</kbd> ' + t('keysDay') + ' · <kbd>S</kbd> ' + t('settings').toLowerCase();
  $('ambHint').innerHTML = '<kbd>' + t('keySpace') + '</kbd> ' + t('keysPlay') + ' · <kbd>F</kbd> / <kbd>Esc</kbd> ' + t('exitAmbient');
  try { localStorage.setItem('wd-lang', lang); } catch (e) { /* optional */ }
  setNote(noteKey); refresh(); renderState(); setupMedia();
  renderReplay(rpProgress()); renderDrawer();
  if (W.live) nameLocation();
}
$('lang').addEventListener('change', e => setLang(e.target.value));
(function initLang() {
  let c = null;
  try { c = localStorage.getItem('wd-lang'); } catch (e) { /* optional */ }
  if (!c || !STR[c]) c = String(navigator.language || 'en').slice(0, 2).toLowerCase();
  setNote('manualNote'); setLang(c);
})();
autoLive();

const splash = $('splash');
if (splash && document.documentElement.classList.contains('no-splash')) splash.remove();
function closeSplash() {
  if (!splash || !splash.isConnected || splash.classList.contains('gone')) return;
  splash.classList.add('gone'); setTimeout(() => splash.remove(), 450);
}
if (splash) {
  splash.addEventListener('click', closeSplash);
  setTimeout(() => { if (splash.isConnected) splash.remove(); }, reduceMotion ? 2200 : 4300);
}

requestAnimationFrame(frame);
requestAnimationFrame(() => requestAnimationFrame(() => document.documentElement.classList.remove('no-tr')));

/* installable app: offline start-up and a home-screen icon (service workers need https or localhost) */
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => {}); });
}
