// Regenerates the procedural maps into maps/*.map.
//   npx tsx tools/genmaps.ts
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { writeMap, loadLevel } from '@d2/shared';
import { buildQuarantine } from './maps/quarantine.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const maps = { d2_quarantine: buildQuarantine };

for (const [name, build] of Object.entries(maps)) {
  const src = writeMap(build().build());
  const path = join(root, 'maps', `${name}.map`);
  writeFileSync(path, src);
  const level = loadLevel(name, src);
  const counts = new Map<string, number>();
  for (const e of level.entities) counts.set(e.classname, (counts.get(e.classname) ?? 0) + 1);
  console.log(`${name}: ${level.world.length} world brushes, ${level.entities.length} entities -> ${path}`);
  console.log([...counts].map(([k, v]) => `${k}=${v}`).join(' '));
}
