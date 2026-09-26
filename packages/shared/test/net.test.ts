import { describe, expect, it } from 'vitest';
import {
  encodeSnapshot,
  decodeSnapshot,
  encodeUserCmds,
  decodeUserCmds,
  quantizeCmd,
  EvKind,
  EntKind,
  type Snapshot,
} from '../src/net/snapshot.js';
import { newMoveState } from '../src/sim/pmove.js';
import { newWeaponState } from '../src/sim/weapons.js';
import { newCyberState } from '../src/sim/cybermove.js';
import { WeaponId } from '../src/game/defs.js';
import { v3 } from '../src/math.js';

describe('net codec', () => {
  it('round-trips a snapshot', () => {
    const snap: Snapshot = {
      tick: 1234,
      ack: 99,
      rules: { phase: 1, stage: 2, stageCount: 3, attackers: 1, timeLeft: 600.5, wavePunk: 12, waveCorp: 3, winner: 0, ff: true },
      local: {
        id: 3,
        t: 12.345678,
        move: { ...newMoveState(v3(1, 2, 3)), onGround: true, slideTime: 0.25 },
        weap: newWeaponState([WeaponId.Shotgun, WeaponId.MachinePistol, WeaponId.Katana, WeaponId.EmpGrenade], 3),
        cyber: newCyberState(v3(10, 20, 30)),
        energy: 42.5,
        maxEnergy: 75,
        emp: 0,
        respawnIn: 0,
        cls: 0,
        implants: 0b1011,
        nextCls: 1,
        nextImplants: 0b100,
        cyberMode: 1,
        hitscanReady: 0.5,
        program: { program: 5, target: 77, progress: 0.4, step: 2, buttons: [3, 1, 0, 2] },
        bodyAlarm: 99,
        crack: -1,
        tacCooldown: 0,
      },
      players: [
        {
          id: 3,
          team: 1,
          cls: 0,
          flags: 5,
          origin: v3(100.5, -20.25, 64),
          velocity: v3(250, 0, -12),
          yaw: 90,
          pitch: -10,
          weapon: 2,
          health: 75,
          armor: 25,
          energy: 50,
          implants: 3,
          vis: 1,
          cyber: { origin: v3(5000, 0, 0), up: v3(0, 0, 1), forward: v3(1, 0, 0) },
        },
      ],
      ents: [{ id: 17, kind: EntKind.Door, team: 0, state: 1, value: 0.5, a: 0, b: 0 }],
      events: [
        { k: EvKind.Fire, shooter: 3, weapon: 2, alt: false, start: v3(1, 2, 3), ends: [v3(4, 5, 6), v3(7, 8, 9)] },
        { k: EvKind.Kill, killer: 3, victim: 4, weapon: 2, headshot: true },
      ],
    };
    const out = decodeSnapshot(encodeSnapshot(snap));
    expect(out.tick).toBe(1234);
    expect(out.rules.timeLeft).toBeCloseTo(600.5);
    expect(out.local!.t).toBe(12.345678);
    expect(out.local!.move.origin).toEqual(v3(1, 2, 3));
    expect(out.local!.move.slideTime).toBeCloseTo(0.25);
    expect(out.local!.weap.clip[WeaponId.Shotgun]).toBe(6);
    expect(out.local!.weap.clip[WeaponId.EmpGrenade]).toBe(3);
    expect(out.local!.cyber!.origin).toEqual(v3(10, 20, 30));
    expect(out.local!.program!.buttons).toEqual([3, 1, 0, 2]);
    expect(out.players[0]!.origin.x).toBeCloseTo(100.5);
    expect(out.players[0]!.yaw).toBeCloseTo(90, 1);
    expect(out.players[0]!.pitch).toBeCloseTo(-10, 1);
    expect(out.players[0]!.cyber!.origin.x).toBe(5000);
    expect(out.ents[0]!.value).toBeCloseTo(0.5);
    expect(out.events).toHaveLength(2);
    expect(out.events[0]).toMatchObject({ k: EvKind.Fire, ends: [v3(4, 5, 6), v3(7, 8, 9)] });
  });

  it('user commands survive the wire exactly after quantization', () => {
    const c = quantizeCmd({ seq: 7, msec: 16.4, forward: 0.7, side: -1, buttons: 0x1234, pitch: 12.3456, yaw: -170.1, weapon: 2, viewTick: 5000.25 });
    const [d] = decodeUserCmds(encodeUserCmds([c]));
    expect(d).toEqual(c);
  });
});
