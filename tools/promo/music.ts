// Procedural synthwave soundtrack for the promo (120 BPM, A minor), written as
// a 48 kHz 16-bit WAV. Sections follow the shot list in shots.ts:
//   0-8 s intro drone, 8 s title hit, 12-48 s groove (lead from 28 s),
//   48-52 s build, 52 s core explosion, 56-68 s end card and fade.
//
//   npx tsx tools/promo/music.ts [out.wav]

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const SR = 48000;
const LEN = 68;
const N = SR * LEN;
const BEAT = 0.5;
const BAR = 2;

// ---------------------------------------------------------------------------
// Buses (stereo) and helpers

const bus = () => [new Float32Array(N), new Float32Array(N)] as const;
const drums = bus();
const bass = bus();
const synth = bus();
const fx = bus();
const verbSend = bus();
const delaySend = bus();

const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
let seed = 12345;
const rnd = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};
const noise = () => rnd() * 2 - 1;

function polyblep(t: number, dt: number): number {
  if (t < dt) {
    t /= dt;
    return t + t - t * t - 1;
  }
  if (t > 1 - dt) {
    t = (t - 1) / dt;
    return t * t + t + t + 1;
  }
  return 0;
}

class Osc {
  phase = rnd();
  saw(f: number): number {
    const dt = f / SR;
    const v = 2 * this.phase - 1 - polyblep(this.phase, dt);
    this.phase += dt;
    if (this.phase >= 1) this.phase -= 1;
    return v;
  }
  square(f: number, pw = 0.5): number {
    const dt = f / SR;
    let v = this.phase < pw ? 1 : -1;
    v += polyblep(this.phase, dt);
    v -= polyblep((this.phase + 1 - pw) % 1, dt);
    this.phase += dt;
    if (this.phase >= 1) this.phase -= 1;
    return v;
  }
  sine(f: number): number {
    const v = Math.sin(2 * Math.PI * this.phase);
    this.phase += f / SR;
    if (this.phase >= 1) this.phase -= 1;
    return v;
  }
}

/** Zavalishin TPT state-variable filter. */
class SVF {
  private ic1 = 0;
  private ic2 = 0;
  lp = 0;
  bp = 0;
  hp = 0;
  run(x: number, fc: number, res: number): this {
    const g = Math.tan((Math.PI * Math.min(fc, SR * 0.45)) / SR);
    const k = 2 - 2 * Math.min(res, 0.98);
    const a1 = 1 / (1 + g * (g + k));
    const a2 = g * a1;
    const a3 = g * a2;
    const v3 = x - this.ic2;
    const v1 = a1 * this.ic1 + a2 * v3;
    const v2 = this.ic2 + a2 * this.ic1 + a3 * v3;
    this.ic1 = 2 * v1 - this.ic1;
    this.ic2 = 2 * v2 - this.ic2;
    this.lp = v2;
    this.bp = v1;
    this.hp = x - k * v1 - v2;
    return this;
  }
}

function add(b: readonly [Float32Array, Float32Array], i: number, v: number, pan = 0): void {
  if (i < 0 || i >= N) return;
  const l = Math.cos(((pan + 1) * Math.PI) / 4);
  const r = Math.sin(((pan + 1) * Math.PI) / 4);
  b[0][i]! += v * l * 1.4142;
  b[1][i]! += v * r * 1.4142;
}

// ---------------------------------------------------------------------------
// Arrangement

const CHORDS: Record<string, number[]> = {
  Am: [57, 60, 64],
  F: [53, 57, 60],
  C: [48, 52, 55, 60],
  G: [55, 59, 62],
  Dm: [50, 53, 57],
  E: [52, 56, 59],
};
/** Chord per bar (34 bars). */
const PROG: string[] = [
  ...['Am', 'Am', 'Am', 'Am'], // 0-8 intro
  ...['Am', 'F'], // 8-12 title
  ...['Am', 'F', 'C', 'G', 'Am', 'F', 'C', 'G'], // 12-28
  ...['Am', 'F', 'Dm', 'E', 'Am', 'F', 'Dm', 'E'], // 28-44 lead
  ...['Am', 'F'], // 44-48
  ...['E', 'E'], // 48-52 build
  ...['Am', 'Am'], // 52-56 after the core
  ...['Am', 'F', 'C', 'G', 'Am', 'Am'], // 56-68 end card
];
const chordAt = (t: number) => CHORDS[PROG[Math.min(PROG.length - 1, Math.floor(t / BAR))]!]!;
const rootAt = (t: number) => {
  const c = chordAt(t);
  return c[0]! - (c[0]! >= 55 ? 12 : 0);
};

const inRange = (t: number, a: number, b: number) => t >= a - 1e-6 && t < b - 1e-6;
const grooveOn = (t: number) => inRange(t, 12, 48);

// ---- drums

function kick(t0: number, gain = 1): void {
  const s0 = Math.round(t0 * SR);
  const o = new Osc();
  o.phase = 0;
  for (let i = 0; i < SR * 0.45; i++) {
    const t = i / SR;
    const f = 44 + 120 * Math.exp(-t / 0.032);
    const a = Math.exp(-t / 0.26);
    const click = noise() * Math.exp(-t / 0.002) * 0.4;
    const v = Math.tanh((o.sine(f) * a + click) * 1.6) * 0.9 * gain;
    add(drums, s0 + i, v);
  }
}

function snare(t0: number, gain = 1): void {
  const s0 = Math.round(t0 * SR);
  const f = new SVF();
  const o = new Osc();
  for (let i = 0; i < SR * 0.35; i++) {
    const t = i / SR;
    const n = f.run(noise(), 2200, 0.2).bp * Math.exp(-t / 0.13);
    const tone = o.sine(185 - 30 * t) * Math.exp(-t / 0.07) * 0.5;
    const v = (n * 1.2 + tone) * 0.55 * gain;
    add(drums, s0 + i, v, 0.05);
    add(verbSend, s0 + i, v * 0.35);
  }
}

function hat(t0: number, open: boolean, gain = 1, pan = 0.25): void {
  const s0 = Math.round(t0 * SR);
  const f = new SVF();
  const d = open ? 0.18 : 0.028;
  for (let i = 0; i < SR * d * 5; i++) {
    const t = i / SR;
    const v = f.run(noise(), 8500, 0.1).hp * Math.exp(-t / d) * 0.22 * gain;
    add(drums, s0 + i, v, pan);
  }
}

/** Big hit: sub drop + noise burst into the reverb. */
function impact(t0: number, gain = 1): void {
  const s0 = Math.round(t0 * SR);
  const o = new Osc();
  const f = new SVF();
  for (let i = 0; i < SR * 3.5; i++) {
    const t = i / SR;
    const sub = o.sine(30 + 50 * Math.exp(-t / 0.25)) * Math.exp(-t / 1.1) * 0.9;
    const n = f.run(noise(), 3000 * Math.exp(-t / 0.5) + 200, 0.1).lp * Math.exp(-t / 0.7) * 0.9;
    const v = Math.tanh((sub + n) * 1.3) * gain;
    add(fx, s0 + i, v);
    add(verbSend, s0 + i, n * 0.6 * gain);
  }
}

/** Noise riser ending at t1. */
function riser(t0: number, t1: number, gain = 1): void {
  const s0 = Math.round(t0 * SR);
  const n = Math.round((t1 - t0) * SR);
  const fl = new SVF();
  const fr = new SVF();
  for (let i = 0; i < n; i++) {
    const p = i / n;
    const fc = 300 * Math.pow(40, p);
    const a = p * p * 0.35 * gain;
    add(fx, s0 + i, fl.run(noise(), fc, 0.6).bp * a, -0.4);
    add(fx, s0 + i, fr.run(noise(), fc * 1.03, 0.6).bp * a, 0.4);
    add(verbSend, s0 + i, fl.bp * a * 0.4);
  }
}

/** Digital "jack in" zap: falling FM chirp with glitch gating. */
function zap(t0: number): void {
  const s0 = Math.round(t0 * SR);
  const o = new Osc();
  const m = new Osc();
  for (let i = 0; i < SR * 0.9; i++) {
    const t = i / SR;
    const f = 2400 * Math.exp(-t / 0.18) + 80;
    const gate = Math.floor(t * 40) % 3 === 0 && t > 0.15 ? 0.2 : 1;
    const v = o.sine(f + m.sine(f * 1.5) * f * 0.8) * Math.exp(-t / 0.35) * 0.35 * gate;
    add(fx, s0 + i, v, Math.sin(t * 30) * 0.5);
    add(delaySend, s0 + i, v * 0.4);
  }
}

// ---- tonal parts

function bassNote(t0: number, dur: number, midi: number, gain = 1): void {
  const s0 = Math.round(t0 * SR);
  const o1 = new Osc();
  const o2 = new Osc();
  const f = new SVF();
  const hz = mtof(midi);
  for (let i = 0; i < SR * (dur + 0.05); i++) {
    const t = i / SR;
    const env = t < dur ? 1 - Math.exp(-t / 0.004) : Math.exp(-(t - dur) / 0.015);
    const cut = 180 + 1500 * Math.exp(-t / 0.07);
    const x = o1.saw(hz) * 0.6 + o2.square(hz / 2) * 0.5;
    const v = Math.tanh(f.run(x, cut, 0.35).lp * 1.5) * env * 0.42 * gain;
    add(bass, s0 + i, v);
  }
}

function padChord(t0: number, dur: number, notes: number[], gain = 1, bright = 1): void {
  const s0 = Math.round(t0 * SR);
  const voices = notes.flatMap((m, k) => [-9, 0, 8].map((cents, j) => ({ hz: mtof(m + 12) * Math.pow(2, cents / 1200), o: new Osc(), pan: ((k + j) % 3) * 0.6 - 0.6 })));
  const fl = new SVF();
  const fr = new SVF();
  const rel = 0.9;
  for (let i = 0; i < SR * (dur + rel); i++) {
    const t = i / SR;
    const env = t < dur ? Math.min(1, t / 0.35) : Math.exp(-(t - dur) / (rel / 3));
    let l = 0;
    let r = 0;
    for (const v of voices) {
      const x = v.o.saw(v.hz);
      l += x * (1 - v.pan) * 0.5;
      r += x * (1 + v.pan) * 0.5;
    }
    const cut = (900 + 500 * Math.sin((t0 + t) * 0.8)) * bright;
    const vl = fl.run(l, cut, 0.15).lp * env * 0.07 * gain;
    const vr = fr.run(r, cut, 0.15).lp * env * 0.07 * gain;
    const idx = s0 + i;
    if (idx >= N) break;
    synth[0][idx]! += vl;
    synth[1][idx]! += vr;
    verbSend[0][idx]! += vl * 0.6;
    verbSend[1][idx]! += vr * 0.6;
  }
}

function pluck(t0: number, midi: number, gain = 1, cutoff = 2600, pan = 0): void {
  const s0 = Math.round(t0 * SR);
  const o = new Osc();
  const o2 = new Osc();
  const f = new SVF();
  const hz = mtof(midi);
  for (let i = 0; i < SR * 0.3; i++) {
    const t = i / SR;
    const env = Math.exp(-t / 0.09);
    const x = o.square(hz, 0.3) * 0.6 + o2.saw(hz * 1.004) * 0.4;
    const v = f.run(x, 300 + cutoff * Math.exp(-t / 0.05), 0.3).lp * env * 0.16 * gain;
    add(synth, s0 + i, v, pan);
    add(delaySend, s0 + i, v * 0.5);
  }
}

function leadNote(t0: number, dur: number, midi: number, prev: number | null, gain = 1): void {
  const s0 = Math.round(t0 * SR);
  const o1 = new Osc();
  const o2 = new Osc();
  const o3 = new Osc();
  const f = new SVF();
  const rel = 0.12;
  for (let i = 0; i < SR * (dur + rel); i++) {
    const t = i / SR;
    const glide = prev !== null && t < 0.05 ? prev + (midi - prev) * (t / 0.05) : midi;
    const vib = t > 0.2 ? Math.sin(2 * Math.PI * 5.5 * t) * 0.18 * Math.min(1, (t - 0.2) / 0.3) : 0;
    const hz = mtof(glide + vib);
    const env = t < dur ? Math.min(1, t / 0.01) : Math.exp(-(t - dur) / 0.04);
    const x = o1.saw(hz) * 0.5 + o2.saw(hz * 1.006) * 0.5 + o3.square(hz / 2) * 0.25;
    const v = f.run(x, 2800 + 1200 * Math.exp(-t / 0.15), 0.25).lp * env * 0.13 * gain;
    add(synth, s0 + i, v, -0.1);
    add(delaySend, s0 + i, v * 0.35);
    add(verbSend, s0 + i, v * 0.3);
  }
}

// Melody: [start beat within the 8-bar phrase, length in beats, midi]
const LEAD_A: [number, number, number][] = [
  [0, 2, 76], [2, 1, 74], [3, 1, 72],
  [4, 1.5, 72], [5.5, 0.5, 74], [6, 2, 69],
  [8, 1, 67], [9, 1, 72], [10, 1, 76], [11, 1, 79],
  [12, 1.5, 77], [13.5, 0.5, 76], [14, 2, 74],
  [16, 2, 76], [18, 2, 81],
  [20, 1, 79], [21, 1, 77], [22, 1, 76], [23, 1, 72],
  [24, 1.5, 74], [25.5, 0.5, 76], [26, 2, 77],
  [28, 3, 76], [31, 1, 80],
];

// ---------------------------------------------------------------------------
// Sequence

// Pads: whole song except the build's last beat and the silence after the boom.
for (let b = 0; b < PROG.length; b++) {
  const t = b * BAR;
  if (inRange(t, 52, 54)) continue;
  const gain = t < 8 ? 0.6 + t / 16 : t >= 64 ? Math.max(0, 1 - (t - 64) / 4) : 1;
  const bright = t < 8 ? 0.6 : inRange(t, 48, 52) ? 1 + (t - 48) / 3 : 1;
  padChord(t, BAR, chordAt(t), gain, bright);
}
padChord(52.6, 3.4, [45, 52, 57, 60, 64], 1.3, 1.3); // wide Am after the explosion

// Arp: 16ths over the chord (filtered in the intro, full in the groove, gentle at the end).
for (let s = 0; s < LEN / (BEAT / 4); s++) {
  const t = s * (BEAT / 4);
  if (t < 4 || inRange(t, 51.5, 56) || t >= 66) continue;
  const c = chordAt(t);
  const pat = [0, 1, 2, 1, 2, 0, 1, 2];
  const idx = pat[s % pat.length]!;
  const oct = Math.floor(s / 8) % 2 ? 12 : 0;
  const midi = c[idx % c.length]! + 12 + oct;
  const cutoff = t < 8 ? 400 + (t - 4) * 300 : t < 12 ? 1500 : t >= 56 ? 1600 : 2600;
  const gain = t < 8 ? (t - 4) / 4 : t >= 62 ? Math.max(0, 1 - (t - 62) / 4) : 1;
  pluck(t, midi, gain * 0.9, cutoff, s % 2 ? 0.35 : -0.35);
}

// Bass: pulsing 8ths from the title on.
for (let e = 0; e < LEN / (BEAT / 2); e++) {
  const t = e * (BEAT / 2);
  if (t < 8 || inRange(t, 51.75, 56) || t >= 64) continue;
  const r = rootAt(t);
  const step = e % 8;
  const midi = r + (step === 3 || step === 7 ? 12 : 0) - 12;
  const gain = t < 12 ? 0.8 : t >= 56 ? 0.7 : 1;
  bassNote(t, 0.2, midi + 12, gain);
}

// Drums.
for (let q = 0; q < LEN / BEAT; q++) {
  const t = q * BEAT;
  const beatInBar = q % 4;
  if (grooveOn(t)) {
    kick(t);
    if (beatInBar === 1 || beatInBar === 3) snare(t);
    hat(t + BEAT / 2, false, 1);
    hat(t + BEAT / 4, false, 0.5, -0.25);
    hat(t + (3 * BEAT) / 4, false, 0.5, -0.25);
    if (t >= 28 && beatInBar === 3) hat(t + BEAT / 2, true, 0.8);
  } else if (inRange(t, 8, 12)) {
    if (beatInBar === 0 || beatInBar === 2) kick(t, 0.8);
    hat(t + BEAT / 2, false, 0.8);
  } else if (inRange(t, 56, 64)) {
    if (beatInBar === 0) kick(t, 0.7);
    hat(t + BEAT / 2, false, 0.6);
  } else if (inRange(t, 4, 8)) {
    hat(t + BEAT / 2, false, 0.3 + (t - 4) * 0.08);
  }
}
// Build (48-52): kicks and snares accelerate into the explosion.
for (let t = 48; t < 52 - 1e-6; t += BEAT / 2) kick(t, 0.7 + (t - 48) * 0.08);
{
  let t = 48;
  while (t < 52 - 0.02) {
    const p = (t - 48) / 4;
    snare(t, 0.3 + p * 0.7);
    t += p < 0.5 ? BEAT / 2 : p < 0.75 ? BEAT / 4 : BEAT / 8;
  }
}
// Snare fill into the drop.
for (let k = 0; k < 8; k++) snare(11 + k * (BEAT / 4), 0.4 + k * 0.08);

// Lead: the 32-beat phrase from 28 s (cut off at the build).
for (const base of [28]) {
  let prev: number | null = null;
  for (const [beat, len, midi] of LEAD_A) {
    const t = base + beat * BEAT;
    if (t >= 48) break;
    leadNote(t, len * BEAT * 0.92, midi, prev);
    prev = midi;
  }
}
// Echo of the phrase opening under the end card.
leadNote(56.5, 1.8, 76, null, 0.6);
leadNote(58.5, 0.9, 74, 76, 0.6);
leadNote(59.5, 0.9, 72, 74, 0.6);
leadNote(60.5, 3.0, 69, 72, 0.6);

// Hits and risers.
riser(4, 8, 0.8);
impact(8, 1);
riser(10, 12, 0.7);
impact(12, 0.5);
zap(21.3);
riser(48, 52, 1.2);
impact(52, 1.4);
impact(56, 0.6);

// ---------------------------------------------------------------------------
// Effects and mix

function sidechain(): Float32Array {
  const g = new Float32Array(N).fill(1);
  for (let q = 0; q < LEN / BEAT; q++) {
    const t = q * BEAT;
    const on = grooveOn(t) || inRange(t, 48, 52) || (inRange(t, 8, 12) && q % 2 === 0) || (inRange(t, 56, 64) && q % 4 === 0);
    if (!on) continue;
    const s0 = Math.round(t * SR);
    for (let i = 0; i < SR * BEAT && s0 + i < N; i++) g[s0 + i] = Math.min(g[s0 + i]!, 1 - 0.55 * Math.exp(-i / SR / 0.11));
  }
  return g;
}

function freeverb(inp: readonly [Float32Array, Float32Array], room = 0.86, damp = 0.35): [Float32Array, Float32Array] {
  const scale = SR / 44100;
  const combT = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
  const apT = [556, 441, 341, 225];
  const outs: Float32Array[] = [];
  for (let ch = 0; ch < 2; ch++) {
    const spread = ch ? 23 : 0;
    const combs = combT.map((d) => ({ buf: new Float32Array(Math.round((d + spread) * scale)), i: 0, store: 0 }));
    const aps = apT.map((d) => ({ buf: new Float32Array(Math.round((d + spread) * scale)), i: 0 }));
    const x = inp[ch]!;
    const out = new Float32Array(N);
    for (let n = 0; n < N; n++) {
      const input = x[n]! * 0.015;
      let acc = 0;
      for (const c of combs) {
        const y = c.buf[c.i]!;
        c.store = y * (1 - damp) + c.store * damp;
        c.buf[c.i] = input + c.store * room;
        c.i = (c.i + 1) % c.buf.length;
        acc += y;
      }
      for (const a of aps) {
        const b = a.buf[a.i]!;
        a.buf[a.i] = acc + b * 0.5;
        a.i = (a.i + 1) % a.buf.length;
        acc = b - acc;
      }
      out[n] = acc;
    }
    outs.push(out);
  }
  return [outs[0]!, outs[1]!];
}

function pingpong(inp: readonly [Float32Array, Float32Array], time: number, fb: number): [Float32Array, Float32Array] {
  const d = Math.round(time * SR);
  const l = new Float32Array(N);
  const r = new Float32Array(N);
  const f = new SVF();
  for (let n = 0; n < N; n++) {
    const fromR = n >= d ? r[n - d]! : 0;
    const fromL = n >= d ? l[n - d]! : 0;
    l[n] = (inp[0][n]! + inp[1][n]!) * 0.5 + f.run(fromR, 3500, 0).lp * fb;
    r[n] = fromL * 0.95;
  }
  return [l, r];
}

const duck = sidechain();
const [dl, dr] = pingpong(delaySend, 0.375, 0.42);
for (let n = 0; n < N; n++) {
  verbSend[0][n]! += dl[n]! * 0.3;
  verbSend[1][n]! += dr[n]! * 0.3;
}
const [rl, rr] = freeverb(verbSend);

const L = new Float32Array(N);
const R = new Float32Array(N);
let peak = 0;
for (let n = 0; n < N; n++) {
  const g = duck[n]!;
  let l = drums[0][n]! * 0.9 + bass[0][n]! * g + synth[0][n]! * g + fx[0][n]! * 0.8 + dl[n]! * 0.35 * g + rl[n]! * 0.9;
  let r = drums[1][n]! * 0.9 + bass[1][n]! * g + synth[1][n]! * g + fx[1][n]! * 0.8 + dr[n]! * 0.35 * g + rr[n]! * 0.9;
  l = Math.tanh(l * 1.1);
  r = Math.tanh(r * 1.1);
  // Fade in over the first half second and out over the last three.
  const t = n / SR;
  const fade = Math.min(1, t / 0.5) * Math.min(1, Math.max(0, (LEN - t) / 3));
  L[n] = l * fade;
  R[n] = r * fade;
  peak = Math.max(peak, Math.abs(L[n]!), Math.abs(R[n]!));
}

const norm = 0.89 / Math.max(peak, 1e-6);
const data = Buffer.alloc(44 + N * 4);
data.write('RIFF', 0);
data.writeUInt32LE(36 + N * 4, 4);
data.write('WAVE', 8);
data.write('fmt ', 12);
data.writeUInt32LE(16, 16);
data.writeUInt16LE(1, 20);
data.writeUInt16LE(2, 22);
data.writeUInt32LE(SR, 24);
data.writeUInt32LE(SR * 4, 28);
data.writeUInt16LE(4, 32);
data.writeUInt16LE(16, 34);
data.write('data', 36);
data.writeUInt32LE(N * 4, 40);
for (let n = 0; n < N; n++) {
  data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, L[n]! * norm)) * 32767), 44 + n * 4);
  data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, R[n]! * norm)) * 32767), 46 + n * 4);
}
const out = process.argv[2] ?? join(repoRoot, 'out', 'promo', 'music.wav');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, data);
console.log(`wrote ${out} (${LEN}s, peak ${peak.toFixed(2)} -> normalised)`);
