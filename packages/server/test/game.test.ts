import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Buttons, ClassId, DEFAULT_LOADOUTS, ImplantId, Team, TICK_RATE, v3, type UserCmd } from '@d2/shared';
import { Game } from '../src/game/game.js';
import { Room } from '../src/room.js';
import { tryJackIn } from '../src/game/cyber.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const mapSrc = readFileSync(join(root, 'maps', 'd2_quarantine.map'), 'utf8');

let seq = 0;
const cmd = (over: Partial<UserCmd> = {}): UserCmd => ({
  seq: ++seq,
  msec: 1000 / TICK_RATE,
  forward: 0,
  side: 0,
  buttons: 0,
  pitch: 0,
  yaw: 0,
  weapon: 0,
  viewTick: 0,
  ...over,
});

describe('game rules', () => {
  it('armor absorbs 80% of damage and explosives hit armor twice as hard', () => {
    const g = new Game('q', mapSrc, { friendlyFire: false });
    const p = g.addPlayer('a')!;
    g.setTeam(p, Team.Corp); // Medium: 100 hp / 50 armor
    expect(p.health).toBe(100);
    g.damage(p, 20, null, 0);
    expect(p.armor).toBeCloseTo(34);
    expect(p.health).toBeCloseTo(96);
    g.damage(p, 10, null, 0, { explosive: true });
    expect(p.armor).toBeCloseTo(18);
    expect(p.health).toBeCloseTo(94);
  });

  it('a decker can hack the bay node open, which opens the bay door', () => {
    const g = new Game('q', mapSrc, { friendlyFire: false });
    const p = g.addPlayer('decker')!;
    p.nextCls = ClassId.Light;
    p.nextImplants = [...DEFAULT_LOADOUTS[ClassId.Light]!];
    g.setTeam(p, Team.Punk);
    expect(p.has(ImplantId.EnhancedDeck)).toBe(true);
    // Stand on the street terminal and jack in.
    const jip = g.jips.find((j) => j.name === 'jip_street_2')!;
    p.move.origin = { ...jip.origin };
    tryJackIn(g, p);
    expect(p.decked).toBe(true);
    // Teleport the avatar into the bay node, facing its screen, and hold USE.
    const node = g.nodes.find((n) => n.name === 'node_bay')!;
    p.cyber!.origin = v3(node.origin.x - 60, node.origin.y, node.origin.z - 36);
    const door = g.doors.find((d) => d.name === 'door_bay')!;
    expect(door.pos).toBe(0);
    for (let i = 0; i < TICK_RATE * 3; i++) {
      g.queueCmds(p, [cmd({ buttons: Buttons.USE, yaw: 0, pitch: -10 })]);
      g.step();
    }
    expect(node.owner).toBe(Team.Punk);
    for (let i = 0; i < TICK_RATE * 3; i++) g.step();
    expect(door.pos).toBeGreaterThan(0.99);
  });

  it('running out of cyber energy ejects with dumpshock and locks the JIP', () => {
    const g = new Game('q', mapSrc, { friendlyFire: false });
    const p = g.addPlayer('decker')!;
    p.nextCls = ClassId.Light;
    p.nextImplants = [...DEFAULT_LOADOUTS[ClassId.Light]!];
    g.setTeam(p, Team.Punk);
    const jip = g.jips.find((j) => j.name === 'jip_street_2')!;
    p.move.origin = { ...jip.origin };
    tryJackIn(g, p);
    const hp = p.health;
    p.energy = 0;
    g.queueCmds(p, [cmd()]);
    g.step();
    expect(p.decked).toBe(false);
    expect(p.health).toBeLessThan(hp);
    expect(jip.lockUntil).toBeGreaterThan(g.now + 8);
  });
});

describe('bot match', () => {
  it('bots play the map: stage 1 falls within a few minutes', { timeout: 60000 }, () => {
    const room = new Room('TEST', 'd2_quarantine', mapSrc, { friendlyFire: false, botsPerTeam: 4 });
    const step = (room as unknown as { step(): void }).step.bind(room);
    let maxStage = 1;
    for (let i = 0; i < TICK_RATE * 60 * 4 && maxStage < 2; i++) {
      step();
      maxStage = Math.max(maxStage, room.game.rules.stage);
    }
    expect(room.game.players.size).toBe(8);
    expect(maxStage).toBeGreaterThanOrEqual(2);
  });
});
