/* Weather Drone · sound engine: drone voices, five styles, rain, wind, thunder */
'use strict';

/* ---------- audio engine: Aeolian drone ---------- */
let S = null, wakeLock = null;
let vol = 85, sleepMin = 0, sleepEnd = null, silentEl = null;
const volGain = () => Math.pow(vol / 100, 2) * 1.3;

function makeIR(c, sec) {
  const rate = c.sampleRate, len = Math.floor(rate * sec), buf = c.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch); let lp = 0;
    for (let i = 0; i < len; i++) {
      const x = i / len;
      lp += ((Math.random() * 2 - 1) - lp) * (0.3 * (1 - x) + 0.05);
      d[i] = lp * Math.pow(1 - x, 2.6) * (i < rate * 0.02 ? i / (rate * 0.02) : 1);
    }
  }
  return buf;
}
function makePink(c, sec) {
  const len = Math.floor(c.sampleRate * sec), buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
    d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
  }
  const f = 1024;
  for (let i = 0; i < f; i++) { const k = i / f; d[i] *= k; d[len - 1 - i] *= k; }
  return buf;
}
function makeWhite(c, sec) {
  const len = Math.floor(c.sampleRate * sec), buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}
function loopNoise(c, buf) {
  const s = c.createBufferSource(); s.buffer = buf; s.loop = true;
  s.start(0, rand(0, buf.duration - 0.5));
  return s;
}
const panner = (c, v) => { if (!c.createStereoPanner) return null; const p = c.createStereoPanner(); p.pan.value = v; return p; };

/* one drone voice: two detuned triangles, slow detune drift, slow independent swell */
function makeVoice(c, freq, level, sink, pan, wow, sawMix) {
  const out = c.createGain(); out.gain.value = level;
  const oscs = [-1, 1].map(s => {
    const o = c.createOscillator(); o.type = 'triangle';
    o.frequency.value = freq; o.detune.value = s * P.detune; o.connect(out); return o;
  });
  const saw = c.createOscillator(); saw.type = 'sawtooth'; saw.frequency.value = freq;
  const sg = c.createGain(); sg.gain.value = sawMix || 0; saw.connect(sg); sg.connect(out); oscs.push(saw);
  if (wow) oscs.forEach(o => wow.connect(o.detune));
  const drift = c.createOscillator(); drift.frequency.value = rand(0.02, 0.06);
  const dA = c.createGain(), dB = c.createGain(); dA.gain.value = rand(1.5, 4); dB.gain.value = -dA.gain.value;
  drift.connect(dA); dA.connect(oscs[0].detune); drift.connect(dB); dB.connect(oscs[1].detune);
  const sw = c.createOscillator(); sw.frequency.value = rand(0.012, 0.04);
  const swd = c.createGain(); swd.gain.value = level * 0.45; sw.connect(swd); swd.connect(out.gain);
  const p = panner(c, pan);
  if (p) { out.connect(p); p.connect(sink); } else out.connect(sink);
  [...oscs, drift, sw].forEach(o => o.start());
  return { oscs, sg };
}

/* voicing indices: 0 root, 1 fifth, 2 octave, 3-4 colour, 5 sub-octave, 6-7 transparent harmonics.
   Colour notes come from the pentatonic palette and stay >=3 semitones from each other, so nothing rubs. */
const LV  = [0.13, 0.08, 0.05, 0.05, 0.04, 0.2, 0.035, 0.022];
const PAN = [0, 0.12, -0.2, -0.5, 0.5, 0, 0.35, -0.35];
function pickColor(sc, taken, lo, hi) {
  const c = [];
  for (const d of sc) for (const o of [12, 24]) { const off = d + o; if (off >= lo && off <= hi && taken.every(e => Math.abs(off - e) >= 3)) c.push(off); }
  return c.length ? pick(c) : null;
}
function newChord() {
  const sc = SCALES[P.mode];
  const c1 = pickColor(sc, [0, 7, 12], 14, 24) || 16;
  const c2 = pickColor(sc, [0, 7, 12, c1], 17, 31) || 19;
  return [0, 7, 12, c1, c2, -12, 24 + pick(sc), 36 + pick([0, 7])];
}
const strOffs = () => [12, 19, 24, 24 + SCALES[P.mode][2]];
function glide(i, tc, when) {
  const f = mtof(P.rootMidi + S.offs[i]), now = when || S.ctx.currentTime;
  S.voices[i].oscs.forEach(o => o.frequency.setTargetAtTime(f, now, tc));
}
function retune(tc) {
  S.offs.forEach((_, i) => glide(i, tc));
  const so = strOffs(), now = S.ctx.currentTime;
  S.strings.forEach((s, i) => s.bp.frequency.setTargetAtTime(mtof(P.rootMidi + so[i]), now, tc));
}
function evolveChord() {
  const sc = SCALES[P.mode], i = pick([3, 4, 6, 7]);
  if (i === 6) S.offs[6] = 24 + pick(sc);
  else if (i === 7) S.offs[7] = 36 + pick([0, 7]);
  else {
    const n = pickColor(sc, S.offs.slice(0, 5).filter((_, k) => k !== i), 14, 31);
    if (n == null) return;
    S.offs[i] = n;
  }
  glide(i, rand(3, 6));   // slow glissando into the new note
}

function requestWake() {
  try {
    if (wakeLock || !navigator.wakeLock) return;
    navigator.wakeLock.request('screen').then(l => { wakeLock = l; l.addEventListener('release', () => { wakeLock = null; }); }).catch(() => {});
  } catch (e) { /* optional */ }
}
function releaseWake() { try { wakeLock && wakeLock.release(); } catch (e) { /* optional */ } wakeLock = null; }

function startAudio() {
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) { /* iOS ringer switch */ }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) { setNote('noAudio'); return; }
  const c = new AC();
  c.onstatechange = () => { if (S && S.ctx === c && c.state !== 'running' && c.state !== 'closed' && !document.hidden) c.resume().catch(() => {}); };
  if (c.resume) c.resume();

  const master = c.createGain(); master.gain.value = 0;
  const comp = c.createDynamicsCompressor();
  comp.threshold.value = -20; comp.knee.value = 24; comp.ratio.value = 3; comp.attack.value = 0.02; comp.release.value = 0.35;
  const volNode = c.createGain(); volNode.gain.value = volGain();
  const cf = STYLES[STYLE], tapeOn = cf.tape;
  // tape stage: clean / saturated crossfade -> gentle top roll-off -> compressor
  const tone = c.createBiquadFilter(); tone.type = 'lowpass'; tone.Q.value = 0.5; tone.frequency.value = 18000 - 10500 * tapeOn;
  const clean = c.createGain(), satG = c.createGain(), shaper = c.createWaveShaper();
  shaper.curve = tapeCurve(); shaper.oversample = '2x';
  clean.gain.value = 1 - tapeOn; satG.gain.value = tapeOn;
  master.connect(clean); clean.connect(tone); master.connect(shaper); shaper.connect(satG); satG.connect(tone);
  tone.connect(comp); comp.connect(volNode); volNode.connect(c.destination);
  const dryBus = c.createGain(); dryBus.connect(master);
  const revIn = c.createGain(), conv = c.createConvolver(), revOut = c.createGain();
  conv.buffer = makeIR(c, 8); revOut.gain.value = P.wet;
  revIn.connect(conv); conv.connect(revOut); revOut.connect(master);
  const route = (node, dry, wet) => {
    const d = c.createGain(); d.gain.value = dry; node.connect(d); d.connect(dryBus);
    const w = c.createGain(); w.gain.value = wet; node.connect(w); w.connect(revIn);
  };
  const pink = makePink(c, 8), white = makeWhite(c, 2);

  // tape hiss
  const thSrc = loopNoise(c, white);
  const thHP = c.createBiquadFilter(); thHP.type = 'highpass'; thHP.frequency.value = 2500;
  const thLP = c.createBiquadFilter(); thLP.type = 'lowpass'; thLP.frequency.value = 9000;
  const tHiss = c.createGain(); tHiss.gain.value = 0.004 * tapeOn;
  thSrc.connect(thHP); thHP.connect(thLP); thLP.connect(tHiss); tHiss.connect(tone);
  // wow (slow) + flutter (fast) pitch wobble shared by every tonal voice, in cents
  const wowOut = c.createGain();
  const wowL = c.createOscillator(); wowL.frequency.value = 0.42;
  const wowD = c.createGain(); wowD.gain.value = cf.wow; wowL.connect(wowD); wowD.connect(wowOut);
  const flL = c.createOscillator(); flL.frequency.value = 5.7;
  const flD = c.createGain(); flD.gain.value = 2.5 * tapeOn; flL.connect(flD); flD.connect(wowOut);
  wowL.start(); flL.start();
  // motif bus with a dark ping-pong tape echo
  const motifBus = c.createGain(); route(motifBus, 0.5, 0.75);
  const dSend = c.createGain(); dSend.gain.value = cf.echo; motifBus.connect(dSend);
  const dL = c.createDelay(4), dR = c.createDelay(4), dLP = c.createBiquadFilter(), fb = c.createGain(), merge = c.createChannelMerger(2), dOut = c.createGain();
  const echo = 60 / P.bpm * 0.75; dL.delayTime.value = echo; dR.delayTime.value = echo;
  dLP.type = 'lowpass'; dLP.frequency.value = 2200; fb.gain.value = 0.42; dOut.gain.value = 0.8;
  dSend.connect(dL); dL.connect(merge, 0, 0); dL.connect(dR); dR.connect(merge, 0, 1); dR.connect(dLP); dLP.connect(fb); fb.connect(dL);
  merge.connect(dOut); route(dOut, 0.6, 0.5);

  // core drone -> soft low-pass -> breathing gain
  const padSum = c.createGain();
  const padFilter = c.createBiquadFilter(); padFilter.type = 'lowpass'; padFilter.Q.value = 0.4; padFilter.frequency.value = P.cutoff;
  const breath = c.createGain(); breath.gain.value = 1 - P.breathDepth * 0.5;
  const breathLfo = c.createOscillator(); breathLfo.frequency.value = P.breathRate;
  const breathDepth = c.createGain(); breathDepth.gain.value = P.breathDepth * 0.5;
  breathLfo.connect(breathDepth); breathDepth.connect(breath.gain); breathLfo.start();
  const droneG = c.createGain(); droneG.gain.value = cf.drone;
  padSum.connect(padFilter); padFilter.connect(droneG); droneG.connect(breath); route(breath, 0.8, 0.55);
  // sub-octave: its own dark low-pass, almost no reverb (keeps the low end clean)
  const subLP = c.createBiquadFilter(); subLP.type = 'lowpass'; subLP.Q.value = 0.5; subLP.frequency.value = P.subCut;
  const subCtl = c.createGain(); subCtl.gain.value = P.subLevel;
  subLP.connect(subCtl); route(subCtl, 0.9, 0.12);
  // transparent harmonics: high triangles, mostly reverb
  const airHP = c.createBiquadFilter(); airHP.type = 'highpass'; airHP.frequency.value = 380;
  const airCtl = c.createGain(); airCtl.gain.value = P.airLevel;
  airHP.connect(airCtl); route(airCtl, 0.3, 0.9);

  // swell + drop buses
  const swellBus = c.createGain(); route(swellBus, 0.35, 0.85);
  const dropBus = c.createGain(); route(dropBus, 0.55, 0.3);

  // rain hiss: band-limited pink noise
  const hissSrc = loopNoise(c, pink);
  const hissHP = c.createBiquadFilter(); hissHP.type = 'highpass'; hissHP.frequency.value = 1500;
  const hissLP = c.createBiquadFilter(); hissLP.type = 'lowpass'; hissLP.frequency.value = 7000;
  const hiss = c.createGain(); hiss.gain.value = 0;
  hissSrc.connect(hissHP); hissHP.connect(hissLP); hissLP.connect(hiss); route(hiss, 0.6, 0.35);

  // wind: two independent gusting bands (L/R) + a whistle that appears from Bft 6
  const windBus = c.createGain(); route(windBus, 0.55, 0.45);
  const wind = [-0.7, 0.7].map(pn => {
    const src = loopNoise(c, pink);
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 220; bp.Q.value = 0.7;
    const g = c.createGain(); g.gain.value = 0;
    src.connect(bp); bp.connect(g);
    const p = panner(c, pn); if (p) { g.connect(p); p.connect(windBus); } else g.connect(windBus);
    return { bp, g };
  });
  const whSrc = loopNoise(c, pink);
  const whBP = c.createBiquadFilter(); whBP.type = 'bandpass'; whBP.frequency.value = 900; whBP.Q.value = 6;
  const whG = c.createGain(); whG.gain.value = 0;
  whSrc.connect(whBP); whBP.connect(whG); whG.connect(windBus);

  // Aeolian strings: wind noise exciting narrow resonances tuned to the chord
  const stringBus = c.createGain(); route(stringBus, 0.25, 0.9);
  const strSrc = loopNoise(c, pink), so = strOffs();
  const strings = so.map((o, i) => {
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 32; bp.frequency.value = mtof(P.rootMidi + o);
    const g = c.createGain(); g.gain.value = 0;
    strSrc.connect(bp); bp.connect(g);
    const p = panner(c, [-0.6, 0.6, -0.25, 0.25][i]); if (p) { g.connect(p); p.connect(stringBus); } else g.connect(stringBus);
    return { bp, g };
  });

  S = { ctx: c, master, vol: volNode, padFilter, revOut, breath, breathLfo, breathDepth, subLP, subCtl, airCtl,
        swellBus, dropBus, white, pink, hiss, wind, whistle: { bp: whBP, g: whG }, strings,
        tone, clean, satG, tHiss, wowD, flD, wowOut, motifBus, dSend, dL, dR,
        prog: P.prog, chordIdx: 0, stepN: 0, nextStep: c.currentTime + 1.5, motif: newMotif(), droneG,
        eno: makeEno(c.currentTime), pearlNext: c.currentTime + 1, loop: Object.assign(newLoop(), { next: c.currentTime + 1 }),
        voices: [], offs: usesProg() ? tapeChord(0) : newChord(), mode: P.mode, root: P.rootMidi, curCut: P.cutoff, lastSwell: null,
        nextSwell: c.currentTime + 2, nextDrop: c.currentTime + 0.5 };
  const sinkFor = i => i <= 4 ? padSum : i === 5 ? subLP : airHP;
  S.offs.forEach((o, i) => S.voices.push(makeVoice(c, mtof(P.rootMidi + o), LV[i], sinkFor(i), PAN[i], wowOut, SAW_MIX * SAWK[i] * cf.saw)));
  applyStyle(0.05);
  master.gain.setTargetAtTime(0.6, c.currentTime, 3);   // long attack
  armSleep(true); keepAlive(true); setupMedia(); requestWake();

  const moveFilter = () => {
    if (!S || S.ctx !== c) return;
    const f = clamp(P.cutoff * Math.pow(2, rand(-1, 1) * P.swing), 260, 3400);
    S.padFilter.frequency.setTargetAtTime(f, c.currentTime, rand(3, 5));
    S.curCut = f; renderScore();
    S.filterTimer = setTimeout(moveFilter, rand(6000, 12000));
  };
  const nextChord = () => {
    S.chordTimer = setTimeout(() => { if (!S || S.ctx !== c) return; if (!usesProg()) evolveChord(); nextChord(); }, rand(14000, 26000));
  };
  moveFilter(); nextChord();
  S.tickId = setInterval(tick, 100);
}

function stopAudio() {
  const s = S; if (!s) return;
  S = null; sleepEnd = null; keepAlive(false);
  if (RP) stopReplay();
  clearInterval(s.tickId); clearTimeout(s.filterTimer); clearTimeout(s.chordTimer);
  const g = s.master.gain, now = s.ctx.currentTime;
  g.cancelScheduledValues(now); g.setValueAtTime(g.value, now); g.setTargetAtTime(0, now, 1.2);   // long release
  setTimeout(() => { s.ctx.close().catch(() => {}); }, 7000);
  if (!ambOn) releaseWake();
}

function applyAudio() {
  if (!S) return;
  const now = S.ctx.currentTime;
  const cf = STYLES[STYLE];
  S.revOut.gain.setTargetAtTime(Math.min(0.95, P.wet + cf.wet), now, 3);
  S.padFilter.frequency.setTargetAtTime(P.cutoff, now, 3); S.curCut = P.cutoff;
  S.voices.forEach(v => { v.oscs[0].detune.setTargetAtTime(-P.detune, now, 3); v.oscs[1].detune.setTargetAtTime(P.detune, now, 3); });
  S.breath.gain.setTargetAtTime(1 - P.breathDepth * 0.5, now, 3);
  S.breathDepth.gain.setTargetAtTime(P.breathDepth * 0.5, now, 3);
  S.breathLfo.frequency.setTargetAtTime(P.breathRate, now, 3);
  S.subCtl.gain.setTargetAtTime(P.subLevel * cf.sub, now, 3);
  S.subLP.frequency.setTargetAtTime(P.subCut, now, 3);
  S.airCtl.gain.setTargetAtTime(P.airLevel * cf.air, now, 4);
  const echo = 60 / P.bpm * 0.75;
  S.dL.delayTime.setTargetAtTime(echo, now, 2); S.dR.delayTime.setTargetAtTime(echo, now, 2);
  if (usesProg()) {
    if (S.prog !== P.prog) { S.prog = P.prog; S.mode = P.mode; S.root = P.rootMidi; S.offs = tapeChord(S.chordIdx); retune(4); }
    else if (S.mode !== P.mode || S.root !== P.rootMidi) { S.mode = P.mode; S.root = P.rootMidi; retune(3); }
  } else if (S.mode !== P.mode) { S.mode = P.mode; S.root = P.rootMidi; S.offs = newChord(); retune(5); }
  else if (S.root !== P.rootMidi) { S.root = P.rootMidi; retune(3); }
}

/* swell: a soft triangle pad note with a long attack and release that glides in from the previous swell */
function swell(at) {
  const c = S.ctx, sc = SCALES[P.mode];
  const midi = P.rootMidi + pick(sc) + pick(P.night ? [12, 12, 24] : [12, 24, 24]);
  const from = S.lastSwell == null ? midi : S.lastSwell; S.lastSwell = midi;
  const att = rand(3, 6), rel = rand(6, 10), peak = rand(0.018, 0.035) * (P.night ? 0.8 : 1);
  const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.3; lp.frequency.value = Math.min(3000, P.cutoff * 1.4);
  const g = c.createGain(); g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(peak, at + att);
  g.gain.setTargetAtTime(0, at + att, rel / 4);
  const p = panner(c, rand(-0.7, 0.7));
  lp.connect(g); if (p) { g.connect(p); p.connect(S.swellBus); } else g.connect(S.swellBus);
  const end = at + att + rel * 1.6;
  const os = [-1, 1].map(s => {
    const o = c.createOscillator(); o.type = 'triangle';
    o.frequency.setValueAtTime(mtof(from), at); o.frequency.setTargetAtTime(mtof(midi), at, att * 0.4);
    o.detune.value = s * rand(3, 7);
    o.connect(lp); o.start(at); o.stop(end);
    return o;
  });
  os[0].onended = () => { os.forEach(o => o.disconnect()); lp.disconnect(); g.disconnect(); if (p) p.disconnect(); };
}

/* ---------- tape style ---------- */
function tapeCurve() {
  // unity gain for quiet signals, soft rounding of peaks (no hidden level boost)
  const n = 2048, k = 2.2, cv = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; cv[i] = Math.tanh(k * x) / k; }
  return cv;
}
function tapeChord(i) {
  const ch = PROGS[P.prog][((i % 4) + 4) % 4];
  return [...ch, ch[0] - 12, ch[3] + 12, ch[4] + 12];
}
// an 8-step motif over chord tones (index into the 5 chord voices), null = rest
function newMotif() {
  const pat = [];
  for (let i = 0; i < 8; i++) pat.push(Math.random() < P.motifDensity ? pick([2, 3, 4, 3, 4]) : null);
  if (pat.filter(v => v != null).length < 2) { pat[0] = 4; pat[4] = 3; }
  return pat;
}
function mutateMotif() { S.motif[Math.floor(Math.random() * 8)] = Math.random() < P.motifDensity ? pick([1, 2, 3, 4]) : null; }
/* music-box mallet: soft triangle body + a short inharmonic glint, wobbling with the tape */
function mallet(at, midi, vel) {
  const c = S.ctx, f = mtof(midi);
  const g = c.createGain(); g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(vel, at + 0.008); g.gain.setTargetAtTime(0, at + 0.008, 0.45);
  const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.3; lp.frequency.value = Math.min(6000, P.cutoff * 3);
  const o1 = c.createOscillator(); o1.type = 'triangle'; o1.frequency.value = f;
  const o2 = c.createOscillator(); o2.type = 'sine'; o2.frequency.value = f * 3.01;
  const g2 = c.createGain(); g2.gain.setValueAtTime(0.35, at); g2.gain.setTargetAtTime(0, at, 0.08);
  S.wowOut.connect(o1.detune); S.wowOut.connect(o2.detune);
  o1.connect(lp); o2.connect(g2); g2.connect(lp); lp.connect(g);
  const p = panner(c, rand(-0.5, 0.5)); if (p) { g.connect(p); p.connect(S.motifBus); } else g.connect(S.motifBus);
  o1.start(at); o2.start(at); o1.stop(at + 3.5); o2.stop(at + 3.5);
  o1.onended = () => { try { S && S.wowOut.disconnect(o1.detune); S && S.wowOut.disconnect(o2.detune); } catch (e) { /* gone */ } o1.disconnect(); o2.disconnect(); g2.disconnect(); lp.disconnect(); g.disconnect(); if (p) p.disconnect(); };
}
function motifStep(at) {
  const v = S.motif[S.stepN % 8];
  if (v == null) return;
  let midi = P.rootMidi + S.offs[v] + 12;
  while (midi > 84) midi -= 12;
  while (midi < 64) midi += 12;
  mallet(at, midi, 0.045 * rand(0.7, 1) * (P.night ? 0.75 : 1));
}
// steps run on the audio clock; every 8 steps the loop moves to the next chord with a short glide
function tapeSteps(now) {
  if (S.nextStep < now) S.nextStep = now + 0.05;
  while (S.nextStep < now + 0.3) {
    const at = S.nextStep, step = 60 / P.bpm;
    if (S.stepN > 0 && S.stepN % 8 === 0) {
      S.chordIdx++; S.offs = tapeChord(S.chordIdx);
      S.offs.forEach((_, i) => glide(i, step * 0.45, at));
      if (S.chordIdx % 4 === 0) mutateMotif();
    }
    motifStep(at);
    S.stepN++; S.nextStep += step;
  }
}
const usesProg = () => STYLE === 'tape' || STYLE === 'pearl';

/* soft piano: triangle body + quickly fading upper partials, felt-like low-pass that closes after the hammer */
function piano(at, midi, vel, dec, bus) {
  const c = S.ctx, f = mtof(midi), wow = S.wowOut;
  const g = c.createGain(); g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(vel, at + 0.012); g.gain.setTargetAtTime(0, at + 0.012, dec / 4);
  const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.2;
  lp.frequency.setValueAtTime(Math.min(5000, 900 + f * 3), at); lp.frequency.setTargetAtTime(Math.min(2500, 500 + f * 1.5), at, 0.6);
  const os = [[1, 1, 'triangle', dec / 4], [2, 0.3, 'sine', dec / 8], [3.01, 0.1, 'sine', dec / 14]].map(([r, a, type, tc]) => {
    const o = c.createOscillator(); o.type = type; o.frequency.value = f * r;
    const pg = c.createGain(); pg.gain.setValueAtTime(a, at); pg.gain.setTargetAtTime(0, at, tc);
    wow.connect(o.detune); o.connect(pg); pg.connect(lp);
    o.start(at); o.stop(at + dec * 1.6);
    return [o, pg];
  });
  lp.connect(g);
  const p = panner(c, rand(-0.6, 0.6)); if (p) { g.connect(p); p.connect(bus || S.motifBus); } else g.connect(bus || S.motifBus);
  os[0][0].onended = () => { os.forEach(([o, pg]) => { try { wow.disconnect(o.detune); } catch (e) { /* gone */ } o.disconnect(); pg.disconnect(); }); lp.disconnect(); g.disconnect(); if (p) p.disconnect(); };
}
/* wordless "ah": detuned saws through vowel formants, slow swell */
function choir(at, midi, dur, vel) {
  const c = S.ctx, f = mtof(midi), wow = S.wowOut;
  const sum = c.createGain(); sum.gain.value = 0.5;
  const src = [-7, 7].map(d => { const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = d; wow.connect(o.detune); o.connect(sum); o.start(at); o.stop(at + dur * 1.7); return o; });
  const mix = c.createGain(), nodes = [];
  [[700, 7, 1], [1150, 9, 0.7], [2600, 10, 0.25]].forEach(([fr, q, a]) => {
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = fr; bp.Q.value = q;
    const ag = c.createGain(); ag.gain.value = a; sum.connect(bp); bp.connect(ag); ag.connect(mix); nodes.push(bp, ag);
  });
  const g = c.createGain(); g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(vel, at + dur * 0.45); g.gain.setTargetAtTime(0, at + dur * 0.45, dur * 0.2);
  mix.connect(g);
  const p = panner(c, rand(-0.4, 0.4)); if (p) { g.connect(p); p.connect(S.swellBus); } else g.connect(S.swellBus);
  src[0].onended = () => { src.forEach(o => { try { wow.disconnect(o.detune); } catch (e) { /* gone */ } o.disconnect(); }); nodes.forEach(n => n.disconnect()); sum.disconnect(); mix.disconnect(); g.disconnect(); if (p) p.disconnect(); };
}

/* AIRPORT: seven loops of incommensurable length, each repeating one note, so the combinations never repeat */
const ENO = [[1, 17.8], [3, 20.1], [4, 23.3], [6, 26.9], [8, 31.4], [9, 37.2], [0, 41.9, true]];
function makeEno(now) { return ENO.map(([idx, per, isChoir]) => ({ idx, per, choir: !!isChoir, next: now + rand(0.5, per * 0.6) })); }
function airportTick(now) {
  const sc = SCALES[P.mode], list = sc.map(d => d + 12).concat(sc.map(d => d + 24));
  S.eno.forEach(v => {
    while (v.next < now + 0.3) {
      const at = Math.max(v.next, now);
      if (Math.random() < P.enoDensity) {
        if (v.choir) choir(at, P.rootMidi + list[v.idx], rand(6, 9), 1.3 * (P.night ? 0.8 : 1));
        else piano(at, P.rootMidi + list[v.idx], 0.5 * rand(0.7, 1) * (P.night ? 0.8 : 1), rand(3.5, 5.5));
      }
      v.next += v.per * P.loopScale;
    }
  });
}

/* PEARL: sparse, slightly spread piano chords drowned in a long, pedalled reverb */
function pearlTick(now) {
  if (now < S.pearlNext) return;
  const at = now + 0.05;
  S.chordIdx++; S.offs = tapeChord(S.chordIdx);
  S.offs.forEach((_, i) => glide(i, 2.5, at));
  const ch = S.offs, strum = rand(0.04, 0.12);
  const notes = [ch[0] + 12, ch[2], ch[3], ch[4]].filter(() => Math.random() < 0.85).sort((a, b) => a - b);
  notes.forEach((o, k) => piano(at + k * strum, P.rootMidi + 12 + o, 0.42 * (k ? 0.8 : 1) * rand(0.8, 1), rand(5, 8)));
  if (Math.random() < 0.5) piano(at + rand(2, 4), P.rootMidi + 24 + pick(ch.slice(2, 5)), 0.25, 6);
  S.pearlNext = now + (60 / P.bpm) * 8 * (P.night ? 1.3 : 1) * rand(0.9, 1.3);
}

/* LOOPS: one short phrase repeats and wears out — notes drop, tone dulls, pitch sags, hiss grows — then a new loop is born */
function newLoop() {
  const sc = SCALES[P.mode], n = pick([4, 5, 5, 6]), notes = [];
  for (let i = 0; i < n; i++) notes.push({ off: pick(sc) + pick([0, 12, 12]), len: pick([1, 1, 1.5, 2]) });
  return { notes, i: 0, rep: 0, deg: 0, next: 0 };
}
function loopNote(at, midi, dur, vel, deg) {
  const c = S.ctx, f = mtof(midi), wow = S.wowOut, d = Math.max(0.26, dur);
  const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.6; lp.frequency.value = 300 + 2000 * (1 - deg * 0.75);
  const g = c.createGain(); g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(vel, at + 0.25); g.gain.setValueAtTime(vel, at + d); g.gain.setTargetAtTime(0, at + d, 0.5);
  const sag = deg * rand(-30, 10);
  const os = [-6, 6].map(dt => { const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = dt + sag; wow.connect(o.detune); o.connect(lp); o.start(at); o.stop(at + d + 3); return o; });
  lp.connect(g);
  const p = panner(c, rand(-0.3, 0.3)); if (p) { g.connect(p); p.connect(S.motifBus); } else g.connect(S.motifBus);
  os[0].onended = () => { os.forEach(o => { try { wow.disconnect(o.detune); } catch (e) { /* gone */ } o.disconnect(); }); lp.disconnect(); g.disconnect(); if (p) p.disconnect(); };
}
function loopsTick(now) {
  let L = S.loop;
  if (L.next < now) L.next = now + 0.05;
  while (L.next < now + 0.3) {
    const beat = 60 / P.bpm * 1.1, nt = L.notes[L.i], dur = nt.len * beat;
    if (Math.random() > L.deg * 0.55) loopNote(L.next, P.rootMidi + nt.off, dur, 0.12 * (1 - L.deg * 0.5), L.deg);
    L.next += dur; L.i++;
    if (L.i >= L.notes.length) {
      L.i = 0; L.rep++; L.deg = Math.min(1, L.rep / P.loopLife);
      S.tHiss.gain.setTargetAtTime(0.004 + L.deg * 0.008, now, 2);
      renderScore();
      if (L.deg >= 1) { const nx = L.next + beat * 2; L = S.loop = newLoop(); L.next = nx; }
    }
  }
}

function applyStyle(tc) {
  if (!S) return;
  const now = S.ctx.currentTime, cf = STYLES[STYLE];
  S.clean.gain.setTargetAtTime(1 - cf.tape, now, tc); S.satG.gain.setTargetAtTime(cf.tape, now, tc);
  S.tone.frequency.setTargetAtTime(18000 - 10500 * cf.tape, now, tc);
  S.tHiss.gain.setTargetAtTime(0.004 * cf.tape, now, tc);
  S.wowD.gain.setTargetAtTime(cf.wow, now, tc); S.flD.gain.setTargetAtTime(2.5 * cf.tape, now, tc);
  S.dSend.gain.setTargetAtTime(cf.echo, now, tc);
  S.droneG.gain.setTargetAtTime(cf.drone, now, tc);
  S.subCtl.gain.setTargetAtTime(P.subLevel * cf.sub, now, tc);
  S.airCtl.gain.setTargetAtTime(P.airLevel * cf.air, now, tc);
  S.revOut.gain.setTargetAtTime(Math.min(0.95, P.wet + cf.wet), now, tc);
  S.voices.forEach((v, i) => v.sg.gain.setTargetAtTime(SAW_MIX * SAWK[i] * cf.saw, now, tc));
}
function setStyle(st) {
  if (!STYLES[st]) return;
  STYLE = st;
  try { localStorage.setItem('wd-style', st); } catch (e) { /* optional */ }
  if (S) {
    applyStyle(1.5);
    const now = S.ctx.currentTime;
    S.prog = P.prog; S.mode = P.mode; S.chordIdx = 0;
    if (st === 'tape') { S.stepN = 0; S.nextStep = now + 0.3; S.motif = newMotif(); S.offs = tapeChord(0); retune(2); }
    else if (st === 'pearl') { S.pearlNext = now + 0.5; S.offs = tapeChord(0); retune(3); }
    else {
      S.offs = newChord(); retune(3); S.nextSwell = now + 1;
      if (st === 'airport') S.eno = makeEno(now);
      if (st === 'loops') { S.loop = newLoop(); S.loop.next = now + 0.5; }
    }
  }
  renderStyle(); renderScore();
}
function renderStyle() {
  document.querySelectorAll('#styleSeg button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.style === STYLE)));
}

/* thunder: a sharp crack that rolls off into a low, reverberant rumble */
function thunder(delay, power) {
  if (!S) return;
  const c = S.ctx, at = c.currentTime + delay, dur = rand(3, 6);
  const src = c.createBufferSource(); src.buffer = S.pink; src.loop = true;
  const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.4;
  lp.frequency.setValueAtTime(1200, at); lp.frequency.exponentialRampToValueAtTime(110, at + dur);
  const g = c.createGain(); g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(1.4 * power, at + 0.05); g.gain.setTargetAtTime(0.7 * power, at + 0.05, 0.2);
  g.gain.setTargetAtTime(0, at + 0.8, dur / 3);
  src.connect(lp); lp.connect(g); g.connect(S.swellBus);
  src.start(at, rand(0, 6)); src.stop(at + dur + 1.5);
  src.onended = () => { src.disconnect(); lp.disconnect(); g.disconnect(); };
}

/* rain micro-drop: a few milliseconds of band-passed white noise */
function drop(at) {
  const c = S.ctx, dur = rand(0.012, 0.035);
  const src = c.createBufferSource(); src.buffer = S.white;
  const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = rand(2200, 7500); bp.Q.value = rand(0.8, 3);
  const g = c.createGain(); g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(rand(0.03, 0.09) * (0.4 + 0.6 * P.rain), at + 0.0015);
  g.gain.setTargetAtTime(0, at + 0.0015, dur / 3);
  const p = panner(c, rand(-0.9, 0.9));
  src.connect(bp); bp.connect(g); if (p) { g.connect(p); p.connect(S.dropBus); } else g.connect(S.dropBus);
  src.start(at, rand(0, S.white.duration - 0.2)); src.stop(at + dur + 0.12);
  src.onended = () => { src.disconnect(); bp.disconnect(); g.disconnect(); if (p) p.disconnect(); };
}

function tick() {
  if (!S) return;
  const now = S.ctx.currentTime, tt = performance.now() / 1000, g = gust(tt), g2 = gust(tt + 9.1);
  if (STYLE === 'tape') tapeSteps(now);
  else if (STYLE === 'airport') airportTick(now);
  else if (STYLE === 'pearl') pearlTick(now);
  else if (STYLE === 'loops') loopsTick(now);
  else if (now >= S.nextSwell) { swell(now + 0.05); S.nextSwell = now + Math.max(2.5, expo(P.swellRate)); }
  if (S.nextDrop < now) S.nextDrop = now;
  while (S.nextDrop < now + 0.35) {
    if (P.dropRate > 0) { drop(S.nextDrop + 0.02); S.nextDrop += expo(P.dropRate * (0.7 + 0.6 * g)); }
    else S.nextDrop += 0.2;
  }
  // wind noise follows the Beaufort number, gusts modulate level and colour
  const b = P.bft / 12, lvl = Math.pow(b, 1.25) * 0.11 + (P.bft > 0 ? 0.006 : 0);
  S.wind[0].g.gain.setTargetAtTime(lvl * (0.3 + 0.7 * g), now, 0.5);
  S.wind[0].bp.frequency.setTargetAtTime(150 + b * 650 * (0.5 + 0.5 * g), now, 0.5);
  S.wind[1].g.gain.setTargetAtTime(lvl * (0.3 + 0.7 * g2), now, 0.5);
  S.wind[1].bp.frequency.setTargetAtTime(190 + b * 700 * (0.5 + 0.5 * g2), now, 0.5);
  S.whistle.g.gain.setTargetAtTime(Math.max(0, P.bft - 5) / 7 * 0.035 * g * g, now, 0.6);
  S.whistle.bp.frequency.setTargetAtTime(650 + b * 900 + g * 350, now, 0.8);
  S.hiss.gain.setTargetAtTime(P.rain * 0.035 * (P.snow ? 0.35 : 1) * (0.75 + 0.25 * g), now, 1);
  S.strings.forEach((s, i) => {
    const gs = gust(tt * 0.6 + i * 13.7 + 3);
    s.g.gain.setTargetAtTime(P.aeol * 3.2 * Math.pow(gs, 1.5) * (0.4 + 0.6 * g), now, 0.8);
  });
}
