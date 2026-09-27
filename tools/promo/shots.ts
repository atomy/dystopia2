// The promo's shot list. Each shot is its own recording session: a fresh room,
// optionally pre-rolled (server only) to a moment of the bot match, then filmed
// with a scripted camera, captions and staged events. Timing is on a 120 BPM
// grid (one bar = 2 s) so cuts land on the soundtrack's beats.

import { v3, vadd, Team, ClassId, Buttons, type Vec3 } from '@d2/shared';
import { damageBreakable } from '../../packages/server/src/game/combat.js';
import type { FrameArgs, Session } from './session.js';
import type { Game } from '../../packages/server/src/game/game.js';
import type { ServerPlayer } from '../../packages/server/src/game/player.js';
import { look, spline, smooth, clamp01, hash, Spring, shade, vignette, flash, caption, terminal, logo, lerp, vlerp, MAG, YEL, CYAN } from './director.js';

export const FPS = 30;

export interface ShotCtx {
  s: Session;
  g: Game;
  /** Seconds into the shot (negative during warm-up). */
  t: number;
  frame: number;
  /** Seconds into the whole video. */
  global: number;
  dur: number;
  /** Per-shot scratch state. */
  mem: Record<string, unknown>;
}

export interface Shot {
  name: string;
  dur: number;
  bots?: number;
  /** Server-only seconds before the browser joins. */
  preroll?: number;
  prerollUntil?: (g: Game) => boolean;
  /** Rendered-but-not-captured seconds before the shot starts (default 1). */
  warm?: number;
  join?: (p: ServerPlayer, g: Game) => void;
  /** Take over this bot (first-person shots); its brain keeps playing through the client. */
  possess?: (g: Game) => ServerPlayer | null;
  /** The possessed player takes no meatspace damage. */
  god?: boolean;
  setup?: (c: ShotCtx) => void | Promise<void>;
  frame: (c: ShotCtx) => FrameArgs;
}

const DT = 1 / FPS;

/** Centroid of living players matching the filter (as rendered, i.e. slightly in the past). */
function centroid(c: ShotCtx, pred: (p: ServerPlayer) => boolean, fallback: Vec3): Vec3 {
  let x = 0;
  let y = 0;
  let z = 0;
  let n = 0;
  for (const p of c.s.players((q) => q.alive && pred(q))) {
    const h = c.s.past(p.id);
    if (!h) continue;
    x += h.origin.x;
    y += h.origin.y;
    z += h.origin.z;
    n++;
  }
  return n ? v3(x / n, y / n, z / n) : fallback;
}

function spring(c: ShotCtx, key: string, target: Vec3, freq = 1.5): Vec3 {
  let sp = c.mem[key] as Spring | undefined;
  if (!sp) c.mem[key] = sp = new Spring(target);
  return sp.step(target, DT, freq);
}

/** A team's decker bot (the first bot of each team). */
export function decker(g: Game, team: number): ServerPlayer | null {
  return [...g.players.values()].find((p) => p.bot && p.team === team && p.cls === 0 && p.hasDeck) ?? null;
}

/** The living non-decker bot of a team closest to a point. */
function nearest(g: Game, team: number, at: Vec3, classes: number[]): ServerPlayer | null {
  let best: ServerPlayer | null = null;
  let bd = Infinity;
  for (const p of g.players.values()) {
    if (!p.bot || !p.alive || p.decked || p.team !== team || !classes.includes(p.cls)) continue;
    const d = Math.hypot(p.move.origin.x - at.x, p.move.origin.y - at.y);
    if (d < bd) {
      bd = d;
      best = p;
    }
  }
  return best;
}

/** Where a player is as rendered (cyber avatar when decked), plus its "up". */
function where(c: ShotCtx, id: number, delay = 5): { pos: Vec3; up: Vec3 } | null {
  const h = c.s.past(id, delay);
  if (!h) return null;
  return h.decked && h.cyber ? { pos: h.cyber, up: h.up ?? v3(0, 0, 1) } : { pos: v3(h.origin.x, h.origin.y, h.origin.z + 48), up: v3(0, 0, 1) };
}

/** Fade from/to black at the shot edges. */
function edges(c: ShotCtx, fadeIn = 0, fadeOut = 0): string {
  let a = 0;
  if (fadeIn > 0 && c.t < fadeIn) a = Math.max(a, 1 - smooth(c.t / fadeIn));
  if (fadeOut > 0 && c.t > c.dur - fadeOut) a = Math.max(a, smooth((c.t - (c.dur - fadeOut)) / fadeOut));
  return shade(a);
}

/** Chase camera behind a player's direction of travel (works on cyber walls too). */
function chase(c: ShotCtx, id: number, back: number, up: number, side = 0): { cam: FrameArgs['cam']; up: Vec3 } | null {
  const now = where(c, id, 5);
  const before = where(c, id, 15);
  if (!now) return null;
  let dir = c.mem['dir'] as Vec3 | undefined;
  if (before) {
    const d = v3(now.pos.x - before.pos.x, now.pos.y - before.pos.y, now.pos.z - before.pos.z);
    // Travel direction projected onto the current floor plane.
    const n = now.up;
    const along = d.x * n.x + d.y * n.y + d.z * n.z;
    const flat = v3(d.x - n.x * along, d.y - n.y * along, d.z - n.z * along);
    const len = Math.hypot(flat.x, flat.y, flat.z);
    if (len > 8) dir = v3(flat.x / len, flat.y / len, flat.z / len);
  }
  dir ??= v3(1, 0, 0);
  c.mem['dir'] = dir;
  const sdir = spring(c, 'sdir', dir, 1.2);
  const sideV = v3(sdir.y * now.up.z - sdir.z * now.up.y, sdir.z * now.up.x - sdir.x * now.up.z, sdir.x * now.up.y - sdir.y * now.up.x);
  const want = v3(
    now.pos.x - sdir.x * back + now.up.x * up + sideV.x * side,
    now.pos.y - sdir.y * back + now.up.y * up + sideV.y * side,
    now.pos.z - sdir.z * back + now.up.z * up + sideV.z * side,
  );
  const pos = spring(c, 'chasepos', want, 2.2);
  const upS = spring(c, 'chaseup', now.up, 2);
  return { cam: look(pos, vadd(now.pos, v3(upS.x * 16, upS.y * 16, upS.z * 16)), upS), up: upS };
}

export const SHOTS: Shot[] = [
  // 0:00 - street at round start, Punks pour out of their bunker. Terminal intro.
  {
    name: 'intro',
    dur: 8,
    preroll: 0.3,
    warm: 0.5,
    frame: (c) => {
      const pos = spline([v3(-2560, 520, 230), v3(-2620, 420, 200), v3(-2700, 300, 170)], smooth(c.t / c.dur));
      const target = spring(c, 'look', vadd(centroid(c, (p) => p.team === Team.Punk && p.move.origin.x < -2048, v3(-3100, 0, 0)), v3(0, 0, 40)), 0.8);
      return {
        hud: false,
        cam: look(pos, target),
        overlay:
          vignette +
          shade(0.35) +
          terminal(
            [
              { at: 0.4, text: '> DATATRUST ARCOLOGY // QUARANTINE PROTOCOL: ACTIVE' },
              { at: 2.6, text: '> THE VACCINE BREACH WAS YEARS AGO. THEY REBUILT.' },
              { at: 4.9, text: '> THE PUNKS ARE BACK.', color: MAG },
            ],
            c.t,
            c.frame,
          ) +
          edges(c, 0.8, 0.5),
      };
    },
  },

  // 0:08 - title over cyberspace.
  {
    name: 'title',
    dur: 4,
    preroll: 9,
    frame: (c) => {
      const pos = vlerp(v3(-990, -470, -5880), v3(-960, -330, -5860), smooth(c.t / c.dur));
      const target = v3(-300, 200, -5620);
      const hit = Math.max(0, 1 - c.t / 0.5);
      const out = smooth((c.t - 3.6) / 0.4);
      return {
        hud: false,
        cam: look(pos, target),
        overlay: vignette + shade(0.5) + logo({ t: c.t, frame: c.frame, sub: 'JACK IN &middot; HACK &middot; FIGHT' }) + flash(hit * 0.8, MAG) + flash(out),
      };
    },
  },

  // 0:12 - the bay door opens and the Punks storm the docks.
  {
    name: 'docks',
    dur: 4,
    preroll: 11.2,
    warm: 0.5,
    frame: (c) => {
      const pos = spline([v3(-1700, -340, 150), v3(-1740, -310, 158), v3(-1780, -280, 166)], smooth(c.t / c.dur));
      const target = spring(c, 'look', vlerp(v3(-2032, 0, 96), centroid(c, (p) => p.team === Team.Punk && p.move.origin.x > -2300 && p.move.origin.x < -1500, v3(-2032, 0, 60)), 0.35), 1.2);
      return {
        hud: false,
        cam: look(pos, target),
        overlay: vignette + caption({ title: 'PUNKS VS CORPS', sub: 'attack &middot; defend &middot; up to 8v8', t: c.t - 0.6, dur: 3.2, frame: c.frame }) + flash(Math.max(0, 1 - c.t / 0.25) * 0.9),
      };
    },
  },

  // 0:16 - first person with a Punk heavy in the docks firefight.
  {
    name: 'heavy',
    dur: 4,
    bots: 8,
    preroll: 13.3,
    warm: 0.7,
    god: true,
    possess: (g) => nearest(g, Team.Punk, v3(-952, 38, 0), [2]) ?? nearest(g, Team.Punk, v3(-952, 38, 0), [1]),
    frame: (c) => ({
      hud: true,
      cam: null,
      overlay: caption({ title: 'LIGHT &middot; MEDIUM &middot; HEAVY', sub: 'miniguns, katanas, EMP grenades', t: c.t - 0.5, dur: 3.3, frame: c.frame, at: 'hudleft' }),
    }),
  },

  // 0:20 - first person: the Punk decker reaches a terminal and jacks in.
  {
    name: 'jackin',
    dur: 4,
    preroll: 2.8,
    warm: 0.5,
    god: true,
    possess: (g) => decker(g, Team.Punk),
    frame: (c) => {
      const decked = c.s.me?.decked ?? false;
      if (decked && c.mem['jt'] === undefined) c.mem['jt'] = c.t;
      const jt = (c.mem['jt'] as number | undefined) ?? 99;
      return {
        hud: true,
        cam: null,
        overlay: flash(c.t >= jt ? Math.max(0, 1 - (c.t - jt) / 0.35) * 0.9 : 0, CYAN) + caption({ title: 'JACK IN.', sub: 'every terminal is a way in', t: c.t - jt - 0.15, dur: 99, frame: c.frame, at: 'center' }),
      };
    },
  },

  // 0:24 - third person: the Punk decker walks up the yellow server's north wall.
  {
    name: 'gravity',
    dur: 4,
    preroll: 32.3,
    warm: 0.8,
    frame: (c) => {
      const d = decker(c.g, Team.Punk);
      const ch = d ? chase(c, d.id, 150, 55, -30) : null;
      return {
        hud: false,
        cam: ch?.cam ?? look(v3(-400, 100, -5900), v3(-200, 480, -5800)),
        overlay: vignette + caption({ title: 'WALLS ARE FLOORS', sub: 'relative-gravity cyberspace', t: c.t - 0.5, dur: 3.3, frame: c.frame, color: YEL }),
      };
    },
  },

  // 0:28 - first person: hacking the loading-bay node.
  {
    name: 'hack',
    dur: 4,
    preroll: 8.0,
    warm: 0.5,
    possess: (g) => decker(g, Team.Punk),
    frame: (c) => ({
      hud: true,
      cam: null,
      overlay: caption({ title: 'HACK EVERYTHING', sub: 'doors &middot; turrets &middot; cameras &middot; spawns', t: c.t - 0.3, dur: 3.5, frame: c.frame, at: 'hudleft' }),
    }),
  },

  // 0:32 - the Punk decker's body stands defenceless at its street terminal; a Corp walks up and guns it down.
  {
    name: 'body',
    dur: 4,
    preroll: 6.0,
    warm: 0.5,
    setup: (c) => {
      const g = c.g;
      const d = decker(g, Team.Punk);
      const hunter = nearest(g, Team.Corp, v3(-1500, 0, 0), [ClassId.Medium]);
      if (!d || !hunter) return;
      c.s.room.bots.delete(hunter.id);
      c.s.god.add(hunter.id);
      const body = { ...d.move.origin };
      hunter.move.origin = v3(body.x + 420, body.y + 480, 1);
      hunter.move.velocity = v3();
      c.mem['body'] = body;
      c.mem['hunter'] = hunter.id;
      const start = g.now + 0.5;
      let seq = hunter.lastSeq;
      c.s.onTick = (gg) => {
        const t = gg.now - start;
        const h = hunter.move.origin;
        const to = v3(body.x - h.x, body.y - h.y, body.z + 36 - (h.z + 64));
        const dist = Math.hypot(to.x, to.y);
        const yaw = (Math.atan2(to.y, to.x) * 180) / Math.PI;
        const pitch = (-Math.atan2(to.z, dist) * 180) / Math.PI;
        const fire = t > 1.1 && d.alive && d.decked;
        gg.queueCmds(hunter, [{ seq: ++seq, msec: 1000 / 60, forward: dist > 300 ? 1 : 0, side: 0, buttons: fire ? Buttons.ATTACK : 0, pitch, yaw, weapon: 0, viewTick: gg.tick }]);
      };
    },
    frame: (c) => {
      const body = (c.mem['body'] as Vec3 | undefined) ?? v3(-2882, -880, 0);
      const hid = c.mem['hunter'] as number | undefined;
      const hp = hid !== undefined ? c.s.past(hid)?.origin : undefined;
      const pos = vlerp(v3(body.x - 150, body.y - 90, body.z + 80), v3(body.x - 175, body.y - 70, body.z + 70), smooth(c.t / c.dur));
      const target = spring(c, 'look', hp ? vlerp(v3(body.x, body.y, body.z + 40), v3(hp.x, hp.y, hp.z + 50), 0.5) : v3(body.x + 200, body.y + 200, body.z + 40), 1.4);
      return {
        hud: false,
        cam: look(pos, target),
        overlay: vignette + caption({ title: 'YOUR BODY STAYS BEHIND', sub: 'guard your deckers. hunt theirs.', t: c.t - 0.4, dur: 3.4, frame: c.frame }),
      };
    },
  },

  // 0:36 - third person: the Corp decker hunts the Punk decker in the yellow server.
  {
    name: 'duel',
    dur: 4,
    preroll: 13.0,
    warm: 0.8,
    frame: (c) => {
      const d = decker(c.g, Team.Corp);
      const ch = d ? chase(c, d.id, 170, 60, 40) : null;
      return {
        hud: false,
        cam: ch?.cam ?? look(v3(-850, 100, -5900), v3(-550, -250, -5960)),
        overlay: vignette + caption({ title: 'ENERGY IS YOUR LIFE', sub: "run dry and you're dumped", t: c.t - 0.4, dur: 3.4, frame: c.frame, color: '#27e6ff' }),
      };
    },
  },

  // 0:40 - montage: first person at the mid-spawn node, the password-cracker minigame.
  {
    name: 'programs',
    dur: 2,
    preroll: 33.9,
    warm: 0.5,
    possess: (g) => decker(g, Team.Punk),
    frame: (c) => ({
      hud: true,
      cam: null,
      overlay: caption({ title: '11 PROGRAMS', sub: 'crack &middot; decrypt &middot; breach the ICE', t: c.t - 0.1, dur: 1.9, frame: c.frame, at: 'hudleft', color: '#3dff9a' }),
    }),
  },

  // 0:42 - montage: bunny hopping down the street (scripted air strafing).
  {
    name: 'bhop',
    dur: 2,
    bots: 0,
    warm: 1.2,
    god: true,
    setup: (c) => {
      c.s.spawnMe(Team.Punk, ClassId.Light, { origin: v3(-3540, -560, 1), yaw: 30 });
      c.mem['yaw'] = 30;
      c.mem['dir'] = 1;
      c.mem['ground'] = true;
    },
    frame: (c) => {
      const me = c.s.me!;
      let yaw = c.mem['yaw'] as number;
      let dir = c.mem['dir'] as number;
      const onGround = me.move.onGround;
      let buttons = 0;
      let forward = 0;
      let side = 0;
      if (c.t < -0.8) {
        forward = 1;
        yaw = 30;
      }
      else {
        // Jump itself is pressed in the page on the client's predicted landing (FrameArgs.bhop).
        if (onGround && !c.mem['ground']) dir = -dir;
        side = dir;
        yaw -= dir * 100 * DT;
      }
      c.mem['ground'] = onGround;
      c.mem['yaw'] = yaw;
      c.mem['dir'] = dir;
      const speed = Math.round(Math.hypot(me.move.velocity.x, me.move.velocity.y));
      return {
        hud: true,
        cam: null,
        drive: { yaw, pitch: 4, buttons, forward, side },
        bhop: c.t >= -0.8,
        overlay:
          `<div style="position:absolute;left:0;right:0;top:57%;text-align:center;font:700 34px Orbitron,sans-serif;color:#fff;text-shadow:0 0 14px ${YEL}">${speed}<span style="font:600 16px Rajdhani,sans-serif;letter-spacing:0.2em;color:${YEL}"> UPS</span></div>` +
          caption({ title: 'SOURCE-STYLE MOVEMENT', sub: 'bhop &middot; air-strafe &middot; slide &middot; ledge-grab', t: c.t - 0.05, dur: 1.95, frame: c.frame, at: 'hudleft', color: YEL }),
      };
    },
  },

  // 0:44 - montage: crane over the 8v8 battle for the mid-spawn platform.
  {
    name: 'battle',
    dur: 2,
    bots: 8,
    preroll: 54.6,
    frame: (c) => {
      const pos = vlerp(v3(430, -560, 420), v3(520, -430, 400), smooth(c.t / c.dur));
      return {
        hud: false,
        cam: look(pos, v3(880, 20, 200)),
        overlay: vignette + caption({ title: '8v8 WITH BOTS', sub: 'they play the objective. they deck.', t: c.t - 0.05, dur: 1.95, frame: c.frame }),
      };
    },
  },

  // 0:46 - montage: first person with a Punk heavy in that battle.
  {
    name: 'battle_fp',
    dur: 2,
    bots: 8,
    preroll: 53.8,
    warm: 0.7,
    god: true,
    possess: (g) => nearest(g, Team.Punk, v3(900, 0, 192), [2]) ?? nearest(g, Team.Punk, v3(900, 0, 192), [1]),
    frame: () => ({ hud: true, cam: null, overlay: '' }),
  },

  // 0:48 - the finale: the core's force field is down; the data core blows.
  {
    name: 'core',
    dur: 8,
    bots: 8,
    preroll: 52.6,
    frame: (c) => {
      const BOOM = 4.0;
      const g = c.g;
      if (c.t >= BOOM && !c.mem['boom']) {
        c.mem['boom'] = true;
        const core = g.breakables.find((b) => b.name === 'data_core');
        const punk = [...g.players.values()].find((p) => p.team === Team.Punk && p.alive) ?? null;
        if (core) damageBreakable(g, core, 99999, punk, true);
      }
      const since = c.t - BOOM;
      const shake = since > 0 ? Math.max(0, 1 - since / 1.2) * 14 : 0;
      const jit = v3((hash(c.frame) - 0.5) * shake, (hash(c.frame + 9) - 0.5) * shake, (hash(c.frame + 17) - 0.5) * shake);
      const pos = vadd(spline([v3(1190, -240, 170), v3(1260, -320, 190), v3(1340, -370, 215), v3(1400, -370, 235)], smooth(c.t / c.dur)), jit);
      const white = since > 0 ? Math.max(0, 1 - since / 0.6) : 0;
      const out = smooth((c.t - 7.5) / 0.5);
      return {
        hud: false,
        cam: look(pos, v3(1680, 0, 150)),
        overlay:
          vignette +
          caption({ title: 'DESTROY THE CORE.', sub: 'three stages. one round.', t: c.t - 0.4, dur: 3.4, frame: c.frame, color: '#ff3b5c' }) +
          caption({ title: 'PUNKS WIN.', t: c.t - 4.8, dur: 2.7, frame: c.frame, at: 'center' }) +
          flash(white * 0.95) +
          flash(out),
      };
    },
  },

  // 0:56 - end card over cyberspace.
  {
    name: 'end',
    dur: 12,
    preroll: 9,
    frame: (c) => {
      const pos = vlerp(v3(-960, 420, -5880), v3(-900, 260, -5840), smooth(c.t / c.dur));
      const line = (at: number, html: string, style: string) => {
        const p = smooth((c.t - at) / 0.6);
        return p > 0 ? `<div style="opacity:${p.toFixed(3)};transform:translateY(${((1 - p) * 8).toFixed(1)}px);${style}">${html}</div>` : '';
      };
      const lines =
        line(1.4, 'A SPIRITUAL SEQUEL TO DYSTOPIA', `font:600 24px Rajdhani,sans-serif;letter-spacing:0.5em;color:${CYAN};text-shadow:0 0 12px ${CYAN}`) +
        line(2.6, 'FREE &middot; IN YOUR BROWSER &middot; 8v8 &middot; BOTS THAT DECK', `margin-top:26px;font:700 22px Orbitron,sans-serif;letter-spacing:0.12em;color:#fff`) +
        line(3.8, 'github.com/atomy/dystopia2', `margin-top:30px;font:500 22px 'JetBrains Mono',monospace;color:${YEL};text-shadow:0 0 10px ${YEL}88`) +
        line(5.2, 'Fan-made, working title. Not affiliated with Team Dystopia or Puny Human.', `margin-top:60px;font:500 13px 'JetBrains Mono',monospace;letter-spacing:0.08em;color:#8b93b3`);
      return {
        hud: false,
        cam: look(pos, v3(-300, -100, -5600)),
        overlay:
          vignette +
          shade(0.62) +
          logo({ t: c.t - 0.2, frame: c.frame, size: 110, y: '34%' }) +
          `<div style="position:absolute;left:0;right:0;top:50%;text-align:center">${lines}</div>` +
          flash(Math.max(0, 1 - c.t / 0.5)) +
          shade(smooth((c.t - 10.4) / 1.4)),
      };
    },
  },
];

export { lerp, clamp01 };
