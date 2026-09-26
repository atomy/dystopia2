import { describe, expect, it } from 'vitest';
import { writeMap, type MapBrush } from '../src/map/mapfile.js';
import { loadLevel } from '../src/map/level.js';
import { boxBrush } from '../src/map/builder.js';
import { v3, vdot } from '../src/math.js';
import { Buttons, type UserCmd } from '../src/sim/pmove.js';
import {
  cyberMove,
  newCyberState,
  EMPTY_ZONE,
  type CyberEnv,
  cyberBasis,
  cyberAnglesFor,
  reorient,
} from '../src/sim/cybermove.js';

const cmd = (over: Partial<UserCmd> = {}): UserCmd => ({
  seq: 0,
  msec: 16,
  forward: 0,
  side: 0,
  buttons: 0,
  pitch: 0,
  yaw: 0,
  weapon: 0,
  viewTick: 0,
  ...over,
});

// A cube "server": gravity floor, a gravity wall at +X, a plain wall at -X.
const server = (): string => {
  const brushes: MapBrush[] = [
    boxBrush(v3(-512, -512, -16), v3(512, 512, 0), 'd2/cyber_floor'),
    boxBrush(v3(-512, -512, 512), v3(512, 512, 528), 'd2/cyber_floor'),
    boxBrush(v3(512, -512, 0), v3(528, 512, 512), 'd2/cyber_floor'),
    boxBrush(v3(-528, -512, 0), v3(-512, 512, 512), 'd2/cyber_wall'),
    boxBrush(v3(-512, -528, 0), v3(512, -512, 512), 'd2/cyber_wall'),
    boxBrush(v3(-512, 512, 0), v3(512, 528, 512), 'd2/cyber_wall'),
  ];
  return writeMap({ entities: [{ props: { classname: 'worldspawn' }, brushes }] });
};

const env: CyberEnv = { zoneAt: () => EMPTY_ZONE };

describe('cyber movement', () => {
  const level = loadLevel('cyber', server());

  it('basis/angles round-trip in arbitrary frames', () => {
    const up = v3(1, 0, 0);
    const north = v3(0, 0, 1);
    const b = cyberBasis(up, north, 20, 70);
    const a = cyberAnglesFor(up, north, b.forward);
    expect(a.pitch).toBeCloseTo(20, 4);
    expect(a.yaw).toBeCloseTo(70, 4);
  });

  it('keeps bouncing while jump is held', () => {
    const s = newCyberState(v3(0, 0, 13));
    let bounces = 0;
    for (let i = 0; i < 300; i++) if (cyberMove(level.collision, s, cmd({ buttons: Buttons.JUMP }), env).bounced) bounces++;
    expect(bounces).toBeGreaterThan(2);
  });

  it('walking into a gravity wall re-orients gravity onto the wall', () => {
    const s = newCyberState(v3(300, 0, 13));
    let reoriented = false;
    for (let i = 0; i < 200 && !reoriented; i++) reoriented = cyberMove(level.collision, s, cmd({ forward: 1, buttons: Buttons.JUMP }), env).reoriented;
    expect(reoriented).toBe(true);
    // The +X wall's surface normal is -X, so up is now -X.
    expect(vdot(s.up, v3(-1, 0, 0))).toBeGreaterThan(0.99);
    // After a while we stand on the wall.
    for (let i = 0; i < 120; i++) cyberMove(level.collision, s, cmd(), env);
    expect(s.onGround).toBe(true);
    expect(s.origin.x).toBeGreaterThan(512 - 14);
  });

  it('non-gravity walls do not re-orient', () => {
    const s = newCyberState(v3(-300, 0, 13));
    let reoriented = false;
    for (let i = 0; i < 200; i++) reoriented ||= cyberMove(level.collision, s, cmd({ forward: 1, yaw: 180 }), env).reoriented;
    expect(reoriented).toBe(false);
    expect(s.up.z).toBeCloseTo(1);
  });

  it('reorient by 180 degrees keeps an orthonormal frame', () => {
    const s = newCyberState(v3());
    reorient(s, v3(0, 0, -1));
    expect(s.up.z).toBeCloseTo(-1);
    expect(Math.abs(vdot(s.up, s.north))).toBeLessThan(1e-6);
  });
});
