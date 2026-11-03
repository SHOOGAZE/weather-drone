/* Weather Drone · helpers, i18n lookup, weather state, sun and sky colours, weather → music mapping */
'use strict';

/* ---------- helpers ---------- */
const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const rand = (a, b) => a + Math.random() * (b - a);
const pick = a => a[Math.floor(Math.random() * a.length)];
const expo = rate => -Math.log(1 - Math.random() * 0.9999) / rate;
const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
const NOTES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
const SCALES = {
  'Major pentatonic': [0, 2, 4, 7, 9],       // clear day: open, sunny
  'Suspended pentatonic': [0, 2, 5, 7, 9],   // overcast day / cloudy night: floating, no 3rd
  'Egyptian pentatonic': [0, 2, 5, 7, 10]    // night: calm, spacious, no 3rd to pull it dark
};
const BFT_MIN = [1, 6, 12, 20, 29, 39, 50, 62, 75, 89, 103, 118];
const bft = w => BFT_MIN.filter(m => w >= m).length;

const hash = n => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
const smooth = x => x * x * (3 - 2 * x);
function noise(x) { const i = Math.floor(x), f = x - i; return (hash(i) + (hash(i + 1) - hash(i)) * smooth(f)) * 2 - 1; }
const gust = x => clamp(0.5 + 0.34 * noise(x * 0.33) + 0.2 * noise(x * 1.1 + 17), 0, 1);

/* ---------- i18n lookup (the dictionary itself lives in strings.js) ---------- */
let lang = 'en', noteKey = 'manualNote';
const t = (k, v) => {
  let s = (STR[lang] && STR[lang][k] !== undefined) ? STR[lang][k] : STR.en[k];
  if (typeof s === 'string' && v) for (const x in v) s = s.replace('{' + x + '}', v[x]);
  return s;
};
function setNote(k) { noteKey = k; $('note').textContent = t(k); }

/* ---------- weather state (sample: Brno) ---------- */
// character macro: -1 darker / heavier ... +1 brighter / lighter, applied on top of the weather
let CHAR = 0;
// engine style: 'tape' = looped chords, music-box motif, wow & flutter, saturation, echo; 'eol' = free Aeolian drone
// per-style mix: drone/sub/air = bed levels, saw = pad grit, tape = saturation + hiss, wow = pitch wobble (cents), echo = send, wet = extra reverb
const STYLES = {
  eol:     { drone: 1,    sub: 1,    air: 1,    saw: 0,   tape: 0,    wow: 0,  echo: 0,    wet: 0 },
  tape:    { drone: 1,    sub: 1,    air: 1,    saw: 1,   tape: 1,    wow: 9,  echo: 0.55, wet: 0 },
  airport: { drone: 0.3,  sub: 0.5,  air: 0.4,  saw: 0,   tape: 0.15, wow: 2,  echo: 0.3,  wet: 0.08 },  // Eno, Music for Airports
  pearl:   { drone: 0.22, sub: 0.45, air: 0.3,  saw: 0,   tape: 0.25, wow: 3,  echo: 0.4,  wet: 0.14 },  // Budd & Eno, The Pearl
  loops:   { drone: 0.4,  sub: 0.6,  air: 0.15, saw: 0.6, tape: 1,    wow: 14, echo: 0.2,  wet: 0.05 }   // Basinski, Disintegration Loops
};
let STYLE = 'tape';
try { const st = localStorage.getItem('wd-style'); if (STYLES[st]) STYLE = st; } catch (e) { /* optional */ }
// tape style: four-chord loops, voices = [bass, 5th, 3 colour tones] in semitones from the key root
const PROGS = {
  day:   [[0, 7, 14, 16, 19], [-7, 0, 9, 12, 16], [-3, 4, 7, 12, 16], [-5, 2, 7, 12, 14]],   // I – IVmaj7 – vi7 – Vsus
  grey:  [[0, 7, 12, 14, 17], [-2, 5, 12, 14, 17], [-5, 2, 7, 14, 17], [-7, 0, 7, 14, 17]],  // floating sus chords
  night: [[0, 7, 11, 14, 19], [2, 9, 14, 18, 21], [-3, 4, 11, 14, 16], [-7, 0, 7, 11, 16]]   // maj9 – lydian II – vi9 – IVmaj7
};
const PROG_LABEL = { day: 'I–IV–vi–V', grey: 'sus · I–♭VII–V–IV', night: 'maj9 · I–II–vi–IV' };
const SAWK = [1, 1, 1, 1, 1, 0, 0.4, 0.4];
const SAW_MIX = 0.1;   // how much saw each drone voice gets in tape style
try { const c = parseInt(localStorage.getItem('wd-char'), 10); if (c >= -100 && c <= 100) CHAR = c / 100; } catch (e) { /* optional */ }
/* ---------- sun & sky ---------- */
const BRNO = { lat: 49.195, lon: 16.607 };
// sunrise / sunset in local minutes (NOAA approximation), for the sample city in the device time zone
function sunTimes(date, lat, lon) {
  const rad = Math.PI / 180;
  const day = Math.floor((Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) - Date.UTC(date.getFullYear(), 0, 0)) / 864e5);
  const g = 2 * Math.PI / 365 * (day - 1);
  const eqt = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const ha = Math.acos(clamp(Math.cos(90.833 * rad) / (Math.cos(lat * rad) * Math.cos(decl)) - Math.tan(lat * rad) * Math.tan(decl), -1, 1)) / rad;
  const noon = 720 - 4 * lon - eqt - date.getTimezoneOffset();
  return { sr: noon - 4 * ha, ss: noon + 4 * ha };
}
// sun: 0 on the horizon, +1 at noon, -1 at midnight; rising = morning half
function sunAt(min, tm) {
  const m = ((min % 1440) + 1440) % 1440, D = tm.ss - tm.sr;
  if (m >= tm.sr && m <= tm.ss) return { sun: Math.sin(Math.PI * (m - tm.sr) / D), rising: m < tm.sr + D / 2, p: (m - tm.sr) / D };
  const N = 1440 - D, tn = ((m - tm.ss) % 1440 + 1440) % 1440;
  return { sun: -Math.sin(Math.PI * tn / N), rising: tn > N / 2, p: tn / N };
}
const deviceMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60; };
const manualSun = () => sunAt(deviceMin(), sunTimes(new Date(), BRNO.lat, BRNO.lon));

const hex = c => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16));
const mixC = (a, b, f) => '#' + hex(a).map((v, i) => Math.round(v + (hex(b)[i] - v) * clamp(f, 0, 1)).toString(16).padStart(2, '0')).join('');
const mixP = (a, b, f) => { const o = {}; for (const k in a) o[k] = mixC(a[k], b[k], f); return o; };
// sky1 = zenith, sky2 = mid sky, sky3 = horizon, glow = sun / moon light
const SKY = {
  night: { bg: '#0f1315', panel: '#161b1e', line: '#252e33', fg: '#e4eaec', dim: '#7d8d94', accent: '#8f9bff', sky1: '#070b14', sky2: '#0c1118', sky3: '#11181d', glow: '#3b4c80' },
  dawn:  { bg: '#1e1b26', panel: '#262231', line: '#3d3448', fg: '#ece6ef', dim: '#a497b0', accent: '#ffb38a', sky1: '#161a33', sky2: '#33263f', sky3: '#6a3a4c', glow: '#ff9a6b' },
  dusk:  { bg: '#251b1d', panel: '#2e2225', line: '#463434', fg: '#f1e7e3', dim: '#b09a93', accent: '#ff9d68', sky1: '#1a1530', sky2: '#371d2b', sky3: '#682e28', glow: '#ff7a3d' },
  morn:  { bg: '#f6ead9', panel: '#efe1cd', line: '#e0cfba', fg: '#2b2420', dim: '#6f6155', accent: '#c4652e', sky1: '#e9dbe6', sky2: '#f5e3d6', sky3: '#f9e6cf', glow: '#ffc58f' },
  eve:   { bg: '#f3e2c8', panel: '#ecd8ba', line: '#dcc5a2', fg: '#2d2219', dim: '#6e5946', accent: '#b8521c', sky1: '#e6d6e2', sky2: '#f3dcc0', sky3: '#f4c796', glow: '#ffad5c' },
  day:   { bg: '#f4efe4', panel: '#ece6d9', line: '#dbd3c2', fg: '#23272a', dim: '#646a70', accent: '#2a7fc0', sky1: '#cde2f1', sky2: '#e7edee', sky3: '#f4efe4', glow: '#fff1c9' },
  grey:  { bg: '#e7e5e0', panel: '#dfdcd5', line: '#d1cec6', fg: '#23272a', dim: '#63676b', accent: '#5f7689', sky1: '#d6dce1', sky2: '#e2e3e2', sky3: '#e7e5e0', glow: '#f3f3ef' }
};
// dark sky below the horizon (night <-> dawn / dusk), cream sky above it (low warm sun <-> high cream day)
// temperature tints the whole sky: heat bleaches and warms it, frost turns it glassy blue
function tempTint(pal, light) {
  const hot = clamp((W.temp - 26) / 9, 0, 1), cold = clamp(-W.temp / 15, 0, 1);
  if (hot) {
    const f = hot * (light ? 0.6 : 0.4);
    if (light) { pal.sky1 = mixC(pal.sky1, '#e8e0cf', f); pal.sky2 = mixC(pal.sky2, '#f3e6cc', f); pal.sky3 = mixC(pal.sky3, '#f6dcb4', f); pal.glow = mixC(pal.glow, '#fff1c4', f); }
    else { pal.sky2 = mixC(pal.sky2, '#2b2026', f); pal.sky3 = mixC(pal.sky3, '#3a2426', f); pal.glow = mixC(pal.glow, '#a5674a', f); }
  }
  if (cold) {
    const f = cold * 0.55;
    if (light) { pal.sky1 = mixC(pal.sky1, '#c9dcee', f); pal.sky2 = mixC(pal.sky2, '#e3ecf2', f); pal.sky3 = mixC(pal.sky3, '#eef2f4', f); pal.glow = mixC(pal.glow, '#f4f8ff', f); }
    else { pal.sky1 = mixC(pal.sky1, '#050a16', f); pal.sky3 = mixC(pal.sky3, '#0d1622', f); pal.glow = mixC(pal.glow, '#5a78a8', f); }
  }
  return pal;
}
function skyPalette(sun, rising) {
  if (sun <= 0.06) return { light: false, pal: tempTint(mixP(rising ? SKY.dawn : SKY.dusk, SKY.night, -sun / 0.35), false) };
  const day = mixP(SKY.day, SKY.grey, W.cloud / 100 * 0.7);
  day.accent = W.precip > 0.05 ? '#17867a' : W.cloud > 70 ? SKY.grey.accent : SKY.day.accent;
  const pal = mixP(rising ? SKY.morn : SKY.eve, day, (sun - 0.06) / 0.44);
  // storms turn the daytime sky to lead, plain rain greys it a little
  const b = bft(W.wind), wet = W.precip > 0.05;
  const sm = b >= 8 && (W.cloud > 55 || wet) ? clamp((b - 7) / 5, 0.2, 1) * 0.8 : wet ? 0.3 : 0;
  if (sm) {
    pal.sky1 = mixC(pal.sky1, '#7c8792', sm); pal.sky2 = mixC(pal.sky2, '#a6acb2', sm);
    pal.sky3 = mixC(pal.sky3, '#c8cac7', sm * 0.6); pal.glow = mixC(pal.glow, '#c4c9ce', sm);
  }
  return { light: true, pal: tempTint(pal, true) };
}

const SAMPLE_COORDS = '49.20° N · 16.61° E';
const W = { temp: 7, wind: 14, precip: 0.6, cloud: 80, hum: 82, press: 1014, night: manualSun().sun < 0, sunFix: null, sunTimes: null, tzOff: 0, place: null, coords: SAMPLE_COORDS, live: false, hourly: null };
let P = derive(W);
let coords = null, refreshTimer = null, liveBusy = false;
let RP = null, replayMin = 10;   // day replay state

/* weather -> musical parameters */
function derive(w) {
  const tN = clamp((w.temp + 10) / 45, 0, 1);
  const windN = clamp(w.wind / 50, 0, 1);
  const humN = w.hum / 100, clear = 1 - w.cloud / 100;
  const lowP = clamp((1025 - w.press) / 45, 0, 1);
  const overcast = w.precip > 0.2 || w.cloud > 70;
  // temperature: register of the whole drone; night drops it further
  // temperature sets the register; the whole drone sits a little higher for a lighter sound
  const rootMidi = 43 + Math.round(tN * 8);
  let mode;
  if (w.night) mode = overcast ? 'Suspended pentatonic' : 'Egyptian pentatonic';
  else mode = overcast ? 'Suspended pentatonic' : 'Major pentatonic';
  // day: bright and open; night: softer, but never dark
  let cutoff = (700 + tN * 1500) * (1 - w.cloud / 100 * 0.2) * (1 + windN * 0.2);
  if (w.night) cutoff *= 0.7;
  const rain = w.precip <= 0.05 ? 0 : clamp(0.2 + w.precip / 5, 0, 1);
  const snow = rain > 0 && w.temp <= 0.5;   // snow: no drops, a soft muffled hush
  if (snow) cutoff *= 0.85;
  return applyChar(applyTemp({
    rootMidi, mode, windN, rain, snow, night: w.night,
    bft: bft(w.wind),
    prog: w.night ? 'night' : overcast ? 'grey' : 'day',
    bpm: (56 + tN * 16 + windN * 8) * (w.night ? 0.85 : 1),                // tape loop tempo
    motifDensity: clamp(0.3 + clear * 0.3 + humN * 0.1 - (w.night ? 0.12 : 0), 0.15, 0.75),
    loopScale: (1 + lowP * 0.3 - windN * 0.25) * (w.night ? 1.25 : 1),     // airport: loop lengths
    enoDensity: clamp(0.55 + clear * 0.35 - rain * 0.2, 0.3, 1),           // airport: chance a loop sounds
    loopLife: Math.round(clamp(48 - humN * 24 - rain * 10, 12, 48)),        // loops: repeats until it dissolves
    cutoff: clamp(cutoff, 320, 3000),
    swing: 0.1 + windN * 0.4,                                        // wind: how far the filter wanders
    wet: clamp(0.42 + humN * 0.28 + rain * 0.08 + (w.night ? 0.12 : 0), 0, 0.85), // humidity: size of the room
    detune: 3 + humN * 6,                                            // humidity: chorus width
    breathRate: (0.04 + (1 - lowP) * 0.05) * (w.night ? 0.7 : 1),    // pressure: breath speed; night breathes slower
    breathDepth: 0.12 + windN * 0.28,                                // wind: breath depth
    subLevel: Math.min(1, (w.night ? 0.55 : 0.3) + lowP * 0.25),     // low pressure / night: gentle weight underneath
    subCut: w.night ? 130 : 170 + tN * 60,
    airLevel: w.night ? 0.12 + clear * 0.33 : 0.45 + clear * 0.55,  // day: bright harmonics; clear night: soft starlight
    aeol: clamp((w.wind - 6) / 40, 0, 1),                            // wind on the Aeolian strings
    swellRate: (0.05 + windN * 0.1 + humN * 0.05) * (w.night ? 0.6 : 1),
    dropRate: rain && !snow ? 3 + rain * 40 : 0
  }, w));
}
// temperature extremes colour the sound a little: heat = lazy and airy, frost = glassy and dry
function applyTemp(o, w) {
  const hot = clamp((w.temp - 26) / 9, 0, 1), cold = clamp(-w.temp / 15, 0, 1);
  if (hot) { o.breathRate *= 1 - hot * 0.3; o.swellRate *= 1 - hot * 0.2; o.airLevel = clamp(o.airLevel + hot * 0.2, 0, 1); o.detune += hot * 3; }
  if (cold) { o.cutoff *= 1 + cold * 0.15; o.airLevel = clamp(o.airLevel + cold * 0.15, 0, 1); o.detune *= 1 - cold * 0.5; o.wet = clamp(o.wet - cold * 0.08, 0, 0.85); o.subLevel *= 1 - cold * 0.25; }
  return o;
}
function applyChar(o) {
  const c = CHAR;
  o.cutoff = clamp(o.cutoff * Math.pow(2, c * 0.9), 250, 3600);
  o.airLevel = clamp(o.airLevel + c * 0.35, 0, 1);
  o.subLevel = clamp(o.subLevel - c * 0.25, 0.1, 1);
  o.subCut *= 1 + Math.max(0, c) * 0.3;
  o.wet = clamp(o.wet - c * 0.08, 0, 0.85);
  o.swellRate *= 1 + c * 0.25;
  return o;
}
