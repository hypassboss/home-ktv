// End-of-song applause, synthesised (no audio files): many "people" clapping at their own pace,
// each with their own hand sound and stereo position, in a small room, plus optional cheers and whistles.
// Several versions take turns so it doesn't sound the same every time.

export const VARIANTS = [
  { name: "熱烈掌聲", clappers: 28, dur: 4.6, rate: [3.6, 5.2], cheer: 0.35, whistles: 1 },
  { name: "家庭小聚", clappers: 7, dur: 3.4, rate: [3.0, 4.4], cheer: 0, whistles: 0 },
  { name: "演唱會", clappers: 46, dur: 5.4, rate: [4.0, 5.8], cheer: 0.7, whistles: 2 },
  { name: "安可節奏", clappers: 22, dur: 6.2, rate: [3.8, 5.0], cheer: 0.2, whistles: 0, rhythm: true },
  { name: "口哨歡呼", clappers: 18, dur: 4.4, rate: [3.4, 5.0], cheer: 0.45, whistles: 3 },
];
const SHORT = { name: "鼓掌", clappers: 9, dur: 2.2, rate: [3.6, 5.0], cheer: 0, whistles: 0 };

const rnd = (a, b) => a + Math.random() * (b - a);

function bandpass(x, sr, f, q) {
  const w = (2 * Math.PI * f) / sr, al = Math.sin(w) / (2 * q), c = Math.cos(w);
  const a0 = 1 + al, b0 = al / a0, b2 = -al / a0, a1 = (-2 * c) / a0, a2 = (1 - al) / a0;
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = b0 * x[i] + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
  }
  return y;
}
function norm(a, peak = 1) {
  let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i]));
  if (m > 0) for (let i = 0; i < a.length; i++) a[i] *= peak / m;
  return a;
}
// one clap: a few tiny bursts in the first ~10 ms (palms meeting), then a short bright tail
function clapSound(sr, tone) {
  const n = Math.floor(sr * 0.06), raw = new Float32Array(n);
  const tau = rnd(0.0035, 0.0075) * sr, bursts = Math.random() < 0.6 ? 2 : 1;
  for (let k = 0; k < bursts; k++) {
    const off = Math.floor(k * rnd(0.004, 0.009) * sr), amp = k ? rnd(0.3, 0.6) : 1;
    for (let i = off; i < n; i++) {
      const t = i - off, env = t < 0.0007 * sr ? t / (0.0007 * sr) : Math.exp(-(t - 0.0007 * sr) / tau);
      raw[i] += (Math.random() * 2 - 1) * env * amp;
    }
  }
  const bright = bandpass(raw, sr, tone, rnd(0.9, 1.6));
  const body = bandpass(raw, sr, tone * rnd(0.32, 0.45), 1.2);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = bright[i] + body[i] * 0.45;
  return norm(out);
}
function addAt(L, R, s, at, gain, pan) {
  const gl = gain * Math.cos(((pan + 1) * Math.PI) / 4), gr = gain * Math.sin(((pan + 1) * Math.PI) / 4);
  for (let i = 0; i < s.length && at + i < L.length; i++) { L[at + i] += s[i] * gl; R[at + i] += s[i] * gr; }
}
// overall loudness: swell in, hold, people stop one by one
const shape = (t, dur) => Math.min(1, t / 0.35) * Math.min(1, Math.max(0, (dur - t) / (dur * 0.45)));

function crowdRoar(sr, n, dur, level) {
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = Math.random() * 2 - 1;
  const a = bandpass(x, sr, 650, 0.8), b = bandpass(x, sr, 1400, 1.1), c = bandpass(x, sr, 2600, 1.4);
  const out = new Float32Array(n);
  let mod = 0.8, target = 0.8;
  for (let i = 0; i < n; i++) {
    if (i % 2400 === 0) target = rnd(0.55, 1);
    mod += (target - mod) * 0.0006;
    const t = i / sr;
    const env = Math.min(1, t / 0.5) * Math.min(1, Math.max(0, (dur * 0.85 - t) / (dur * 0.5)));
    out[i] = (a[i] + b[i] * 0.7 + c[i] * 0.25) * mod * env * level;
  }
  return out;
}
// "woo!" voices: a gliding buzzy tone through an "oo" vowel filter
function woo(sr) {
  const d = rnd(0.7, 1.3), n = Math.floor(sr * d), x = new Float32Array(n);
  const f0 = rnd(220, 420), peak = f0 * rnd(1.35, 1.7);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / n, f = t < 0.35 ? f0 + (peak - f0) * (t / 0.35) : peak - (peak - f0 * 0.8) * ((t - 0.35) / 0.65);
    ph += (f * (1 + 0.012 * Math.sin(i / sr * 2 * Math.PI * 5.5))) / sr;
    x[i] = ((ph % 1) * 2 - 1) * Math.min(1, t / 0.12) * Math.min(1, (1 - t) / 0.35);
  }
  const f1 = bandpass(x, sr, rnd(330, 420), 4), f2 = bandpass(x, sr, rnd(800, 950), 5);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = f1[i] + f2[i] * 0.5;
  return norm(out);
}
// two-part whistle (up, then up-and-down)
function whistle(sr) {
  const parts = [[0.24, 1250, 2700, 2700], [0.5, 1450, 2900, 1300]], gap = 0.09;
  const n = Math.floor(sr * (parts[0][0] + gap + parts[1][0])), x = new Float32Array(n);
  let i0 = 0, ph = 0;
  for (const [d, a, m, e] of parts) {
    const len = Math.floor(d * sr);
    for (let i = 0; i < len; i++) {
      const t = i / len, f = t < 0.45 ? a + (m - a) * (t / 0.45) : m + (e - m) * ((t - 0.45) / 0.55);
      ph += (f + 40 * Math.sin((i / sr) * 2 * Math.PI * 7)) / sr;
      x[i0 + i] = Math.sin(2 * Math.PI * ph) * Math.min(1, t / 0.08) * Math.min(1, (1 - t) / 0.12) + (Math.random() * 2 - 1) * 0.03;
    }
    i0 += len + Math.floor(gap * sr);
  }
  return x;
}
function render(sr, v) {
  const n = Math.floor(sr * v.dur), L = new Float32Array(n), R = new Float32Array(n);
  for (let p = 0; p < v.clappers; p++) {
    const tone = rnd(900, 2300), sounds = [clapSound(sr, tone), clapSound(sr, tone), clapSound(sr, tone)];
    const pan = rnd(-0.85, 0.85), vol = rnd(0.35, 1) * (Math.random() < 0.15 ? 1.4 : 1);
    const rate = rnd(v.rate[0], v.rate[1]), stopAt = v.dur * rnd(0.55, 0.95);
    let t = rnd(0, 0.3);
    if (v.rhythm) {
      // free applause first, then everyone falls into one beat: 安可! 安可!
      const freeEnd = 1.6, beat = 0.42;
      while (t < freeEnd) { addAt(L, R, sounds[(Math.random() * 3) | 0], Math.floor(t * sr), vol * shape(t, v.dur) * 0.8, pan); t += (1 / rate) * rnd(0.8, 1.2); }
      for (let k = 0; freeEnd + 0.2 + k * beat < v.dur - 0.3; k++) {
        const bt = freeEnd + 0.2 + k * beat + rnd(-0.022, 0.022);
        addAt(L, R, sounds[k % 3], Math.floor(bt * sr), vol * (k % 4 === 3 ? 1.15 : 0.95) * Math.min(1, (v.dur - bt) / 0.8), pan);
      }
      continue;
    }
    while (t < stopAt) {
      addAt(L, R, sounds[(Math.random() * 3) | 0], Math.floor(t * sr), vol * shape(t, v.dur) * rnd(0.75, 1.1), pan);
      t += (1 / rate) * rnd(0.82, 1.18);
    }
  }
  norm(L, 0.9); norm(R, 0.9);
  if (v.cheer) {
    const roar = crowdRoar(sr, n, v.dur, 0.18 * v.cheer);
    for (let i = 0; i < n; i++) { L[i] += roar[i]; R[i] += roar[i] * 0.95; }
    const voices = Math.round(v.cheer * 7);
    for (let k = 0; k < voices; k++) addAt(L, R, woo(sr), Math.floor(rnd(0.1, v.dur * 0.55) * sr), rnd(0.08, 0.16), rnd(-0.7, 0.7));
  }
  for (let k = 0; k < (v.whistles || 0); k++) addAt(L, R, whistle(sr), Math.floor(rnd(0.3, v.dur * 0.5) * sr), rnd(0.12, 0.2), rnd(-0.6, 0.6));
  // same loudness for every version, never clipping
  let pk = 0, ss = 0;
  for (let i = 0; i < n; i++) { pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i])); ss += L[i] * L[i] + R[i] * R[i]; }
  const g = Math.min(0.1 / (Math.sqrt(ss / (2 * n)) || 1), 0.9 / (pk || 1));
  for (let i = 0; i < n; i++) { L[i] *= g; R[i] *= g; }
  return [L, R];
}
function roomImpulse(ctx) {
  const sr = ctx.sampleRate, n = Math.floor(sr * 1.1), b = ctx.createBuffer(2, n, sr);
  for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (sr * 0.28)); }
  return b;
}

let turn = 0;
try { turn = +localStorage.getItem("ktv_clap_turn") || 0; } catch { /* */ }
/** Plays applause. kind: "end" rotates through the versions, "short" is a quick clap for the 👏 reaction. Returns the version name. */
export function playApplause(ctx, kind = "end", volume = 0.9) {
  if (!ctx) return "";
  try { ctx.resume(); } catch { /* */ }
  let v = SHORT;
  if (kind === "end") {
    v = VARIANTS[turn % VARIANTS.length];
    turn++;
    try { localStorage.setItem("ktv_clap_turn", String(turn)); } catch { /* */ }
  }
  const sr = ctx.sampleRate, [L, R] = render(sr, v);
  const buf = ctx.createBuffer(2, L.length, sr);
  buf.getChannelData(0).set(L); buf.getChannelData(1).set(R);
  const src = ctx.createBufferSource(), dry = ctx.createGain(), wet = ctx.createGain(), rev = ctx.createConvolver();
  rev.buffer = roomImpulse(ctx);
  src.buffer = buf; dry.gain.value = volume; wet.gain.value = volume * 0.22;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -10; comp.ratio.value = 6; comp.attack.value = 0.003; comp.release.value = 0.15;
  src.connect(dry).connect(comp);
  src.connect(rev).connect(wet).connect(comp);
  comp.connect(ctx.destination);
  src.start();
  return v.name;
}
// for tests: render a version without playing it
export function renderVariant(sr, i) { return render(sr, i == null ? SHORT : VARIANTS[i]); }
