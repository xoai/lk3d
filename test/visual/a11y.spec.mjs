// Accessibility shown, not only meant: axe-core (a dev dependency, never shipped) on every example page and on the
// playground, once their figures are drawn: no serious or critical violation. What axe cannot judge (does a screen
// reader make sense of the figure?) is the manual matrix in docs/accessibility.md. (Chromium: the markup is the same
// in every browser.)
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url),
  axe = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8'),
  ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), '..', '..'),
  pages = [
    ...fs
      .readdirSync(path.join(ROOT, 'examples'))
      .filter((f) => f.endsWith('.html'))
      .map((f) => `/examples/${f}`),
    '/playground/index.html',
  ];

test.skip(({ browserName }) => browserName !== 'chromium', 'the markup is the same in every browser');
for (const url of pages)
  test(`axe: ${url}`, async ({ page }) => {
    await page.goto(url);
    // (its figures drawn: each element's or mounted figure's ready, else a moment for a page that mounts later)
    await page.evaluate(() =>
      Promise.race([
        Promise.all([...document.querySelectorAll('.lk3d')].map((el) => el.lk3d?.ready)),
        new Promise((done) => setTimeout(done, 5000)),
      ]),
    );
    await page.addScriptTag({ content: axe });
    const found = await page.evaluate(async () =>
      (await window.axe.run()).violations
        .filter((v) => ['serious', 'critical'].includes(v.impact))
        .map(
          (v) =>
            `${v.id} (${v.impact}): ${v.nodes
              .map((n) => n.target.join(' '))
              .slice(0, 3)
              .join(', ')}`,
        ),
    );
    expect(found).toEqual([]);
  });
