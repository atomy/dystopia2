// Procedural sound effects for Dystopia 2. Everything is synthesized at runtime
// with the WebAudio API: no audio asset files.
//
// Routing (per voice):
//   synth layers -> voice gain -> [muffle LP] -> [HRTF panner] -> mix -> limiter -> master -> out
//                                            \-> reverb send -> HP -> convolver -> mix
//
// World units are inches (a player is 72 tall); positions are three.js world
// coordinates (Y up), which is also WebAudio's default coordinate frame.

export interface SfxVec {
  x: number;
  y: number;
  z: number;
}

/** One-shot sounds (see SOUNDS below). */
export type SfxOneShot =
  // weapons
  | 'mp_fire'
  | 'shotgun_fire'
  | 'shotgun_double'
  | 'ar_fire'
  | 'ar_burst'
  | 'minigun_fire'
  | 'katana_swing'
  | 'katana_hit'
  | 'katana_block'
  | 'fist_punch'
  | 'grenade_throw'
  | 'grenade_bounce'
  | 'frag_explode'
  | 'emp_explode'
  | 'reload'
  | 'reload_shell'
  | 'dry_fire'
  | 'weapon_switch'
  | 'turret_fire'
  | 'bullet_impact'
  | 'ricochet'
  // movement
  | 'footstep'
  | 'jump'
  | 'land'
  | 'land_hard'
  | 'boost_charge'
  | 'boost_jump'
  | 'ledge_grab'
  | 'slide'
  // player
  | 'hit_beep'
  | 'kill_confirm'
  | 'pain'
  | 'death'
  | 'heal'
  | 'spawn'
  | 'wave_warning'
  | 'stealth_on'
  | 'stealth_off'
  | 'thermal_on'
  | 'tac_ping'
  | 'emp_hit'
  // cyber
  | 'jack_in'
  | 'jack_out'
  | 'eject'
  | 'cyber_hitscan'
  | 'cyber_proj'
  | 'cyber_explode'
  | 'cyber_bounce'
  | 'cyber_pad'
  | 'crystal_pickup'
  | 'program_step'
  | 'program_done'
  | 'program_fail'
  | 'node_captured'
  | 'ice_wedge'
  | 'ice_break'
  | 'alarm'
  // world / ui
  | 'door_move'
  | 'capture'
  | 'denied'
  | 'ui_click'
  | 'ui_hover'
  | 'chat'
  | 'round_win'
  | 'round_lose';

/** Continuous sounds for `Sfx.loop()`. */
export type SfxLoopName =
  | 'minigun_spin'
  | 'shaft'
  | 'cyber_ambience'
  | 'meat_ambience'
  | 'stealth_hum'
  | 'crack'
  | 'program'
  | 'alarm';

/**
 * Every sound name. Loop names passed to `play()` produce a short (~0.7 s)
 * faded burst of that loop; `'alarm'` as a one-shot is the single alarm beep.
 */
export type SfxName = SfxOneShot | SfxLoopName;

export interface SfxPlayOpts {
  /** World position (three.js coords). Omit for 2D / first-person sounds. */
  pos?: SfxVec;
  /** Linear gain multiplier (default 1). */
  volume?: number;
  /** Playback-rate style pitch multiplier (default 1). */
  pitch?: number;
  /** Lowpass ~900 Hz: meatspace heard through the cyber mic. */
  muffled?: boolean;
}

export interface SfxLoopParams {
  /** Pitch / rate multiplier. For `minigun_spin`, 1 = full spin (use ~0.25..1 while spinning up). */
  pitch?: number;
  volume?: number;
  /** Only effective if the loop was started with a `pos`. */
  pos?: SfxVec;
}

export interface SfxLoopOpts extends SfxLoopParams {
  /** Instance key so several copies of one loop can run (e.g. per player id). */
  key?: string;
  muffled?: boolean;
}

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------

const MAX_VOICES = 48;
const REF_DIST = 150;
const MAX_DIST = 4000;
const ROLLOFF = 1.2;
/** Positional one-shots farther than this are not played at all (CPU). */
const CULL_DIST = 6000;
const LOOKAHEAD = 0.005;
/** Same-name voices started within this window attenuate new ones (clean stacking). */
const STACK_WINDOW = 0.06;
const MUFFLE_HZ = 900;
const NOISE_SECONDS = 3;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

type Wave = 'sine' | 'square' | 'sawtooth' | 'triangle';
type NoiseColor = 'white' | 'pink' | 'brown';
type BufKey = 'crack' | 'chatter';

const hz = (midi: number): number => 440 * 2 ** ((midi - 69) / 12);
const hzClamp = (f: number): number => Math.min(20000, Math.max(10, f));
const distance = (a: SfxVec, b: SfxVec): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
/** WebAudio 'inverse' distance model gain. */
const distGain = (d: number): number => REF_DIST / (REF_DIST + ROLLOFF * (Math.max(d, REF_DIST) - REF_DIST));

/** Attack / hold / exponential decay (to -60 dB over `d`). Returns end time. */
function env(prm: AudioParam, t: number, a: number, h: number, d: number, v: number): number {
  const ta = t + Math.max(a, 0.0005);
  prm.setValueAtTime(0, t);
  prm.linearRampToValueAtTime(v, ta);
  if (h > 0) prm.setValueAtTime(v, ta + h);
  const end = ta + h + Math.max(d, 0.001);
  prm.exponentialRampToValueAtTime(Math.max(v * 1e-3, 1e-6), end);
  return end;
}

function sweep(prm: AudioParam, from: number, to: number, t: number, dur: number): void {
  prm.setValueAtTime(from, t);
  prm.exponentialRampToValueAtTime(Math.max(to, 1e-4), t + Math.max(dur, 0.001));
}

/** Smoothly move a param from wherever it currently is to `v`. */
function glide(prm: AudioParam, v: number, now: number, tc = 0.03): void {
  const cur = prm.value;
  prm.cancelScheduledValues(now);
  prm.setValueAtTime(cur, now);
  prm.setTargetAtTime(v, now, tc);
}

function disconnectAll(nodes: AudioNode[]): void {
  for (const n of nodes) {
    try {
      n.disconnect();
    } catch {
      /* already disconnected */
    }
  }
}

// Older engines (Firefox lacks listener positionX etc.) only have setPosition/setOrientation.
interface LegacyListener {
  positionX?: AudioParam;
  positionY?: AudioParam;
  positionZ?: AudioParam;
  forwardX?: AudioParam;
  forwardY?: AudioParam;
  forwardZ?: AudioParam;
  upX?: AudioParam;
  upY?: AudioParam;
  upZ?: AudioParam;
  setPosition?(x: number, y: number, z: number): void;
  setOrientation?(x: number, y: number, z: number, xUp: number, yUp: number, zUp: number): void;
}

interface LegacyPanner {
  positionX?: AudioParam;
  positionY?: AudioParam;
  positionZ?: AudioParam;
  setPosition?(x: number, y: number, z: number): void;
}

function applyListener(ctx: AudioContext, p: SfxVec, f: SfxVec, u: SfxVec): void {
  const l: LegacyListener = ctx.listener;
  if (l.positionX && l.positionY && l.positionZ) {
    l.positionX.value = p.x;
    l.positionY.value = p.y;
    l.positionZ.value = p.z;
  } else l.setPosition?.(p.x, p.y, p.z);
  if (l.forwardX && l.forwardY && l.forwardZ && l.upX && l.upY && l.upZ) {
    l.forwardX.value = f.x;
    l.forwardY.value = f.y;
    l.forwardZ.value = f.z;
    l.upX.value = u.x;
    l.upY.value = u.y;
    l.upZ.value = u.z;
  } else l.setOrientation?.(f.x, f.y, f.z, u.x, u.y, u.z);
}

function setPannerPos(pn: PannerNode, p: SfxVec): void {
  const l: LegacyPanner = pn;
  if (l.positionX && l.positionY && l.positionZ) {
    l.positionX.value = p.x;
    l.positionY.value = p.y;
    l.positionZ.value = p.z;
  } else l.setPosition?.(p.x, p.y, p.z);
}

function makePanner(ctx: AudioContext, pos: SfxVec): PannerNode {
  const pn = new PannerNode(ctx, {
    panningModel: 'HRTF',
    distanceModel: 'inverse',
    refDistance: REF_DIST,
    maxDistance: MAX_DIST,
    rolloffFactor: ROLLOFF,
  });
  setPannerPos(pn, pos);
  return pn;
}

// ---------------------------------------------------------------------------
// Generated buffers / curves (cached per AudioContext)
// ---------------------------------------------------------------------------

function fillNoise(d: Float32Array, c: NoiseColor): void {
  const n = d.length;
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  let last = 0;
  for (let i = 0; i < n; i++) {
    const w = Math.random() * 2 - 1;
    if (c === 'white') d[i] = w;
    else if (c === 'pink') {
      // Paul Kellet's economy pink filter
      b0 = 0.99765 * b0 + w * 0.099046;
      b1 = 0.963 * b1 + w * 0.2965164;
      b2 = 0.57 * b2 + w * 1.0526913;
      d[i] = b0 + b1 + b2 + w * 0.1848;
    } else {
      last = (last + 0.02 * w) / 1.02;
      d[i] = last;
    }
  }
  if (c === 'white') return;
  // Detrend so the loop point is continuous, remove DC, normalize.
  const first = d[0] ?? 0;
  const delta = (d[n - 1] ?? 0) - first;
  let mean = 0;
  for (let i = 0; i < n; i++) {
    const v = (d[i] ?? 0) - (delta * i) / (n - 1);
    d[i] = v;
    mean += v;
  }
  mean /= n;
  let peak = 1e-9;
  for (let i = 0; i < n; i++) {
    const v = (d[i] ?? 0) - mean;
    d[i] = v;
    peak = Math.max(peak, Math.abs(v));
  }
  const k = 0.95 / peak;
  for (let i = 0; i < n; i++) d[i] = (d[i] ?? 0) * k;
}

/** Hacking clicks: relay/keyboard-ish ticks and short click bursts. Wraps seamlessly. */
function genCrack(d: Float32Array, sr: number): void {
  const n = d.length;
  let t = 0;
  while (t < n) {
    const burst = Math.random() < 0.25 ? 2 + Math.floor(Math.random() * 4) : 1;
    const spacing = Math.floor(sr * (0.007 + Math.random() * 0.006));
    for (let k = 0; k < burst; k++) {
      const len = Math.floor(sr * (0.002 + Math.random() * 0.006));
      const amp = 0.25 + Math.random() * 0.75;
      const f = 900 + Math.random() * 4500;
      const noisy = Math.random() < 0.55;
      const at = t + k * spacing;
      for (let i = 0; i < len; i++) {
        const e = Math.exp((-5 * i) / len);
        const s = noisy ? Math.random() * 2 - 1 : Math.sin((2 * Math.PI * f * i) / sr);
        const j = (at + i) % n;
        d[j] = (d[j] ?? 0) + s * e * amp;
      }
    }
    t += Math.floor(sr * (Math.random() < 0.15 ? 0.1 + Math.random() * 0.2 : 0.02 + Math.random() * 0.06));
  }
}

/** Data chatter: random square/sine blips on a 5-TET scale. Wraps seamlessly. */
function genChatter(d: Float32Array, sr: number): void {
  const n = d.length;
  const ramp = Math.max(1, Math.floor(sr * 0.0015));
  let t = 0;
  while (t < n) {
    if (Math.random() < 0.12) {
      t += Math.floor(sr * (0.04 + Math.random() * 0.1));
      continue;
    }
    const f = 480 * 2 ** (Math.floor(Math.random() * 15) / 5);
    const len = Math.floor(sr * (0.012 + Math.random() * 0.045));
    const amp = 0.2 + Math.random() * 0.25;
    const sq = Math.random() < 0.6;
    let ph = 0;
    for (let i = 0; i < len; i++) {
      ph = (ph + f / sr) % 1;
      const s = sq ? (ph < 0.5 ? 0.55 : -0.55) : Math.sin(2 * Math.PI * ph);
      const e = Math.min(1, i / ramp, (len - i) / ramp);
      const j = (t + i) % n;
      d[j] = (d[j] ?? 0) + s * e * amp;
    }
    t += len + Math.floor(sr * (0.003 + Math.random() * 0.02));
  }
}

const BUF_GEN: Record<BufKey, { seconds: number; gen: (d: Float32Array, sr: number) => void }> = {
  crack: { seconds: 1.9, gen: genCrack },
  chatter: { seconds: 2.3, gen: genChatter },
};

/** Stereo reverb impulse: darkening exponential noise tail plus a few early reflections. */
function makeIR(ctx: AudioContext, seconds: number, rt60: number): AudioBuffer {
  const sr = ctx.sampleRate;
  const n = Math.floor(sr * seconds);
  const buf = ctx.createBuffer(2, n, sr);
  const pre = Math.floor(sr * 0.01);
  const tailFade = Math.floor(sr * 0.1);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < n; i++) {
      const x = i / n;
      lp += (0.9 - 0.8 * x) * (Math.random() * 2 - 1 - lp);
      const fade = Math.min(1, i / pre, (n - i) / tailFade);
      d[i] = lp * Math.exp((-6.9 * i) / (sr * rt60)) * fade;
    }
    for (let k = 0; k < 10; k++) {
      const j = Math.floor(sr * (0.006 + Math.random() * 0.07));
      d[j] = (d[j] ?? 0) + (Math.random() * 2 - 1) * 0.5 * (1 - k / 12);
    }
  }
  return buf;
}

class Resources {
  private readonly noiseBufs = new Map<NoiseColor, AudioBuffer>();
  private readonly bufs = new Map<BufKey, AudioBuffer>();
  private readonly curves = new Map<string, Float32Array<ArrayBuffer>>();

  constructor(private readonly ctx: AudioContext) {}

  noise(c: NoiseColor): AudioBuffer {
    let b = this.noiseBufs.get(c);
    if (!b) {
      b = this.make(NOISE_SECONDS, (d) => fillNoise(d, c));
      this.noiseBufs.set(c, b);
    }
    return b;
  }

  buffer(key: BufKey): AudioBuffer {
    let b = this.bufs.get(key);
    if (!b) {
      const g = BUF_GEN[key];
      b = this.make(g.seconds, g.gen);
      this.bufs.set(key, b);
    }
    return b;
  }

  curve(key: string, fn: (x: number) => number): Float32Array<ArrayBuffer> {
    let c = this.curves.get(key);
    if (!c) {
      const n = 2048;
      c = new Float32Array(n);
      for (let i = 0; i < n; i++) c[i] = fn((i / (n - 1)) * 2 - 1);
      this.curves.set(key, c);
    }
    return c;
  }

  private make(seconds: number, fill: (d: Float32Array, sr: number) => void): AudioBuffer {
    const sr = this.ctx.sampleRate;
    const buf = this.ctx.createBuffer(1, Math.max(1, Math.floor(sr * seconds)), sr);
    fill(buf.getChannelData(0), sr);
    return buf;
  }
}

// ---------------------------------------------------------------------------
// Voice builder: tiny synthesis DSL used by the sound definitions
// ---------------------------------------------------------------------------

interface RateParam {
  param: AudioParam;
  base: number;
}

interface Filt {
  type: BiquadFilterType;
  /** Cutoff/center Hz (scaled by pitch). */
  f: number;
  /** Exponential sweep target Hz. */
  f2?: number;
  /** Sweep time (default: whole envelope). */
  sw?: number;
  q?: number;
  /** Gain dB (peaking/shelf). */
  g?: number;
}
type Filters = Filt | Filt[];

interface Shaping {
  fl?: Filters;
  /** Soft-clip distortion amount (0 = clean, 20 = heavy). */
  dist?: number;
  /** Bit-crush to this many bits. */
  crush?: number;
  /** Destination (a bus); default: the voice output. */
  to?: AudioNode;
}

interface EnvSpec {
  /** Start offset (s). */
  t?: number;
  /** Attack (s). */
  a?: number;
  /** Hold (s). */
  h?: number;
  /** Decay to -60 dB (s). */
  d: number;
  /** Peak level. */
  v: number;
}

interface ToneSpec extends EnvSpec, Shaping {
  w?: Wave;
  f: number;
  f2?: number;
  sw?: number;
  /** Detune cents. */
  det?: number;
  /** Linear FM: modulator at f*r, depth i*f Hz (ramps to i2*f2). */
  fm?: { r: number; i: number; i2?: number; w?: Wave };
  /** Vibrato: rate Hz, depth cents. */
  vib?: [rate: number, cents: number];
}

interface NoiseSpec extends EnvSpec, Shaping {
  c?: NoiseColor;
  /** Playback rate (<1 = darker/grainier). */
  rate?: number;
  rate2?: number;
  sw?: number;
}

interface BusSpec extends Shaping {
  t?: number;
  a?: number;
  h?: number;
  /** If set, the bus output gets an a/h/d envelope; otherwise static gain `v`. */
  d?: number;
  v?: number;
  /** Amplitude chopper LFO: rate Hz, depth 0..1, waveform (sawtooth = percussive per cycle). */
  gate?: [rate: number, depth?: number, w?: Wave];
}

class Builder {
  readonly nodes: AudioNode[] = [];
  readonly srcs: AudioScheduledSourceNode[] = [];
  /** Params that follow pitch (used by loops for live pitch changes). */
  readonly rate: RateParam[] = [];
  private readonly stops: (number | undefined)[] = [];
  end: number;

  constructor(
    readonly ctx: AudioContext,
    private readonly res: Resources,
    readonly out: AudioNode,
    readonly t0: number,
    readonly p: number,
    private readonly sustained: boolean,
  ) {
    this.end = t0;
  }

  rnd(lo: number, hi: number): number {
    return lo + Math.random() * (hi - lo);
  }

  /** Keep the voice alive at least `dur` seconds after t0. */
  hold(dur: number): void {
    this.end = Math.max(this.end, this.t0 + dur);
  }

  // --- low level -----------------------------------------------------------

  gain(v: number): GainNode {
    const g = new GainNode(this.ctx, { gain: v });
    this.nodes.push(g);
    return g;
  }

  /** Gain that follows pitch. */
  sgain(v: number): GainNode {
    const g = this.gain(v * this.p);
    this.rate.push({ param: g.gain, base: v });
    return g;
  }

  filt(type: BiquadFilterType, f: number, q = 1): BiquadFilterNode {
    const bq = new BiquadFilterNode(this.ctx, { type, frequency: hzClamp(f * this.p), Q: q });
    this.rate.push({ param: bq.frequency, base: f });
    this.nodes.push(bq);
    return bq;
  }

  osc(w: Wave, f: number, t = 0): OscillatorNode {
    const o = new OscillatorNode(this.ctx, { type: w, frequency: f * this.p });
    this.rate.push({ param: o.frequency, base: f });
    this.start(o, this.t0 + t);
    return o;
  }

  nsrc(c: NoiseColor, rate = 1): AudioBufferSourceNode {
    return this.bufSrc(this.res.noise(c), rate);
  }

  bsrc(key: BufKey, rate = 1): AudioBufferSourceNode {
    return this.bufSrc(this.res.buffer(key), rate);
  }

  lfo(w: Wave, rate: number, depth: number, target: AudioParam, scaleDepth = false): OscillatorNode {
    const o = this.osc(w, rate);
    this.link(o, scaleDepth ? this.sgain(depth) : this.gain(depth)).connect(target);
    return o;
  }

  shaper(k: number): WaveShaperNode {
    return this.ws(this.res.curve(`d${k}`, (x) => ((1 + k) * x) / (1 + k * Math.abs(x))));
  }

  crusher(bits: number): WaveShaperNode {
    const q = 2 ** (bits - 1);
    return this.ws(this.res.curve(`c${bits}`, (x) => Math.round(x * q) / q));
  }

  /** Sparse positive spikes from a random signal (crackle modulator). */
  spiker(): WaveShaperNode {
    return this.ws(this.res.curve('spike', (x) => Math.max(0, Math.abs(x) - 0.7) * 3.3));
  }

  link(first: AudioNode, ...rest: AudioNode[]): AudioNode {
    let n = first;
    for (const m of rest) {
      n.connect(m);
      n = m;
    }
    return n;
  }

  // --- high level ----------------------------------------------------------

  tone(s: ToneSpec): void {
    const { ctx, p } = this;
    const t = this.t0 + (s.t ?? 0);
    const a = s.a ?? 0.002;
    const h = s.h ?? 0;
    const len = a + h + s.d;
    const end = t + len;
    const f = s.f * p;
    const f2 = s.f2 !== undefined ? s.f2 * p : undefined;
    const sw = s.sw ?? len;
    const o = new OscillatorNode(ctx, { type: s.w ?? 'sine', frequency: f, detune: s.det ?? 0 });
    if (f2 !== undefined) sweep(o.frequency, f, f2, t, sw);
    if (s.fm) {
      const { r, i, i2, w } = s.fm;
      const m = new OscillatorNode(ctx, { type: w ?? 'sine', frequency: f * r });
      if (f2 !== undefined) sweep(m.frequency, f * r, f2 * r, t, sw);
      const mg = new GainNode(ctx, { gain: i * f });
      if (i2 !== undefined) {
        mg.gain.setValueAtTime(i * f, t);
        mg.gain.linearRampToValueAtTime(i2 * (f2 ?? f), end);
      }
      m.connect(mg).connect(o.frequency);
      this.nodes.push(mg);
      this.start(m, t, end);
    }
    if (s.vib) this.lfo('sine', s.vib[0], s.vib[1], o.detune);
    this.start(o, t, end);
    this.shape(o, s, t, a, h, s.d);
  }

  noise(s: NoiseSpec): void {
    const t = this.t0 + (s.t ?? 0);
    const a = s.a ?? 0.001;
    const h = s.h ?? 0;
    const len = a + h + s.d;
    const r = (s.rate ?? 1) * this.p;
    const buffer = this.res.noise(s.c ?? 'white');
    const src = new AudioBufferSourceNode(this.ctx, { buffer, loop: true, playbackRate: r });
    if (s.rate2 !== undefined) sweep(src.playbackRate, r, s.rate2 * this.p, t, s.sw ?? len);
    this.start(src, t, t + len, Math.random() * (buffer.duration - 0.5));
    this.shape(src, s, t, a, h, s.d);
  }

  /** A shared processing bus; returns its input node (use as `to`). */
  bus(s: BusSpec = {}): GainNode {
    const input = this.gain(1);
    let n: AudioNode = input;
    if (s.dist !== undefined) n = this.link(n, this.shaper(s.dist));
    if (s.crush !== undefined) n = this.link(n, this.crusher(s.crush));
    const t = this.t0 + (s.t ?? 0);
    const a = s.a ?? 0.002;
    const h = s.h ?? 0;
    n = this.filters(n, s.fl, t, s.d !== undefined ? a + h + s.d : 0.5);
    if (s.gate) {
      const [rate, depth = 1, w = 'sawtooth'] = s.gate;
      const gg = this.gain(1 - depth / 2);
      this.lfo(w, rate, -depth / 2, gg.gain);
      n = this.link(n, gg);
    }
    const og = this.gain(s.d !== undefined ? 0 : (s.v ?? 1));
    if (s.d !== undefined) env(og.gain, t, a, h, s.d, s.v ?? 1);
    this.link(n, og).connect(s.to ?? this.out);
    return input;
  }

  /** Schedule stops for a one-shot (loops are stopped by their owner). */
  finish(): void {
    if (this.sustained) return;
    this.srcs.forEach((s, i) => s.stop(this.stops[i] ?? this.end));
  }

  // --- internals -----------------------------------------------------------

  private bufSrc(buffer: AudioBuffer, rate: number): AudioBufferSourceNode {
    const s = new AudioBufferSourceNode(this.ctx, { buffer, loop: true, playbackRate: rate * this.p });
    this.rate.push({ param: s.playbackRate, base: rate });
    this.start(s, this.t0, undefined, Math.random() * buffer.duration * 0.9);
    return s;
  }

  private ws(curve: Float32Array<ArrayBuffer>): WaveShaperNode {
    const n = new WaveShaperNode(this.ctx, { curve });
    this.nodes.push(n);
    return n;
  }

  private start(s: AudioScheduledSourceNode, t: number, stop?: number, offset?: number): void {
    if (offset !== undefined && s instanceof AudioBufferSourceNode) s.start(t, Math.max(0, offset));
    else s.start(t);
    this.srcs.push(s);
    this.stops.push(stop);
    this.nodes.push(s);
    if (stop !== undefined && stop > this.end) this.end = stop;
  }

  private shape(src: AudioNode, s: Shaping & { v: number }, t: number, a: number, h: number, d: number): void {
    const g = this.gain(0);
    let n: AudioNode = src;
    if (s.dist !== undefined || s.crush !== undefined) {
      // Envelope before the shaper: saturates at the peak, cleans up in the tail.
      n = this.link(n, g);
      env(g.gain, t, a, h, d, 1);
      if (s.dist !== undefined) n = this.link(n, this.shaper(s.dist));
      if (s.crush !== undefined) n = this.link(n, this.crusher(s.crush));
      n = this.filters(n, s.fl, t, a + h + d);
      n = this.link(n, this.gain(s.v));
    } else {
      n = this.filters(n, s.fl, t, a + h + d);
      n = this.link(n, g);
      env(g.gain, t, a, h, d, s.v);
    }
    n.connect(s.to ?? this.out);
  }

  private filters(n: AudioNode, fl: Filters | undefined, t: number, len: number): AudioNode {
    if (!fl) return n;
    for (const f of Array.isArray(fl) ? fl : [fl]) {
      const from = hzClamp(f.f * this.p);
      const bq = new BiquadFilterNode(this.ctx, { type: f.type, frequency: from, Q: f.q ?? 1, gain: f.g ?? 0 });
      if (f.f2 !== undefined) sweep(bq.frequency, from, hzClamp(f.f2 * this.p), t, f.sw ?? len);
      this.nodes.push(bq);
      n = this.link(n, bq);
    }
    return n;
  }
}

// ---------------------------------------------------------------------------
// Sound definitions
// ---------------------------------------------------------------------------

interface SoundMeta {
  /** Random pitch variation per play (+-fraction, default 0.04). */
  vary?: number;
  /** Reverb send (default 0.12). */
  rev?: number;
  /** Max concurrent instances; the oldest is cut (default 12). */
  max?: number;
  /** Min seconds between plays; extra calls are dropped. */
  gap?: number;
  /** Cull distance for positional plays (default CULL_DIST). */
  far?: number;
}

interface SoundDef extends SoundMeta {
  fn: (b: Builder) => void;
}

interface LoopDef {
  fn: (b: Builder) => void;
  fadeIn: number;
  fadeOut: number;
  rev?: number;
}

/** Mechanical click (mag, bolt, shell...). */
function click(b: Builder, t: number, f: number, v: number): void {
  b.noise({ t, d: 0.03, v, fl: { type: 'bandpass', f, q: 1.5 } });
  b.tone({ t, w: 'square', f: f * 0.7, d: 0.018, v: v * 0.15, fl: { type: 'highpass', f: 600 } });
}

function shotgun(b: Builder, s: number): void {
  const bus = b.bus({ dist: 10, v: 0.8, fl: { type: 'lowpass', f: 7000, f2: 500, sw: 0.4 * s } });
  b.noise({ d: 0.02, v: 1, fl: { type: 'highpass', f: 2500 }, to: bus });
  b.noise({ d: 0.35 * s, v: 1, to: bus });
  b.noise({ c: 'brown', d: 0.45 * s, v: 0.9, to: bus });
  b.tone({ f: 130 / s, f2: 38, sw: 0.18 * s, d: 0.35 * s, v: 1.1, to: bus });
  b.tone({ t: 0.005, w: 'triangle', f: 2150, d: 0.08, v: 0.03 });
}

function arShot(b: Builder, t: number, m: number, v: number): void {
  const bus = b.bus({ dist: 8, v: 0.8 * v });
  b.noise({ t, d: 0.012, v: 0.9, fl: { type: 'highpass', f: 3000 }, to: bus });
  b.noise({
    t,
    d: 0.2,
    v: 0.85,
    fl: [
      { type: 'highpass', f: 250 },
      { type: 'lowpass', f: 7500 * m, f2: 1100 * m, sw: 0.12 },
    ],
    to: bus,
  });
  b.noise({ t, c: 'pink', d: 0.14, v: 0.5, fl: { type: 'bandpass', f: 1100 * m, q: 0.9 }, to: bus });
  b.tone({ t, f: 170 * m, f2: 48, sw: 0.07, d: 0.18, v: 1, to: bus });
  b.tone({ t, w: 'sawtooth', f: 1100 * m, f2: 190, sw: 0.06, d: 0.06, v: 0.06 * v, fl: { type: 'lowpass', f: 3500 } });
}

const SOUNDS: Record<SfxOneShot, SoundDef> = {
  // --- weapons -------------------------------------------------------------

  mp_fire: {
    vary: 0.06,
    rev: 0.12,
    max: 8,
    fn: (b) => {
      const bus = b.bus({ dist: 5, v: 0.75 });
      b.noise({ d: 0.015, v: 0.9, fl: { type: 'highpass', f: 3500 }, to: bus });
      b.noise({
        d: 0.1,
        v: 0.7,
        fl: [
          { type: 'highpass', f: 700 },
          { type: 'lowpass', f: 9000, f2: 1800 },
        ],
        to: bus,
      });
      b.tone({ f: 260, f2: 75, sw: 0.05, d: 0.09, v: 0.8, to: bus });
      b.tone({ w: 'square', f: 1700, f2: 520, sw: 0.035, d: 0.035, v: 0.07, fl: { type: 'bandpass', f: 2400, q: 1.5 } });
    },
  },

  shotgun_fire: { vary: 0.05, rev: 0.25, max: 6, far: 8000, fn: (b) => shotgun(b, 1) },

  shotgun_double: {
    vary: 0.04,
    rev: 0.3,
    max: 4,
    far: 9000,
    fn: (b) => {
      shotgun(b, 1.4);
      b.noise({ t: 0.014, d: 0.3, v: 0.5, fl: { type: 'lowpass', f: 4000, f2: 400 } });
      b.tone({ f: 75, f2: 28, sw: 0.4, d: 0.7, v: 0.8 });
    },
  },

  ar_fire: { vary: 0.05, rev: 0.18, max: 8, fn: (b) => arShot(b, 0, 1, 1) },

  ar_burst: {
    vary: 0.04,
    rev: 0.18,
    max: 4,
    fn: (b) => {
      arShot(b, 0, 1, 1);
      arShot(b, 0.075, 0.99 + Math.random() * 0.02, 0.95);
      arShot(b, 0.15, 0.98 + Math.random() * 0.03, 0.9);
    },
  },

  minigun_fire: {
    vary: 0.04,
    rev: 0.15,
    max: 4,
    fn: (b) => {
      const bus = b.bus({ dist: 7, gate: [38, 1], a: 0.004, h: 0.12, d: 0.08, v: 0.8 });
      b.noise({
        h: 0.14,
        d: 0.06,
        v: 0.9,
        fl: [
          { type: 'highpass', f: 500 },
          { type: 'lowpass', f: 6000 },
        ],
        to: bus,
      });
      b.tone({ f: 85, h: 0.14, d: 0.06, v: 0.8, to: bus });
      b.tone({ w: 'square', f: 1250, h: 0.1, d: 0.05, v: 0.02, fl: { type: 'bandpass', f: 1800, q: 2 }, to: bus });
    },
  },

  katana_swing: {
    vary: 0.1,
    rev: 0.1,
    fn: (b) => {
      b.noise({ c: 'pink', a: 0.07, h: 0.03, d: 0.16, v: 1.1, fl: { type: 'bandpass', f: 450, f2: 2800, sw: 0.12, q: 2.2 } });
      b.noise({ a: 0.06, d: 0.12, v: 0.18, fl: { type: 'highpass', f: 5000 } });
      b.tone({ f: 2600, f2: 5200, sw: 0.12, a: 0.05, d: 0.12, v: 0.04 }); // mono-edge shimmer
    },
  },

  katana_hit: {
    vary: 0.08,
    rev: 0.15,
    fn: (b) => {
      b.noise({
        d: 0.1,
        v: 0.4,
        fl: [
          { type: 'highpass', f: 2200 },
          { type: 'peaking', f: 4200, q: 3, g: 6 },
        ],
      });
      b.noise({ c: 'pink', a: 0.003, d: 0.12, v: 0.4, fl: { type: 'bandpass', f: 3000, f2: 1400, q: 3 } });
      b.tone({ f: 180, f2: 60, sw: 0.06, d: 0.12, v: 0.7, dist: 3 });
      b.tone({ w: 'sawtooth', f: 3800, f2: 1900, sw: 0.08, d: 0.08, v: 0.035, fl: { type: 'highpass', f: 2000 } });
    },
  },

  katana_block: {
    vary: 0.06,
    rev: 0.3,
    fn: (b) => {
      // inharmonic bell/bar partials: [ratio, decay, level]
      const partials: [number, number, number][] = [
        [1, 0.9, 0.22],
        [1.51, 0.5, 0.08],
        [2.76, 0.6, 0.16],
        [5.4, 0.35, 0.1],
        [8.93, 0.2, 0.06],
      ];
      for (const [r, d, v] of partials) b.tone({ f: 620 * r, d, v });
      b.tone({ w: 'square', f: 810, fm: { r: 1.41, i: 3, i2: 0.1 }, d: 0.25, v: 0.07, fl: { type: 'bandpass', f: 2500 } });
      b.noise({ d: 0.03, v: 0.6, fl: { type: 'highpass', f: 2500 } });
    },
  },

  fist_punch: {
    vary: 0.08,
    rev: 0.12,
    fn: (b) => {
      b.tone({ f: 120, f2: 38, sw: 0.1, d: 0.25, v: 1, dist: 4 });
      b.noise({ c: 'brown', d: 0.12, v: 0.8, fl: { type: 'lowpass', f: 600 } });
      b.noise({ d: 0.02, v: 0.4, fl: { type: 'bandpass', f: 1800 } });
      // hydraulic release hiss
      b.noise({
        t: 0.05,
        a: 0.02,
        h: 0.04,
        d: 0.25,
        v: 0.22,
        fl: [
          { type: 'highpass', f: 2500 },
          { type: 'bandpass', f: 6500, f2: 3500, q: 0.8 },
        ],
      });
      b.tone({ t: 0.02, w: 'sawtooth', f: 340, f2: 180, sw: 0.12, d: 0.14, v: 0.05, fl: { type: 'lowpass', f: 1400 } });
    },
  },

  grenade_throw: {
    vary: 0.06,
    rev: 0.08,
    fn: (b) => {
      b.tone({ w: 'square', f: 3100, d: 0.012, v: 0.12, fl: { type: 'highpass', f: 1500 } }); // pin
      b.noise({ d: 0.01, v: 0.35, fl: { type: 'bandpass', f: 4000, q: 2 } });
      b.noise({ t: 0.04, c: 'pink', a: 0.05, d: 0.16, v: 0.8, fl: { type: 'bandpass', f: 600, f2: 1900, q: 1.8 } });
      b.tone({ t: 0.12, f: 2400, a: 0.002, h: 0.02, d: 0.03, v: 0.08 }); // armed beeps
      b.tone({ t: 0.18, f: 2400, a: 0.002, h: 0.02, d: 0.03, v: 0.08 });
    },
  },

  grenade_bounce: {
    vary: 0.12,
    rev: 0.12,
    max: 4,
    fn: (b) => {
      b.tone({ w: 'triangle', f: 1180, d: 0.09, v: 0.18 });
      b.tone({ f: 1870, d: 0.06, v: 0.1 });
      b.tone({ f: 3150, d: 0.04, v: 0.06 });
      b.tone({ f: 220, f2: 110, sw: 0.04, d: 0.06, v: 0.3 });
      b.noise({ d: 0.025, v: 0.35, fl: { type: 'bandpass', f: 2600, q: 1.2 } });
    },
  },

  frag_explode: {
    vary: 0.08,
    rev: 0.45,
    max: 4,
    far: 14000,
    fn: (b) => {
      const bus = b.bus({ dist: 14, v: 0.7, fl: { type: 'lowpass', f: 5000, f2: 180, sw: 1.4 } });
      b.noise({ d: 1.2, v: 1, to: bus });
      b.noise({ c: 'brown', rate: 0.6, a: 0.01, h: 0.1, d: 2.2, v: 1, to: bus });
      b.noise({ d: 0.05, v: 0.7, fl: { type: 'highpass', f: 1200 } }); // crack
      b.tone({ f: 160, f2: 42, sw: 0.14, d: 0.35, v: 0.7 }); // punch
      b.tone({ f: 62, f2: 24, sw: 1.2, a: 0.01, d: 2, v: 0.8 }); // sub tail
      b.noise({ t: 0.12, c: 'brown', a: 0.2, d: 1.6, v: 0.5, fl: { type: 'lowpass', f: 260 } }); // rolling rumble
      b.noise({ t: 0.06, a: 0.05, d: 0.9, v: 0.1, fl: { type: 'bandpass', f: 3500, q: 0.8 } }); // debris sizzle
    },
  },

  emp_explode: {
    vary: 0.05,
    rev: 0.4,
    max: 4,
    far: 10000,
    fn: (b) => {
      const zap = b.bus({ dist: 25, v: 0.35, fl: { type: 'bandpass', f: 2200, f2: 700, q: 0.7, sw: 0.5 } });
      b.tone({ w: 'sawtooth', f: 90, fm: { r: 7.3, i: 25, i2: 2 }, a: 0.003, d: 0.55, v: 1, to: zap });
      const crackle = b.bus({ gate: [27, 1, 'square'], v: 0.4, fl: { type: 'highpass', f: 1500 } });
      b.noise({ a: 0.002, h: 0.1, d: 0.5, v: 1, to: crackle });
      // descending whine
      b.tone({ f: 3400, f2: 110, sw: 1.7, a: 0.01, h: 0.1, d: 1.8, v: 0.18, vib: [11, 35] });
      b.tone({ w: 'triangle', f: 1700, f2: 55, sw: 1.7, a: 0.01, h: 0.1, d: 1.6, v: 0.08 });
      b.tone({ f: 100, f2: 32, sw: 0.25, d: 0.5, v: 0.9 });
      b.noise({ d: 0.03, v: 0.7, fl: { type: 'highpass', f: 2000 } });
    },
  },

  reload: {
    vary: 0.04,
    rev: 0.08,
    max: 3,
    fn: (b) => {
      click(b, 0, 1800, 0.35); // mag release
      b.noise({ t: 0.06, c: 'pink', a: 0.02, d: 0.14, v: 0.18, fl: { type: 'bandpass', f: 1300, f2: 2500, q: 3 } });
      click(b, 0.34, 1300, 0.5); // mag in
      b.tone({ t: 0.34, f: 320, f2: 150, sw: 0.04, d: 0.06, v: 0.3 });
      click(b, 0.56, 2300, 0.4); // bolt back
      b.noise({ t: 0.58, c: 'pink', a: 0.01, d: 0.06, v: 0.15, fl: { type: 'bandpass', f: 2800, q: 3 } });
      click(b, 0.64, 1600, 0.5); // bolt forward
      b.tone({ t: 0.72, f: 2600, d: 0.05, v: 0.05 }); // smartgun ready chirp
      b.tone({ t: 0.78, f: 3500, d: 0.07, v: 0.05 });
    },
  },

  reload_shell: {
    vary: 0.08,
    rev: 0.08,
    max: 3,
    fn: (b) => {
      b.noise({ c: 'pink', a: 0.01, d: 0.05, v: 0.2, fl: { type: 'bandpass', f: 1500, f2: 3200, q: 2.5 } });
      click(b, 0.05, 2100, 0.45);
      b.tone({ t: 0.05, f: 540, f2: 320, sw: 0.03, d: 0.05, v: 0.22 });
    },
  },

  dry_fire: {
    vary: 0.05,
    rev: 0.05,
    gap: 0.05,
    fn: (b) => {
      b.tone({ w: 'square', f: 2600, d: 0.012, v: 0.12, fl: { type: 'highpass', f: 1200 } });
      b.noise({ d: 0.015, v: 0.3, fl: { type: 'bandpass', f: 4200, q: 2 } });
      b.tone({ f: 420, d: 0.025, v: 0.12 });
    },
  },

  weapon_switch: {
    vary: 0.05,
    rev: 0.05,
    max: 2,
    fn: (b) => {
      b.noise({ c: 'pink', a: 0.025, d: 0.1, v: 0.4, fl: { type: 'bandpass', f: 900, f2: 2200, q: 1.5 } });
      click(b, 0.1, 1700, 0.55);
      b.tone({ t: 0.12, w: 'triangle', f: 1200, f2: 2400, sw: 0.05, d: 0.06, v: 0.08 });
    },
  },

  turret_fire: {
    vary: 0.05,
    rev: 0.15,
    max: 8,
    fn: (b) => {
      const bus = b.bus({ dist: 6, v: 0.6 });
      b.tone({ w: 'sawtooth', f: 1900, f2: 260, sw: 0.09, d: 0.12, v: 0.5, fl: { type: 'lowpass', f: 4500 }, to: bus });
      b.tone({ w: 'square', f: 950, f2: 180, sw: 0.08, d: 0.08, v: 0.2, to: bus });
      b.noise({
        d: 0.05,
        v: 0.6,
        fl: [
          { type: 'highpass', f: 1500 },
          { type: 'lowpass', f: 8000, f2: 2000 },
        ],
        to: bus,
      });
      b.tone({ f: 210, f2: 60, sw: 0.05, d: 0.08, v: 0.6, to: bus });
    },
  },

  bullet_impact: {
    vary: 0.18,
    rev: 0.1,
    max: 10,
    fn: (b) => {
      b.noise({ d: 0.06, v: 0.45, fl: { type: 'bandpass', f: 2600, f2: 1200, q: 0.9 } });
      b.noise({ d: 0.02, v: 0.25, fl: { type: 'highpass', f: 5000 } });
      b.tone({ f: 340, f2: 110, sw: 0.03, d: 0.05, v: 0.3 });
      b.noise({ t: 0.025, d: 0.05, v: 0.06, fl: { type: 'bandpass', f: 5500, q: 2 } });
    },
  },

  ricochet: {
    vary: 0.1,
    rev: 0.25,
    max: 6,
    fn: (b) => {
      const f = b.rnd(3200, 4600);
      b.noise({ d: 0.03, v: 0.35, fl: { type: 'bandpass', f: 3000 } });
      b.tone({ f, f2: f * 0.42, sw: 0.4, a: 0.004, d: 0.45, v: 0.16, vib: [38, 30] });
      b.tone({ w: 'triangle', f: f * 1.5, f2: f * 0.6, sw: 0.3, a: 0.004, d: 0.25, v: 0.04 });
    },
  },

  // --- movement ------------------------------------------------------------

  footstep: {
    vary: 0.15,
    rev: 0.05,
    max: 8,
    fn: (b) => {
      b.noise({ c: 'pink', a: 0.004, d: 0.1, v: 0.3, fl: { type: 'lowpass', f: 900 } });
      b.tone({ f: 130, f2: 70, sw: 0.04, d: 0.07, v: 0.15 });
      b.noise({ t: 0.005, d: 0.025, v: 0.04, fl: { type: 'bandpass', f: 3800, q: 1.5 } });
    },
  },

  jump: {
    vary: 0.08,
    rev: 0.05,
    fn: (b) => {
      b.noise({ c: 'pink', a: 0.012, d: 0.14, v: 0.2, fl: { type: 'bandpass', f: 600, f2: 1500, q: 1.4 } });
      b.tone({ f: 150, f2: 90, sw: 0.05, d: 0.08, v: 0.2 });
      b.tone({ t: 0.01, w: 'sawtooth', f: 260, f2: 420, sw: 0.08, a: 0.01, d: 0.08, v: 0.025, fl: { type: 'lowpass', f: 1400 } });
    },
  },

  land: {
    vary: 0.1,
    rev: 0.06,
    fn: (b) => {
      b.tone({ f: 115, f2: 48, sw: 0.06, d: 0.14, v: 0.45 });
      b.noise({ c: 'brown', d: 0.1, v: 0.5, fl: { type: 'lowpass', f: 600 } });
      b.noise({ d: 0.03, v: 0.08, fl: { type: 'bandpass', f: 3000 } });
    },
  },

  land_hard: {
    vary: 0.08,
    rev: 0.12,
    fn: (b) => {
      b.tone({ f: 90, f2: 32, sw: 0.12, d: 0.35, v: 0.9, dist: 3 });
      b.noise({ c: 'brown', d: 0.3, v: 0.8, fl: { type: 'lowpass', f: 500 } });
      b.noise({ d: 0.07, v: 0.3, fl: { type: 'bandpass', f: 1600, q: 0.8 } });
      b.tone({ t: 0.01, w: 'triangle', f: 720, d: 0.14, v: 0.05 });
      b.tone({ t: 0.01, w: 'triangle', f: 1135, d: 0.1, v: 0.04 });
      b.noise({ t: 0.03, a: 0.01, d: 0.15, v: 0.08, fl: { type: 'highpass', f: 3000 } }); // hydraulic absorb
    },
  },

  boost_charge: {
    vary: 0.02,
    rev: 0.1,
    max: 2,
    fn: (b) => {
      b.tone({
        w: 'sawtooth',
        f: 110,
        f2: 880,
        sw: 0.6,
        a: 0.08,
        h: 0.45,
        d: 0.12,
        v: 0.18,
        fl: { type: 'bandpass', f: 400, f2: 3200, sw: 0.6, q: 2.5 },
      });
      b.tone({ f: 220, f2: 1760, sw: 0.6, a: 0.08, h: 0.45, d: 0.12, v: 0.1, vib: [14, 25] });
      b.noise({ a: 0.4, h: 0.1, d: 0.1, v: 0.08, fl: { type: 'bandpass', f: 1500, f2: 6000, sw: 0.6, q: 1.5 } });
    },
  },

  boost_jump: {
    vary: 0.06,
    rev: 0.15,
    fn: (b) => {
      const bus = b.bus({ dist: 3, v: 0.8 });
      b.noise({ a: 0.01, h: 0.08, d: 0.45, v: 0.7, fl: { type: 'bandpass', f: 700, f2: 2600, sw: 0.25, q: 0.9 }, to: bus });
      b.noise({ c: 'brown', a: 0.01, h: 0.05, d: 0.45, v: 0.7, fl: { type: 'lowpass', f: 400 }, to: bus });
      b.tone({ f: 95, f2: 45, sw: 0.3, d: 0.35, v: 0.6, to: bus });
      b.tone({ w: 'sawtooth', f: 210, f2: 130, sw: 0.35, a: 0.01, d: 0.35, v: 0.06, fl: { type: 'lowpass', f: 900 }, to: bus });
    },
  },

  ledge_grab: {
    vary: 0.08,
    rev: 0.08,
    fn: (b) => {
      b.noise({ d: 0.05, v: 0.4, fl: { type: 'bandpass', f: 1900, q: 1.2 } });
      b.tone({ w: 'triangle', f: 640, f2: 520, sw: 0.05, d: 0.09, v: 0.16 });
      b.tone({ f: 140, f2: 80, sw: 0.04, d: 0.07, v: 0.3 });
      b.tone({ t: 0.04, w: 'sawtooth', f: 220, f2: 360, sw: 0.14, a: 0.02, d: 0.14, v: 0.05, fl: { type: 'lowpass', f: 1500 } });
    },
  },

  slide: {
    vary: 0.08,
    rev: 0.06,
    max: 3,
    fn: (b) => {
      b.noise({ c: 'pink', a: 0.03, h: 0.2, d: 0.25, v: 0.3, fl: { type: 'bandpass', f: 1900, f2: 800, q: 1.3 } });
      b.noise({ c: 'brown', a: 0.03, h: 0.2, d: 0.25, v: 0.3, fl: { type: 'lowpass', f: 300 } });
      b.noise({ a: 0.05, h: 0.15, d: 0.2, v: 0.04, fl: { type: 'highpass', f: 6000 } });
    },
  },

  // --- player --------------------------------------------------------------

  hit_beep: {
    // Short, pure and nearly fixed-pitch so rapid repeats read as a crisp ticker.
    vary: 0.004,
    rev: 0,
    max: 6,
    gap: 0.018,
    fn: (b) => {
      b.tone({ w: 'triangle', f: 1975, a: 0.001, h: 0.018, d: 0.045, v: 0.3 });
      b.tone({ f: 3950, a: 0.001, h: 0.01, d: 0.025, v: 0.06 });
    },
  },

  kill_confirm: {
    vary: 0,
    rev: 0.1,
    max: 3,
    fn: (b) => {
      b.tone({ w: 'square', f: hz(88), a: 0.002, h: 0.04, d: 0.06, v: 0.1, fl: { type: 'lowpass', f: 4500 } });
      b.tone({ t: 0.075, w: 'square', f: hz(95), a: 0.002, h: 0.06, d: 0.25, v: 0.1, fl: { type: 'lowpass', f: 5000 } });
      b.tone({ t: 0.075, f: hz(107), a: 0.002, d: 0.25, v: 0.05 });
      b.tone({ f: 180, f2: 70, sw: 0.06, d: 0.12, v: 0.35 });
    },
  },

  pain: {
    vary: 0.1,
    rev: 0.08,
    max: 3,
    fn: (b) => {
      b.tone({ f: 140, f2: 55, sw: 0.08, d: 0.14, v: 0.55 });
      b.noise({ c: 'pink', d: 0.07, v: 0.3, fl: { type: 'bandpass', f: 900 } });
      // implant damage buzz
      b.tone({ w: 'square', f: 95, f2: 70, sw: 0.14, a: 0.005, h: 0.05, d: 0.1, v: 0.12, dist: 8, fl: { type: 'bandpass', f: 800, q: 1.5 } });
      // grunt-ish formant
      b.tone({ w: 'sawtooth', f: 185, f2: 125, sw: 0.18, a: 0.015, h: 0.05, d: 0.15, v: 0.06, fl: { type: 'bandpass', f: 700, q: 4 } });
    },
  },

  death: {
    vary: 0.05,
    rev: 0.25,
    max: 3,
    fn: (b) => {
      b.tone({ f: 100, f2: 30, sw: 0.3, d: 0.45, v: 0.85 });
      b.noise({ c: 'brown', d: 0.35, v: 0.6, fl: { type: 'lowpass', f: 500 } });
      // systems failing
      b.tone({
        w: 'sawtooth',
        f: 240,
        f2: 38,
        sw: 0.9,
        a: 0.01,
        h: 0.2,
        d: 0.8,
        v: 0.18,
        dist: 10,
        fl: { type: 'lowpass', f: 2400, f2: 250, sw: 1 },
      });
      b.tone({ t: 0.35, w: 'triangle', f: 988, a: 0.01, h: 0.55, d: 0.35, v: 0.06 }); // flatline
      const glitch = b.bus({ gate: [16, 1, 'square'], v: 0.15, fl: { type: 'bandpass', f: 2500 } });
      b.noise({ a: 0.01, h: 0.2, d: 0.2, v: 1, crush: 3, to: glitch });
    },
  },

  heal: {
    vary: 0.01,
    rev: 0.3,
    max: 3,
    fn: (b) => {
      [84, 91, 96].forEach((m, i) => {
        b.tone({ t: i * 0.06, f: hz(m), a: 0.004, d: 0.6, v: 0.1 });
        b.tone({ t: i * 0.06, f: hz(m) * 2.005, a: 0.004, d: 0.3, v: 0.03 });
      });
      b.noise({ a: 0.12, d: 0.35, v: 0.025, fl: { type: 'highpass', f: 7000 } });
    },
  },

  spawn: {
    vary: 0.03,
    rev: 0.3,
    max: 4,
    fn: (b) => {
      b.tone({
        w: 'sawtooth',
        f: 90,
        f2: 720,
        sw: 0.35,
        a: 0.2,
        h: 0.1,
        d: 0.25,
        v: 0.12,
        fl: { type: 'lowpass', f: 300, f2: 4500, sw: 0.35, q: 6 },
      });
      b.tone({ t: 0.3, f: 1320, fm: { r: 3.5, i: 1.5, i2: 0 }, a: 0.003, d: 0.6, v: 0.1 });
      b.tone({ t: 0.3, f: 70, f2: 40, sw: 0.3, d: 0.5, v: 0.5 });
      b.noise({ a: 0.25, d: 0.12, v: 0.08, fl: { type: 'bandpass', f: 1500, f2: 7000, sw: 0.3, q: 1.2 } });
    },
  },

  wave_warning: {
    vary: 0,
    rev: 0.05,
    gap: 0.1,
    fn: (b) => {
      b.tone({ w: 'square', f: 880, a: 0.003, h: 0.08, d: 0.07, v: 0.1, fl: { type: 'lowpass', f: 3200 } });
      b.tone({ f: 1760, a: 0.003, h: 0.06, d: 0.05, v: 0.05 });
    },
  },

  stealth_on: {
    vary: 0.03,
    rev: 0.25,
    max: 3,
    fn: (b) => {
      b.tone({ f: 2400, f2: 520, sw: 0.45, fm: { r: 1.5, i: 1.8, i2: 0 }, a: 0.01, d: 0.55, v: 0.1 });
      b.noise({ a: 0.03, d: 0.45, v: 0.12, fl: { type: 'bandpass', f: 7000, f2: 1400, sw: 0.4, q: 2 } });
      b.tone({ f: 150, f2: 60, sw: 0.3, d: 0.35, v: 0.2 });
    },
  },

  stealth_off: {
    vary: 0.03,
    rev: 0.25,
    max: 3,
    fn: (b) => {
      b.tone({ f: 520, f2: 2400, sw: 0.3, fm: { r: 1.5, i: 0, i2: 1.8 }, a: 0.15, d: 0.2, v: 0.1 });
      b.noise({ a: 0.2, d: 0.15, v: 0.12, fl: { type: 'bandpass', f: 1400, f2: 7000, sw: 0.3, q: 2 } });
      b.noise({ t: 0.3, d: 0.03, v: 0.3, fl: { type: 'highpass', f: 1500 } });
      b.tone({ t: 0.3, f: 170, f2: 70, sw: 0.06, d: 0.12, v: 0.3 });
    },
  },

  thermal_on: {
    vary: 0.02,
    rev: 0.05,
    max: 2,
    fn: (b) => {
      b.tone({ w: 'square', f: 180, f2: 1400, sw: 0.14, a: 0.005, d: 0.16, v: 0.07, fl: { type: 'lowpass', f: 2600 } });
      b.tone({ t: 0.12, f: 2960, a: 0.003, h: 0.04, d: 0.12, v: 0.08 });
      b.noise({ a: 0.005, d: 0.14, v: 0.06, fl: { type: 'highpass', f: 4000 } });
      b.tone({ w: 'sawtooth', f: 60, h: 0.1, d: 0.2, v: 0.12, fl: { type: 'lowpass', f: 250 } }); // power hum
    },
  },

  tac_ping: {
    vary: 0.01,
    rev: 0.7,
    max: 3,
    far: 10000,
    fn: (b) => {
      b.tone({ f: 1480, f2: 1400, sw: 1.2, fm: { r: 2, i: 0.25, i2: 0 }, a: 0.003, d: 1.3, v: 0.22 });
      b.tone({ f: 2960, a: 0.003, d: 0.35, v: 0.04 });
      b.noise({ d: 0.02, v: 0.12, fl: { type: 'bandpass', f: 1500, q: 3 } });
    },
  },

  emp_hit: {
    vary: 0.05,
    rev: 0.15,
    max: 3,
    fn: (b) => {
      const st = b.bus({ gate: [19, 0.9, 'square'], dist: 6, v: 0.35, fl: { type: 'bandpass', f: 2400, q: 0.6 } });
      b.noise({ a: 0.003, h: 0.25, d: 0.45, v: 1, to: st });
      b.noise({ a: 0.003, h: 0.1, d: 0.3, v: 0.2, crush: 2, fl: { type: 'highpass', f: 1000 } });
      b.tone({ w: 'square', f: 55, h: 0.3, d: 0.3, v: 0.08, dist: 5, fl: { type: 'lowpass', f: 900 } });
      b.tone({ w: 'sawtooth', f: 1800, f2: 400, sw: 0.5, a: 0.005, d: 0.5, v: 0.05, vib: [23, 80] });
    },
  },

  // --- cyber ---------------------------------------------------------------

  jack_in: {
    vary: 0.02,
    rev: 0.35,
    max: 2,
    fn: (b) => {
      b.tone({ f: 55, a: 0.02, d: 0.6, v: 0.45 });
      b.tone({
        w: 'sawtooth',
        f: 70,
        f2: 1500,
        sw: 0.85,
        fm: { r: 0.5, i: 1, i2: 4 },
        a: 0.08,
        h: 0.6,
        d: 0.3,
        v: 0.12,
        crush: 5,
        fl: { type: 'bandpass', f: 300, f2: 5000, sw: 0.85, q: 2.5 },
      });
      b.noise({ a: 0.6, h: 0.1, d: 0.25, v: 0.1, fl: { type: 'highpass', f: 800, f2: 7000, sw: 0.8 } });
      for (let i = 0; i < 6; i++) {
        b.tone({ t: 0.1 + i * 0.11, w: 'square', f: hz(72 + i * 5), a: 0.002, d: 0.05, v: 0.04, fl: { type: 'lowpass', f: 5000 } });
      }
      b.tone({ t: 0.8, f: 1760, f2: 3520, sw: 0.15, a: 0.005, d: 0.4, v: 0.1 });
      b.noise({ t: 0.8, d: 0.25, v: 0.2, fl: { type: 'bandpass', f: 5000 } });
    },
  },

  jack_out: {
    vary: 0.02,
    rev: 0.3,
    max: 2,
    fn: (b) => {
      b.tone({
        w: 'sawtooth',
        f: 1500,
        f2: 60,
        sw: 0.7,
        fm: { r: 0.5, i: 4, i2: 1 },
        a: 0.01,
        h: 0.4,
        d: 0.35,
        v: 0.12,
        crush: 5,
        fl: { type: 'bandpass', f: 5000, f2: 250, sw: 0.7, q: 2.5 },
      });
      b.noise({ a: 0.01, d: 0.6, v: 0.12, fl: { type: 'highpass', f: 7000, f2: 500, sw: 0.6 } });
      for (let i = 0; i < 5; i++) {
        b.tone({ t: i * 0.1, w: 'square', f: hz(96 - i * 5), a: 0.002, d: 0.05, v: 0.04, fl: { type: 'lowpass', f: 5000 } });
      }
      b.tone({ t: 0.6, f: 110, f2: 38, sw: 0.25, d: 0.45, v: 0.6 }); // back in the meat
      b.noise({ t: 0.6, c: 'brown', d: 0.3, v: 0.4, fl: { type: 'lowpass', f: 400 } });
    },
  },

  eject: {
    vary: 0.03,
    rev: 0.2,
    max: 2,
    fn: (b) => {
      const g = b.bus({ gate: [13, 1, 'square'], dist: 20, v: 0.3, fl: { type: 'lowpass', f: 6000 } });
      b.noise({ a: 0.002, h: 0.35, d: 0.3, v: 1, crush: 3, to: g });
      b.tone({ w: 'square', f: 900, f2: 40, sw: 0.5, a: 0.002, h: 0.2, d: 0.35, v: 0.5, to: g });
      for (let i = 0; i < 7; i++) {
        b.tone({ t: b.rnd(0, 0.45), w: 'square', f: b.rnd(300, 3000), a: 0.001, h: b.rnd(0.01, 0.04), d: 0.02, v: 0.08 });
      }
      b.tone({ f: 80, f2: 30, sw: 0.3, d: 0.5, v: 0.7, dist: 6 });
    },
  },

  cyber_hitscan: {
    vary: 0.04,
    rev: 0.3,
    max: 8,
    fn: (b) => {
      b.tone({ f: 1900, f2: 1250, sw: 0.5, fm: { r: 3.01, i: 3.5, i2: 0.1 }, a: 0.002, d: 0.6, v: 0.18 });
      b.tone({
        w: 'sawtooth',
        f: 6200,
        f2: 700,
        sw: 0.18,
        a: 0.001,
        d: 0.22,
        v: 0.07,
        fl: { type: 'bandpass', f: 4500, f2: 900, sw: 0.18, q: 6 },
      });
      b.noise({ a: 0.001, d: 0.2, v: 0.25, fl: { type: 'highpass', f: 4500, f2: 1500, sw: 0.2 } });
      b.tone({ f: 130, f2: 45, sw: 0.1, d: 0.2, v: 0.5 });
      b.tone({ f: 5200, a: 0.001, d: 0.35, v: 0.03, vib: [45, 60] }); // spiral shimmer
    },
  },

  cyber_proj: {
    vary: 0.06,
    rev: 0.2,
    max: 8,
    fn: (b) => {
      b.tone({ f: 260, f2: 980, sw: 0.12, fm: { r: 2, i: 1.2, i2: 0.2 }, a: 0.004, d: 0.28, v: 0.25 });
      b.tone({ w: 'square', f: 130, f2: 490, sw: 0.12, a: 0.004, d: 0.16, v: 0.06, fl: { type: 'lowpass', f: 1600 } });
      b.noise({ a: 0.004, d: 0.1, v: 0.12, fl: { type: 'bandpass', f: 1400, f2: 4000, q: 2 } });
    },
  },

  cyber_explode: {
    vary: 0.06,
    rev: 0.45,
    max: 5,
    far: 10000,
    fn: (b) => {
      const bus = b.bus({ dist: 4, crush: 4, v: 0.7, fl: { type: 'lowpass', f: 7000, f2: 350, sw: 0.7 } });
      b.noise({ a: 0.001, d: 0.7, v: 1, to: bus });
      b.tone({ w: 'square', f: 440, f2: 45, sw: 0.35, d: 0.45, v: 0.5, to: bus });
      b.tone({ f: 90, f2: 30, sw: 0.5, d: 0.8, v: 1 });
      let t = 0.04;
      for (let i = 0; i < 5; i++) {
        b.tone({ t, w: 'square', f: b.rnd(900, 3200), a: 0.001, d: 0.05, v: 0.05, fl: { type: 'lowpass', f: 6000 } });
        t += b.rnd(0.03, 0.06);
      }
      b.tone({ f: 2200, f2: 300, sw: 0.4, fm: { r: 1.99, i: 2, i2: 0 }, a: 0.002, d: 0.45, v: 0.08 });
    },
  },

  cyber_bounce: {
    vary: 0.12,
    rev: 0.15,
    max: 6,
    fn: (b) => {
      b.tone({ f: 1250, f2: 420, sw: 0.09, a: 0.002, d: 0.14, v: 0.22, vib: [30, 40] });
      b.tone({ w: 'triangle', f: 2500, f2: 840, sw: 0.06, a: 0.002, d: 0.07, v: 0.06 });
    },
  },

  cyber_pad: {
    vary: 0.04,
    rev: 0.3,
    max: 4,
    fn: (b) => {
      b.tone({ f: 85, f2: 40, sw: 0.15, d: 0.3, v: 0.7 });
      b.tone({
        w: 'sawtooth',
        f: 110,
        f2: 1300,
        sw: 0.3,
        a: 0.005,
        h: 0.12,
        d: 0.25,
        v: 0.1,
        fl: { type: 'bandpass', f: 400, f2: 4000, sw: 0.3, q: 3 },
      });
      b.noise({ a: 0.01, h: 0.08, d: 0.3, v: 0.25, fl: { type: 'bandpass', f: 500, f2: 4500, sw: 0.3 } });
      for (let i = 0; i < 3; i++) {
        b.tone({ t: i * 0.05, w: 'square', f: hz(79 + i * 7), a: 0.002, d: 0.06, v: 0.05, fl: { type: 'lowpass', f: 5000 } });
      }
    },
  },

  crystal_pickup: {
    vary: 0.015,
    rev: 0.3,
    max: 4,
    fn: (b) => {
      [91, 96, 100, 103].forEach((m, i) => {
        b.tone({ t: i * 0.035, f: hz(m), fm: { r: 3.5, i: 0.4, i2: 0 }, a: 0.002, d: 0.35, v: 0.09 });
      });
      b.noise({ a: 0.02, d: 0.25, v: 0.03, fl: { type: 'highpass', f: 8000 } });
    },
  },

  program_step: {
    vary: 0,
    rev: 0.03,
    gap: 0.02,
    fn: (b) => {
      const r = [1, 1.25, 1.5, 2][Math.floor(Math.random() * 4)] ?? 1;
      b.tone({ w: 'square', f: 1050 * r, a: 0.001, h: 0.012, d: 0.035, v: 0.07, fl: { type: 'lowpass', f: 4500 } });
    },
  },

  program_done: {
    vary: 0,
    rev: 0.2,
    max: 3,
    fn: (b) => {
      [72, 76, 79, 84].forEach((m, i) => {
        const last = i === 3;
        const d = last ? 0.4 : 0.08;
        b.tone({ t: i * 0.07, w: 'square', f: hz(m), a: 0.002, h: last ? 0.1 : 0.03, d, v: 0.1, fl: { type: 'lowpass', f: 4000 } });
        b.tone({ t: i * 0.07, f: hz(m + 12), a: 0.002, d, v: 0.04 });
      });
    },
  },

  program_fail: {
    vary: 0,
    rev: 0.1,
    max: 2,
    fn: (b) => {
      for (const t of [0, 0.2]) {
        b.tone({ t, w: 'sawtooth', f: 110, a: 0.004, h: 0.12, d: 0.05, v: 0.14, dist: 4, fl: { type: 'lowpass', f: 1800 } });
        b.tone({ t, w: 'square', f: 116.5, a: 0.004, h: 0.12, d: 0.05, v: 0.06, fl: { type: 'lowpass', f: 1400 } });
      }
    },
  },

  node_captured: {
    vary: 0,
    rev: 0.3,
    max: 2,
    fn: (b) => {
      [67, 72, 76, 79].forEach((m, i) => {
        b.tone({ t: i * 0.06, w: 'square', f: hz(m), a: 0.002, h: 0.03, d: 0.1, v: 0.07, fl: { type: 'lowpass', f: 4500 } });
      });
      for (const m of [72, 79, 84]) {
        b.tone({
          t: 0.24,
          w: 'sawtooth',
          f: hz(m),
          det: b.rnd(-6, 6),
          a: 0.02,
          h: 0.25,
          d: 0.5,
          v: 0.06,
          fl: { type: 'lowpass', f: 800, f2: 4000, sw: 0.3 },
        });
      }
      b.tone({ t: 0.24, f: 65, d: 0.6, v: 0.35 });
      b.noise({ t: 0.24, a: 0.01, d: 0.4, v: 0.05, fl: { type: 'highpass', f: 6000 } });
    },
  },

  ice_wedge: {
    vary: 0.05,
    rev: 0.3,
    max: 4,
    fn: (b) => {
      b.tone({ f: 720, fm: { r: 2.41, i: 3, i2: 0 }, a: 0.002, d: 0.45, v: 0.18 });
      b.noise({ d: 0.1, v: 0.3, fl: { type: 'bandpass', f: 3200, q: 3 } });
      b.tone({ f: 160, f2: 70, sw: 0.06, d: 0.18, v: 0.45 });
      b.tone({ f: 3300, a: 0.002, d: 0.3, v: 0.04 });
      b.tone({ f: 4870, a: 0.002, d: 0.2, v: 0.025 });
    },
  },

  ice_break: {
    vary: 0.06,
    rev: 0.35,
    max: 4,
    fn: (b) => {
      b.noise({
        a: 0.001,
        d: 0.55,
        v: 0.5,
        fl: [
          { type: 'highpass', f: 2200 },
          { type: 'lowpass', f: 12000, f2: 3000 },
        ],
      });
      b.tone({ f: 220, f2: 60, sw: 0.08, d: 0.22, v: 0.45 });
      for (let i = 0; i < 10; i++) {
        b.tone({ t: b.rnd(0, 0.28), f: b.rnd(2500, 7500), a: 0.001, d: b.rnd(0.08, 0.3), v: b.rnd(0.03, 0.07) });
      }
      b.tone({ f: 900, fm: { r: 1.73, i: 4, i2: 0 }, a: 0.001, d: 0.3, v: 0.1 });
    },
  },

  alarm: {
    vary: 0,
    rev: 0.2,
    max: 2,
    fn: (b) => {
      b.tone({ w: 'square', f: 960, a: 0.004, h: 0.14, d: 0.05, v: 0.16, fl: { type: 'lowpass', f: 3000 } });
      b.tone({ t: 0.19, w: 'square', f: 720, a: 0.004, h: 0.14, d: 0.05, v: 0.16, fl: { type: 'lowpass', f: 3000 } });
      b.tone({ w: 'sawtooth', f: 480, a: 0.004, h: 0.33, d: 0.05, v: 0.03, fl: { type: 'lowpass', f: 1500 } });
    },
  },

  // --- world / ui ----------------------------------------------------------

  door_move: {
    vary: 0.05,
    rev: 0.2,
    max: 6,
    fn: (b) => {
      // pneumatic release
      b.noise({
        a: 0.01,
        h: 0.05,
        d: 0.35,
        v: 0.22,
        fl: [
          { type: 'highpass', f: 1800 },
          { type: 'bandpass', f: 5000, f2: 2500, q: 0.8 },
        ],
      });
      // servo
      b.tone({ w: 'sawtooth', f: 170, f2: 235, sw: 0.5, a: 0.06, h: 0.45, d: 0.2, v: 0.08, vib: [28, 20], fl: { type: 'lowpass', f: 900 } });
      b.tone({ w: 'square', f: 340, f2: 470, sw: 0.5, a: 0.06, h: 0.45, d: 0.2, v: 0.02, fl: { type: 'bandpass', f: 1200, q: 2 } });
      b.noise({ c: 'brown', a: 0.05, h: 0.4, d: 0.2, v: 0.15, fl: { type: 'lowpass', f: 250 } });
      // end clunk
      b.tone({ t: 0.72, f: 130, f2: 55, sw: 0.06, d: 0.18, v: 0.45 });
      b.noise({ t: 0.72, d: 0.06, v: 0.25, fl: { type: 'bandpass', f: 900 } });
    },
  },

  capture: {
    vary: 0,
    rev: 0.3,
    max: 2,
    fn: (b) => {
      const brass = (t: number, m: number, h: number, d: number, v: number): void => {
        b.tone({ t, w: 'sawtooth', f: hz(m), a: 0.015, h, d, v, fl: { type: 'lowpass', f: 900, f2: 3500, sw: 0.08 } });
        b.tone({ t, w: 'sawtooth', f: hz(m), det: 9, a: 0.015, h, d, v: v * 0.7, fl: { type: 'lowpass', f: 2000 } });
      };
      brass(0, 72, 0.06, 0.08, 0.07);
      brass(0.11, 76, 0.06, 0.08, 0.07);
      brass(0.22, 79, 0.06, 0.08, 0.07);
      for (const m of [72, 76, 79, 84]) brass(0.33, m, 0.35, 0.7, 0.05);
      b.tone({ t: 0.33, f: 65, d: 0.9, v: 0.4 });
      b.noise({ t: 0.33, a: 0.01, d: 0.6, v: 0.04, fl: { type: 'highpass', f: 7000 } });
    },
  },

  denied: {
    vary: 0,
    rev: 0.05,
    gap: 0.08,
    fn: (b) => {
      b.tone({ w: 'square', f: 233, a: 0.003, h: 0.07, d: 0.06, v: 0.12, fl: { type: 'lowpass', f: 1800 } });
      b.tone({ t: 0.12, w: 'square', f: 185, a: 0.003, h: 0.1, d: 0.08, v: 0.12, fl: { type: 'lowpass', f: 1600 } });
    },
  },

  ui_click: {
    vary: 0.02,
    rev: 0,
    gap: 0.02,
    fn: (b) => {
      b.tone({ w: 'square', f: 1850, a: 0.001, d: 0.022, v: 0.06, fl: { type: 'lowpass', f: 6000 } });
      b.noise({ d: 0.01, v: 0.08, fl: { type: 'highpass', f: 4000 } });
    },
  },

  ui_hover: {
    vary: 0.01,
    rev: 0,
    gap: 0.04,
    fn: (b) => {
      b.tone({ f: 2640, a: 0.002, d: 0.03, v: 0.05 });
    },
  },

  chat: {
    vary: 0,
    rev: 0.05,
    gap: 0.1,
    fn: (b) => {
      b.tone({ f: hz(88), a: 0.002, h: 0.02, d: 0.08, v: 0.1 });
      b.tone({ t: 0.07, f: hz(93), a: 0.002, h: 0.02, d: 0.15, v: 0.1 });
      b.tone({ t: 0.07, w: 'triangle', f: hz(105), a: 0.002, d: 0.1, v: 0.02 });
    },
  },

  round_win: {
    vary: 0,
    rev: 0.35,
    max: 1,
    fn: (b) => {
      const note = (t: number, m: number, h: number, d: number, v: number): void => {
        b.tone({ t, w: 'square', f: hz(m), a: 0.004, h, d, v, fl: { type: 'lowpass', f: 3500 } });
        b.tone({ t, w: 'sawtooth', f: hz(m), det: 7, a: 0.004, h, d, v: v * 0.6, fl: { type: 'lowpass', f: 2500 } });
      };
      [72, 76, 79, 84].forEach((m, i) => note(i * 0.12, m, 0.05, 0.1, 0.06));
      for (const m of [76, 84, 88, 91]) note(0.5, m, 0.6, 1, 0.045);
      b.tone({ t: 0.5, f: 65.4, a: 0.01, h: 0.4, d: 1, v: 0.35 });
      b.noise({ t: 0.5, a: 0.05, d: 1.2, v: 0.03, fl: { type: 'highpass', f: 7000 } });
    },
  },

  round_lose: {
    vary: 0,
    rev: 0.35,
    max: 1,
    fn: (b) => {
      const note = (t: number, m: number, h: number, d: number, v: number): void => {
        b.tone({ t, w: 'sawtooth', f: hz(m), a: 0.01, h, d, v, vib: [5, 12], fl: { type: 'lowpass', f: 1800, f2: 500, sw: h + d } });
        b.tone({ t, w: 'sawtooth', f: hz(m), det: -10, a: 0.01, h, d, v: v * 0.7, fl: { type: 'lowpass', f: 1400 } });
      };
      [79, 75, 72].forEach((m, i) => note(i * 0.22, m, 0.1, 0.2, 0.06));
      for (const m of [48, 55, 60, 63]) note(0.66, m, 0.6, 1.2, 0.05);
      b.tone({ t: 0.66, f: 55, f2: 40, sw: 1.5, a: 0.02, h: 0.5, d: 1.2, v: 0.35 });
    },
  },
};

// Loops are built from sustained sources; every param registered via osc/filt/nsrc/
// sgain follows `pitch` live. Output goes to `b.out` (the loop's fade gain).
const LOOPS: Record<SfxLoopName, LoopDef> = {
  minigun_spin: {
    fadeIn: 0.08,
    fadeOut: 0.35,
    rev: 0.05,
    fn: (b) => {
      const out = b.gain(0.6);
      out.connect(b.out);
      b.link(b.osc('sawtooth', 92), b.filt('lowpass', 800, 6), b.gain(0.22), out); // motor
      b.link(b.osc('square', 184.7), b.filt('bandpass', 1500, 3), b.gain(0.05), out);
      const gate = b.gain(0.55); // barrel clatter
      b.lfo('sawtooth', 32, -0.45, gate.gain);
      b.link(b.nsrc('white'), b.filt('bandpass', 2600, 1.4), gate, b.gain(0.25), out);
      b.link(b.nsrc('pink', 0.8), b.filt('bandpass', 700), b.gain(0.12), out); // air whir
    },
  },

  shaft: {
    fadeIn: 0.03,
    fadeOut: 0.1,
    rev: 0.1,
    fn: (b) => {
      const buzz = b.gain(1);
      b.link(buzz, b.shaper(18), b.filt('bandpass', 1500, 0.8), b.gain(0.08), b.out);
      const o1 = b.osc('sawtooth', 55);
      o1.connect(buzz);
      b.link(b.osc('sawtooth', 110.6), b.gain(0.7), buzz);
      b.lfo('sine', 7, 18, o1.detune);
      // random crackle: slow random signal -> sparse spikes -> AM on hissy noise
      const cr = b.gain(0);
      b.link(b.nsrc('white'), b.filt('highpass', 2800), cr, b.gain(0.12), b.out);
      b.link(b.nsrc('white', 0.002), b.spiker()).connect(cr.gain);
      b.link(b.osc('sine', 110), b.gain(0.06), b.out); // body hum
    },
  },

  cyber_ambience: {
    fadeIn: 2.5,
    fadeOut: 2,
    rev: 0,
    fn: (b) => {
      // dark detuned drone through a slowly moving resonant lowpass
      const lp = b.filt('lowpass', 480, 8);
      b.lfo('sine', 0.045, 300, lp.frequency, true);
      b.link(lp, b.gain(0.06), b.out);
      b.osc('sawtooth', 55).connect(lp);
      b.osc('sawtooth', 55.35).connect(lp);
      b.link(b.osc('sawtooth', 82.6), b.gain(0.5), lp);
      b.link(b.osc('sine', 27.5), b.gain(0.09), b.out);
      // high digital shimmer
      const bp = b.filt('bandpass', 3000, 9);
      b.lfo('sine', 0.11, 1600, bp.frequency, true);
      const trem = b.gain(0.02);
      b.lfo('sine', 0.23, 0.015, trem.gain);
      b.link(b.nsrc('white'), bp, trem, b.out);
      // distant data chatter
      const ch = b.gain(0.02);
      b.lfo('sine', 0.07, 0.018, ch.gain);
      b.link(b.bsrc('chatter', 0.5), b.filt('bandpass', 1100, 2), ch, b.out);
    },
  },

  meat_ambience: {
    fadeIn: 2.5,
    fadeOut: 2,
    rev: 0,
    fn: (b) => {
      b.link(b.nsrc('brown', 0.7), b.filt('lowpass', 160), b.gain(0.25), b.out); // rumble
      b.link(b.osc('sine', 60), b.gain(0.035), b.out); // mains hum
      b.link(b.osc('sawtooth', 120), b.filt('lowpass', 400), b.gain(0.012), b.out);
      const traffic = b.gain(0.06);
      b.lfo('sine', 0.06, 0.045, traffic.gain);
      b.link(b.nsrc('pink'), b.filt('bandpass', 450, 0.7), traffic, b.out);
      b.link(b.nsrc('pink', 1.3), b.filt('highpass', 3500), b.gain(0.006), b.out); // drizzle hiss
      // faint distant siren swelling in and out
      const sir = b.gain(0.004);
      b.lfo('sine', 0.031, 0.004, sir.gain);
      const so = b.osc('triangle', 680);
      b.lfo('sine', 0.35, 90, so.frequency, true);
      b.link(so, b.filt('lowpass', 900), sir, b.out);
    },
  },

  stealth_hum: {
    fadeIn: 0.4,
    fadeOut: 0.4,
    rev: 0.1,
    fn: (b) => {
      const t1 = b.gain(0.02);
      b.lfo('sine', 3.1, 0.012, t1.gain);
      const o1 = b.osc('sine', 1760);
      b.lfo('sine', 5.3, 10, o1.detune);
      b.link(o1, t1, b.out);
      const t2 = b.gain(0.012);
      b.lfo('sine', 4.4, 0.008, t2.gain);
      b.link(b.osc('sine', 2641), t2, b.out);
      b.link(b.nsrc('white'), b.filt('bandpass', 7200, 4), b.gain(0.012), b.out);
      b.link(b.osc('triangle', 220), b.gain(0.012), b.out);
    },
  },

  crack: {
    fadeIn: 0.05,
    fadeOut: 0.15,
    rev: 0.05,
    fn: (b) => {
      b.link(b.bsrc('crack'), b.filt('highpass', 250), b.gain(0.35), b.out);
      b.link(b.nsrc('pink'), b.filt('bandpass', 2000, 6), b.gain(0.01), b.out);
    },
  },

  program: {
    fadeIn: 0.05,
    fadeOut: 0.2,
    rev: 0.08,
    fn: (b) => {
      b.link(b.bsrc('chatter'), b.filt('lowpass', 5000), b.gain(0.18), b.out);
      b.link(b.osc('sine', 110), b.gain(0.02), b.out);
    },
  },

  alarm: {
    fadeIn: 0.05,
    fadeOut: 0.2,
    rev: 0.15,
    fn: (b) => {
      const o1 = b.osc('sawtooth', 720);
      const o2 = b.osc('square', 1440);
      b.lfo('sine', 1.7, 230, o1.frequency, true);
      b.lfo('sine', 1.7, 460, o2.frequency, true);
      b.link(o1, b.filt('bandpass', 1100, 1.2), b.gain(0.3), b.out);
      b.link(o2, b.filt('bandpass', 1800, 2), b.gain(0.06), b.out);
    },
  },
};

const isOneShot = (n: SfxName): n is SfxOneShot => Object.hasOwn(SOUNDS, n);
const loopId = (name: SfxLoopName, key: string | undefined): string => `${name}|${key ?? ''}`;

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

interface Graph {
  ctx: AudioContext;
  res: Resources;
  master: GainNode;
  mix: GainNode;
  revIn: GainNode;
}

interface Voice {
  name: SfxName;
  start: number;
  end: number;
  level: number;
  out: GainNode;
  srcs: AudioScheduledSourceNode[];
  nodes: AudioNode[];
  left: number;
  /** Stolen or finished: no longer counts toward limits. */
  dead: boolean;
  gone: boolean;
}

interface LoopInst {
  fade: GainNode;
  panner: PannerNode | null;
  srcs: AudioScheduledSourceNode[];
  nodes: AudioNode[];
  rate: RateParam[];
  volume: number;
  pitch: number;
  fadeOut: number;
}

export class Sfx {
  private g: Graph | null = null;
  private volume = 0.8;
  private readonly lpos: SfxVec = { x: 0, y: 0, z: 0 };
  private readonly lfwd: SfxVec = { x: 0, y: 0, z: -1 };
  private readonly lup: SfxVec = { x: 0, y: 1, z: 0 };
  private readonly voices = new Set<Voice>();
  private readonly lastPlay = new Map<SfxName, number>();
  private readonly loops = new Map<string, LoopInst>();
  /** Loops requested before unlock(); started once the context exists. */
  private readonly pending = new Map<string, { name: SfxLoopName; opts: SfxLoopOpts }>();

  /** True once the AudioContext exists and is running. */
  get ready(): boolean {
    return this.g?.ctx.state === 'running';
  }

  /** Create/resume the AudioContext. Call from a user gesture (click/keydown). */
  unlock(): void {
    if (!this.g) {
      const AC =
        typeof AudioContext !== 'undefined'
          ? AudioContext
          : (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      let ctx: AudioContext;
      try {
        ctx = new AC({ latencyHint: 'interactive' });
      } catch {
        return;
      }
      const g = this.build(ctx);
      this.g = g;
      for (const [id, p] of this.pending) this.startLoop(g, id, p.name, p.opts);
      this.pending.clear();
    }
    const { ctx } = this.g;
    if (ctx.state !== 'running' && ctx.state !== 'closed') ctx.resume().catch(() => undefined);
  }

  /** Master volume 0..1. */
  setVolume(v: number): void {
    if (!Number.isFinite(v)) return;
    this.volume = Math.min(1, Math.max(0, v));
    if (this.g) glide(this.g.master.gain, this.volume, this.g.ctx.currentTime, 0.02);
  }

  /** Listener pose in three.js world coords (Y up). Call every frame. */
  setListener(pos: SfxVec, forward: SfxVec, up: SfxVec): void {
    this.lpos.x = pos.x;
    this.lpos.y = pos.y;
    this.lpos.z = pos.z;
    this.lfwd.x = forward.x;
    this.lfwd.y = forward.y;
    this.lfwd.z = forward.z;
    this.lup.x = up.x;
    this.lup.y = up.y;
    this.lup.z = up.z;
    if (this.g) applyListener(this.g.ctx, this.lpos, this.lfwd, this.lup);
  }

  /** Fire-and-forget sound. No-op until unlocked. */
  play(name: SfxName, opts: SfxPlayOpts = {}): void {
    const g = this.g;
    if (!g || g.ctx.state !== 'running') return;
    const { ctx } = g;
    const shot = isOneShot(name);
    const meta: SoundMeta = shot ? SOUNDS[name] : { vary: 0.03, rev: LOOPS[name].rev ?? 0.1, max: 3 };
    const now = ctx.currentTime;

    let vol = opts.volume ?? 1;
    if (!(vol > 0)) return;
    let wet = meta.rev ?? 0.12;
    if (opts.pos) {
      const d = distance(opts.pos, this.lpos);
      if (d > (meta.far ?? CULL_DIST)) return;
      // Reverb falls off slower than the dry path: far sounds get wetter.
      wet *= Math.sqrt(distGain(d));
    }
    if (meta.gap !== undefined) {
      const last = this.lastPlay.get(name);
      if (last !== undefined && now - last < meta.gap) return;
    }
    this.lastPlay.set(name, now);

    // Per-name cap and stacking attenuation.
    let same = 0;
    let recent = 0;
    let oldest: Voice | undefined;
    for (const v of this.voices) {
      if (v.dead || v.name !== name) continue;
      same++;
      oldest ??= v;
      if (now - v.start < STACK_WINDOW) recent++;
    }
    if (oldest && same >= (meta.max ?? 12)) this.kill(oldest, now);
    vol /= 1 + 0.3 * recent;
    this.reclaim(now);

    const t0 = now + LOOKAHEAD;
    const pitch = Math.max(0.05, (opts.pitch ?? 1) * (1 + (Math.random() * 2 - 1) * (meta.vary ?? 0.04)));
    const vg = new GainNode(ctx, { gain: vol });
    const muffled = opts.muffled === true;
    const routed = this.route(g, vg, opts.pos, muffled, muffled ? wet * 0.6 : wet, false);
    const extra: AudioNode[] = [vg, ...routed.nodes];
    let out: AudioNode = vg;
    if (!shot) {
      const eg = new GainNode(ctx, { gain: 0 });
      env(eg.gain, t0, 0.03, 0.35, 0.3, 1);
      eg.connect(vg);
      extra.push(eg);
      out = eg;
    }
    const b = new Builder(ctx, g.res, out, t0, pitch, false);
    if (shot) SOUNDS[name].fn(b);
    else {
      LOOPS[name].fn(b);
      b.hold(0.7);
    }
    b.finish();

    const voice: Voice = {
      name,
      start: now,
      end: b.end,
      level: vol,
      out: vg,
      srcs: b.srcs,
      nodes: b.nodes.concat(extra),
      left: b.srcs.length,
      dead: false,
      gone: false,
    };
    if (voice.left === 0) {
      this.dispose(voice);
      return;
    }
    this.voices.add(voice);
    for (const s of b.srcs) {
      s.onended = () => {
        if (--voice.left <= 0) this.dispose(voice);
      };
    }
  }

  /**
   * Start (`on` = true) or stop a continuous sound. Instances are keyed by
   * name + `opts.key`. Calling with `on` for a running instance just updates
   * pitch/volume/pos, so it is safe to call every frame. Fades in/out.
   * Loops requested before `unlock()` start when the context is created.
   */
  loop(name: SfxLoopName, on: boolean, opts: SfxLoopOpts = {}): void {
    const id = loopId(name, opts.key);
    const g = this.g;
    if (!g) {
      if (on) this.pending.set(id, { name, opts: { ...opts } });
      else this.pending.delete(id);
      return;
    }
    const cur = this.loops.get(id);
    if (on) {
      if (cur) this.updateLoop(g, cur, opts);
      else this.startLoop(g, id, name, opts);
    } else if (cur) this.stopLoop(g, id, cur);
  }

  /** Update a running loop, e.g. minigun spin pitch rising with spin-up. */
  setLoopParam(name: SfxLoopName, key: string | undefined, p: SfxLoopParams): void {
    const id = loopId(name, key);
    const g = this.g;
    if (!g) {
      const pend = this.pending.get(id);
      if (pend) {
        if (p.pitch !== undefined) pend.opts.pitch = p.pitch;
        if (p.volume !== undefined) pend.opts.volume = p.volume;
        if (p.pos) pend.opts.pos = { x: p.pos.x, y: p.pos.y, z: p.pos.z };
      }
      return;
    }
    const inst = this.loops.get(id);
    if (inst) this.updateLoop(g, inst, p);
  }

  /** Fade out every running loop (e.g. on map change / disconnect). */
  stopAllLoops(): void {
    this.pending.clear();
    const g = this.g;
    if (!g) return;
    for (const [id, inst] of this.loops) this.stopLoop(g, id, inst);
  }

  // --- internals -----------------------------------------------------------

  private build(ctx: AudioContext): Graph {
    const master = new GainNode(ctx, { gain: this.volume });
    const limiter = new DynamicsCompressorNode(ctx, { threshold: -6, knee: 4, ratio: 20, attack: 0.002, release: 0.15 });
    const mix = new GainNode(ctx, { gain: 0.7 });
    mix.connect(limiter).connect(master).connect(ctx.destination);

    const revIn = new GainNode(ctx, { gain: 1 });
    const revHp = new BiquadFilterNode(ctx, { type: 'highpass', frequency: 220 });
    const conv = new ConvolverNode(ctx, { buffer: makeIR(ctx, 2.2, 1.6) });
    const revOut = new GainNode(ctx, { gain: 0.45 });
    revIn.connect(revHp).connect(conv).connect(revOut).connect(mix);

    applyListener(ctx, this.lpos, this.lfwd, this.lup);
    return { ctx, res: new Resources(ctx), master, mix, revIn };
  }

  /** input -> [muffle] -> [panner] -> mix, plus reverb send (pre- or post-panner). */
  private route(
    g: Graph,
    input: AudioNode,
    pos: SfxVec | undefined,
    muffled: boolean,
    wet: number,
    wetPostPanner: boolean,
  ): { nodes: AudioNode[]; panner: PannerNode | null } {
    const { ctx } = g;
    const nodes: AudioNode[] = [];
    let tail = input;
    if (muffled) {
      const lp = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: MUFFLE_HZ });
      tail.connect(lp);
      tail = lp;
      nodes.push(lp);
    }
    let panner: PannerNode | null = null;
    if (pos) {
      panner = makePanner(ctx, pos);
      tail.connect(panner);
      panner.connect(g.mix);
      nodes.push(panner);
    } else tail.connect(g.mix);
    if (wet > 0.003) {
      const send = new GainNode(ctx, { gain: wet });
      (wetPostPanner && panner ? panner : tail).connect(send);
      send.connect(g.revIn);
      nodes.push(send);
    }
    return { nodes, panner };
  }

  /** Enforce the global voice cap: fade out the voice with the least remaining energy. */
  private reclaim(now: number): void {
    let alive = 0;
    let victim: Voice | undefined;
    let best = Infinity;
    for (const v of this.voices) {
      if (now > v.end + 2) {
        this.dispose(v); // safety net if onended never fired
        continue;
      }
      if (v.dead) continue;
      alive++;
      const span = Math.max(v.end - v.start, 1e-3);
      const score = v.level * Math.max(0, (v.end - now) / span);
      if (score < best) {
        best = score;
        victim = v;
      }
    }
    if (victim && alive >= MAX_VOICES) this.kill(victim, now);
  }

  private kill(v: Voice, now: number): void {
    if (v.dead) return;
    v.dead = true;
    const gp = v.out.gain;
    // Not audible yet (still inside the lookahead): cut instantly, no fade needed.
    const started = now >= v.start + LOOKAHEAD;
    gp.cancelScheduledValues(now);
    gp.setValueAtTime(started ? v.level : 0, now);
    if (started) gp.linearRampToValueAtTime(0, now + 0.015);
    const stopAt = started ? now + 0.02 : now;
    for (const s of v.srcs) {
      try {
        s.stop(stopAt);
      } catch {
        /* already stopped */
      }
    }
  }

  private dispose(v: Voice): void {
    if (v.gone) return;
    v.gone = true;
    v.dead = true;
    this.voices.delete(v);
    disconnectAll(v.nodes);
  }

  private startLoop(g: Graph, id: string, name: SfxLoopName, opts: SfxLoopOpts): void {
    const { ctx } = g;
    const def = LOOPS[name];
    const now = ctx.currentTime;
    const volume = Math.max(0, opts.volume ?? 1);
    const pitch = Math.max(0.01, opts.pitch ?? 1);
    const fade = new GainNode(ctx, { gain: 0 });
    fade.gain.setValueAtTime(0, now);
    fade.gain.linearRampToValueAtTime(volume, now + def.fadeIn);
    const muffled = opts.muffled === true;
    const wet = (def.rev ?? 0) * (muffled ? 0.6 : 1);
    const routed = this.route(g, fade, opts.pos, muffled, wet, true);
    const b = new Builder(ctx, g.res, fade, now, pitch, true);
    def.fn(b);
    this.loops.set(id, {
      fade,
      panner: routed.panner,
      srcs: b.srcs,
      nodes: [...b.nodes, fade, ...routed.nodes],
      rate: b.rate,
      volume,
      pitch,
      fadeOut: def.fadeOut,
    });
  }

  private updateLoop(g: Graph, inst: LoopInst, p: SfxLoopParams): void {
    const now = g.ctx.currentTime;
    if (p.pitch !== undefined) {
      const pitch = Math.max(0.01, p.pitch);
      if (pitch !== inst.pitch) {
        inst.pitch = pitch;
        for (const r of inst.rate) glide(r.param, Math.min(r.base * pitch, 20000), now);
      }
    }
    if (p.volume !== undefined) {
      const volume = Math.max(0, p.volume);
      if (volume !== inst.volume) {
        inst.volume = volume;
        glide(inst.fade.gain, volume, now);
      }
    }
    if (p.pos && inst.panner) setPannerPos(inst.panner, p.pos);
  }

  private stopLoop(g: Graph, id: string, inst: LoopInst): void {
    // Removed from the map right away: a restart while fading creates a fresh
    // instance that cross-fades with this one.
    this.loops.delete(id);
    const now = g.ctx.currentTime;
    const fg = inst.fade.gain;
    const cur = fg.value;
    fg.cancelScheduledValues(now);
    fg.setValueAtTime(cur, now);
    fg.linearRampToValueAtTime(0, now + inst.fadeOut);
    const end = now + inst.fadeOut + 0.02;
    let left = inst.srcs.length;
    if (left === 0) {
      disconnectAll(inst.nodes);
      return;
    }
    for (const s of inst.srcs) {
      s.onended = () => {
        if (--left === 0) disconnectAll(inst.nodes);
      };
      try {
        s.stop(end);
      } catch {
        /* already stopped */
      }
    }
  }
}

/** Shared instance. Call `sfx.unlock()` from the first user gesture. */
export const sfx = new Sfx();
