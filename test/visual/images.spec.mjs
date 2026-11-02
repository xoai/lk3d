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
    const done = await page.waitForFunction(() => window.__ready, null, { timeout: 45_000 }).then((h) => h.jsonValue());
    expect(done.errors, 'no errors on the page').toEqual([]);
    if (look.endsWith('2d')) expect(done.renderer).toBe('2d');
    else test.info().annotations.push({ type: 'renderer', description: done.renderer }); // WebGL 2 where the browser has it
    expect(done.triangles).toBeGreaterThan(0);
    await expect(page.locator('.lk3d-stage')).toHaveScreenshot(`${name}.png`);
  });
}

// a look the engine does not know is drawn as the drawn look, without an error
test('an unknown look', async ({ page }) => {
  await page.goto('/test/visual/index.html?scene=generator&look=photo');
  const done = await page.waitForFunction(() => window.__ready, null, { timeout: 45_000 }).then((h) => h.jsonValue());
  expect(done.errors).toEqual([]);
  await expect(page.locator('.lk3d-stage')).toHaveAttribute('data-look', 'ink');
});

// Taking apart never jumps. With the clock stopped, the take-apart is stepped through in 20 frames; how much each picture
// covers and where its middle is must change smoothly, since a jump (a part gone for a frame, a part that snaps) is a
// spike in their second differences. The check is first shown a planted jump, a part hidden for one frame, and must
// catch it: a check that cannot see a jump proves nothing.
async function takeApart(page, plant) {
  await page.goto('/test/visual/index.html?scene=generator&look=ink');
  await page.waitForFunction(() => window.__ready, null, { timeout: 45_000 });
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
