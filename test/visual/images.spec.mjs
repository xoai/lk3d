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
];

for (const [scene, look, theme] of runs) {
  const name = `${scene}-${look}${theme ? '-' + theme : ''}`;
  test(name.replace(/-/g, ', '), async ({ page, browserName }) => {
    await page.goto(`/test/visual/index.html?scene=${scene}&look=${look}${theme ? '&theme=' + theme : ''}`);
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
