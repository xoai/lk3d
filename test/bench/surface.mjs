/* global LK3D */ // (in the page: the engine and the live add-on, put there by addScriptTag)
// lk3d's own work per frame for a surface the page reshapes every frame (the live add-on's fig.surface): ripples on an
// n × n grid, its heights written by the page, then update() and drawNow() timed together (median / 95th percentile,
// ms: the normals, the tones, the refill and the drawing; the page's writing and the GPU's work are not in it), at resolution 1, with the CPU as it is
// and slowed 4 and 6 times (a phone's stand-in).
//   npm run build && node test/bench/surface.mjs        N=128,256 RATES=1,4,6 node test/bench/surface.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const LK = new URL('../..', import.meta.url).pathname.replace(/\/$/, '');
const { chromium } = require(LK + '/node_modules/playwright');
const engine = fs.readFileSync(LK + '/dist/lk3d.min.js', 'utf8'),
  live = fs.readFileSync(LK + '/dist/lk3d-live.min.js', 'utf8'),
  sizes = (process.env.N || '256').split(',').map(Number),
  rates = (process.env.RATES || '1,4,6').split(',').map(Number);
const scene = {
  view: { yaw: -25, pitch: 35 },
  parts: [{ id: 'tray', name: 'Tray', shapes: [{ box: [4.4, 0.1, 4.4] }], at: [0, -0.4, 0] }],
};

const browser = await chromium.launch({ args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu'] });
for (const rate of rates)
  for (const n of sizes) {
    const page = await browser.newPage({ viewport: { width: 900, height: 640 }, deviceScaleFactor: 1 });
    await page.setContent('<div id="g" style="width:860px"></div>');
    await page.addScriptTag({ content: engine });
    await page.addScriptTag({ content: live });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate });
    const result = await page.evaluate(
      async ({ scene, n }) => {
        const fig = LK3D.mount(document.getElementById('g'), scene, { controls: false, adaptive: false, maxDpr: 1 });
        await fig.ready;
        const water = fig.surface({ size: [4, 4], res: [n, n], colors: 'cool', smooth: true }),
          times = [];
        for (let frame = 0; frame < 120; frame++) {
          const phase = frame * 0.2;
          for (let j = 0; j < n; j++)
            for (let i = 0; i < n; i++) {
              const r = Math.hypot(i / n - 0.5, j / n - 0.5),
                h = 0.1 * Math.sin(40 * r - phase);
              water.heights[i + n * j] = h;
              water.tones[i + n * j] = 0.5 + 5 * h;
            }
          const start = performance.now(); // (lk3d's work only: not the page's writing of the heights)
          water.update();
          fig.drawNow();
          times.push(performance.now() - start);
        }
        times.sort((a, b) => a - b);
        return { renderer: fig.renderer, median: times[60], p95: times[114] };
      },
      { scene, n },
    );
    console.log(
      `${rate}× CPU, ${n} × ${n} surface (${result.renderer}): ${result.median.toFixed(2)} / ${result.p95.toFixed(2)} ms`,
    );
    await page.close();
  }
await browser.close();
