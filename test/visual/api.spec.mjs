// The page API wired as it says, in a real browser: what a page sets is drawn, what the reader does reaches the right
// callback, tweens give way to the page and the reader, removed and destroyed things leave nothing behind. Each test
// mounts a small scene of its own on api.html and drives it as a page would. (Chromium: the wiring is the same
// everywhere.)
/* global LK3D, mountIt */ // (in the page: the engine, and the helper beforeEach puts there)
import { test, expect } from '@playwright/test';

test.skip(({ browserName }) => browserName !== 'chromium', 'the wiring is the same in every browser');
test.beforeEach(async ({ page }) => {
  await page.goto('/test/visual/api.html');
  await page.evaluate(() => {
    window.scene = {
      parts: [
        { id: 'base', name: 'Base', shapes: [{ box: [2, 0.2, 2] }] },
        {
          id: 'knob',
          name: 'Knob',
          shapes: [{ cylinder: { r: 0.08, x0: 0, x1: 0.1 }, rot: [0, 0, 90] }], // (small: caught a finger's width away)
          at: [0, 0.1, 0],
          explode: [0, 1, 0],
          handle: { turn: { axis: [0, 1, 0] } },
        },
      ],
    };
    window.mountIt = (o = {}) => LK3D.mount(document.getElementById('g'), window.scene, { controls: false, ...o });
  });
});

test('onPick is for choosing, onHover for pointing; neither fires at mount', async ({ page }) => {
  const got = await page.evaluate(async () => {
    const calls = [];
    const fig = mountIt({
      onPick: (p) => calls.push(['pick', p && p.id]),
      onHover: (p) => calls.push(['hover', p && p.id]),
    });
    await fig.ready;
    const cv = document.querySelector('#g canvas'),
      r = cv.getBoundingClientRect();
    // the base, seen from the default view: a point on it, found by picking across the canvas
    let at = null;
    for (let y = r.height * 0.4; y < r.height && !at; y += 4)
      for (let x = r.width * 0.2; x < r.width * 0.8 && !at; x += 8) if (fig.pick(x, y) === 'base') at = [x, y];
    const ev = (type, [x, y]) =>
      cv.dispatchEvent(
        new PointerEvent(type, {
          clientX: r.left + x,
          clientY: r.top + y,
          pointerId: 1,
          bubbles: true,
          isPrimary: true,
        }),
      );
    ev('pointermove', at);
    await new Promise((res) => setTimeout(res, 60));
    const afterHover = calls.slice();
    ev('pointerdown', at);
    ev('pointerup', at);
    return { afterHover, all: calls };
  });
  expect(got.afterHover).toEqual([['hover', 'base']]);
  expect(got.all).toContainEqual(['pick', 'base']);
});

test('what a page sets by assignment is drawn; a ball set starts at version 0', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const fig = mountIt();
    await fig.ready;
    const dots = fig.particles({
      path: [
        [-1, 0.3, 0],
        [1, 0.3, 0],
      ],
      count: 5,
    });
    const balls = fig.particles({ count: 3, radius: 0.05 });
    await new Promise((res) => setTimeout(res, 100)); // (the figure is idle: nothing draws by itself)
    dots.speed = 1;
    await new Promise((res) => setTimeout(res, 400));
    const L = fig.lines({ count: 1 });
    L.set(0, [0, 0.5, 0], [1, 0.5, 0]);
    await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
    L.radius = 0.05;
    const dirty = L.dirty;
    return { offset: dots.offset, version: balls.version, dirty };
  });
  expect(r.offset).toBeGreaterThan(0.1);
  expect(r.version).toBe(0);
  expect(r.dirty).toBe(true);
});

test('the page wins over a running tween; an unknown view is ignored', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const fig = mountIt();
    await fig.ready;
    fig.explode(1);
    await new Promise((res) => setTimeout(res, 150));
    fig.set({ explode: 0 });
    await new Promise((res) => setTimeout(res, 1200));
    const e = fig._state.explode;
    fig.view('sideways');
    await new Promise((res) => setTimeout(res, 100));
    return { e, yaw: fig._state.yaw, pitch: fig._state.pitch };
  });
  expect(r.e).toBe(0);
  expect(Number.isFinite(r.yaw) && Number.isFinite(r.pitch)).toBe(true);
});

test('a hidden handle cannot be grabbed', async ({ page }) => {
  const moved = await page.evaluate(async () => {
    let n = 0;
    const fig = mountIt({ onHandle: () => n++ });
    await fig.ready;
    const cv = document.querySelector('#g canvas'),
      r = cv.getBoundingClientRect();
    let at = null;
    for (let y = 0; y < r.height && !at; y += 2)
      for (let x = 0; x < r.width && !at; x += 2) if (fig.pick(x, y) === 'knob') at = [x, y];
    fig.set({ hide: ['knob'] });
    await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
    const ev = (type, x, y) =>
      cv.dispatchEvent(
        new PointerEvent(type, { clientX: r.left + x, clientY: r.top + y, pointerId: 1, bubbles: true }),
      );
    ev('pointerdown', ...at);
    for (let k = 1; k <= 5; k++) ev('pointermove', at[0] + 10 * k, at[1]);
    ev('pointerup', at[0] + 50, at[1]);
    return n;
  });
  expect(moved).toBe(0);
});

test('mounting again replaces the figure; destroy leaves the element as it was, and ready settles', async ({
  page,
}) => {
  const r = await page.evaluate(async () => {
    const el = document.getElementById('g');
    const a = mountIt(),
      b = mountIt();
    const canvases = el.querySelectorAll('canvas').length;
    let settled = false;
    b.ready.then(() => (settled = true));
    b.destroy();
    await new Promise((res) => setTimeout(res, 50));
    return {
      aGone: !a.renderer || true,
      canvases,
      cls: el.className,
      renderer: el.dataset.renderer ?? null,
      settled,
      kids: el.children.length,
    };
  });
  expect(r.canvases).toBe(1);
  expect(r.cls).toBe('');
  expect(r.renderer).toBe(null);
  expect(r.settled).toBe(true);
  expect(r.kids).toBe(0);
});

test('parts alike are drawn together: a frame of 400 alike parts takes a few draw calls, not hundreds', async ({
  page,
}) => {
  const calls = await page.evaluate(async () => {
    const parts = [];
    for (let k = 0; k < 400; k++)
      parts.push({
        id: 'p' + k,
        name: 'Part ' + k,
        color: k % 5 ? '#c9ccd1' : '#d9822b',
        at: [(k % 20) * 0.5, 0, Math.floor(k / 20) * 0.5],
        shapes: [{ box: [0.3, 0.1, 0.3] }, { cylinder: { r: 0.05, x0: 0, x1: 0.2 }, rot: [0, 0, 90] }],
      });
    const fig = LK3D.mount(document.getElementById('g'), { parts, check: { float: true } }, { controls: false });
    await fig.ready;
    const gl = document.querySelector('#g canvas').getContext('webgl2');
    let n = 0;
    for (const k of ['drawElements', 'drawElementsInstanced', 'drawArrays', 'drawArraysInstanced']) {
      const o = gl[k].bind(gl);
      gl[k] = (...a) => (n++, o(...a));
    }
    fig.set({ explode: 0.5 }); // (every part moves: the groups' copies are written again)
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return n;
  });
  // shadow, outline, solids, edges and the ground: a handful each, for two shapes
  expect(calls).toBeLessThan(40);
});

test('a motion is set, played to its end and back, and stopped by the page; its slider follows', async ({ page }) => {
  const r = await page.evaluate(async () => {
    window.scene.motions = [
      {
        id: 'lift',
        name: 'Lift',
        range: [0, 1],
        speed: 4,
        tracks: [
          {
            parts: ['knob'],
            move: [
              [0, [0, 0, 0]],
              [1, [0, 1, 0]],
            ],
          },
        ],
      },
    ];
    const fig = LK3D.mount(document.getElementById('g'), window.scene, {});
    await fig.ready;
    const m = fig.motion('lift'),
      slider = document.querySelector('#g input[aria-label="Lift"]'),
      knob = () => fig.parts.find((p) => p.id === 'knob').m[13];
    m.set(0.5);
    await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
    const half = { y: knob(), slider: +slider.value };
    m.play();
    await new Promise((res) => setTimeout(res, 600));
    const end = { y: knob(), value: m.value, playing: m.playing };
    m.play(); // (at its end: back to the start)
    await new Promise((res) => setTimeout(res, 100));
    m.stop();
    const stopped = m.value;
    await new Promise((res) => setTimeout(res, 100));
    return { half, end, stopped, still: m.value, unknown: fig.motion('nope') === undefined };
  });
  expect(r.half.y).toBeCloseTo(0.5, 5);
  expect(r.half.slider).toBeCloseTo(0.5, 5);
  expect(r.end).toEqual({ y: 1, value: 1, playing: false });
  expect(r.stopped).toBeLessThan(1);
  expect(r.still).toBe(r.stopped);
  expect(r.unknown).toBe(true);
});

test("a motion's slider moves it, the reader's way", async ({ page }) => {
  const v = await page.evaluate(async () => {
    window.scene.motions = [
      {
        id: 'lift',
        name: 'Lift',
        range: [0, 1],
        tracks: [
          {
            parts: ['knob'],
            move: [
              [0, [0, 0, 0]],
              [1, [0, 1, 0]],
            ],
          },
        ],
      },
    ];
    const fig = LK3D.mount(document.getElementById('g'), window.scene, {});
    await fig.ready;
    const slider = document.querySelector('#g input[aria-label="Lift"]');
    slider.value = 0.7;
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    return fig.motion('lift').value;
  });
  expect(v).toBeCloseTo(0.7, 5);
});
