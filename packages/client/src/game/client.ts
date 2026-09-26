import * as THREE from 'three';
import {
  type Snapshot,
  type NetLocal,
  type NetPlayer,
  type NetEvent,
  type NetEnt,
  type PlayerInfo,
  type ServerMsg,
  type UserCmd,
  type Vec3,
  type LevelEntity,
  TICK_MS,
  INTERP_DELAY_MS,
  EvKind,
  EntKind,
  PF,
  Snd,
  Team,
  TEAM_COLORS,
  WeaponId,
  WEAPONS,
  CLASSES,
  ClassId,
  ImplantId,
  DEFAULT_LOADOUTS,
  ProgramId,
  PROGRAMS,
  PROGRAM_RANGE,
  Buttons,
  CYBER_EYE,
  DEFAULT_MOVE,
  CONTENTS_SOLID,
  quantizeCmd,
  cyberBasis,
  cyberAnglesFor,
  angleVectors,
  spreadOffsets,
  lerpAngle,
  vlerp,
  vadd,
  vsub,
  vscale,
  vdist,
  vlen,
  vma,
  vnorm,
  vdot,
  v3,
  hasImplant,
  parseVec,
  propNum,
} from '@d2/shared';
import { Connection } from '../net.js';
import { Input } from '../input.js';
import { Renderer } from '../render/renderer.js';
import { buildLevelVisuals } from '../render/levelMesh.js';
import { EntityRenderer } from '../render/entities.js';
import { Effects } from '../render/effects.js';
import { ViewModel } from '../render/viewmodel.js';
import { PlayerModel, CyberAvatar } from '../render/players.js';
import { ClientWorld, type Predicted, predictedFrom } from './world.js';
import { Hud, type HudObjective, type HudProgram } from '../ui/hud.js';
import { showLoadout, showPause, showLoading, saveSettings, type Settings, type LoadoutChoice } from '../ui/menus.js';
import { sfx, type SfxName } from '../audio/sfx.js';

const toThree = (v: Vec3) => new THREE.Vector3(v.x, v.z, -v.y);

const FIRE_SFX: Record<number, SfxName> = {
  [WeaponId.MachinePistol]: 'mp_fire',
  [WeaponId.Shotgun]: 'shotgun_fire',
  [WeaponId.AssaultRifle]: 'ar_fire',
  [WeaponId.Minigun]: 'minigun_fire',
};

const SND_SFX: Partial<Record<Snd, SfxName>> = {
  [Snd.Jump]: 'jump',
  [Snd.Land]: 'land',
  [Snd.Boost]: 'boost_jump',
  [Snd.Ledge]: 'ledge_grab',
  [Snd.Pain]: 'pain',
  [Snd.Death]: 'death',
  [Snd.Reload]: 'reload',
  [Snd.Dry]: 'dry_fire',
  [Snd.Switch]: 'grenade_throw',
  [Snd.StealthOn]: 'stealth_on',
  [Snd.StealthOff]: 'stealth_off',
  [Snd.Thermal]: 'thermal_on',
  [Snd.TacPing]: 'tac_ping',
  [Snd.Heal]: 'heal',
  [Snd.JackIn]: 'jack_in',
  [Snd.JackOut]: 'jack_out',
  [Snd.Eject]: 'eject',
  [Snd.DoorMove]: 'door_move',
  [Snd.Capture]: 'capture',
  [Snd.Denied]: 'denied',
  [Snd.Bounce]: 'cyber_bounce',
  [Snd.Crystal]: 'crystal_pickup',
  [Snd.Katana]: 'katana_swing',
  [Snd.Block]: 'katana_block',
  [Snd.Punch]: 'fist_punch',
  [Snd.GrenadeBounce]: 'grenade_bounce',
  [Snd.Spawn]: 'spawn',
  [Snd.Wave]: 'wave_warning',
  [Snd.ProgramDone]: 'program_done',
  [Snd.ProgramFail]: 'program_fail',
  [Snd.Alarm]: 'alarm',
  [Snd.Footstep]: 'footstep',
  [Snd.Pad]: 'cyber_pad',
};

interface RemoteView {
  model: PlayerModel | null;
  avatar: CyberAvatar | null;
  cls: number;
  team: number;
  lastPos: Vec3;
  stepDist: number;
}

export class ClientGame {
  private conn: Connection;
  private readonly input: Input;
  private renderer: Renderer | null = null;
  private hud: Hud | null = null;
  private world: ClientWorld | null = null;
  private ents: EntityRenderer | null = null;
  private fx: Effects | null = null;
  private vm: ViewModel | null = null;

  me = 0;
  host = false;
  room = '';
  private players: PlayerInfo[] = [];
  private snaps: Snapshot[] = [];
  private latest: Snapshot | null = null;
  private local: NetLocal | null = null;
  private pred: Predicted | null = null;
  private pending: UserCmd[] = [];
  private seq = 0;
  private yaw = 0;
  private pitch = 0;
  private meatYaw = 0;
  private meatPitch = 0;
  private wasDecked = false;
  private wasAlive = false;
  private tickOffset: number | null = null;
  private smooth = v3();
  private camUp = new THREE.Vector3(0, 1, 0);
  private remotes = new Map<number, RemoteView>();
  private tacPings: { pos: Vec3; until: number }[] = [];
  private objectives: LevelEntity[] = [];
  private lastFrame = performance.now();
  private fps = 60;
  private running = true;
  private overlayClose: (() => void) | null = null;
  private chatInput: HTMLInputElement | null = null;
  private stepDist = 0;
  private duckEye = DEFAULT_MOVE.eyeHeight;
  private lastEyeTeam = 0;
  private thermal = false;
  private stealth = false;
  private hurt = 0;
  private readonly killerPos = { pos: null as Vec3 | null };
  private deadCam: Vec3 | null = null;
  private firstLoadout = true;

  constructor(
    private readonly ui: HTMLElement,
    private readonly gameEl: HTMLElement,
    private readonly settings: Settings,
    hello: { name: string; create: boolean; room?: string; bots: number; ff: boolean },
    private readonly onExit: (reason: string) => void,
  ) {
    this.input = new Input(gameEl);
    this.input.sensitivity = settings.sensitivity;
    sfx.setVolume(settings.volume);
    const loading = showLoading(ui, 'CONNECTING…');
    this.conn = new Connection(
      { name: hello.name, create: hello.create, room: hello.room, bots: hello.bots, ff: hello.ff },
      {
        onJson: (m) => this.onJson(m, loading),
        onSnapshot: (s) => this.onSnapshot(s),
        onClose: (reason) => {
          loading.close();
          this.shutdown();
          this.onExit(reason);
        },
      },
    );
    gameEl.addEventListener('click', () => {
      sfx.unlock();
      if (!this.overlayClose && this.world) this.input.lock();
    });
    document.addEventListener('pointerlockchange', () => {
      if (!document.pointerLockElement && this.world && !this.overlayClose && !this.chatInput && this.running) this.openPause();
    });
    window.addEventListener('keydown', (e) => this.onKey(e));
    if (import.meta.env.DEV) (window as unknown as { __d2: ClientGame }).__d2 = this;
  }

  /** Dev/test hook: look in a direction and hold buttons without pointer lock. */
  debugDrive(opts: { yaw?: number; pitch?: number; buttons?: number; forward?: number; side?: number; lock?: boolean }): void {
    if (opts.yaw !== undefined) this.yaw = opts.yaw;
    if (opts.pitch !== undefined) this.pitch = opts.pitch;
    this.input.debug = { buttons: opts.buttons ?? 0, forward: opts.forward ?? 0, side: opts.side ?? 0 };
    if (opts.lock !== undefined) this.input.locked = opts.lock;
  }

  /** Dev/test hook: free camera override (sim coordinates) for visual checks. */
  debugCam: { pos: Vec3; yaw: number; pitch: number; up?: Vec3 } | null = null;

  /** Dev/test hook: walk through waypoints (sim x,y) automatically. */
  debugRoute: Vec3[] = [];

  debugLoadout(cls: number, implants?: number[]): void {
    this.conn.send({ t: 'loadout', cls, primary: 0, implants: implants ?? [...DEFAULT_LOADOUTS[cls as ClassId]!], programs: [] });
  }

  debugState(): unknown {
    return { me: this.me, room: this.room, pred: this.pred, local: this.local, tick: this.latest?.tick, players: this.latest?.players.length, fps: this.fps };
  }

  // ---------------------------------------------------------------------------
  // Network

  private async onJson(m: ServerMsg, loading: ReturnType<typeof showLoading>): Promise<void> {
    switch (m.t) {
      case 'welcome': {
        this.me = m.you;
        this.room = m.room;
        this.host = m.host;
        history.replaceState(null, '', `?room=${m.room}`);
        loading.set(0.1, `LOADING ${m.map.toUpperCase()}…`);
        const src = await (await fetch(`/maps/${m.map}.map`)).text();
        loading.set(0.3, 'BAKING LIGHT…');
        await new Promise((r) => setTimeout(r, 20));
        const world = new ClientWorld(m.map, src);
        try {
          this.renderer = new Renderer(this.gameEl, this.settings.quality);
        } catch {
          loading.close();
          this.shutdown();
          this.conn.close();
          this.onExit('WebGL is not available in this browser. Enable hardware acceleration (or use Chrome/Firefox) and try again.');
          return;
        }
        this.renderer.baseFov = fovVertical(this.settings.fov);
        const vis = buildLevelVisuals(world.level);
        this.renderer.scene.add(vis.world);
        this.ents = new EntityRenderer(this.renderer.scene, world.level, vis);
        this.fx = new Effects(this.renderer.scene);
        this.vm = new ViewModel(this.renderer.viewCamera, this.renderer.viewScene);
        this.hud = new Hud(this.ui);
        this.world = world;
        this.objectives = this.world.level.entities.filter((e) => e.classname === 'd2_objective').sort((a, b) => propNum(a, 'stage', 1) - propNum(b, 'stage', 1));
        loading.close();
        this.hud.system(`Joined room ${m.room}${m.host ? ' as host' : ''}. Invite friends with the room code or ?room=${m.room}`);
        sfx.loop('meat_ambience', true, { volume: 0.5 });
        requestAnimationFrame((t) => this.frame(t));
        break;
      }
      case 'players':
        this.players = m.players;
        break;
      case 'chat': {
        const p = this.players.find((x) => x.id === m.from);
        this.hud?.chat(m.name, p?.team ?? 0, m.text, m.teamOnly);
        sfx.play('chat', { volume: 0.4 });
        break;
      }
      case 'event':
        if (m.kind === 'objective' || m.kind === 'stage' || m.kind === 'round') {
          this.hud?.showNotice(m.text, m.kind === 'round' ? 'var(--magenta)' : 'var(--yellow)', 5);
          if (m.kind === 'round') {
            const won = (this.latest?.rules.winner ?? 0) === this.myTeam();
            sfx.play(m.text.startsWith('New') ? 'spawn' : won ? 'round_win' : 'round_lose');
          } else sfx.play('capture');
        } else this.hud?.system(m.text);
        break;
      case 'error':
        this.hud?.system(`⚠ ${m.message}`);
        if (!this.world) {
          loading.close();
          this.shutdown();
          this.onExit(m.message);
        }
        break;
      case 'pong':
        break;
    }
  }

  private onSnapshot(s: Snapshot): void {
    if (!this.world) return;
    const nowTicks = performance.now() / TICK_MS;
    const sample = s.tick - nowTicks;
    if (this.tickOffset === null || Math.abs(sample - this.tickOffset) > 30) this.tickOffset = sample;
    else this.tickOffset += (sample - this.tickOffset) * 0.08;
    this.snaps.push(s);
    while (this.snaps.length > 40) this.snaps.shift();
    this.latest = s;
    this.world.phase = s.rules.phase;
    this.world.applyEnts(s.ents, performance.now() / 1000);
    for (const e of s.events) this.onEvent(e);

    const L = s.local;
    if (!L) return;
    this.local = L;
    const me = s.players.find((p) => p.id === this.me);
    const alive = !!me && (me.flags & PF.ALIVE) !== 0;
    this.thermal = !!me && (me.flags & PF.THERMAL) !== 0;
    this.stealth = !!me && (me.flags & PF.STEALTH) !== 0;
    this.vm?.setTeam(me?.team ?? 0);

    // Transitions: jacking in/out resets the view frame.
    const decked = L.cyber !== null;
    if (decked && !this.wasDecked) {
      this.meatYaw = this.yaw;
      this.meatPitch = this.pitch;
      this.yaw = 0;
      this.pitch = 0;
      sfx.loop('meat_ambience', false);
      sfx.loop('cyber_ambience', true, { volume: 0.6 });
    } else if (!decked && this.wasDecked) {
      this.yaw = this.meatYaw;
      this.pitch = this.meatPitch;
      sfx.loop('cyber_ambience', false);
      sfx.loop('meat_ambience', true, { volume: 0.5 });
    }
    if (alive && !this.wasAlive) {
      this.yaw = me!.yaw;
      this.pitch = 0;
      this.deadCam = null;
      this.pending = [];
    }
    this.wasDecked = decked;
    this.wasAlive = alive;

    // Reconcile prediction: take the server state and replay unacknowledged commands.
    const before = this.pred ? (this.pred.cyber ? this.pred.cyber.origin : this.pred.move.origin) : null;
    this.pending = this.pending.filter((c) => c.seq > s.ack);
    const p = predictedFrom(L);
    const ctx = this.stepCtx(me ?? null);
    for (const c of this.pending) this.world.step(p, c, ctx);
    const after = p.cyber ? p.cyber.origin : p.move.origin;
    if (before && this.pred && !!this.pred.cyber === !!p.cyber) {
      const err = vsub(before, after);
      if (vlen(err) < 48) this.smooth = vadd(this.smooth, err);
      else this.smooth = v3();
    } else this.smooth = v3();
    this.pred = p;
  }

  private stepCtx(me: NetPlayer | null) {
    const L = this.local!;
    return {
      team: me?.team ?? this.myTeam(),
      cls: L.cls,
      implants: L.implants,
      energy: L.energy,
      emped: L.emp > 0,
      alive: !!me && (me.flags & PF.ALIVE) !== 0,
      now: performance.now() / 1000,
    };
  }

  private myTeam(): number {
    return this.latest?.players.find((p) => p.id === this.me)?.team ?? this.players.find((p) => p.id === this.me)?.team ?? 0;
  }

  private playerName(id: number): string {
    return this.players.find((p) => p.id === id)?.name ?? `#${id}`;
  }

  private playerTeam(id: number): number {
    return this.latest?.players.find((p) => p.id === id)?.team ?? this.players.find((p) => p.id === id)?.team ?? 0;
  }

  private myBodyPos(): Vec3 | null {
    return this.latest?.players.find((p) => p.id === this.me)?.origin ?? null;
  }

  /** Should a positional sound be heard? Meat sounds while decked only via the cyber mic. */
  private hear(pos: Vec3): { ok: boolean; muffled: boolean } {
    const decked = !!this.pred?.cyber;
    const inCyber = pos.z < -1000;
    if (decked === inCyber) return { ok: true, muffled: false };
    if (decked && !inCyber) {
      const body = this.myBodyPos();
      if (body && vdist(body, pos) < 384) return { ok: true, muffled: true };
    }
    return { ok: false, muffled: false };
  }

  private play(name: SfxName, pos: Vec3 | null, volume = 1, pitch = 1): void {
    if (!pos) {
      sfx.play(name, { volume, pitch });
      return;
    }
    const h = this.hear(pos);
    if (!h.ok) return;
    const p = toThree(pos);
    sfx.play(name, { pos: h.muffled ? undefined : { x: p.x, y: p.y, z: p.z }, volume: h.muffled ? volume * 0.8 : volume, pitch, muffled: h.muffled });
  }

  private onEvent(e: NetEvent): void {
    const fx = this.fx!;
    switch (e.k) {
      case EvKind.Fire: {
        const shooter = this.latest?.players.find((p) => p.id === e.shooter);
        const team = shooter?.team ?? 0;
        for (const end of e.ends) {
          fx.tracer(e.start, end, team === Team.Punk ? 0xffb0c0 : 0xb0e8ff);
          fx.impact(end);
        }
        fx.muzzle(e.start);
        const snd = FIRE_SFX[e.weapon];
        if (snd) this.play(e.weapon === WeaponId.Shotgun && e.alt ? 'shotgun_double' : e.weapon === WeaponId.AssaultRifle && e.alt ? 'ar_burst' : snd, e.start, 0.9);
        break;
      }
      case EvKind.Melee: {
        const a = this.latest?.players.find((p) => p.id === e.attacker);
        if (!a) break;
        const pos = vadd(a.origin, v3(0, 0, 50));
        this.play(e.result === 2 ? 'katana_block' : e.weapon === WeaponId.Fist ? 'fist_punch' : e.result === 1 ? 'katana_hit' : 'katana_swing', pos);
        if (e.result === 2) fx.sparks(pos, 0xbfefff, 14, 260);
        break;
      }
      case EvKind.Explosion:
        fx.explosion(e.pos, e.radius, e.kind);
        this.play(e.kind === 2 ? 'emp_explode' : e.kind >= 5 ? (e.kind === 6 ? 'eject' : 'cyber_explode') : 'frag_explode', e.pos, e.kind === 4 ? 1.6 : 1);
        break;
      case EvKind.Kill: {
        const mine = e.killer === this.me || e.victim === this.me;
        this.hud?.kill(e.killer && e.killer !== e.victim ? this.playerName(e.killer) : '', this.playerTeam(e.killer), this.playerName(e.victim), this.playerTeam(e.victim), e.weapon, e.headshot, mine);
        if (e.killer === this.me && e.victim !== this.me) sfx.play('kill_confirm', { volume: 0.7 });
        if (e.victim === this.me) {
          const k = this.latest?.players.find((p) => p.id === e.killer);
          this.killerPos.pos = k ? k.origin : null;
        }
        break;
      }
      case EvKind.Damage: {
        let ang: number | null = null;
        if (vlen(e.dir) > 0.1) {
          const incoming = Math.atan2(-e.dir.y, -e.dir.x) * (180 / Math.PI);
          ang = -(incoming - this.yaw) + 0;
        }
        this.hud?.damaged(e.amount, ang);
        this.hurt = Math.min(1, this.hurt + e.amount / 60);
        break;
      }
      case EvKind.Hit:
        this.hud?.hit(e.kill);
        sfx.play('hit_beep', { volume: 0.55, pitch: e.headshot ? 1.3 : 1 });
        break;
      case EvKind.Sound: {
        const name = SND_SFX[e.sound as Snd];
        if (!name) break;
        if (e.player === this.me && (e.sound === Snd.Jump || e.sound === Snd.Land || e.sound === Snd.Boost || e.sound === Snd.Ledge)) break; // predicted locally
        if (e.sound === Snd.Wave || e.sound === Snd.Denied || e.sound === Snd.Dry) {
          this.play(name, null, 0.7);
          break;
        }
        this.play(name, e.pos.x === 0 && e.pos.y === 0 && e.pos.z === 0 ? null : e.pos, e.sound === Snd.Bounce ? 0.4 : 0.9);
        break;
      }
      case EvKind.Tac: {
        const until = performance.now() / 1000 + 4;
        for (const p of e.pings) this.tacPings.push({ pos: p.pos, until });
        const body = this.myBodyPos();
        if (body) fx.ring(body, 0x27e6ff, 2048, 1.2);
        sfx.play('tac_ping', { volume: 0.7 });
        break;
      }
      case EvKind.Jack: {
        const p = this.latest?.players.find((x) => x.id === e.player);
        if (e.player === this.me) this.play(e.inout === 1 ? 'jack_in' : e.inout === 2 ? 'eject' : 'jack_out', null, 1);
        else if (p) this.play(e.inout === 1 ? 'jack_in' : 'jack_out', p.origin, 0.8);
        if (e.inout === 2 && e.player === this.me) this.hud?.showNotice('EJECTED — DUMPSHOCK', 'var(--red)', 2.5);
        break;
      }
      case EvKind.CyberFire: {
        const team = this.playerTeam(e.shooter);
        const col = TEAM_COLORS[team] ?? '#ffffff';
        if (e.kind === 0) {
          fx.beam(e.start, e.end, col, 3, 0.35, 3);
          fx.sparks(e.end, col, 10, 200, 0, 0.3);
          this.play('cyber_hitscan', e.start);
        } else if (e.kind === 1) fx.beam(e.start, e.end, 0xb0f4ff, 1.8, 0.1, 2.5);
        else this.play('cyber_proj', e.start);
        break;
      }
      case EvKind.Program:
        sfx.play(e.result === 1 ? 'program_done' : e.result === 2 ? 'program_fail' : 'program_step', { volume: 0.7 });
        if (e.result === 1) this.hud?.showNotice(`${PROGRAMS[e.program]?.name ?? 'Program'} complete`, 'var(--cyan)', 2);
        break;
      case EvKind.Alarm:
        if (e.kind === 1) {
          if (e.ref === this.me) sfx.play('alarm', { volume: 0.9 });
          else {
            this.hud?.system(`⚠ Decker ${this.playerName(e.ref)} is under attack!`);
            sfx.play('alarm', { volume: 0.5 });
          }
        } else {
          this.hud?.showNotice('ICE ALARM TRIPPED', 'var(--red)', 2.5);
          sfx.play('alarm', { volume: 0.8 });
        }
        break;
      case EvKind.Heal: {
        const t = this.latest?.players.find((p) => p.id === e.target);
        if (t) fx.ring(vadd(t.origin, v3(0, 0, 4)), 0x3dff9a, 48, 0.6);
        break;
      }
      case EvKind.TurretFire:
        fx.tracer(e.start, e.end, 0xff6040);
        fx.impact(e.end);
        this.play('turret_fire', e.start, 0.7);
        break;
    }
  }

  // ---------------------------------------------------------------------------
  // Input helpers

  private onKey(e: KeyboardEvent): void {
    if (!this.world || this.chatInput) return;
    if (e.code === 'KeyM' && !this.overlayClose) {
      e.preventDefault();
      this.openLoadout();
    } else if ((e.code === 'KeyY' || e.code === 'KeyU') && !this.overlayClose && this.input.locked) {
      e.preventDefault();
      this.openChat(e.code === 'KeyU');
    }
  }

  private openChat(team: boolean): void {
    if (!this.hud) return;
    this.input.enabled = false;
    const inp = document.createElement('input');
    inp.placeholder = team ? 'team chat…' : 'chat…';
    inp.maxLength = 200;
    this.hud.chatLog.appendChild(inp);
    this.hud.chatLog.classList.add('interactive');
    this.chatInput = inp;
    const done = (send: boolean) => {
      if (send && inp.value.trim()) this.conn.send({ t: 'chat', text: inp.value.trim(), teamOnly: team });
      inp.remove();
      this.hud?.chatLog.classList.remove('interactive');
      this.chatInput = null;
      this.input.enabled = true;
      this.input.lock();
    };
    inp.onkeydown = (ev) => {
      ev.stopPropagation();
      if (ev.key === 'Enter') done(true);
      if (ev.key === 'Escape') done(false);
    };
    setTimeout(() => inp.focus(), 0);
  }

  private openLoadout(): void {
    this.input.unlock();
    const L = this.local;
    const cur: LoadoutChoice = {
      team: this.myTeam() || Team.Punk,
      cls: (L?.nextCls ?? ClassId.Medium) as ClassId,
      implants: L ? implantList(L.nextImplants) : [...DEFAULT_LOADOUTS[ClassId.Medium]!],
    };
    this.overlayClose = showLoadout(
      this.ui,
      cur,
      (c) => {
        this.overlayClose = null;
        if (c.team !== this.myTeam()) this.conn.send({ t: 'team', team: c.team });
        this.conn.send({ t: 'loadout', cls: c.cls, primary: 0, implants: c.implants, programs: [] });
        this.input.lock();
      },
      () => {
        this.overlayClose = null;
        this.input.lock();
      },
    );
  }

  private openPause(): void {
    this.overlayClose = showPause(this.ui, {
      resume: () => {
        this.overlayClose = null;
        this.input.lock();
      },
      loadout: () => {
        this.overlayClose = null;
        this.openLoadout();
      },
      leave: () => {
        this.overlayClose = null;
        this.conn.close();
      },
      settings: this.settings,
      applySettings: (s) => {
        Object.assign(this.settings, s);
        this.input.sensitivity = s.sensitivity;
        sfx.setVolume(s.volume);
        if (this.renderer) this.renderer.baseFov = fovVertical(s.fov);
        saveSettings(this.settings);
      },
      host: this.host,
      room: this.room,
      hostAction: (a) => {
        if (a.fillbots !== undefined) this.conn.send({ t: 'fillbots', perTeam: a.fillbots });
        if (a.kickbots) this.conn.send({ t: 'kickbots' });
        if (a.ff !== undefined) this.conn.send({ t: 'settings', ff: a.ff });
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Frame

  private frame(t: number): void {
    if (!this.running) return;
    requestAnimationFrame((tt) => this.frame(tt));
    const dt = Math.min(0.1, Math.max(0.001, (t - this.lastFrame) / 1000));
    this.lastFrame = t;
    this.fps = this.fps * 0.95 + (1 / dt) * 0.05;
    if (!this.world || !this.renderer || !this.hud) return;
    if (this.firstLoadout && this.latest) {
      this.firstLoadout = false;
      this.openLoadout();
    }
    const nowS = performance.now() / 1000;
    const renderTick = this.tickOffset === null ? 0 : performance.now() / TICK_MS + this.tickOffset - INTERP_DELAY_MS / TICK_MS;

    // ---- input -> command -> prediction
    const me = this.latest?.players.find((p) => p.id === this.me) ?? null;
    if (this.debugRoute.length && this.pred && this.input.debug) {
      const c = this.pred.cyber;
      const wp = this.debugRoute[0]!;
      if (c) {
        const to = vsub(wp, c.origin);
        if (vlen(to) < 40 || (vlen(to) < 160 && vdot(to, c.velocity) < 0 && vlen(c.velocity) > 150)) this.debugRoute.shift();
        else {
          const a = cyberAnglesFor(c.up, c.north, to);
          this.yaw = a.yaw;
          this.pitch = Math.max(-89, Math.min(89, a.pitch));
          this.input.debug.forward = 1;
        }
      } else {
        const pos = this.pred.move.origin;
        if (Math.hypot(wp.x - pos.x, wp.y - pos.y) < 24) this.debugRoute.shift();
        else {
          this.yaw = (Math.atan2(wp.y - pos.y, wp.x - pos.x) * 180) / Math.PI;
          this.input.debug.forward = 1;
        }
      }
      if (!this.debugRoute.length) this.input.debug.forward = 0;
    }
    if (this.pred && this.local) {
      const m = this.input.takeMouse();
      const sens = this.input.sensitivity * (this.pred.weap.zoomed ? 0.45 : 1);
      this.yaw -= m.dx * sens;
      this.pitch = Math.max(-89, Math.min(89, this.pitch + m.dy * sens));
      this.yaw = ((this.yaw % 360) + 540) % 360 - 180;
      let buttons = this.input.buttons();
      let weapon = 0;
      const decked = !!this.pred.cyber;
      for (const code of this.input.consumePressed()) {
        const d = /^Digit([1-9])$/.exec(code);
        if (!d) continue;
        const n = Number(d[1]);
        if (decked) {
          const prog = this.programChoice(n);
          if (prog > 0) {
            buttons |= Buttons.PROGRAM;
            weapon = prog;
          }
        } else if (n <= 4) weapon = n;
      }
      if (!decked && this.input.wheel !== 0) {
        weapon = this.cycleWeapon(Math.sign(this.input.wheel));
        this.input.wheel = 0;
      }
      const mv = this.input.move();
      // Long frames (slow machines) are split so simulated time keeps up with real time.
      let ms = dt * 1000;
      const out: UserCmd[] = [];
      while (ms > 0.5) {
        const chunk = Math.min(ms, 40);
        ms -= chunk;
        const cmd = quantizeCmd({
          seq: ++this.seq,
          msec: Math.max(1, chunk),
          forward: mv.forward,
          side: mv.side,
          buttons,
          pitch: this.pitch,
          yaw: this.yaw,
          weapon: out.length ? 0 : weapon,
          viewTick: renderTick,
        });
        this.runLocal(cmd, me);
        this.pending.push(cmd);
        out.push(cmd);
      }
      if (this.pending.length > 240) this.pending.splice(0, this.pending.length - 240);
      this.conn.sendCmds(out);
    }

    // ---- camera
    const cam = this.renderer.camera;
    this.smooth = vscale(this.smooth, Math.max(0, 1 - dt * 12));
    const alive = !!me && (me.flags & PF.ALIVE) !== 0;
    const decked = !!this.pred?.cyber;
    if (this.pred && alive && decked) {
      const c = this.pred.cyber!;
      const b = cyberBasis(c.up, c.north, this.pitch, this.yaw);
      const eye = vadd(vma(c.origin, CYBER_EYE, c.up), this.smooth);
      cam.position.copy(toThree(eye));
      const upT = toThree(c.up);
      this.camUp.lerp(upT, Math.min(1, dt * 9)).normalize();
      cam.up.copy(this.camUp);
      cam.lookAt(cam.position.clone().add(toThree(b.forward)));
    } else if (this.pred && alive) {
      const m = this.pred.move;
      const target = m.ducked ? DEFAULT_MOVE.duckEyeHeight : DEFAULT_MOVE.eyeHeight;
      this.duckEye += (target - this.duckEye) * Math.min(1, dt * 14);
      const eye = vadd(v3(m.origin.x, m.origin.y, m.origin.z + this.duckEye), this.smooth);
      cam.position.copy(toThree(eye));
      this.camUp.set(0, 1, 0);
      cam.up.set(0, 1, 0);
      const f = angleVectors(this.pitch, this.yaw).forward;
      cam.lookAt(cam.position.clone().add(toThree(f)));
      this.deadCam = eye;
    } else {
      // Death cam: hover above the body, look at the killer.
      const base = this.deadCam ?? (me ? vadd(me.origin, v3(0, 0, 64)) : v3(0, 0, 200));
      const up = vadd(base, v3(0, 0, 40));
      cam.position.copy(toThree(up));
      cam.up.set(0, 1, 0);
      const look = this.killerPos.pos ? vadd(this.killerPos.pos, v3(0, 0, 40)) : vadd(base, v3(100, 0, -40));
      cam.lookAt(toThree(look));
    }

    if (this.debugCam) {
      const d = this.debugCam;
      cam.position.copy(toThree(d.pos));
      cam.up.copy(toThree(d.up ?? v3(0, 0, 1)));
      cam.lookAt(cam.position.clone().add(toThree(angleVectors(d.pitch, d.yaw).forward)));
    }

    // ---- remote players & avatars
    this.updateRemotes(renderTick, dt, nowS, me);

    // ---- entities, effects, viewmodel
    this.ents!.update(this.world, nowS, this.myTeam(), this.latest?.rules.stage ?? 1);
    this.fx!.update(dt);
    const speed = this.pred ? Math.hypot(this.pred.move.velocity.x, this.pred.move.velocity.y) : 0;
    this.vm!.update(dt, {
      weapon: this.pred?.weap.current ?? 0,
      speed,
      onGround: this.pred?.move.onGround ?? true,
      reloading: (this.pred?.weap.reloadEnd ?? 0) > 0,
      decked,
      alive,
      spin: this.pred?.weap.spin ?? 0,
      zoomed: this.pred?.weap.zoomed ?? false,
      blocking: this.pred?.weap.blocking ?? false,
      pitch: this.pitch,
    });

    // ---- audio listener & loops
    const fwdT = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    sfx.setListener(cam.position, fwdT, cam.up);
    sfx.loop('minigun_spin', (this.pred?.weap.spin ?? 0) > 0.02 && alive && !decked, { key: 'me', volume: 0.6, pitch: 0.25 + (this.pred?.weap.spin ?? 0) * 0.75 });
    sfx.loop('shaft', decked && alive && (this.local?.cyberMode ?? 0) === 1 && (this.input.buttons() & Buttons.ATTACK) !== 0, { volume: 0.6 });
    sfx.loop('stealth_hum', this.stealth && alive, { volume: 0.35 });
    sfx.loop('crack', (this.local?.crack ?? -1) >= 0, { volume: 0.5 });
    sfx.loop('program', !!this.local?.program, { volume: 0.4 });
    sfx.loop('alarm', decked && (this.local?.bodyAlarm ?? 99) < 1.2, { volume: 0.5 });

    // ---- HUD
    this.hurt = Math.max(0, this.hurt - dt * 1.5);
    this.updateHud(me, nowS);
    this.hud.showScoreboard(this.input.isDown('Tab') && this.input.locked, this.players, new Map((this.latest?.players ?? []).map((p) => [p.id, p])), this.me);

    this.renderer.setMode({
      cyber: decked,
      thermal: this.thermal && !decked,
      emp: (this.local?.emp ?? 0) > 0 ? Math.min(1, 0.35 + (this.local?.emp ?? 0) / 20) : 0,
      hurt: this.hurt,
      time: nowS,
      zoom: !!this.pred?.weap.zoomed,
    });
    this.renderer.render();
  }

  /** Run a fresh command through prediction and play its local effects. */
  private runLocal(cmd: UserCmd, me: NetPlayer | null): void {
    const p = this.pred!;
    const world = this.world!;
    const oldFrame = p.cyber?.frame;
    const oldFwd = p.cyber ? cyberBasis(p.cyber.up, p.cyber.north, this.pitch, this.yaw).forward : null;
    const res = world.step(p, cmd, this.stepCtx(me));
    // Gravity flipped: keep looking the same way in world space.
    if (p.cyber && oldFwd && p.cyber.frame !== oldFrame) {
      const a = cyberAnglesFor(p.cyber.up, p.cyber.north, oldFwd);
      this.yaw = a.yaw;
      this.pitch = Math.max(-89, Math.min(89, a.pitch));
    }
    if (res.cyber) {
      if (res.cyber.bounced) sfx.play('cyber_bounce', { volume: 0.25 });
      if (res.cyber.padLaunched) sfx.play('cyber_pad', { volume: 0.7 });
      if (res.cyber.reoriented) sfx.play('cyber_pad', { volume: 0.35, pitch: 0.6 });
    }
    if (res.move) {
      const m = res.move;
      if (m.boostJump > 0) sfx.play('boost_jump', { volume: 0.8 });
      else if (m.jumped) sfx.play('jump', { volume: 0.5 });
      if (m.landed) sfx.play(m.landSpeed > 500 ? 'land_hard' : 'land', { volume: Math.min(1, m.landSpeed / 500) });
      if (m.ledgeGrab) sfx.play('ledge_grab');
      if (m.slideStart) sfx.play('slide');
      // Footsteps.
      const mv = p.move;
      const sp = Math.hypot(mv.velocity.x, mv.velocity.y);
      if (mv.onGround && sp > 160 && !mv.ducked && !(cmd.buttons & Buttons.WALK)) {
        this.stepDist += sp * (cmd.msec / 1000);
        if (this.stepDist > 95) {
          this.stepDist = 0;
          sfx.play('footstep', { volume: 0.35 });
        }
      }
    }
    for (const e of res.weapons) {
      switch (e.kind) {
        case 'fire': {
          const def = WEAPONS[e.weapon]!;
          const eye = vadd(p.move.origin, v3(0, 0, p.move.ducked ? DEFAULT_MOVE.duckEyeHeight : DEFAULT_MOVE.eyeHeight));
          const basis = angleVectors(cmd.pitch, cmd.yaw);
          const muzzle = vadd(vadd(vma(eye, 18, basis.forward), vscale(basis.right, 5)), vscale(basis.up, -4));
          for (const o of spreadOffsets(e.seed, e.pellets, e.spread)) {
            const dir = angleVectors(cmd.pitch + o.pitch, cmd.yaw + o.yaw).forward;
            const end = vma(eye, def.range, dir);
            const tr = world.level.collision.trace(eye, end, v3(), v3(), CONTENTS_SOLID);
            const hit = tr.endpos;
            this.fx!.tracer(muzzle, hit, 0xffe0a0);
            if (tr.fraction < 1) this.fx!.impact(hit);
          }
          this.vm!.fire(e.weapon);
          const name = e.weapon === WeaponId.Shotgun && e.alt ? 'shotgun_double' : e.weapon === WeaponId.AssaultRifle && e.alt ? 'ar_burst' : FIRE_SFX[e.weapon];
          if (name) sfx.play(name, { volume: 0.8 });
          break;
        }
        case 'melee':
          this.vm!.melee(e.dir);
          sfx.play(e.weapon === WeaponId.Fist ? 'fist_punch' : 'katana_swing', { volume: 0.8 });
          break;
        case 'throw':
          sfx.play('grenade_throw', { volume: 0.7 });
          break;
        case 'reload':
          sfx.play(e.weapon === WeaponId.Shotgun ? 'reload_shell' : 'reload', { volume: 0.6 });
          break;
        case 'switch':
          sfx.play('weapon_switch', { volume: 0.5 });
          break;
        case 'dry':
          sfx.play('dry_fire', { volume: 0.6 });
          break;
      }
    }
  }

  private cycleWeapon(dir: number): number {
    const w = this.pred?.weap;
    if (!w) return 0;
    const slots = [...new Set(w.owned.map((id) => WEAPONS[id]!.slot))].sort();
    const cur = WEAPONS[w.current]?.slot ?? 1;
    const i = slots.indexOf(cur);
    return slots[(i + dir + slots.length) % slots.length] ?? 0;
  }

  // ---------------------------------------------------------------------------
  // Remote players

  private updateRemotes(renderTick: number, dt: number, now: number, me: NetPlayer | null): void {
    const scene = this.renderer!.scene;
    // Pick the two snapshots around renderTick.
    let a: Snapshot | undefined;
    let b: Snapshot | undefined;
    for (let i = this.snaps.length - 1; i >= 0; i--) {
      const s = this.snaps[i]!;
      if (s.tick <= renderTick) {
        a = s;
        b = this.snaps[i + 1] ?? s;
        break;
      }
    }
    a ??= this.snaps[0];
    b ??= a;
    if (!a || !b) return;
    const f = b.tick === a.tick ? 1 : Math.max(0, Math.min(1, (renderTick - a.tick) / (b.tick - a.tick)));
    const prev = new Map(a.players.map((p) => [p.id, p]));
    const seen = new Set<number>();
    const myTeam = me?.team ?? 0;
    const decked = !!this.pred?.cyber;
    const thermalView = this.thermal && !decked;
    for (const pb of b.players) {
      seen.add(pb.id);
      const pa = prev.get(pb.id) ?? pb;
      let rv = this.remotes.get(pb.id);
      if (!rv || rv.cls !== pb.cls || rv.team !== pb.team) {
        if (rv?.model) scene.remove(rv.model.object);
        rv?.avatar?.dispose(scene);
        rv = { model: null, avatar: null, cls: pb.cls, team: pb.team, lastPos: pb.origin, stepDist: 0 };
        this.remotes.set(pb.id, rv);
      }
      const origin = vlerp(pa.origin, pb.origin, f);
      const isMe = pb.id === this.me;
      // Meat body.
      if (!rv.model) {
        rv.model = new PlayerModel(pb.cls as ClassId, pb.team);
        scene.add(rv.model.object);
      }
      const alive = (pb.flags & PF.ALIVE) !== 0;
      const pdecked = (pb.flags & PF.DECKED) !== 0;
      const vel = pb.velocity;
      rv.model.update(
        {
          origin,
          yaw: lerpAngle(pa.yaw, pb.yaw, f),
          pitch: pa.pitch + (pb.pitch - pa.pitch) * f,
          speed: Math.hypot(vel.x, vel.y),
          ducked: (pb.flags & PF.DUCKED) !== 0,
          onGround: (pb.flags & PF.ONGROUND) !== 0,
          hanging: (pb.flags & PF.HANGING) !== 0,
          decked: pdecked,
          alive,
          weapon: pb.weapon,
          vis: pb.team === myTeam ? Math.max(0.35, pb.vis) : pb.flags & PF.REVEALED ? Math.max(0.5, pb.vis) : pb.vis,
          thermalView: thermalView && alive,
          firing: false,
          sliding: (pb.flags & PF.SLIDING) !== 0,
        },
        dt,
      );
      // First person: never draw our own living body around the camera.
      if (isMe && alive) rv.model.object.visible = false;
      // Remote footsteps.
      if (!isMe && alive && (pb.flags & PF.ONGROUND) !== 0 && !(pb.flags & PF.DUCKED) && !(pb.flags & PF.STEALTH)) {
        rv.stepDist += vdist(origin, rv.lastPos);
        if (rv.stepDist > 100) {
          rv.stepDist = 0;
          this.play('footstep', origin, 0.45);
        }
      }
      rv.lastPos = origin;
      // Minigun spin of others.
      if (!isMe) sfx.loop('minigun_spin', alive && (pb.flags & PF.SPINNING) !== 0 && !decked, { key: `p${pb.id}`, pos: toThree(origin), volume: 0.45 });
      // Cyber avatar.
      if (pb.cyber && alive) {
        rv.avatar ??= new CyberAvatar(pb.team, scene);
        const ca = pa.cyber ?? pb.cyber;
        const pos = vlerp(ca.origin, pb.cyber.origin, f);
        rv.avatar.update(isMe && this.pred?.cyber ? this.pred.cyber.origin : pos, pb.cyber.up, pb.cyber.forward, now, !isMe);
      } else if (rv.avatar) {
        rv.avatar.dispose(scene);
        rv.avatar = null;
      }
    }
    for (const [id, rv] of this.remotes) {
      if (seen.has(id)) continue;
      if (rv.model) scene.remove(rv.model.object);
      rv.avatar?.dispose(scene);
      this.remotes.delete(id);
    }
  }

  // ---------------------------------------------------------------------------
  // HUD

  private nodeContext(): { node: NetEnt | null; ice: NetEnt | null; nodeSrc: LevelEntity | null } {
    const w = this.world!;
    const c = this.pred?.cyber;
    if (!c) return { node: null, ice: null, nodeSrc: null };
    const eye = vma(c.origin, CYBER_EYE, c.up);
    const fwd = cyberBasis(c.up, c.north, this.pitch, this.yaw).forward;
    let node: NetEnt | null = null;
    let nodeSrc: LevelEntity | null = null;
    let bn = Infinity;
    let ice: NetEnt | null = null;
    let bi = Infinity;
    for (const e of w.ents.values()) {
      if (e.kind === EntKind.Node && e.origin) {
        const to = vsub(e.origin, eye);
        const d = vlen(to);
        if (d < PROGRAM_RANGE && d < bn && vdot(vnorm(to), fwd) > 0.2) {
          bn = d;
          node = e;
          nodeSrc = w.byId.get(e.id) ?? null;
        }
      } else if (e.kind === EntKind.Ice && (e.state & 1) === 1) {
        const src = w.byId.get(e.id);
        if (!src) continue;
        const cx = Math.max(src.mins.x, Math.min(eye.x, src.maxs.x));
        const cy = Math.max(src.mins.y, Math.min(eye.y, src.maxs.y));
        const cz = Math.max(src.mins.z, Math.min(eye.z, src.maxs.z));
        const d = vdist(v3(cx, cy, cz), eye);
        if (d < PROGRAM_RANGE && d < bi) {
          bi = d;
          ice = e;
        }
      }
    }
    return { node, ice, nodeSrc };
  }

  /** Programs usable right now (mirror of the server's programApplicable). */
  private availablePrograms(): { list: HudProgram[]; target: string } {
    const L = this.local;
    if (!L || !L.cyber) return { list: [], target: '' };
    const team = this.myTeam();
    const enhanced = hasImplant(L.implants, ImplantId.EnhancedDeck);
    const { node, ice, nodeSrc } = this.nodeContext();
    const stage = this.latest?.rules.stage ?? 1;
    const out: HudProgram[] = [];
    let n = 1;
    const prot = node ? node.a & 15 : 0;
    const protTeam = node ? node.a >> 4 : 0;
    const nodeActive = !!node && (node.state & 1) === 1 && (!node.b || stage >= node.b);
    const doorwayId = nodeSrc?.props['doorway'];
    const doorway = doorwayId ? [...this.world!.ents.values()].find((e) => e.kind === EntKind.Ice && this.world!.byId.get(e.id)?.props['targetname'] === doorwayId) : undefined;
    const iceActive = !!ice && ice.team !== 3;
    const iceBlocks = !!ice && iceActive && ice.value <= 0 && (ice.team === 0 || ice.team !== team);
    const check = (id: ProgramId): boolean => {
      const def = PROGRAMS[id]!;
      if (def.enhanced && !enhanced) return false;
      switch (id) {
        case ProgramId.PasswordProtect:
          return nodeActive && node!.team === team && prot === 0;
        case ProgramId.Encryption:
          return nodeActive && node!.team === team && prot < 2;
        case ProgramId.IceBarrier:
          return nodeActive && node!.team === team && !!doorway && doorway.team === 3;
        case ProgramId.PasswordCracker:
          return !!node && prot === 1 && protTeam !== team;
        case ProgramId.Decryptor:
          return !!node && prot === 2 && protTeam !== team;
        case ProgramId.IceAlarm:
          return iceActive && ice!.team === team && !(ice!.a & 5);
        case ProgramId.IceMine:
          return iceActive && ice!.team === team && !(ice!.a & 6);
        case ProgramId.GreenIce:
          return iceActive && ice!.team === team && ice!.a === 0;
        case ProgramId.Wedge:
          return iceBlocks;
        case ProgramId.IceBreaker:
        case ProgramId.IceScan:
          return iceActive && ice!.team !== team;
      }
      return false;
    };
    const relevant: ProgramId[] = [];
    if (node) relevant.push(ProgramId.PasswordProtect, ProgramId.Encryption, ProgramId.IceBarrier, ProgramId.PasswordCracker, ProgramId.Decryptor);
    if (ice) relevant.push(ProgramId.IceAlarm, ProgramId.IceMine, ProgramId.GreenIce, ProgramId.Wedge, ProgramId.IceBreaker, ProgramId.IceScan);
    for (const id of relevant) {
      const ok = check(id);
      if (!ok && PROGRAMS[id]!.enhanced && !enhanced) continue;
      out.push({ key: ok ? n++ : 0, program: id, available: ok });
    }
    const target = node ? `${nodeSrc?.props['label'] ?? 'Node'} · ${node.team === team ? 'yours' : 'enemy'}${prot ? ` · ${prot === 2 ? 'ENCRYPTED' : 'PASSWORD'}` : ''}` : ice ? `ICE (${['sealed', 'Punk', 'Corp', 'open'][ice.team]})` : '';
    return { list: out.filter((p) => p.available || true), target };
  }

  /** Map a pressed digit to a program id+1 (or a minigame button index). */
  private programChoice(n: number): number {
    const L = this.local;
    if (!L) return 0;
    if (L.program) return n <= 4 ? n : 0;
    const p = this.availablePrograms().list.find((x) => x.key === n && x.available);
    return p ? p.program + 1 : 0;
  }

  private updateHud(me: NetPlayer | null, now: number): void {
    const hud = this.hud!;
    const w = this.world!;
    const L = this.local;
    const team = me?.team ?? 0;
    const objectives: HudObjective[] = this.objectives.map((o) => {
      const st = w.ents.get(o.id);
      return {
        label: o.props['label'] ?? o.props['targetname'] ?? 'Objective',
        desc: o.props['desc'] ?? '',
        stage: propNum(o, 'stage', 1),
        done: !!st && (st.state & 1) === 1,
        optional: propNum(o, 'optional', 0) === 1,
      };
    });
    // Prompts.
    let prompt = '';
    let useProgress = -1;
    const alive = !!me && (me.flags & PF.ALIVE) !== 0;
    const decked = !!this.pred?.cyber;
    if (alive && L && this.pred && !decked) {
      const pos = this.pred.move.origin;
      const hasDeck = hasImplant(L.implants, ImplantId.Cyberdeck) || hasImplant(L.implants, ImplantId.EnhancedDeck);
      for (const e of w.ents.values()) {
        if (e.kind === EntKind.Jip && e.origin && Math.hypot(e.origin.x - pos.x, e.origin.y - pos.y) < 80 && Math.abs(e.origin.z - pos.z) < 64) {
          const src = w.byId.get(e.id);
          if ((e.state & 1) === 0 || (e.team !== 0 && e.team !== team)) continue;
          if (!hasDeck) prompt = 'Jack-in point · you need a Cyberdeck implant';
          else if (e.value > 0.05) prompt = `Jack-in point locked (${e.value.toFixed(0)}s)`;
          else if (e.state & 2) prompt = 'Jack-in point occupied';
          else if (L.energy < 15) prompt = 'Not enough energy to jack in (15)';
          else prompt = `[F] JACK IN · ${src?.props['label'] ?? ''}`;
        }
        if (e.kind === EntKind.Screen && e.origin && vdist(e.origin, vadd(pos, v3(0, 0, 60))) < 130 && (e.state & 3) === 1) {
          const src = w.byId.get(e.id);
          const st = src ? propNum(src, 'stage', 0) : 0;
          const r = this.latest?.rules;
          if (st && r && st !== r.stage) continue;
          if (e.team && e.team !== team) prompt = 'Enemy screen';
          else {
            prompt = `[HOLD E] ${src?.props['label'] ?? 'Use'}`;
            if (e.value > 0) useProgress = e.value;
          }
        }
      }
      if (L.crack >= 0) {
        prompt = '[HOLD E] CRACKING…';
        useProgress = L.crack;
      } else {
        for (const c of w.level.entities) {
          if (c.classname !== 'trigger_crack') continue;
          if (pos.x < c.mins.x || pos.x > c.maxs.x || pos.y < c.mins.y || pos.y > c.maxs.y) continue;
          const st = w.ents.get(c.id);
          if (st && st.state & 1) continue;
          prompt = hasDeck ? `[HOLD E] ${c.props['label'] ?? 'Crack'} (${propNum(c, 'time', 20)}s)` : 'Crack point · needs a Cyberdeck';
          if (st && st.value > 0) useProgress = st.value;
        }
      }
    }
    let programs: HudProgram[] = [];
    let programTarget = '';
    if (decked && alive) {
      const ap = this.availablePrograms();
      programs = ap.list;
      programTarget = ap.target;
      const { node, nodeSrc } = this.nodeContext();
      if (node && !L?.program) {
        const prot = node.a & 15;
        const stage = this.latest?.rules.stage ?? 1;
        const active = (node.state & 1) === 1 && (!node.b || stage >= node.b);
        if (node.team === team) prompt = `${nodeSrc?.props['label'] ?? 'Node'} — secured`;
        else if (!active) prompt = `${nodeSrc?.props['label'] ?? 'Node'} — offline (stage ${node.b})`;
        else if ((node.state & 2) !== 0) prompt = `${nodeSrc?.props['label'] ?? 'Node'} — done`;
        else if (prot) prompt = `${nodeSrc?.props['label'] ?? 'Node'} — ${prot === 2 ? 'ENCRYPTED: run Decryptor' : 'PASSWORD: run Password Cracker'}`;
        else {
          prompt = `[HOLD E] HACK ${nodeSrc?.props['label'] ?? 'node'}`;
          if (node.value > 0) useProgress = node.value;
        }
      }
    }
    // Radar.
    const blips: { pos: Vec3; color: string; size: number }[] = [];
    const origin = decked ? this.pred!.cyber!.origin : (this.pred?.move.origin ?? me?.origin ?? v3());
    for (const p of this.latest?.players ?? []) {
      if (p.id === this.me || !(p.flags & PF.ALIVE)) continue;
      const pos = decked ? p.cyber?.origin : p.cyber ? null : p.origin;
      if (!pos) continue;
      if (p.team === team) blips.push({ pos, color: TEAM_COLORS[team] ?? '#fff', size: 3.5 });
      else if (p.flags & PF.REVEALED) blips.push({ pos, color: '#ff4040', size: 4 });
    }
    this.tacPings = this.tacPings.filter((t) => t.until > now);
    if (!decked) for (const t of this.tacPings) blips.push({ pos: t.pos, color: '#ffd21f', size: 4.5 });
    if (!decked) {
      for (const e of w.ents.values()) {
        if (e.kind === EntKind.Jip && e.origin && (e.state & 1) && (e.team === 0 || e.team === team)) blips.push({ pos: e.origin, color: '#3dff7a', size: 2.2 });
      }
      const stage = this.latest?.rules.stage ?? 1;
      for (const o of this.objectives) if (propNum(o, 'stage', 1) === stage) blips.push({ pos: o.origin, color: '#ffd21f', size: 3 });
    }
    hud.markers(this.buildMarkers(me, team, decked));
    hud.update({
      local: L,
      rules: this.latest?.rules ?? null,
      me,
      team,
      objectives,
      prompt,
      useProgress,
      programs,
      programTarget,
      radar: { me: origin, yaw: decked ? this.yaw : this.yaw, blips },
      fps: this.fps,
      ping: this.conn.rtt,
      thermal: this.thermal,
      stealth: this.stealth,
    });
    void CLASSES;
    void parseVec;
  }

  /** IFF tags over visible team-mates and edge-clamped objective markers. */
  private buildMarkers(me: NetPlayer | null, team: number, decked: boolean): import('../ui/hud.js').HudMarker[] {
    const out: import('../ui/hud.js').HudMarker[] = [];
    const cam = this.renderer!.camera;
    const W = window.innerWidth;
    const H = window.innerHeight;
    const camSim = { x: cam.position.x, y: -cam.position.z, z: cam.position.y };
    const project = (p: Vec3): { x: number; y: number; behind: boolean } => {
      const v = toThree(p).project(cam);
      return { x: ((v.x + 1) / 2) * W, y: ((1 - v.y) / 2) * H, behind: v.z > 1 };
    };
    if (!decked) {
      for (const p of this.latest?.players ?? []) {
        if (p.id === this.me || p.team !== team || !(p.flags & PF.ALIVE) || p.flags & PF.DECKED) continue;
        const head = vadd(p.origin, v3(0, 0, 84));
        if (vdist(head, camSim) > 2500) continue;
        const tr = this.world!.level.collision.trace(camSim, head, v3(), v3(), CONTENTS_SOLID, () => false);
        if (tr.fraction < 0.98) continue;
        const s = project(head);
        if (s.behind || s.x < 0 || s.x > W || s.y < 0 || s.y > H) continue;
        const c = CLASSES[p.cls]!;
        out.push({ x: s.x, y: s.y, kind: 'iff', text: this.playerName(p.id), color: TEAM_COLORS[team] ?? '#fff', hp: p.health / c.health, armor: p.armor / Math.max(1, c.armor) });
      }
      const stage = this.latest?.rules.stage ?? 1;
      for (const o of this.objectives) {
        const st = this.world!.ents.get(o.id);
        if (propNum(o, 'stage', 1) !== stage || (st && st.state & 1)) continue;
        const pos = vadd(o.origin, v3(0, 0, 40));
        const s = project(pos);
        let x = s.x;
        let y = s.y;
        let off = s.behind || x < 40 || x > W - 40 || y < 40 || y > H - 40;
        if (s.behind) {
          x = W - x;
          y = H - 60;
        }
        x = Math.max(60, Math.min(W - 60, x));
        y = Math.max(60, Math.min(H - 80, y));
        off ||= false;
        const dist = Math.round(vdist(pos, me?.origin ?? camSim) / 39.37);
        out.push({ x, y, kind: 'objective', text: `${o.props['label'] ?? 'Objective'} · ${dist}m`, color: '#ffd21f', offscreen: off });
      }
    }
    return out;
  }

  shutdown(): void {
    this.running = false;
    this.input.unlock();
    this.overlayClose?.();
    sfx.stopAllLoops();
    this.renderer?.renderer.dispose();
    this.renderer?.renderer.domElement.remove();
    this.hud?.root.remove();
  }
}

function implantList(mask: number): ImplantId[] {
  const out: ImplantId[] = [];
  for (let i = 0; i < 16; i++) if (mask & (1 << i)) out.push(i as ImplantId);
  return out;
}

/** Horizontal FOV (at 16:9) to three.js vertical FOV. */
function fovVertical(h: number): number {
  const aspect = 16 / 9;
  return (2 * Math.atan(Math.tan((h * Math.PI) / 360) / aspect) * 180) / Math.PI;
}
