// Camera math and overlay (titles/captions) builders for the promo recorder.

import { v3, vadd, vsub, vscale, vlen, type Vec3 } from '@d2/shared';
import type { Cam } from './session.js';

const DEG = 180 / Math.PI;

export const clamp01 = (t: number): number => Math.max(0, Math.min(1, t));
export const smooth = (t: number): number => {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
};
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const vlerp = (a: Vec3, b: Vec3, t: number): Vec3 => v3(lerp(a.x, b.x, t), lerp(a.y, b.y, t), lerp(a.z, b.z, t));

/** Quake angles (yaw 0 = +X, pitch positive = down) looking from `from` to `to`. */
export function look(from: Vec3, to: Vec3, up?: Vec3): Cam {
  const d = vsub(to, from);
  return { pos: from, yaw: Math.atan2(d.y, d.x) * DEG, pitch: -Math.atan2(d.z, Math.hypot(d.x, d.y)) * DEG, up };
}

/** Catmull-Rom through the keys, t in 0..1 over the whole path. */
export function spline(keys: Vec3[], t: number): Vec3 {
  if (keys.length === 1) return keys[0]!;
  const n = keys.length - 1;
  const x = clamp01(t) * n;
  const i = Math.min(n - 1, Math.floor(x));
  const u = x - i;
  const p0 = keys[Math.max(0, i - 1)]!;
  const p1 = keys[i]!;
  const p2 = keys[i + 1]!;
  const p3 = keys[Math.min(n, i + 2)]!;
  const f = (a: number, b: number, c: number, d: number) =>
    0.5 * (2 * b + (-a + c) * u + (2 * a - 5 * b + 4 * c - d) * u * u + (-a + 3 * b - 3 * c + d) * u * u * u);
  return v3(f(p0.x, p1.x, p2.x, p3.x), f(p0.y, p1.y, p2.y, p3.y), f(p0.z, p1.z, p2.z, p3.z));
}

/** Critically damped spring for camera positions. */
export class Spring {
  vel = v3();
  constructor(public pos: Vec3) {}
  step(target: Vec3, dt: number, freq = 3): Vec3 {
    const w = 2 * Math.PI * freq;
    const x = vsub(this.pos, target);
    const a = vsub(vscale(x, -w * w), vscale(this.vel, 2 * w));
    this.vel = vadd(this.vel, vscale(a, dt));
    this.pos = vadd(this.pos, vscale(this.vel, dt));
    if (vlen(vsub(this.pos, target)) > 2000) this.pos = target;
    return this.pos;
  }
}

// ---------------------------------------------------------------------------
// Overlays. All sizes are in CSS px for a 1280x720 viewport.

const MAG = '#ff2bd6';
const CYAN = '#27e6ff';
const YEL = '#ffd21f';

/** Deterministic per-frame noise for glitches. */
export function hash(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/** Dark wash over the frame (0 = none, 1 = black). */
export const shade = (a: number): string =>
  a > 0.001 ? `<div style="position:absolute;inset:0;background:#000;opacity:${a.toFixed(3)}"></div>` : '';

export const vignette = `<div style="position:absolute;inset:0;background:radial-gradient(ellipse at center, rgba(0,0,0,0) 55%, rgba(0,0,0,0.55) 100%)"></div>`;

export const flash = (a: number, color = '#fff'): string =>
  a > 0.001 ? `<div style="position:absolute;inset:0;background:${color};opacity:${a.toFixed(3)};mix-blend-mode:screen"></div>` : '';

/**
 * Caption that slides and wipes in, holds, then glitches out.
 * t = seconds since the caption started, dur = its total length.
 */
export function caption(o: { title: string; sub?: string; t: number; dur: number; color?: string; at?: 'left' | 'center' | 'hudleft'; frame: number }): string {
  const { t, dur } = o;
  if (t < 0 || t > dur) return '';
  const color = o.color ?? MAG;
  const inP = smooth(t / 0.35);
  const outP = smooth((t - (dur - 0.3)) / 0.3);
  const wipe = Math.round(100 - inP * 100);
  const jit = outP > 0 ? (hash(o.frame) - 0.5) * 40 * outP : 0;
  const op = (1 - outP).toFixed(3);
  const pos =
    o.at === 'center'
      ? 'left:0;right:0;top:50%;transform:translateY(-50%);text-align:center'
      : o.at === 'hudleft'
        ? 'left:64px;top:38%'
        : 'left:72px;bottom:96px';
  const subP = smooth((t - 0.25) / 0.4);
  return `<div style="position:absolute;${pos};opacity:${op}">
    <div style="display:inline-block;clip-path:inset(0 ${wipe}% 0 0);transform:translateX(${jit.toFixed(1)}px)">
      <div style="font:900 58px/1 Orbitron,sans-serif;letter-spacing:0.06em;color:#fff;
        text-shadow:0 0 6px ${color},0 0 22px ${color},0 0 48px ${color},${(-2 - jit / 6).toFixed(1)}px 0 0 rgba(39,230,255,0.8),${(2 + jit / 6).toFixed(1)}px 0 0 rgba(255,43,214,0.8)">${o.title}</div>
    </div>
    ${
      o.sub
        ? `<div style="margin-top:12px;font:600 24px/1.2 Rajdhani,sans-serif;letter-spacing:0.28em;text-transform:uppercase;color:${CYAN};
            text-shadow:0 0 12px rgba(39,230,255,0.7);opacity:${subP.toFixed(3)};transform:translateY(${((1 - subP) * 10).toFixed(1)}px)">${o.sub}</div>`
        : ''
    }
    <div style="margin-top:14px;height:3px;width:${Math.round(inP * 220)}px;background:${color};box-shadow:0 0 12px ${color}"></div>
  </div>`;
}

/** Terminal lines typed out one after another (chars per second). */
export function terminal(lines: { at: number; text: string; color?: string }[], t: number, frame: number): string {
  const rows = lines
    .filter((l) => t >= l.at)
    .map((l, i, all) => {
      const n = Math.min(l.text.length, Math.floor((t - l.at) * 38));
      const typing = n < l.text.length || i === all.length - 1;
      const cursor = typing && Math.floor(t * 2.5) % 2 === 0 ? '<span style="opacity:0.9">█</span>' : '';
      return `<div style="color:${l.color ?? CYAN};text-shadow:0 0 10px ${l.color ?? CYAN}88;margin:10px 0">${l.text.slice(0, n)}${cursor}</div>`;
    })
    .join('');
  const jx = hash(frame) < 0.05 ? (hash(frame + 1) - 0.5) * 8 : 0;
  return `<div style="position:absolute;left:96px;top:250px;font:500 22px/1.3 'JetBrains Mono',monospace;letter-spacing:0.04em;transform:translateX(${jx.toFixed(1)}px)">${rows}</div>`;
}

/** The DYSTOPIA 2 logo with a glitchy reveal. p = 0..1 reveal, frame for jitter. */
export function logo(o: { t: number; frame: number; size?: number; sub?: string; y?: string }): string {
  const size = o.size ?? 132;
  const t = o.t;
  if (t < 0) return '';
  const settle = clamp01(t / 0.6);
  const g = (1 - settle) * (hash(o.frame) > 0.4 ? 1 : 0.2);
  const split = (2 + g * 18).toFixed(1);
  const slices = [0, 1, 2, 3]
    .map((i) => {
      const off = (hash(o.frame * 7 + i) - 0.5) * 60 * g;
      return `<div aria-hidden="true" style="position:absolute;inset:0;clip-path:inset(${i * 25}% 0 ${75 - i * 25}% 0);transform:translateX(${off.toFixed(1)}px)">${word(size, split)}</div>`;
    })
    .join('');
  const subP = smooth((t - 0.5) / 0.6);
  return `<div style="position:absolute;left:0;right:0;top:${o.y ?? '50%'};transform:translateY(-50%) scale(${(1.08 - 0.08 * smooth(t / 1.2)).toFixed(4)});text-align:center">
    <div style="position:relative;display:inline-block;opacity:${Math.min(1, t / 0.12).toFixed(3)}">
      <div style="visibility:hidden">${word(size, split)}</div>${slices}
    </div>
    ${o.sub ? `<div style="margin-top:18px;font:600 26px Rajdhani,sans-serif;letter-spacing:0.5em;color:${CYAN};text-shadow:0 0 14px ${CYAN};opacity:${subP.toFixed(3)}">${o.sub}</div>` : ''}
  </div>`;
}

function word(size: number, split: string): string {
  return `<div style="font:900 ${size}px/1 Orbitron,sans-serif;letter-spacing:0.08em;color:#fff;white-space:nowrap;
    text-shadow:0 0 8px ${MAG},0 0 30px ${MAG},0 0 80px ${MAG},-${split}px 0 0 rgba(39,230,255,0.85),${split}px 0 0 rgba(255,43,214,0.85)">DYSTOPIA<span style="color:${YEL};text-shadow:0 0 8px ${YEL},0 0 30px ${YEL},0 0 70px ${YEL}"> 2</span></div>`;
}

/** Small corner tag, e.g. a recording marker. */
export const tag = (text: string, color = CYAN): string =>
  `<div style="position:absolute;right:28px;bottom:22px;font:500 13px 'JetBrains Mono',monospace;letter-spacing:0.2em;color:${color};opacity:0.75">${text}</div>`;

export { MAG, CYAN, YEL };
