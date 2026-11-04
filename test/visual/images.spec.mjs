// Each reference scene, drawn in each look (and a few in the 2D fallback, and in the themes), must look as it did: a
// broken shader, a shape built wrong or a light gone missing changes many pixels; GPU noise changes few.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCENES = fs
  .readdirSync(path.join(HERE, 'scenes'))
  .map((f) => f.replace(/\.json$/, ''))
  .sort();
const FALLBACK = ['generator', 'molecules', 'earth']; // the 2D fallback: a few are enough
const runs = [
  ...SCENES.flatMap((s) => [
    [s, 'ink'],
    [s, 'studio'],
    [s, 'pen'],
  ]),
  ...FALLBACK.flatMap((s) => [
    [s, '2d'],
    [s, 'pen2d'],
  ]),
  // the themes: on a machine, a cell, and the streaks of a flow
  ...['generator', 'cell', 'flow'].flatMap((s) => [
    [s, 'pen', 'dark'],
    [s, 'pen', 'blueprint'],
    [s, 'ink', 'sepia'],
  ]),
  ['flow', 'studio', 'dark'],
  // streams of air: the exhaust jet and the intake, in pen, pen on a dark page, and studio
  ['stream', 'pen', 'dark'],
  ['stream', 'studio', 'dark'],
  // one stream round another (a bypass jet round the core's), seen from behind: each is marched, neither hides the other
  ['jets', 'pen', 'dark'],
  // the orthographic camera, with the pen look's edges: machines drawn as a technical illustration
  ['engine', 'pen', null, 'ortho'],
  ['generator', 'pen', null, 'ortho'],
  ['generator', 'ink', null, 'ortho'],
];

for (const [scene, look, theme, proj] of runs) {
  const name = `${scene}-${look}${theme ? '-' + theme : ''}${proj ? '-' + proj : ''}`;
  test(name.replace(/-/g, ', '), async ({ page, browserName }) => {
    await page.goto(
      `/test/visual/index.html?scene=${scene}&look=${look}${theme ? '&theme=' + theme : ''}${proj ? '&proj=' + proj : ''}`,
    );
    const done = await page
      .waitForFunction(() => window.__ready, null, { timeout: 100_000 })
      .then((h) => h.jsonValue());
    expect(done.errors, 'no errors on the page').toEqual([]);
    // (a picture of a figure still finding its edges or shading differs from run to run: refused, not compared)
    expect(done.complete, 'the figure complete (fig.ready) before its picture').toBe(true);
    // (a WebGL look drawn by the 2D fallback would be compared with pictures of the wrong thing: refused)
    if (look.endsWith('2d')) expect(done.renderer).toBe('2d');
    else expect(done.renderer, 'drawn with WebGL').not.toBe('2d');
    expect(done.triangles).toBeGreaterThan(0);
    await expect(page.locator('.lk3d-stage')).toHaveScreenshot(`${name}.png`);
  });
}

// A textured model, chosen, keeps its own colours (a rim of light and a faint wash), where a plain part takes the full
// wash: how much the pixels that change at all change, on choosing the ball and on choosing the plain rod beside it.
test('a chosen textured model keeps its colours', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'the same shader everywhere');
  await page.goto('/test/visual/index.html?scene=textured&look=studio');
  await page.waitForFunction(() => window.__ready, null, { timeout: 100_000 });
  const canvas = page.locator('.lk3d-stage canvas').first();
  const shot = async (id) => {
    await page.evaluate(async (id) => {
      window.__fig.select(id);
      for (let k = 0; k < 3; k++) await new Promise((r) => requestAnimationFrame(r));
    }, id);
    return (await canvas.screenshot()).toString('base64');
  };
  const [none, ball, rod] = [await shot(null), await shot('ball'), await shot('knurl')];
  const change = await page.evaluate(
    async ([a, b, c]) => {
      const px = async (s) => {
        const im = await createImageBitmap(await (await fetch('data:image/png;base64,' + s)).blob()),
          cv = new OffscreenCanvas(im.width, im.height),
          x = cv.getContext('2d');
        x.drawImage(im, 0, 0);
        return x.getImageData(0, 0, im.width, im.height).data;
      };
      const [A, B, C] = await Promise.all([a, b, c].map(px));
      const mean = (P) => {
        let sum = 0,
          n = 0;
        for (let i = 0; i < A.length; i += 4) {
          const d = (Math.abs(P[i] - A[i]) + Math.abs(P[i + 1] - A[i + 1]) + Math.abs(P[i + 2] - A[i + 2])) / 3;
          if (d > 3) ((sum += d), n++);
        }
        return { mean: sum / Math.max(n, 1), n };
      };
      return { ball: mean(B), rod: mean(C) };
    },
    [none, ball, rod],
  );
  expect(change.ball.n, 'choosing the ball shows').toBeGreaterThan(200);
  expect(change.rod.n, 'choosing the rod shows').toBeGreaterThan(200);
  expect(change.ball.mean, 'the ball much less washed than the rod').toBeLessThan(0.6 * change.rod.mean);
});

// a look the engine does not know is drawn in the default look, pen, without an error
test('an unknown look', async ({ page }) => {
  await page.goto('/test/visual/index.html?scene=generator&look=photo');
  const done = await page.waitForFunction(() => window.__ready, null, { timeout: 100_000 }).then((h) => h.jsonValue());
  expect(done.errors).toEqual([]);
  await expect(page.locator('.lk3d-stage')).toHaveAttribute('data-look', 'pen');
});

// Taking apart never jumps. With the clock stopped, the take-apart is stepped through in 20 frames; how much each picture
// covers and where its middle is must change smoothly, since a jump (a part gone for a frame, a part that snaps) is a
// spike in their second differences. The check is first shown a planted jump, a part hidden for one frame, and must
// catch it: a check that cannot see a jump proves nothing.
async function takeApart(page, plant) {
  await page.goto('/test/visual/index.html?scene=generator&look=ink');
  await page.waitForFunction(() => window.__ready, null, { timeout: 100_000 });
  return page.evaluate(async (plant) => {
    const fig = window.__fig;
    window.LK3D.clock.speed = 0;
    fig.explode(1);
    const out = [];
    for (let k = 0; k <= 20; k++) {
      if (plant) fig.set({ hide: k === 10 ? [plant] : [] });
      out.push(await window.__ink());
      window.LK3D.clock.step(45);
    }
    return out;
  }, plant);
}
// the largest second difference of each measure, against its largest first difference
function jumpiness(frames) {
  return [0, 1, 2].map((m) => {
    const s = frames.map((f) => f[m]),
      d1 = s.slice(1).map((v, k) => v - s[k]),
      d2 = d1.slice(1).map((v, k) => v - d1[k]);
    return Math.max(...d2.map(Math.abs)) / (Math.max(...d1.map(Math.abs)) + 1e-6);
  });
}
const JUMP = 1; // (measured: about 0.35–0.57 for the real take-apart, 1.6 with a part hidden for a frame)
test('taking apart never jumps', async ({ page }) => {
  const planted = jumpiness(await takeApart(page, 'nap-truoc'));
  test.info().annotations.push({ type: 'planted', description: planted.map((v) => v.toFixed(2)).join(' ') });
  expect(Math.max(...planted), 'the check catches a planted jump').toBeGreaterThan(JUMP);
  const real = jumpiness(await takeApart(page, null));
  test.info().annotations.push({ type: 'jumpiness', description: real.map((v) => v.toFixed(2)).join(' ') });
  expect(Math.max(...real)).toBeLessThan(JUMP);
});

// Zooming deep into a detail: towards the pointer, the part under it stays under it all the way in (here the
// generator's terminal box, about 50 times closer), in both projections; the close-up is compared as a picture.
for (const proj of ['perspective', 'ortho'])
  test(`zooming into a detail, ${proj}`, async ({ page }) => {
    await page.goto(`/test/visual/index.html?scene=generator&look=pen&proj=${proj}`);
    const done = await page
      .waitForFunction(() => window.__ready, null, { timeout: 100_000 })
      .then((h) => h.jsonValue());
    expect(done.complete, 'the figure complete (fig.ready) before its picture').toBe(true);
    const r = await page.evaluate(async () => {
      const fig = window.__fig,
        frame = () => new Promise((f) => requestAnimationFrame(() => f()));
      let at = null;
      for (let y = 20; y < 400 && !at; y += 6)
        for (let x = 20; x < 460 && !at; x += 6) if (fig.pick(x, y) === 'hop-dau-day') at = [x, y];
      const seen = [];
      for (let k = 0; k < 12; k++) {
        fig.zoom(1.5, ...at);
        await frame();
        seen.push(fig.pick(...at));
      }
      await frame();
      await frame();
      return { at, seen, zoom: fig.zoomLevel };
    });
    expect(r.at, 'the terminal box is on screen').not.toBeNull();
    expect(new Set(r.seen)).toEqual(new Set(['hop-dau-day']));
    expect(r.zoom).toBeGreaterThan(45); // as far as the scene allows (50 by default), not 3.3 as before
    await expect(page.locator('.lk3d-stage')).toHaveScreenshot(`zoom-${proj}.png`);
  });
