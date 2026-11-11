/* global LK3D */ // (in the page: the engine, put there by addScriptTag)
// lk3d's own work per frame for flow streaks: the ducted fan of the image tests (test/visual/scenes/flow.json) with its
// flows at n streaks each, moving, each frame drawn with drawNow() and timed (median / 95th percentile, ms; the GPU's
// work is not in it), against the same scene without flows, with the CPU as it is and slowed 6 times (a low-end phone's
// stand-in).
//   npm run build && node test/bench/flow.mjs        N=2000,8000 ENGINE=path/to/lk3d.min.js node test/bench/flow.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const LK = new URL('../..', import.meta.url).pathname.replace(/\/$/, '');
const { chromium } = require(LK + '/node_modules/playwright');
const engine = fs.readFileSync(process.env.ENGINE || LK + '/dist/lk3d.min.js', 'utf8'),
  scene = JSON.parse(fs.readFileSync(LK + '/test/visual/scenes/flow.json', 'utf8')),
  sizes = [0, ...(process.env.N || '2000,8000').split(',').map(Number)];

const browser = await chromium.launch({ args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu'] });
for (const slowdown of [1, 6]) {
  for (const n of sizes) {
    const page = await browser.newPage({ viewport: { width: 900, height: 640 } });
    await page.setContent('<div id="g" style="width:860px"></div>');
    await page.addScriptTag({ content: engine });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: slowdown });
    const result = await page.evaluate(
      async ({ scene, n }) => {
        const fig = LK3D.mount(document.getElementById('g'), scene, { controls: false, adaptive: false });
        await fig.ready;
        LK3D.clock.speed = 0; // (the page steps the clock: every frame moves the streaks the same)
        if (n)
          for (const flow of scene.extras.flows)
            fig.flow({ ...flow, count: Math.round(n / scene.extras.flows.length), speed: 1 });
        const times = [];
        for (let k = 0; k < 120; k++) {
          LK3D.clock.step(16.7);
          const start = performance.now();
          fig.drawNow();
          times.push(performance.now() - start);
        }
        times.sort((a, b) => a - b);
        return { renderer: fig.renderer, median: times[60], p95: times[114] };
      },
      { scene, n },
    );
    console.log(
      `${slowdown}× CPU, ${String(n).padStart(5)} streaks (${result.renderer}): ${result.median.toFixed(2)} / ${result.p95.toFixed(2)} ms`,
    );
    await page.close();
  }
}
await browser.close();
