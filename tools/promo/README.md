# Promo video

Records the promo trailer from the real game: bot matches in an in-process room, rendered by the dev client in headless Chrome with software WebGL (SwiftShader), plus a procedural soundtrack.

```bash
npx tsx tools/promo/record.ts --preview            # every 6th frame, 720p: quick framing checks
npx tsx tools/promo/record.ts --preview core bhop  # only some shots
npx tsx tools/promo/record.ts --final              # all frames at 1920x1080 (about 30 min)
npx tsx tools/promo/music.ts                       # out/promo/music.wav
npx tsx tools/promo/compose.ts                     # out/promo/dystopia2-promo.mp4 (+ a 720p copy)
```

Output goes to `out/promo/` (git-ignored). Needs Chrome at `/usr/bin/google-chrome-stable` (or `CHROME=...`) and `ffmpeg` with libx264.

## How it works

- `session.ts` runs a `Room` in-process and steps it in lockstep with the page. `shim.js` replaces the page's clock, animation frames and timers with a virtual clock. Each video frame advances the server by 2 ticks and the page by 1/30 s, so the footage is smooth no matter how slowly SwiftShader renders.
- `Math.random` is seeded, so a pre-rolled match replays identically: a shot can jump to "11.2 s into the round, when the bay door opens" and film it.
- First-person shots take over a bot (`possess`). Its brain keeps playing through the real client (`debugDrive` and `debugWeapon`), so the HUD, viewmodel and prediction are the real thing. `god` makes the camera player invulnerable.
- Cinematic shots use a free camera (`debugCam`) with splines, springs and a chase camera. Some shots stage events directly on the server, like the scripted hunter in `body` and the core destruction in `core`.
- Captions, titles and the end card are HTML in an overlay layer in the page, so they're in the screenshots.
- `shots.ts` is the edit: shots in order, on a 120 BPM grid (one bar = 2 s) that `music.ts` follows. The title hit is at 8 s, the drop at 12 s, the jack-in zap at 21.3 s and the core explosion at 52 s. If you change shot lengths, move the cues in `music.ts` to match.
