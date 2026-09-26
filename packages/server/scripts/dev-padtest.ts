import { readFileSync } from 'node:fs';
import { v3, newCyberState, cyberMove, Buttons } from '@d2/shared';
import { Game } from '../src/game/game.js';
import { cyberEnv } from '../src/game/cyber.js';
const g = new Game('q', readFileSync('/home/atomy/git/dystopia2/maps/d2_quarantine.map', 'utf8'), { friendlyFire: false });
const env = cyberEnv(g);
const CZ = -6000;
console.log('zone at pad', env.zoneAt(v3(-1868, 0, CZ + 12)));
const s = newCyberState(v3(-1960, 0, CZ + 13));
for (let i = 0; i < 240; i++) {
  const ev = cyberMove(g.level.collision, s, { seq: i, msec: 1000 / 60, forward: i < 20 ? 1 : 0, side: 0, buttons: 0, pitch: 0, yaw: 0, weapon: 0, viewTick: 0 }, env, g.teamFilter(1));
  if (ev.padLaunched || i < 25 || i % 20 === 0) console.log(i, s.origin.x.toFixed(0), s.origin.y.toFixed(0), (s.origin.z - CZ).toFixed(0), 'v', s.velocity.x.toFixed(0), s.velocity.z.toFixed(0), s.zeroG ? 'ZG' : '', ev.padLaunched ? 'PAD' : '');
}
