/* global LK3D */ // (in the page: the engine and the story add-on, put there by addScriptTag)
// lk3d's own work per frame while a sequence plays and while the steps play by themselves (the story add-on,
// dist/lk3d-story.min.js): the desk fan of the image tests (test/visual/scenes/sequence-teardown.json, with two steps
// added), each frame drawn with drawNow() and timed (median / 95th percentile, ms; the GPU's work is not in it), against
// the same figure standing still, with the CPU as it is and slowed 6 times (a low-end phone's stand-in).
//   npm run build && node test/bench/story.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const LK = new URL('../..', import.meta.url).pathname.replace(/\/$/, '');
const { chromium } = require(LK + '/node_modules/playwright');
const engine = fs.readFileSync(LK + '/dist/lk3d.min.js', 'utf8'),
  story = fs.readFileSync(LK + '/dist/lk3d-story.min.js', 'utf8'),
  scene = JSON.parse(fs.readFileSync(LK + '/test/visual/scenes/sequence-teardown.json', 'utf8'));
scene.steps = [
  { id: 'whole', title: 'The whole fan', view: 'home', dwell: 500 },
  { id: 'apart', title: 'Taken apart', focus: ['motor'], play: ['thao'], dwell: 500 },
];

const browser = await chromium.launch({ args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu'] });
for (const slowdown of [1, 6]) {
  for (const what of ['still', 'sequence', 'tour']) {
    const page = await browser.newPage({ viewport: { width: 900, height: 640 } });
    await page.setContent('<div id="g" style="width:860px"></div>');
    await page.addScriptTag({ content: engine });
    await page.addScriptTag({ content: story });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: slowdown });
    const result = await page.evaluate(
      async ({ scene, what }) => {
        const fig = LK3D.mount(document.getElementById('g'), scene, { controls: false, adaptive: false });
        await fig.ready;
        LK3D.clock.speed = 0; // (the page steps the clock: every run moves the same)
        if (what === 'sequence') fig.sequence('thao').play();
        if (what === 'tour') fig.tour({ dwell: 500 }).play();
        const times = [];
        for (let k = 0; k < 200; k++) {
          LK3D.clock.step(16.7);
          const start = performance.now();
          fig.drawNow();
          times.push(performance.now() - start);
        }
        times.sort((a, b) => a - b);
        return { renderer: fig.renderer, median: times[100], p95: times[190] };
      },
      { scene, what },
    );
    console.log(
      `CPU ×${slowdown}  ${what.padEnd(8)}  ${result.median.toFixed(2)} ms median, ${result.p95.toFixed(2)} ms p95 (${result.renderer})`,
    );
    await page.close();
  }
}
await browser.close();
