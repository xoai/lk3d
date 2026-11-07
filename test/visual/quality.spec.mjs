// Quality, not sameness: the image tests compare pictures with stored ones, and pass a flaw that was there when the
// pictures were stored. These measure two flaws a picture can have whatever it was before, on small scenes of their own
// (test/visual/quality/), each with a bound found by drawing it with the flaw and without:
// - the ink look's hard step between two tones, on a curve made of crisp bands (a lathe's profile segments, each with
//   its own normal), must run smoothly round the curve, not in a staircase band by band;
// - a cut part's cap must hide what is buried in the part behind the cut (here a ball inside a block), in every look.
import { test, expect } from '@playwright/test';

// the stage's picture, as numbers: [r, g, b, a] per pixel, with its width and height
async function pixels(page) {
  const png = (await page.locator('.lk3d-stage canvas').first().screenshot()).toString('base64');
  return page.evaluate(async (s) => {
    const im = await createImageBitmap(await (await fetch('data:image/png;base64,' + s)).blob()),
      x = new OffscreenCanvas(im.width, im.height).getContext('2d');
    x.drawImage(im, 0, 0);
    return { w: im.width, h: im.height, d: Array.from(x.getImageData(0, 0, im.width, im.height).data) };
  }, png);
}
async function open(page, scene, look) {
  await page.goto(`/test/visual/index.html?scene=../quality/${scene}&look=${look}`);
  const done = await page.waitForFunction(() => window.__ready, null, { timeout: 100_000 }).then((h) => h.jsonValue());
  expect(done.errors).toEqual([]);
  expect(done.renderer, 'drawn with WebGL').not.toBe('2d');
}

// The barrel, in ink: in each column, the lowest row of the lit tone (the boundary between it and the middle tone,
// found on a vertical median of five pixels, against the paper's grain). A smooth boundary bends gently from column to
// column; a staircase jumps at each band, a spike in the boundary's second difference. Measured on Chromium (Apple
// GPU): 10 spikes with the staircase, 0 without.
const SPIKE = 4, // pixels
  SPIKES = 3;
test('ink: the step between tones runs smoothly round a curve of crisp bands', async ({ page }) => {
  await open(page, 'barrel', 'ink');
  const { w, h, d } = await pixels(page),
    lum = (x, y) => (d[4 * (y * w + x)] + d[4 * (y * w + x) + 1] + d[4 * (y * w + x) + 2]) / 3;
  // the lit tone: the brightest of the barrel (the page is whiter, the outline darker)
  const body = [];
  for (let y = 0; y < h; y += 2)
    for (let x = 0; x < w; x += 2) if (lum(x, y) > 90 && lum(x, y) < 240) body.push(lum(x, y));
  body.sort((a, b) => a - b);
  const lit = body[Math.floor(body.length * 0.95)],
    T = lit * 0.91; // (halfway between the lit tone and the middle one, 0.82 of it)
  // (the end of the first run of the lit tone down the column, of at least five pixels: not the outline's soft edge
  // against the page)
  const low = [];
  for (let x = 0; x < w; x++) {
    let run = 0,
      at = -1;
    for (let y = 2; y < h - 2 && at < 0; y++) {
      const m = [-2, -1, 0, 1, 2].map((k) => lum(x, y + k)).sort((a, b) => a - b)[2];
      if (m > T && m < 240) run++;
      else if (run >= 5) at = y - 1;
      else run = 0;
    }
    low.push(at);
  }
  const cols = low.map((y, x) => x).filter((x) => low[x] >= 0),
    from = cols[0] + Math.round((cols.at(-1) - cols[0]) * 0.15),
    to = cols.at(-1) - Math.round((cols.at(-1) - cols[0]) * 0.15);
  let spikes = 0;
  for (let x = from + 1; x < to; x++)
    if (low[x - 1] >= 0 && low[x] >= 0 && low[x + 1] >= 0 && Math.abs(low[x + 1] - 2 * low[x] + low[x - 1]) > SPIKE)
      spikes++;
  test.info().annotations.push({ type: 'spikes', description: `${spikes} in columns ${from}–${to}, lit ${lit}` });
  expect(to - from, 'the lit tone found across the barrel').toBeGreaterThan(w / 4);
  expect(spikes, 'steps in the boundary between the lit tone and the next').toBeLessThan(SPIKES);
});

// The block, cut, with a ball inside it: in front of the cut (the plane z = 0) the ball is cut too, behind it its
// surface is buried in the block. Across the block's section, away from the ball's own (a disc of radius 0.28 round the
// middle), every pixel must be the block's cap: nothing of the ball's surface (blue, or near-black in shade) may show
// through. Measured on Chromium (Apple GPU): 8–11 % of the section showed the ball, at most 0.03 % once fixed.
for (const look of ['ink', 'pen', 'studio'])
  test(`${look}: a cap hides what is buried behind the cut`, async ({ page }) => {
    await open(page, 'buried', look);
    const P = await page.evaluate(async () => {
      const fig = window.__fig;
      fig.set({ cut: true });
      for (let k = 0; k < 4; k++) await new Promise((r) => requestAnimationFrame(r));
      const c = document.querySelector('.lk3d-stage canvas').getBoundingClientRect(),
        s = document.querySelector('.lk3d-stage').getBoundingClientRect(),
        at = (p) => {
          const q = fig.project(p);
          return [q[0] + s.left - c.left, q[1] + s.top - c.top];
        };
      return { mid: at([0, 0, 0]), ring: at([0, 0.33, 0]), lo: at([-1.05, -0.7, 0]), hi: at([1.05, 0.7, 0]) };
    });
    const { w, d } = await pixels(page),
      sx = w / (await page.locator('.lk3d-stage canvas').first().boundingBox()).width,
      px = (x, y) => [0, 1, 2].map((k) => d[4 * (Math.round(y) * w + Math.round(x)) + k]);
    // the section's region (in canvas pixels), and the ball's section with a margin, left out
    const [x0, x1] = [P.lo[0], P.hi[0]].map((v) => v * sx).sort((a, b) => a - b),
      [y0, y1] = [P.lo[1], P.hi[1]].map((v) => v * sx).sort((a, b) => a - b),
      [cx, cy] = P.mid.map((v) => v * sx),
      r = Math.hypot(P.ring[0] - P.mid[0], P.ring[1] - P.mid[1]) * sx;
    // the cap's colour: the median of the region (most of it is the block's cap)
    const all = [];
    for (let y = y0; y < y1; y += 3)
      for (let x = x0; x < x1; x += 3) if (Math.hypot(x - cx, y - cy) > r) all.push(px(x, y));
    const ref = [0, 1, 2].map((k) => all.map((c) => c[k]).sort((a, b) => a - b)[all.length >> 1]);
    let n = 0,
      off = 0;
    for (let y = Math.ceil(y0); y < y1; y++)
      for (let x = Math.ceil(x0); x < x1; x++) {
        if (Math.hypot(x - cx, y - cy) <= r) continue;
        n++;
        const c = px(x, y);
        // (the hatching shades the cap by up to a sixth: far beyond that is something else)
        if (Math.abs(c[0] - ref[0]) + Math.abs(c[1] - ref[1]) + Math.abs(c[2] - ref[2]) > 90) off++;
      }
    test.info().annotations.push({ type: 'foreign', description: `${off} of ${n} pixels, cap ${ref}` });
    expect(n, 'the section found').toBeGreaterThan(5000);
    expect(off / n, 'pixels of the section that are not its cap').toBeLessThan(0.003);
  });
