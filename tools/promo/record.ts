// Records the promo video's shots as JPEG frames.
//
//   npx tsx tools/promo/record.ts [--final] [--preview] [shot ...]
//
// --preview renders every 6th frame only (fast framing checks); --final renders
// at 1920x1080. Frames land in out/promo/frames/<shot>/. See tools/promo/README.md.

import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { TICK_RATE } from '@d2/shared';
import { Session, repoRoot } from './session.js';
import { SHOTS, FPS, type ShotCtx } from './shots.js';

const args = process.argv.slice(2);
const final = args.includes('--final');
const preview = args.includes('--preview');
const only = args.filter((a) => !a.startsWith('--'));
const out = process.env['PROMO_OUT'] ?? join(repoRoot, 'out', 'promo');
const clientDir = join(out, 'client');

// The recorder drives the client through its dev hooks, so it needs a dev build.
if (!existsSync(join(clientDir, 'index.html')) || args.includes('--rebuild')) {
  console.log('building dev client…');
  execFileSync('npx', ['vite', 'build', '--mode', 'development', '--outDir', clientDir, '--emptyOutDir'], {
    cwd: join(repoRoot, 'packages', 'client'),
    env: { ...process.env, NODE_ENV: 'development' },
    stdio: 'inherit',
  });
}

let start = 0;
for (const shot of SHOTS) {
  const at = start;
  start += shot.dur;
  if (only.length && !only.includes(shot.name)) continue;
  const dir = join(out, 'frames', shot.name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const t0 = Date.now();
  const s = new Session({ clientDir, botsPerTeam: shot.bots ?? 5, width: 1280, height: 720, scale: final ? 1.5 : 1, fps: FPS, ff: false });
  if (shot.join) s.onJoin = shot.join;
  if (shot.possess) {
    const pick = shot.possess;
    s.possess = (g) => {
      const p = pick(g);
      if (p && shot.god) s.god.add(p.id);
      return p;
    };
  }
  s.preroll(shot.preroll ?? 0, shot.prerollUntil);
  await s.open();
  const ctx: ShotCtx = { s, g: s.game, t: 0, frame: 0, global: at, dur: shot.dur, mem: {} };
  await shot.setup?.(ctx);
  const warm = Math.round((shot.warm ?? 1) * FPS);
  for (let i = -warm; i < shot.dur * FPS; i++) {
    ctx.frame = i;
    ctx.t = i / FPS;
    ctx.global = at + ctx.t;
    const f = shot.frame(ctx);
    const capture = i >= 0 && (!preview || i % 6 === 0);
    await s.frame({ ...f, skipRender: !capture });
    if (capture) await s.capture(join(dir, `${String(i).padStart(5, '0')}.jpg`));
  }
  await s.close();
  console.log(`${shot.name}: ${shot.dur}s at ${at}s, ${((Date.now() - t0) / 1000).toFixed(0)}s wall, game t=${(s.game.tick / TICK_RATE).toFixed(1)} stage=${s.game.rules.stage}`);
}
process.exit(0);
