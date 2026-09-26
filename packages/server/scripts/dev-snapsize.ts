// Prints snapshot sizes for a bot-filled room (bandwidth baseline).
import { readFileSync } from 'node:fs';
import { encodeSnapshot, TICK_RATE, SNAPSHOT_RATE } from '@d2/shared';
import { Room } from '../src/room.js';
const src = readFileSync(new URL('../../../maps/d2_quarantine.map', import.meta.url), 'utf8');
const perTeam = Number(process.argv[2] ?? 8);
const room = new Room('SIZE', 'd2_quarantine', src, { friendlyFire: true, botsPerTeam: perTeam });
const step = (room as unknown as { step(): void }).step.bind(room);
for (let i = 0; i < TICK_RATE * 60; i++) step();
const g = room.game;
const viewer = [...g.players.values()][0]!;
let total = 0;
const n = 60;
for (let i = 0; i < n; i++) {
  for (let k = 0; k < TICK_RATE / SNAPSHOT_RATE; k++) step();
  total += encodeSnapshot(g.snapshotFor(viewer)).byteLength;
}
const avg = total / n;
console.log(`players=${g.players.size} avg snapshot=${avg.toFixed(0)} B -> ${((avg * SNAPSHOT_RATE) / 1024).toFixed(1)} KiB/s per client`);
