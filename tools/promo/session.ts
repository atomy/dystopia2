// Promo recorder session: one in-process game room plus the dev client in
// headless Chrome (SwiftShader), stepped in lockstep. Each video frame advances
// the server by exactly TICK_RATE / fps ticks and the page's virtual clock by
// 1 / fps seconds, so footage is smooth no matter how slowly software WebGL renders.

import { createServer, type Server } from 'node:http';
import { readFileSync, existsSync, statSync, writeFileSync } from 'node:fs';
import { join, extname, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';
import { WebSocketServer, type WebSocket } from 'ws';
import puppeteer, { type Browser, type Page } from 'puppeteer-core';
import { TICK_RATE, SNAPSHOT_RATE, Team, ClassId, Buttons, DEFAULT_LOADOUTS, v3, type UserCmd, type Vec3 } from '@d2/shared';
import { Room, type Client } from '../../packages/server/src/room.js';
import { BotBrain } from '../../packages/server/src/game/bots.js';
import type { Game } from '../../packages/server/src/game/game.js';
import type { ServerPlayer } from '../../packages/server/src/game/player.js';

const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = resolve(here, '..', '..');
const SHIM = readFileSync(join(here, 'shim.js'), 'utf8');
const MIME: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

export interface Cam {
  pos: Vec3;
  yaw: number;
  pitch: number;
  up?: Vec3;
}

/** What the director wants for the next frame. */
export interface FrameArgs {
  /** Free camera (sim coordinates); null hands the camera back to the player. */
  cam?: Cam | null;
  /** HTML for the overlay layer above the game. */
  overlay?: string;
  /** Show the game HUD and viewmodel. */
  hud?: boolean;
  /** Scripted input for the human's player (overrides the pilot). */
  drive?: { yaw?: number; pitch?: number; buttons?: number; forward?: number; side?: number };
  /** Weapon / program field for the next command. */
  weapon?: number;
  /** Press jump exactly when the client's predicted player is on the ground (bunny hopping). */
  bhop?: boolean;
  /** Skip rendering this frame (preview mode, frame not captured). */
  skipRender?: boolean;
  /** Freeze the server (no ticks) but keep sending snapshots. */
  hold?: boolean;
}

/** Where a player was on a past tick (for cameras that track rendered positions). */
export interface Past {
  origin: Vec3;
  eye: Vec3;
  yaw: number;
  alive: boolean;
  decked: boolean;
  cyber: Vec3 | null;
  up: Vec3 | null;
  team: number;
}

interface RoomInternals {
  step(): void;
  sendSnapshots(): void;
}

interface PromoWindow {
  __promo: { t: number; rx: number; advance(dt: number): void; realTimeout: typeof setTimeout; skipRender: boolean };
  __d2?: {
    debugCam: Cam | null;
    debugWeapon: number;
    debugDrive(o: { yaw?: number; pitch?: number; buttons?: number; forward?: number; side?: number; lock?: boolean }): void;
    vm?: { root: { visible: boolean } };
    renderer?: { render(): void };
    pred?: { move: { onGround: boolean } } | null;
    world?: unknown;
    latest?: unknown;
  };
}

export interface SessionOpts {
  clientDir: string;
  map?: string;
  botsPerTeam: number;
  width: number;
  height: number;
  fps: number;
  /** Device pixel ratio: 1.5 renders a 1280x720 layout at 1920x1080. */
  scale?: number;
  ff?: boolean;
  seed?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Seed Math.random (the game picks cyber spawns with it) so pre-rolled matches replay identically. */
export function seedRandom(seed: number): void {
  let a = seed >>> 0;
  Math.random = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Session {
  readonly room: Room;
  readonly game: Game;
  private http!: Server;
  private wss!: WebSocketServer;
  private browser!: Browser;
  page!: Page;
  client: Client | null = null;
  private sent = 0;
  private cmdsIn = 0;
  /** Bot brain that plays the human's player through the real client. */
  pilot: BotBrain | null = null;
  private pilotCmd: UserCmd | null = null;
  private pilotButtons = 0;
  private pilotWeapon = 0;
  private hud = true;
  /** Server ticks run so far in this session. */
  ticks = 0;
  /** Called after every server tick. */
  onTick: ((g: Game) => void) | null = null;
  /** Pick a bot for the browser to take over instead of joining as a new player. */
  possess: ((g: Game) => ServerPlayer | null) | null = null;
  /** Players that take no damage (the camera player during first-person shots). */
  readonly god = new Set<number>();
  /** Called right after the browser's player joins (default: make them a spectator). */
  onJoin: (p: ServerPlayer, g: Game) => void = (p, g) => g.setTeam(p, Team.Spectator);
  private history = new Map<number, Past[]>();

  constructor(readonly opts: SessionOpts) {
    seedRandom(opts.seed ?? 1);
    const map = opts.map ?? 'd2_quarantine';
    const src = readFileSync(join(repoRoot, 'maps', `${map}.map`), 'utf8');
    this.room = new Room('PROMO', map, src, { friendlyFire: opts.ff ?? false, botsPerTeam: opts.botsPerTeam });
    this.game = this.room.game;
    const damage = this.game.damage.bind(this.game);
    this.game.damage = (victim, ...rest) => (this.god.has(victim.id) ? 0 : damage(victim, ...rest));
  }

  get me(): ServerPlayer | null {
    return this.client?.player ?? null;
  }

  /** Run the server alone (no browser) for a while, e.g. to let a match develop. */
  preroll(seconds: number, until?: (g: Game) => boolean): void {
    const n = Math.round(seconds * TICK_RATE);
    for (let i = 0; i < n; i++) {
      this.serverTick();
      if (until?.(this.game)) break;
    }
  }

  private serverTick(): void {
    const r = this.room as unknown as RoomInternals;
    const me = this.me;
    if (this.pilot && me) {
      const c = this.pilot.think(this.game, me);
      this.pilotCmd = c;
      this.pilotButtons |= c.buttons;
      if (c.weapon) this.pilotWeapon = c.weapon;
    }
    r.step();
    this.ticks++;
    if (this.game.tick % Math.round(TICK_RATE / SNAPSHOT_RATE) === 0) r.sendSnapshots();
    for (const p of this.game.players.values()) {
      let h = this.history.get(p.id);
      if (!h) this.history.set(p.id, (h = []));
      const o = p.move.origin;
      h.push({
        origin: { ...o },
        eye: v3(o.x, o.y, o.z + (p.move.ducked ? 28 : 64)),
        yaw: p.yaw,
        alive: p.alive,
        decked: p.decked,
        cyber: p.cyber ? { ...p.cyber.origin } : null,
        up: p.cyber ? { ...p.cyber.up } : null,
        team: p.team,
      });
      if (h.length > 40) h.shift();
    }
    this.onTick?.(this.game);
  }

  /** A player's state `delay` ticks ago (what the client is rendering now). */
  past(id: number, delay = 5): Past | null {
    const h = this.history.get(id);
    if (!h?.length) return null;
    return h[Math.max(0, h.length - 1 - delay)]!;
  }

  players(filter?: (p: ServerPlayer) => boolean): ServerPlayer[] {
    return [...this.game.players.values()].filter((p) => p !== this.me && (!filter || filter(p)));
  }

  async open(): Promise<void> {
    const { clientDir } = this.opts;
    this.http = createServer((req, res) => {
      const path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
      if (path.startsWith('/maps/')) {
        const f = join(repoRoot, 'maps', path.slice(6));
        if (existsSync(f)) {
          res.writeHead(200, { 'content-type': 'text/plain' });
          res.end(readFileSync(f));
          return;
        }
      }
      if (path === '/api/rooms') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ rooms: [], maps: [] }));
        return;
      }
      let f = resolve(clientDir, '.' + path);
      if (!f.startsWith(clientDir) || !existsSync(f) || !statSync(f).isFile()) f = join(clientDir, 'index.html');
      res.writeHead(200, { 'content-type': MIME[extname(f)] ?? 'application/octet-stream' });
      res.end(readFileSync(f));
    });
    this.wss = new WebSocketServer({ server: this.http, path: '/ws' });
    this.wss.on('connection', (ws: WebSocket) => {
      const send = ws.send.bind(ws);
      ws.send = ((data: unknown, ...rest: unknown[]) => {
        this.sent++;
        return (send as (...a: unknown[]) => void)(data, ...rest);
      }) as typeof ws.send;
      ws.on('message', (data, isBinary) => {
        if (isBinary) {
          if (this.client) {
            this.cmdsIn++;
            this.room.onBinary(this.client, new Uint8Array(data as Buffer));
          }
          return;
        }
        const msg = JSON.parse(String(data)) as { t: string; name?: string };
        if (!this.client) {
          if (msg.t === 'hello') {
            const bot = this.possess?.(this.game) ?? null;
            if (bot) this.takeOver(ws, bot);
            else {
              this.client = this.room.join(ws, msg.name ?? 'Runner');
              if (this.client) this.onJoin(this.client.player, this.game);
            }
          }
          return;
        }
        this.room.onJson(this.client, msg as never);
      });
    });
    await new Promise<void>((r) => this.http.listen(0, '127.0.0.1', r));
    const port = (this.http.address() as AddressInfo).port;

    const { width, height } = this.opts;
    this.browser = await puppeteer.launch({
      executablePath: process.env['CHROME'] ?? '/usr/bin/google-chrome-stable',
      headless: true,
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--no-sandbox', `--window-size=${Math.round(width * (this.opts.scale ?? 1))},${Math.round(height * (this.opts.scale ?? 1))}`, '--hide-scrollbars', '--mute-audio'],
      defaultViewport: { width, height, deviceScaleFactor: this.opts.scale ?? 1 },
      protocolTimeout: 600_000,
    });
    this.page = await this.browser.newPage();
    this.page.on('pageerror', (e) => console.error('[page]', (e as Error).message));
    this.page.on('console', (m) => {
      if (m.type() === 'error') console.error('[page]', m.text());
    });
    await this.page.evaluateOnNewDocument(
      `localStorage.setItem('d2.settings', JSON.stringify({ name: 'Runner', sensitivity: 0.12, volume: 0, quality: 'high', fov: 90 }));
       ${SHIM.replace('const P = (window.__promo = {', 'const P = (window.__promo = { realTimeout: window.setTimeout.bind(window),')}`,
    );
    await this.page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
    // Menus render on DOMContentLoaded; pump the clock until the host button exists.
    await this.pumpUntil(() => this.page.evaluate(() => !!document.querySelector('#host')), 'menu');
    await this.page.evaluate(() => {
      (document.querySelector('#name') as HTMLInputElement).value = 'Runner';
      (document.querySelector('#host') as HTMLButtonElement).click();
    });
    await this.pumpUntil(() => this.page.evaluate(() => !!(window as unknown as PromoWindow).__d2?.world), 'world', true);
    // The loadout screen opens on the first frame with a snapshot; close it (the
    // recorder sets teams and classes server side).
    await this.pumpUntil(() => this.page.evaluate(() => !!document.querySelector('#go')), 'loadout', true);
    await this.page.evaluate(() => {
      const d = (window as unknown as { __d2: { overlayClose: (() => void) | null } }).__d2;
      d.overlayClose?.();
      d.overlayClose = null;
    });
    await this.page.addStyleTag({
      content: `#promo{position:fixed;inset:0;z-index:99999;pointer-events:none;overflow:hidden}
        body.promo-nohud .hud{display:none!important}
        .fps,.chat{display:none!important}`,
    });
    await this.page.evaluate(() => {
      const d = document.createElement('div');
      d.id = 'promo';
      document.body.appendChild(d);
    });
    await this.page.evaluate(async () => {
      await Promise.all(['900 58px Orbitron', '600 24px Rajdhani', '500 22px "JetBrains Mono"'].map((f) => document.fonts.load(f)));
      const w = window as unknown as PromoWindow;
      const r = w.__d2!.renderer!;
      const render = r.render.bind(r);
      r.render = () => {
        if (!w.__promo.skipRender) render();
      };
    });
  }

  /** Step frames (without capturing) until the predicate holds. */
  private async pumpUntil(pred: () => Promise<boolean>, what: string, lockstep = false): Promise<void> {
    const t0 = Date.now();
    while (!(await pred())) {
      if (Date.now() - t0 > 120_000) throw new Error(`timed out waiting for ${what}`);
      if (lockstep) await this.frame({ hold: true, skipRender: true });
      else {
        await this.page.evaluate(() => (window as unknown as PromoWindow).__promo.advance(16));
        await sleep(10);
      }
    }
  }

  /** Attach the browser to an existing bot's player; its brain keeps playing it through the client. */
  private takeOver(ws: WebSocket, p: ServerPlayer): void {
    const room = this.room;
    const brain = room.bots.get(p.id) ?? null;
    room.bots.delete(p.id);
    p.bot = false;
    p.lastSeq = 0;
    p.cmdQueue.length = 0;
    const c: Client = { ws, player: p, events: [], host: true };
    room.clients.add(c);
    room.emptySince = 0;
    this.client = c;
    this.pilot = brain;
    const g = this.game;
    room.send(c, { t: 'welcome', you: p.id, room: room.code, map: room.mapName, tick: g.tick, tickRate: TICK_RATE, host: true });
    room.broadcastPlayers();
  }

  /** Give the human player a class and spawn them at a spot (server side). */
  spawnMe(team: number, cls: ClassId, at?: { origin: Vec3; yaw: number }): ServerPlayer {
    const g = this.game;
    const p = this.me!;
    if (p.team !== team) g.setTeam(p, team);
    p.nextCls = cls;
    p.nextImplants = [...DEFAULT_LOADOUTS[cls]!];
    const sp = at ?? g.spawnPoint(team)!;
    p.spawn(sp.origin, 'yaw' in sp ? sp.yaw : (sp as { angle: number }).angle);
    p.spawnTime = g.now;
    p.cmdQueue.length = 0;
    return p;
  }

  /** Let a bot brain play the human's player (commands go through the real client). */
  setPilot(role: 'decker' | 'assault' | null): void {
    if (!role) {
      this.pilot = null;
      return;
    }
    this.pilot = new BotBrain(this.me!.id);
    this.pilot.role = role;
  }

  /** Advance one video frame: server ticks, deliver snapshots, render the page. */
  async frame(args: FrameArgs): Promise<void> {
    const per = Math.round(TICK_RATE / this.opts.fps);
    if (args.hold) (this.room as unknown as RoomInternals).sendSnapshots();
    else for (let i = 0; i < per; i++) this.serverTick();
    const drive = args.drive
      ? { ...args.drive, lock: true }
      : this.pilot && this.pilotCmd
        ? { yaw: this.pilotCmd.yaw, pitch: this.pilotCmd.pitch, buttons: this.pilotButtons, forward: this.pilotCmd.forward, side: this.pilotCmd.side, lock: true }
        : null;
    const weapon = args.weapon ?? this.pilotWeapon;
    this.pilotButtons = 0;
    this.pilotWeapon = 0;
    if (args.hud !== undefined) this.hud = args.hud;
    const before = this.cmdsIn;
    await this.page.evaluate(
      async (a) => {
        const w = window as unknown as PromoWindow;
        const P = w.__promo;
        const t0 = Date.now();
        while (P.rx < a.sent && Date.now() - t0 < 2000) await new Promise((r) => P.realTimeout(r, 1));
        const d = w.__d2;
        if (d) {
          if (a.drive && a.bhop && d.pred) a.drive.buttons = d.pred.move.onGround ? (a.drive.buttons ?? 0) | a.jump : (a.drive.buttons ?? 0) & ~a.jump;
          if (a.drive) d.debugDrive(a.drive);
          if (a.weapon) d.debugWeapon = a.weapon;
          if (a.cam !== undefined) d.debugCam = a.cam;
          if (d.vm) d.vm.root.visible = a.hud;
        }
        document.body.classList.toggle('promo-nohud', !a.hud);
        P.skipRender = a.skip;
        const o = document.getElementById('promo');
        if (o && a.overlay !== undefined && o.innerHTML !== a.overlay) o.innerHTML = a.overlay;
        P.advance(a.dt);
      },
      { sent: this.sent, drive, weapon, cam: args.cam, hud: this.hud, overlay: args.overlay, dt: 1000 / this.opts.fps, skip: !!args.skipRender, bhop: !!args.bhop, jump: Buttons.JUMP },
    );
    // Wait (briefly) for the client's commands for this frame to reach the server.
    const t0 = Date.now();
    while (this.cmdsIn === before && Date.now() - t0 < 40) await new Promise((r) => setImmediate(r));
  }

  async capture(file: string): Promise<void> {
    const buf = await this.page.screenshot({ type: 'jpeg', quality: 94, optimizeForSpeed: true });
    writeFileSync(file, buf);
  }

  async close(): Promise<void> {
    await this.browser?.close().catch(() => {});
    this.wss?.close();
    this.http?.close();
  }
}

export { Team, ClassId };
