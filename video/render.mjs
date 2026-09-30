// node render.mjs <w> <h> <out.mp4|--stills> [frames...]
import { chromium } from '/root/deck/node_modules/playwright/index.mjs';
import { spawn } from 'child_process';
import fs from 'fs';
const [w, h, target, ...rest] = process.argv.slice(2);
const port = 4800;
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await b.newPage({ viewport: { width: 400, height: 400 }, deviceScaleFactor: 1 });
p.on('pageerror', (e) => console.error('PAGE', e.message));
p.on('console', (m) => m.type() === 'error' && console.error('CONSOLE', m.text()));
await p.goto(`http://localhost:${port}/index.html?w=${w}&h=${h}`);
await p.waitForFunction(() => window.gali, null, { timeout: 30000 });
await p.evaluate(() => window.gali.ready);
const total = await p.evaluate(() => window.gali.frames);
if (target === '--stills') {
  const want = new Set(rest.map(Number));
  const last = Math.max(...want);
  for (let f = 0; f <= last; f++) {
    await p.evaluate((f) => window.gali.render(f), f);
    if (want.has(f)) {
      const d = await p.evaluate(() => window.gali.grab(0.9));
      fs.writeFileSync(`/tmp/claude-0/vid-${w}x${h}-${String(f).padStart(3, '0')}.jpg`, Buffer.from(d.split(',')[1], 'base64'));
    }
  }
} else {
  const ff = spawn('ffmpeg', ['-y', '-f', 'image2pipe', '-framerate', '30', '-c:v', 'mjpeg', '-i', '-', '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', target], { stdio: ['pipe', 'ignore', 'inherit'] });
  const t0 = Date.now();
  for (let f = 0; f < total; f++) {
    await p.evaluate((f) => window.gali.render(f), f);
    const d = await p.evaluate(() => window.gali.grab(0.95));
    if (!ff.stdin.write(Buffer.from(d.split(',')[1], 'base64'))) await new Promise((r) => ff.stdin.once('drain', r));
    if (f % 90 === 0) console.log('frame', f, Math.round((Date.now() - t0) / 1000) + 's');
  }
  ff.stdin.end();
  await new Promise((r) => ff.on('close', r));
}
await b.close();
