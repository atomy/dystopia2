// Headless bot match: runs the real game loop faster than real time and logs
// what happens. Usage: npx tsx packages/server/scripts/botsim.ts [minutes] [botsPerTeam]
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EvKind, Team, TICK_RATE, Cause } from '@d2/shared';
import { Room } from '../src/room.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const minutes = Number(process.argv[2] ?? 5);
const perTeam = Number(process.argv[3] ?? 4);
const src = readFileSync(join(root, 'maps', 'd2_quarantine.map'), 'utf8');
const room = new Room('SIM', 'd2_quarantine', src, { friendlyFire: false, botsPerTeam: perTeam });
const g = room.game;
const ticks = minutes * 60 * TICK_RATE;
const stats = { kills: 0, cyberKills: 0, jackIns: 0, ejects: 0, programsDone: 0, programsStarted: 0 };
let lastStage = g.rules.stage;
const t0 = Date.now();
for (let i = 0; i < ticks; i++) {
  (room as unknown as { step(): void }).step();
  for (const n of g.notices) console.log(`[${g.now.toFixed(1)}s] ${n.kind}: ${n.text}`);
  g.notices.length = 0;
  if (g.rules.stage !== lastStage) {
    console.log(`[${g.now.toFixed(1)}s] >>> stage ${g.rules.stage}`);
    lastStage = g.rules.stage;
  }
  if (process.env['TRACE']) {
    const w = [...g.players.values()].find((p) => p.name.includes(process.env['TRACE']!));
    if (w?.cyber && i % 20 === 0) {
      const c = w.cyber;
      console.log(`  trace ${w.name} ${c.origin.x.toFixed(0)},${c.origin.y.toFixed(0)},${(c.origin.z + 6000).toFixed(0)} v=${c.velocity.x.toFixed(0)},${c.velocity.y.toFixed(0)},${c.velocity.z.toFixed(0)} up=${c.up.x.toFixed(1)},${c.up.y.toFixed(1)},${c.up.z.toFixed(1)} g=${c.onGround} zg=${c.zeroG} ${room.bots.get(w.id)?.debug}`);
    }
  }
  if (i % (TICK_RATE * 30) === 0) {
    const decked = [...g.players.values()].filter((p) => p.decked).map((p) => `${p.name}@${p.cyber!.origin.x.toFixed(0)},${p.cyber!.origin.y.toFixed(0)},${p.cyber!.origin.z.toFixed(0)}`);
    const alive = [...g.players.values()].filter((p) => p.alive).length;
    for (const [id, b] of room.bots) {
      const p = g.players.get(id)!;
      if (b.role === 'decker' || process.env['VERBOSE']) console.log(`    ${p.name} ${b.role} @${p.move.origin.x.toFixed(0)},${p.move.origin.y.toFixed(0)},${p.move.origin.z.toFixed(0)} e=${p.energy.toFixed(0)} ${b.debug}`);
    }
    console.log(`[${g.now.toFixed(0)}s] alive=${alive}/${g.players.size} stage=${g.rules.stage} time=${g.rules.timeLeft.toFixed(0)} decked=[${decked.join(' ')}] bay=${g.doors.find((d) => d.name === 'door_bay')?.pos.toFixed(2)}`);
  }
}
void Team;
void EvKind;
void Cause;
console.log(`simulated ${minutes} min in ${((Date.now() - t0) / 1000).toFixed(1)} s; stage=${g.rules.stage} phase=${g.rules.phase} winner=${g.rules.winner}`);
for (const p of g.players.values()) console.log(`  ${p.team === 1 ? 'P' : 'C'} ${p.name.padEnd(16)} cls=${p.cls} score=${p.score.toFixed(0)} k=${p.kills} d=${p.deaths}`);
void stats;
