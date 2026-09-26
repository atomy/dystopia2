import { describe, expect, it } from 'vitest';
import { parseMap, writeMap, type MapBrush } from '../src/map/mapfile.js';
import { buildBrush } from '../src/map/brush.js';
import { loadLevel } from '../src/map/level.js';
import { v3 } from '../src/math.js';
import { PlayerMover, newMoveState, Buttons, type UserCmd, DEFAULT_CAPS, type MoveCaps } from '../src/sim/pmove.js';
import { boxBrush } from '../src/map/builder.js';

const room = (): string => {
  const brushes: MapBrush[] = [
    boxBrush(v3(-512, -512, -16), v3(512, 512, 0), 'd2/floor'), // floor
    boxBrush(v3(-512, -512, 256), v3(512, 512, 272), 'd2/ceil'),
    boxBrush(v3(-528, -512, 0), v3(-512, 512, 256), 'd2/wall'),
    boxBrush(v3(512, -512, 0), v3(528, 512, 256), 'd2/wall'),
    boxBrush(v3(-512, -528, 0), v3(512, -512, 256), 'd2/wall'),
    boxBrush(v3(-512, 512, 0), v3(512, 528, 256), 'd2/wall'),
    boxBrush(v3(100, -64, 0), v3(132, 64, 16), 'd2/step'), // a 16u step
    boxBrush(v3(-512, 300, 0), v3(-300, 512, 96), 'd2/ledge'), // a 96u ledge in the corner
  ];
  return writeMap({ entities: [{ props: { classname: 'worldspawn', mapversion: '220' }, brushes }] });
};

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

describe('map parsing', () => {
  it('round-trips a TrenchBroom-style cube', () => {
    const src = `// Game: Dystopia 2
// Format: Valve
{
"classname" "worldspawn"
"mapversion" "220"
{
( -64 -64 -16 ) ( -64 -63 -16 ) ( -64 -64 -15 ) __TB_empty [ 0 -1 0 0 ] [ 0 0 -1 0 ] 0 1 1
( -64 -64 -16 ) ( -64 -64 -15 ) ( -63 -64 -16 ) __TB_empty [ 1 0 0 0 ] [ 0 0 -1 0 ] 0 1 1
( -64 -64 -16 ) ( -63 -64 -16 ) ( -64 -63 -16 ) __TB_empty [ -1 0 0 0 ] [ 0 -1 0 0 ] 0 1 1
( 64 64 16 ) ( 64 65 16 ) ( 65 64 16 ) __TB_empty [ 1 0 0 0 ] [ 0 -1 0 0 ] 0 1 1
( 64 64 16 ) ( 65 64 16 ) ( 64 64 17 ) __TB_empty [ -1 0 0 0 ] [ 0 0 -1 0 ] 0 1 1
( 64 64 16 ) ( 64 64 17 ) ( 64 65 16 ) __TB_empty [ 0 1 0 0 ] [ 0 0 -1 0 ] 0 1 1
}
}
`;
    const map = parseMap(src);
    const b = buildBrush(map.entities[0]!.brushes[0]!)!;
    expect(b).not.toBeNull();
    expect(b.mins).toEqual(v3(-64, -64, -16));
    expect(b.maxs).toEqual(v3(64, 64, 16));
    expect(b.faces).toHaveLength(6);
    for (const f of b.faces) expect(f.verts).toHaveLength(4);
    // Our generator produces equivalent brushes.
    const gen = buildBrush(boxBrush(v3(-64, -64, -16), v3(64, 64, 16), 'x'))!;
    expect(gen.mins).toEqual(b.mins);
    expect(gen.maxs).toEqual(b.maxs);
    expect(parseMap(writeMap(map)).entities[0]!.brushes[0]!.faces).toHaveLength(6);
  });
});

describe('player movement', () => {
  const level = loadLevel('test', room());
  const mover = new PlayerMover(level.collision);

  it('falls and lands on the floor', () => {
    const s = newMoveState(v3(0, 0, 100));
    for (let i = 0; i < 120; i++) mover.move(s, cmd());
    expect(s.onGround).toBe(true);
    expect(s.origin.z).toBeCloseTo(0, 1);
  });

  it('walks forward at max speed and stops at a wall', () => {
    const s = newMoveState(v3(-300, 200, 1));
    for (let i = 0; i < 60; i++) mover.move(s, cmd({ forward: 1 }));
    expect(Math.hypot(s.velocity.x, s.velocity.y)).toBeCloseTo(DEFAULT_CAPS.runSpeed, 0);
    for (let i = 0; i < 300; i++) mover.move(s, cmd({ forward: 1 }));
    expect(s.origin.x).toBeLessThanOrEqual(512 - 16 + 0.01);
    expect(s.origin.x).toBeGreaterThan(512 - 16 - 1);
  });

  it('steps up a 16 unit step', () => {
    const s = newMoveState(v3(0, 0, 1));
    for (let i = 0; i < 60; i++) mover.move(s, cmd({ forward: 1 }));
    expect(s.origin.x).toBeGreaterThan(110);
    // Standing on the step or already past it.
    expect(s.onGround).toBe(true);
  });

  it('jumps once per press (no auto-hop)', () => {
    const s = newMoveState(v3(-200, -200, 1));
    mover.move(s, cmd());
    mover.move(s, cmd());
    let jumps = 0;
    for (let i = 0; i < 200; i++) if (mover.move(s, cmd({ buttons: Buttons.JUMP })).jumped) jumps++;
    expect(jumps).toBe(1);
  });

  it('air strafing gains speed beyond max ground speed', () => {
    const s = newMoveState(v3(-400, -400, 1));
    for (let i = 0; i < 30; i++) mover.move(s, cmd({ forward: 1, yaw: 45 }));
    let yaw = 45;
    let best = 0;
    // Classic bhop: jump, strafe right while turning right, land, re-jump.
    for (let hop = 0; hop < 3; hop++) {
      mover.move(s, cmd({ forward: 0, buttons: Buttons.JUMP, yaw }));
      for (let i = 0; i < 40 && !s.onGround; i++) {
        yaw -= 1.2;
        mover.move(s, cmd({ side: 1, yaw }));
        best = Math.max(best, Math.hypot(s.velocity.x, s.velocity.y));
      }
      mover.move(s, cmd({ yaw }));
    }
    expect(best).toBeGreaterThan(DEFAULT_CAPS.runSpeed + 20);
  });
});

describe('stuck recovery', () => {
  const level = loadLevel('test', room());
  const mover = new PlayerMover(level.collision);
  it('a player spawned exactly on the floor can still walk', () => {
    const s = newMoveState(v3(-300, 0, 0));
    for (let i = 0; i < 60; i++) mover.move(s, cmd({ forward: 1 }));
    expect(s.origin.x).toBeGreaterThan(-200);
    expect(s.onGround).toBe(true);
  });
});

describe('dystopia movement extras', () => {
  const level = loadLevel('test', room());
  const mover = new PlayerMover(level.collision);
  const caps: MoveCaps = { ...DEFAULT_CAPS, canSprint: true, canBoost: true, canLedgeGrab: true };

  it('grabs a ledge and mantles onto it', () => {
    // Stand facing the 96u ledge (its face is at y=300), jump and hold forward.
    const s = newMoveState(v3(-400, 240, 1));
    mover.move(s, cmd({ yaw: 90 }), caps);
    let grabbed = false;
    for (let i = 0; i < 60 && !grabbed; i++) {
      const ev = mover.move(s, cmd({ yaw: 90, forward: 1, buttons: Buttons.JUMP }), caps);
      grabbed ||= ev.ledgeGrab;
    }
    expect(grabbed).toBe(true);
    expect(s.hanging).toBe(true);
    mover.move(s, cmd({ yaw: 90 }), caps); // release jump
    const ev = mover.move(s, cmd({ yaw: 90, forward: 1, buttons: Buttons.JUMP }), caps);
    expect(ev.ledgeClimb).toBe(true);
    for (let i = 0; i < 90; i++) mover.move(s, cmd({ yaw: 90, forward: 1 }), caps);
    expect(s.origin.z).toBeGreaterThan(90);
    expect(s.onGround).toBe(true);
  });

  it('charged boost jumps go much higher than normal jumps', () => {
    const s = newMoveState(v3(0, -300, 1));
    mover.move(s, cmd(), caps);
    for (let i = 0; i < 70; i++) mover.move(s, cmd({ buttons: Buttons.BOOST }), caps);
    const ev = mover.move(s, cmd(), caps);
    expect(ev.boostJump).toBeGreaterThan(0.9);
    let peak = 0;
    for (let i = 0; i < 120; i++) {
      mover.move(s, cmd(), caps);
      peak = Math.max(peak, s.origin.z);
    }
    expect(peak).toBeGreaterThan(150);
  });

  it('sprinting is faster than running', () => {
    const s = newMoveState(v3(-400, -300, 1));
    for (let i = 0; i < 90; i++) mover.move(s, cmd({ forward: 1, buttons: Buttons.SPRINT }), caps);
    expect(Math.hypot(s.velocity.x, s.velocity.y)).toBeCloseTo(caps.sprintSpeed, 0);
    expect(s.sprinting).toBe(true);
  });

  it('landing crouched at speed starts a slide', () => {
    const s = newMoveState(v3(-400, -300, 40));
    s.velocity = v3(400, 0, 0);
    let slid = false;
    for (let i = 0; i < 60 && !slid; i++) slid = mover.move(s, cmd({ buttons: Buttons.DUCK }), caps).slideStart;
    expect(slid).toBe(true);
    // Slides much further than a crouch walk would allow.
    const x0 = s.origin.x;
    for (let i = 0; i < 20; i++) mover.move(s, cmd({ buttons: Buttons.DUCK }), caps);
    expect(s.origin.x - x0).toBeGreaterThan(80);
  });
});
