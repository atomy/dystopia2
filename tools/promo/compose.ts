// Stitches the recorded shots (out/promo/frames/<shot>/) and the soundtrack
// (out/promo/music.wav) into out/promo/dystopia2-promo.mp4 with a light grade.
// Preview recordings only have every 6th frame; those are held to fill the gaps.
//
//   npx tsx tools/promo/compose.ts

import { existsSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { repoRoot } from './session.js';
import { SHOTS, FPS } from './shots.js';

const out = process.env['PROMO_OUT'] ?? join(repoRoot, 'out', 'promo');
const seq = join(out, 'seq');
rmSync(seq, { recursive: true, force: true });
mkdirSync(seq, { recursive: true });

let n = 0;
for (const shot of SHOTS) {
  const dir = join(out, 'frames', shot.name);
  let last: string | null = null;
  for (let i = 0; i < shot.dur * FPS; i++) {
    const f = join(dir, `${String(i).padStart(5, '0')}.jpg`);
    if (existsSync(f)) last = f;
    if (!last) throw new Error(`shot ${shot.name} has no frame ${i}; record it first (tools/promo/record.ts ${shot.name})`);
    symlinkSync(last, join(seq, `${String(n++).padStart(6, '0')}.jpg`));
  }
}

const music = join(out, 'music.wav');
if (!existsSync(music)) throw new Error('no soundtrack; run tools/promo/music.ts first');
const video = join(out, 'dystopia2-promo.mp4');
const grade = "eq=contrast=1.12:brightness=0.02:saturation=1.3:gamma=1.08,curves=r='0/0 0.5/0.52 1/1':b='0/0.02 0.5/0.52 1/1'";
execFileSync(
  'ffmpeg',
  ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', join(seq, '%06d.jpg'), '-i', music,
    '-vf', `${grade},format=yuv420p`, '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-r', String(FPS),
    '-c:a', 'aac', '-b:a', '256k', '-shortest', '-movflags', '+faststart', video],
  { stdio: 'inherit' },
);
console.log(`wrote ${video} (${(n / FPS).toFixed(1)} s, ${n} frames)`);
