// Each reference scene, drawn in the drawn look and the studio look (and a few in the 2D fallback), must look as it
// did: a broken shader, a shape built wrong or a light gone missing changes many pixels; GPU noise changes few.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCENES = fs.readdirSync(path.join(HERE, 'scenes')).map((f) => f.replace(/\.json$/, '')).sort();
const FALLBACK = ['generator', 'molecules', 'earth'];  // the 2D fallback: a few are enough
const runs = [...SCENES.flatMap((s) => [[s, 'ink'], [s, 'studio']]), ...FALLBACK.map((s) => [s, '2d'])];

for (const [scene, look] of runs) {
  test(`${scene}, ${look}`, async ({ page, browserName }) => {
    await page.goto(`/test/visual/index.html?scene=${scene}&look=${look}`);
    const done = await page.waitForFunction(() => window.__ready, null, { timeout: 45_000 }).then((h) => h.jsonValue());
    expect(done.errors, 'no errors on the page').toEqual([]);
    if (look === '2d') expect(done.renderer).toBe('2d');
    else test.info().annotations.push({ type: 'renderer', description: done.renderer });   // WebGL 2 where the browser has it
    expect(done.triangles).toBeGreaterThan(0);
    await expect(page.locator('.lk3d-stage')).toHaveScreenshot(`${scene}-${look}.png`);
  });
}
