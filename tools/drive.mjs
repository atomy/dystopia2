// Headless test driver: launches the locally installed Chrome with software
// WebGL (SwiftShader), hosts or joins a game on the Vite dev server and runs a
// scripted sequence of steps, saving screenshots.
//
//   node tools/drive.mjs <outDir> '<json steps>' [url]
//
// Steps: {"wait": ms} | {"shot": "name"} | {"drive": {yaw,pitch,buttons,forward,side}}
//        {"eval": "js expression"} | {"key": "KeyM"} | {"click": "css selector"}
import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [outDir = './shots', stepsJson = '[]', url = 'http://localhost:5173/'] = process.argv.slice(2);
const steps = JSON.parse(stepsJson);
mkdirSync(outDir, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME ?? '/usr/bin/google-chrome-stable',
  headless: true,
  args: [
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
    '--enable-webgl',
    '--autoplay-policy=no-user-gesture-required',
    '--window-size=1280,720',
    '--no-sandbox',
  ],
  defaultViewport: { width: 1280, height: 720 },
});
const page = await browser.newPage();
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(url, { waitUntil: 'networkidle2' });

if (!url.includes('room=')) {
  await page.type('#name', 'TestPilot');
  await page.click('#host');
} else {
  await page.type('#name', 'Joiner');
  await page.click('#join');
}
await page.waitForFunction(() => !!window.__d2 && document.querySelector('.hud'), { timeout: 60000 });
// Deploy with the default loadout if the loadout screen is up.
await new Promise((r) => setTimeout(r, 1500));
const deploy = await page.$('#go');
if (deploy) await deploy.click();

for (const s of steps) {
  if (s.wait) await new Promise((r) => setTimeout(r, s.wait));
  if (s.drive) await page.evaluate((d) => window.__d2.debugDrive({ lock: true, ...d }), s.drive);
  if (s.eval) {
    const v = await page.evaluate(s.eval);
    logs.push(`[eval] ${s.eval} => ${JSON.stringify(v)?.slice(0, 2000)}`);
  }
  if (s.key) {
    await page.keyboard.down(s.key);
    await new Promise((r) => setTimeout(r, 60));
    await page.keyboard.up(s.key);
  }
  if (s.click) await page.click(s.click);
  if (s.shot) await page.screenshot({ path: join(outDir, `${s.shot}.png`) });
}
writeFileSync(join(outDir, 'console.log'), logs.join('\n'));
console.log(logs.filter((l) => !l.includes('[vite]')).slice(-40).join('\n'));
await browser.close();
