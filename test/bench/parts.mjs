/* global LK3D */ // (in the page: the engine, put there by addScriptTag)
// lk3d's own work per frame for a scene of many parts: n small assemblies on a grid (a plate, a post, a collar; every
// third with a ring of eight bolts), all named, in the pen look (the scene lessonkit's bench.cjs calls MANY), and a
// motion that lifts every fourth part. Each frame is drawn with drawNow() and timed: while only the camera moves, and
// while the motion plays (median / 95th percentile, ms; the GPU's work is not in it).
//   npm run build && node test/bench/parts.mjs        N=1000,3000 ENGINE=path/to/lk3d.min.js node test/bench/parts.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const LK = new URL('../..', import.meta.url).pathname.replace(/\/$/, '');
const { chromium } = require(LK + '/node_modules/playwright');
const engine = fs.readFileSync(process.env.ENGINE || LK + '/dist/lk3d.min.js', 'utf8');
const sizes = (process.env.N || '1000,3000').split(',').map(Number);

const many = (n) => {
  const side = Math.ceil(Math.sqrt(n)),
    parts = [];
  for (let k = 0; k < n; k++) {
    const x = (k % side) - side / 2,
      z = Math.floor(k / side) - side / 2;
    parts.push({
      id: 'p' + k,
      name: 'Part ' + k,
      note: 'one of many',
      group: k % 4 ? 'still' : 'lift',
      color: k % 7 ? '#c9ccd1' : '#d9822b',
      at: [x * 0.5, 0, z * 0.5],
      shapes: [
        { box: [0.36, 0.05, 0.36], at: [0, 0.025, 0] },
        { cylinder: { r: 0.06, x0: 0, x1: 0.22 }, rot: [0, 0, 90], at: [0, 0.05, 0], detail: 0.3 },
        {
          lathe: [
            [0.2, 0.06],
            [0.2, 0.1],
            [0.26, 0.1],
            [0.26, 0.06],
          ],
          closed: true,
          rot: [0, 0, 90],
          detail: 0.3,
        },
        ...(k % 3
          ? []
          : [
              {
                cylinder: { r: 0.012, x0: 0, x1: 0.03 },
                rot: [0, 0, 90],
                at: [0.14, 0.05, 0],
                repeat: { n: 8, axis: 'y' },
                detail: 0.3,
              },
            ]),
      ],
    });
  }
  return {
    w: 16,
    h: 10,
    style: 'pen',
    view: { projection: 'ortho', yaw: -35, pitch: 30 },
    motions: [
      {
        id: 'lift',
        range: [0, 1],
        tracks: [
          {
            parts: ['lift'],
            move: [
              [0, [0, 0, 0]],
              [1, [0, 0.3, 0]],
            ],
          },
        ],
      },
    ],
    parts,
  };
};

const b = await chromium.launch({ args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu'] });
const page = await b.newPage({ viewport: { width: 900, height: 700 } });
const rows = [];
for (const n of sizes) {
  await page.setContent(
    `<!doctype html><meta charset=utf-8><body style="margin:0"><div id=g style="width:880px"></div>`,
  );
  await page.addScriptTag({ content: engine });
  const r = await page.evaluate(async (spec) => {
    const fig = LK3D.mount(document.getElementById('g'), spec, { controls: false, adaptive: false });
    await fig.ready;
    const q = (a, f) => {
      const s = a.slice().sort((x, y) => x - y);
      return +s[Math.floor(f * (s.length - 1))].toFixed(3);
    };
    const time = (step) => {
      const t = [];
      for (let k = 0; k < 160; k++) {
        step(k);
        const a = performance.now();
        fig.drawNow();
        if (k >= 10) t.push(performance.now() - a); // (the first frames warm the JIT)
      }
      return [q(t, 0.5), q(t, 0.95)];
    };
    const camera = time((k) => fig.view({ yaw: -35 + k * 0.5 }, { ms: 0 }));
    const motion = time((k) => fig.motion('lift').set((k % 40) / 40));
    return { camera, motion, backend: fig.renderer };
  }, many(n));
  rows.push({ parts: n, ...r });
  console.log(`${n} parts (${r.backend}): camera ${r.camera.join(' / ')} ms, motion ${r.motion.join(' / ')} ms`);
}
await b.close();
