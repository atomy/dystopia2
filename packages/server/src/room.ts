// A room = one game instance + its connected clients.

import type { WebSocket } from 'ws';
import {
  type ClientMsg,
  type ServerMsg,
  type PlayerInfo,
  type NetEvent,
  BinMsg,
  TICK_RATE,
  SNAPSHOT_RATE,
  Team,
  ClassId,
  DEFAULT_LOADOUTS,
  decodeUserCmds,
  encodeSnapshot,
} from '@d2/shared';
import { Game } from './game/game.js';
import type { ServerPlayer } from './game/player.js';
import { BotBrain, BOT_NAMES } from './game/bots.js';

export interface Client {
  ws: WebSocket;
  player: ServerPlayer;
  events: NetEvent[];
  host: boolean;
}

export class Room {
  readonly clients = new Set<Client>();
  readonly game: Game;
  readonly bots = new Map<number, BotBrain>();
  private timer: NodeJS.Timeout | null = null;
  private lastTime = 0;
  private acc = 0;
  emptySince = Date.now();
  botsPerTeam = 0;
  private lastPlayersBroadcast = 0;

  constructor(
    readonly code: string,
    readonly mapName: string,
    mapSource: string,
    opts: { friendlyFire: boolean; botsPerTeam: number },
  ) {
    this.game = new Game(mapName, mapSource, { friendlyFire: opts.friendlyFire });
    this.botsPerTeam = opts.botsPerTeam;
  }

  start(): void {
    this.lastTime = performance.now();
    const loop = () => {
      const now = performance.now();
      this.acc += Math.min(now - this.lastTime, 250);
      this.lastTime = now;
      const stepMs = 1000 / TICK_RATE;
      const snapEvery = Math.round(TICK_RATE / SNAPSHOT_RATE);
      while (this.acc >= stepMs) {
        this.acc -= stepMs;
        this.step();
        if (this.game.tick % snapEvery === 0) this.sendSnapshots();
      }
      this.timer = setTimeout(loop, Math.max(1, stepMs - this.acc - 1));
    };
    this.timer = setTimeout(loop, 1);
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private step(): void {
    const g = this.game;
    this.balanceBots();
    for (const [id, brain] of this.bots) {
      const p = g.players.get(id);
      if (!p) {
        this.bots.delete(id);
        continue;
      }
      g.queueCmds(p, [brain.think(g, p)]);
    }
    g.step();
    // Route events to clients.
    for (const { ev, to } of g.events) {
      for (const c of this.clients) {
        const p = c.player;
        if ('all' in to || ('team' in to && p.team === to.team) || ('player' in to && p.id === to.player) || ('except' in to && p.id !== to.except)) {
          c.events.push(ev);
        }
      }
    }
    g.events.length = 0;
    for (const n of g.notices) this.broadcast({ t: 'event', kind: n.kind, text: n.text, team: n.team }, n.team || undefined);
    g.notices.length = 0;
    const nowMs = Date.now();
    if (nowMs - this.lastPlayersBroadcast > 2000) this.broadcastPlayers();
  }

  private sendSnapshots(): void {
    for (const c of this.clients) {
      if (c.ws.readyState !== 1) continue;
      const snap = this.game.snapshotFor(c.player);
      snap.events = c.events;
      c.events = [];
      c.ws.send(encodeSnapshot(snap), { binary: true });
    }
  }

  send(c: Client, msg: ServerMsg): void {
    if (c.ws.readyState === 1) c.ws.send(JSON.stringify(msg));
  }

  broadcast(msg: ServerMsg, team?: number): void {
    const s = JSON.stringify(msg);
    for (const c of this.clients) if (c.ws.readyState === 1 && (team === undefined || c.player.team === team)) c.ws.send(s);
  }

  broadcastPlayers(): void {
    this.lastPlayersBroadcast = Date.now();
    const players: PlayerInfo[] = [...this.game.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      team: p.team,
      bot: p.bot,
      score: Math.round(p.score),
      deaths: p.deaths,
      ping: p.ping,
    }));
    this.broadcast({ t: 'players', players });
  }

  join(ws: WebSocket, name: string): Client | null {
    const p = this.game.addPlayer(sanitizeName(name));
    if (!p) return null;
    const c: Client = { ws, player: p, events: [], host: this.clients.size === 0 };
    this.clients.add(c);
    this.emptySince = 0;
    this.game.setTeam(p, this.game.autoTeam());
    this.send(c, { t: 'welcome', you: p.id, room: this.code, map: this.mapName, tick: this.game.tick, tickRate: TICK_RATE, host: c.host });
    this.broadcast({ t: 'event', kind: 'join', text: `${p.name} joined the ${p.team === Team.Punk ? 'Punks' : 'Corps'}` });
    this.broadcastPlayers();
    return c;
  }

  leave(c: Client): void {
    this.clients.delete(c);
    this.game.removePlayer(c.player.id);
    this.broadcast({ t: 'event', kind: 'leave', text: `${c.player.name} left` });
    if (c.host) {
      const next = [...this.clients][0];
      if (next) next.host = true;
    }
    if (this.clients.size === 0) this.emptySince = Date.now();
    this.broadcastPlayers();
  }

  onBinary(c: Client, data: Uint8Array): void {
    if (data[0] === BinMsg.UserCmds) {
      try {
        this.game.queueCmds(c.player, decodeUserCmds(data));
      } catch {
        /* malformed packet: ignore */
      }
    }
  }

  onJson(c: Client, msg: ClientMsg): void {
    const g = this.game;
    const p = c.player;
    switch (msg.t) {
      case 'team': {
        const team = msg.team === Team.Punk || msg.team === Team.Corp || msg.team === Team.Spectator ? msg.team : g.autoTeam();
        g.setTeam(p, team);
        this.broadcastPlayers();
        break;
      }
      case 'loadout': {
        const err = g.setLoadout(p, msg.cls, msg.implants);
        if (err) this.send(c, { t: 'error', message: err });
        break;
      }
      case 'chat': {
        const text = String(msg.text ?? '').slice(0, 200).trim();
        if (!text) break;
        this.broadcast({ t: 'chat', from: p.id, name: p.name, text, teamOnly: !!msg.teamOnly }, msg.teamOnly ? p.team : undefined);
        break;
      }
      case 'addbot':
        if (c.host) this.addBot(msg.team === Team.Corp ? Team.Corp : Team.Punk);
        break;
      case 'fillbots':
        if (c.host) this.botsPerTeam = Math.max(0, Math.min(8, Math.round(msg.perTeam)));
        break;
      case 'kickbots':
        if (c.host) {
          this.botsPerTeam = 0;
          for (const id of [...this.bots.keys()]) this.removeBot(id);
        }
        break;
      case 'settings':
        if (c.host && typeof msg.ff === 'boolean') {
          g.rules.ff = msg.ff;
          this.broadcast({ t: 'event', kind: 'settings', text: `Friendly fire ${msg.ff ? 'ON' : 'OFF'}` });
        }
        break;
      case 'ping':
        if (typeof msg.rtt === 'number') p.ping = Math.round(msg.rtt);
        this.send(c, { t: 'pong', at: msg.at, server: g.tick });
        break;
    }
  }

  addBot(team: number): void {
    const used = new Set([...this.game.players.values()].map((p) => p.name));
    const name = BOT_NAMES.find((n) => !used.has(`[BOT] ${n}`)) ?? `Bot${this.bots.size + 1}`;
    const p = this.game.addPlayer(`[BOT] ${name}`, true);
    if (!p) return;
    const brain = new BotBrain(p.id);
    const cls = brain.pickClass(this.game, team);
    p.nextCls = cls;
    p.nextImplants = [...(DEFAULT_LOADOUTS[cls] ?? DEFAULT_LOADOUTS[ClassId.Medium]!)];
    brain.applyLoadout(p);
    this.bots.set(p.id, brain);
    this.game.setTeam(p, team);
    this.broadcastPlayers();
  }

  removeBot(id: number): void {
    this.bots.delete(id);
    this.game.removePlayer(id);
    this.broadcastPlayers();
  }

  /** Keep each team topped up with bots to `botsPerTeam` total players. */
  private balanceBots(): void {
    if (this.game.tick % 30 !== 0 || this.botsPerTeam <= 0) return;
    for (const team of [Team.Punk, Team.Corp]) {
      const total = this.game.teamCount(team);
      if (total < this.botsPerTeam) this.addBot(team);
      else if (total > this.botsPerTeam) {
        const bot = [...this.game.players.values()].find((p) => p.bot && p.team === team);
        if (bot) this.removeBot(bot.id);
      }
    }
  }
}

function sanitizeName(n: string): string {
  const s = String(n ?? '')
    .replace(/[^\p{L}\p{N} _\-.[\]]/gu, '')
    .trim()
    .slice(0, 20);
  return s || 'Runner';
}
