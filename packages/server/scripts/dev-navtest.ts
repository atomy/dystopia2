import { readFileSync } from 'node:fs';
import { v3 } from '@d2/shared';
import { Game } from '../src/game/game.js';
import { NavGraph } from '../src/game/nav.js';
const g = new Game('q', readFileSync(new URL('../../../maps/d2_quarantine.map', import.meta.url), 'utf8'), { friendlyFire: false });
const gates = new Set<number>([...g.doors.map((d) => d.id), ...g.forcefields.map((f) => f.id)]);
const nav = new NavGraph(g.level, gates);
const tests: [string, [number, number, number], [number, number, number]][] = [
  ['spawn->street', [-3520, -160, 1], [-2600, 0, 0]],
  ['street->bay', [-2600, 0, 0], [-2100, 0, 0]],
  ['bay->docks', [-2100, 0, 0], [-1800, 0, 0]],
  ['docks->screen', [-1800, 0, 0], [-540, -832, 64]],
  ['spawn->screen', [-3520, -160, 1], [-540, -832, 64]],
  ['docks->catwalk jip', [-744, -960, 0], [-1312, 696, 225]],
];
const open = (_: number) => false;
for (const [name, a, b] of tests) {
  const from = nav.nearest(v3(...a));
  const to = nav.nearest(v3(...b), 400);
  const p = nav.path(from, to, open);
  console.log(name, 'from', from, nav.nodes[from]?.pos, 'to', to, nav.nodes[to]?.pos, 'edges', nav.nodes[from]?.edges.length, nav.nodes[to]?.edges.length, '->', p ? p.length : 'NO PATH');
}
// Reachability around the docks spawn door.
const start = nav.nearest(v3(-1800, 0, 0));
const seen = new Set<number>([start]);
const st = [start];
while (st.length) { const c = st.pop()!; for (const e of nav.nodes[c]!.edges) if (!seen.has(e.to)) { seen.add(e.to); st.push(e.to); } }
for (const n of nav.nodes) {
  if (n.pos.x >= -816 && n.pos.x <= -656 && n.pos.y >= -720 && n.pos.y <= -528 && n.pos.z < 50) console.log(n.pos.x, n.pos.y, n.pos.z.toFixed(1), 'reach', seen.has(n.id), 'edges', n.edges.map((e) => `${nav.nodes[e.to]!.pos.x},${nav.nodes[e.to]!.pos.y}`).join(' '));
}
