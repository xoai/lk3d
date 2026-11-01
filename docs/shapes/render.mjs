// Draws one picture of each kind of shape for docs/shapes.md (docs/shapes/KIND.png), with the image tests' page and
// Playwright's Chromium. Run after a change to a shape:  node docs/shapes/render.mjs   (needs npm run build first)
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url)),
  ROOT = path.join(HERE, '..', '..');
const SHAPES = {
  lathe: {
    lathe: [
      [-0.6, 0],
      [-0.6, 0.3],
      [-0.2, 0.45],
      [0.3, 0.45],
      [0.6, 0.2],
      [0.6, 0],
    ],
  },
  cylinder: { cylinder: { r: 0.4, ri: 0.3, x0: -0.6, x1: 0.6 } },
  box: { box: [1, 0.5, 0.6] },
  sphere: { sphere: 0.5 },
  torus: { torus: [0.45, 0.12] },
  tube: {
    tube: [
      [-0.7, -0.2, 0],
      [-0.2, 0.3, 0.2],
      [0.3, -0.1, -0.2],
      [0.7, 0.3, 0],
    ],
    r: 0.06,
  },
  helix: { helix: { r: 0.3, x0: -0.6, x1: 0.6, turns: 6, wire: 0.04 } },
  loop: { loop: { a: 1, b: 0.25, R: 0.4, wire: 0.03, turns: 3, gap: 0.06 } },
  ellipsoid: { ellipsoid: [0.7, 0.4, 0.3] },
  capsule: { capsule: { r: 0.22, x0: -0.5, x1: 0.5 } },
  blob: { blob: { r: 0.5, amp: 0.12, seed: 4 } },
  shell: { shell: { r: 0.6, ri: 0.4, from: 0, to: 270 } },
  tree: { tree: { levels: 3, length: 0.5, r: 0.05, seed: 2 } },
  molecule: {
    molecule: {
      atoms: [
        { el: 'C', at: [0, 0, 0] },
        { el: 'H', at: [0.63, 0.63, 0.63] },
        { el: 'H', at: [-0.63, -0.63, 0.63] },
        { el: 'H', at: [-0.63, 0.63, -0.63] },
        { el: 'H', at: [0.63, -0.63, -0.63] },
      ],
      bonds: [
        [0, 1, 1],
        [0, 2, 1],
        [0, 3, 1],
        [0, 4, 1],
      ],
      scale: 0.5,
    },
  },
  dna: { dna: { pairs: 12, scale: 0.35 } },
  extrude: {
    extrude: {
      outline: [
        [-0.6, -0.3],
        [0.6, -0.3],
        [0.6, 0.3],
        [0, 0.05],
        [-0.6, 0.3],
      ],
      depth: 0.3,
    },
  },
  terrain: {
    terrain: {
      size: [1.4, 1],
      base: 0.45,
      height: { amp: 0.12, seed: 3 },
      layers: [
        { thick: 0.12, color: '#c9a46a' },
        { thick: 0.15, color: '#9b6b43' },
        { thick: 0.2, color: '#7d7f86' },
      ],
    },
  },
  ring: { ring: { r: 0.7, ri: 0.45, thickness: 0.02 } },
  orbit: { orbit: { a: 0.6, e: 0.4, wire: 0.015 } },
  blade: { blade: { root: 0.1, span: 0.9, chord: 0.35, tip: 0.2, twist: 40, camber: 0.05 } },
  scatter: { scatter: { shape: { sphere: 0.05 }, n: 60, within: { sphere: 0.6 }, seed: 2 } },
};
const dir = path.join(ROOT, 'test/visual/scenes'),
  made = [];
for (const [kind, shape] of Object.entries(SHAPES)) {
  const f = path.join(dir, `_shape-${kind}.json`);
  fs.writeFileSync(
    f,
    JSON.stringify({
      w: 16,
      h: 10,
      view: { yaw: -30, pitch: 20 },
      section: false,
      parts: [{ id: kind, color: '#6f9fd8', material: 'paint', shapes: [shape] }],
    }),
  );
  made.push(f);
}
// and the English generator from the examples, for the README's picture
const hero = path.join(dir, '_hero.json');
fs.copyFileSync(path.join(ROOT, 'examples/scenes/generator.json'), hero);
made.push(hero);
const server = spawn('node', [path.join(ROOT, 'test/visual/serve.mjs')], {
  env: { ...process.env, PORT: '4175' },
  stdio: 'ignore',
});
await new Promise((r) => setTimeout(r, 600));
const browser = await chromium.launch(),
  page = await browser.newPage({ viewport: { width: 300, height: 260 } });
try {
  for (const kind of Object.keys(SHAPES)) {
    await page.goto(`http://localhost:4175/test/visual/index.html?scene=_shape-${kind}&look=ink&w=260`);
    await page.waitForFunction(() => window.__ready, null, { timeout: 30_000 });
    await page.locator('.lk3d-stage').screenshot({ path: path.join(HERE, `${kind}.png`) });
  }
  // the README's picture: the generator taken apart and cut open, in the drawn look
  await page.setViewportSize({ width: 680, height: 460 });
  await page.goto('http://localhost:4175/test/visual/index.html?scene=_hero&look=ink&w=640');
  await page.waitForFunction(() => window.__ready, null, { timeout: 30_000 });
  await page.evaluate(() => window.__fig.set({ explode: 1, cut: true, labels: 'all' }));
  await page.waitForTimeout(400);
  await page.locator('.lk3d-stage').screenshot({ path: path.join(HERE, '..', 'generator.png') });
} finally {
  await browser.close();
  server.kill();
  for (const f of made) fs.rmSync(f);
}
console.log(`${Object.keys(SHAPES).length} pictures in docs/shapes/`);
