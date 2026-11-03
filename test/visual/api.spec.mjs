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

test('a funnel pours by Torricelli into a beaker below: volume kept, a stream while it flows, stopped when shut', async ({
  page,
}) => {
  const r = await page.evaluate(async () => {
    const scene = await (await fetch('/test/visual/scenes/pour.json')).json();
    const fig = LK3D.mount(document.getElementById('g'), scene, { controls: false });
    await fig.ready;
    const up = fig.liquid('water'),
      down = fig.liquid('water-below'),
      tap = fig.vessel('f'),
      gl = document.querySelector('#g canvas');
    const before = { up: up.volume, down: down.volume, level: up.level };
    tap.set({ open: 1 });
    await new Promise((res) => setTimeout(res, 800));
    const during = { up: up.volume, down: down.volume, flow: tap.flow, level: up.level, below: down.level };
    tap.set({ open: 0 });
    await new Promise((res) => setTimeout(res, 300));
    const shut = { up: up.volume, flow: tap.flow };
    await new Promise((res) => setTimeout(res, 300));
    return { before, during, shut, still: up.volume, w: gl.width };
  });
  expect(r.during.up).toBeLessThan(r.before.up);
  expect(r.during.up + r.during.down).toBeCloseTo(r.before.up + r.before.down, 6); // (nothing lost)
  expect(r.during.flow).toBeGreaterThan(0);
  expect(r.during.level).toBeLessThan(r.before.level);
  expect(r.shut.flow).toBe(0);
  expect(r.still).toBe(r.shut.up);
});

test('a gas holds its piston where pV = nRT puts it: half as hot again, half as high again', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const scene = await (await fetch('/test/visual/scenes/piston.json')).json();
    const fig = LK3D.mount(document.getElementById('g'), scene, { controls: false });
    await fig.ready;
    await new Promise((res) => setTimeout(res, 200));
    const gas = fig.gas('air'),
      piston = () => fig.parts.find((p) => p.id === 'piston'),
      h0 = gas.height,
      seat0 = piston().lo[1] + piston().m[13];
    gas.set({ T: 293 * 1.5 });
    await new Promise((res) => setTimeout(res, 3000));
    return { h0, h1: gas.height, seat0, seat1: piston().lo[1] + piston().m[13] };
  });
  expect(r.h1 - 0.2).toBeCloseTo(1.5 * (r.h0 - 0.2), 2); // (above the inside's floor at 0.2; still easing in)
  expect(r.seat0).toBeCloseTo(r.h0, 5); // (the piston sits on the gas)
  expect(r.seat1).toBeCloseTo(r.h1, 5);
});

// A page that draws the figure frame by frame from its own timeline (a video seeking to any time and taking a picture)
test('a timeline drives the figure: the camera placed at once, drawn at once, a point of a part on the stage', async ({
  page,
}) => {
  const r = await page.evaluate(async () => {
    const fig = mountIt({ adaptive: false });
    await fig.ready;
    fig.view({ yaw: 40, pitch: 10, zoom: 2 }, { ms: 0 });
    const a = fig.camera();
    fig.view('top'); // (a glide, which the page's own camera replaces)
    fig.set({ camera: { yaw: -20, pitch: 30, dist: 5, target: [0, 0.1, 0] } });
    await new Promise((res) => setTimeout(res, 700));
    const b = fig.camera(),
      drawn = fig.drawNow(),
      p0 = fig.project([0, 0, 0], 'knob');
    fig.set({ move: { knob: [0, 0.5, 0] } });
    const p1 = fig.project([0, 0, 0], 'knob'),
      behind = fig.project([0, 0, 100]);
    return { a, b, drawn, p0, p1, behind, zoom: fig.zoomLevel };
  });
  expect(r.a.yaw).toBeCloseTo(40, 6);
  expect(r.a.pitch).toBeCloseTo(10, 6);
  expect(r.b.yaw).toBeCloseTo(-20, 9);
  expect(r.b.pitch).toBeCloseTo(30, 9);
  expect([r.b.dist, ...r.b.target]).toEqual([5, 0, 0.1, 0]);
  expect(r.drawn).toBe(true);
  expect(r.p0.length).toBe(2);
  expect(r.p1[1]).toBeLessThan(r.p0[1] - 10); // (moved up, so higher on the stage)
  expect(r.behind).toBe(null);
});

test("labels for chosen parts: exactly theirs, whatever else is on; 'none' still hides all", async ({ page }) => {
  const r = await page.evaluate(async () => {
    const fig = mountIt();
    await fig.ready;
    const shown = () =>
      [...document.querySelectorAll('#g .lk3d-tag')].filter((t) => t.style.display !== 'none').map((t) => t.dataset.id);
    fig.set({ labels: ['knob'] });
    fig.select('base');
    fig.drawNow();
    const one = shown();
    fig.set({ explode: 1, labels: ['knob', 'base'] });
    fig.drawNow();
    const two = shown();
    fig.set({ labels: [] });
    fig.drawNow();
    const empty = shown();
    fig.set({ labels: 'none' });
    fig.drawNow();
    return { one, two, empty, none: shown() };
  });
  expect(r.one).toEqual(['knob']);
  expect(r.two.sort()).toEqual(['base', 'knob']);
  expect(r.empty).toEqual([]);
  expect(r.none).toEqual([]);
});

test('a transparent page: the canvas clear behind the model in every look, the theme still drawing it', async ({
  page,
}) => {
  const r = await page.evaluate(async () => {
    const out = {};
    // (the corner of the canvas, read in the same task as the picture is drawn)
    const corner = (fig) => {
      fig.drawNow();
      const cv = document.querySelector('#g canvas'),
        gl = cv.getContext(fig.renderer === 'webgl2' ? 'webgl2' : 'webgl'),
        px = new Uint8Array(4);
      gl.readPixels(1, 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      return [...px];
    };
    for (const style of ['pen', 'studio', 'ink']) {
      const fig = mountIt({ style, theme: 'dark', transparent: true });
      await fig.ready;
      out[style] = { px: corner(fig), bg: getComputedStyle(document.querySelector('#g .lk3d-stage')).backgroundColor };
    }
    let fig = mountIt({ theme: 'dark' });
    await fig.ready;
    out.opaque = corner(fig);
    fig = mountIt({ force2d: true, transparent: true }); // (the 2D fallback, the pen look's light theme)
    await fig.ready;
    fig.drawNow();
    out.flat = [...document.querySelector('#g canvas').getContext('2d').getImageData(1, 1, 1, 1).data];
    LK3D.themes.film = { ...LK3D.themes.dark, bg: 'transparent' };
    fig = mountIt({ theme: 'film' });
    await fig.ready;
    out.themed = {
      px: corner(fig),
      line: getComputedStyle(document.querySelector('#g .lk3d-stage')).getPropertyValue('--lk3d-line'),
    };
    fig.set({ theme: 'dark' });
    out.back = corner(fig);
    return out;
  });
  for (const s of ['pen', 'studio', 'ink']) {
    expect(r[s].px[3]).toBe(0);
    expect(r[s].bg).toBe('rgba(0, 0, 0, 0)');
  }
  expect(r.opaque[3]).toBe(255);
  expect(r.flat[3]).toBe(0);
  expect(r.themed.px[3]).toBe(0);
  expect(r.themed.line.trim()).toBe('#8d939b');
  expect(r.back[3]).toBe(255);
});

test('the clock set to a time: particles, flows and streams show the same picture for the same time', async ({
  page,
}) => {
  const r = await page.evaluate(async () => {
    LK3D.clock.speed = 0;
    LK3D.clock.set(0);
    const fig = mountIt({ adaptive: false });
    await fig.ready;
    const path = [
      [-1, 0.4, 0],
      [1, 0.4, 0],
    ];
    const dots = fig.particles({ path, count: 6 });
    dots.speed = 0.5; // (a quarter of the path a second)
    fig.flow({ path, count: 80, speed: 0.7, spread: 0.05 });
    fig.stream({
      path: [
        [-1, 0.8, 0],
        [1, 0.8, 0],
      ],
      radius: 0.1,
      speed: 0.6,
    });
    const cv = document.querySelector('#g canvas'),
      gl = cv.getContext(fig.renderer === 'webgl2' ? 'webgl2' : 'webgl');
    const at = (ms) => {
      LK3D.clock.set(ms);
      fig.drawNow();
      const px = new Uint8Array(cv.width * cv.height * 4);
      gl.readPixels(0, 0, cv.width, cv.height, gl.RGBA, gl.UNSIGNED_BYTE, px);
      let h = 0;
      for (let k = 0; k < px.length; k++) h = (h * 31 + px[k]) | 0;
      return { offset: dots.offset, h };
    };
    const a = at(1000),
      b = at(2600),
      c = at(1000),
      d = at(2600);
    dots.speed = 0; // (stopped at 2.6 s: it stays there whatever the time)
    const e = at(4000);
    LK3D.clock.speed = 1;
    return { a, b, c, d, e };
  });
  expect(r.a.offset).toBeCloseTo(0.25, 9);
  expect(r.b.offset).toBeCloseTo(0.65, 9);
  expect(r.c).toEqual(r.a);
  expect(r.d).toEqual(r.b);
  expect(r.a.h).not.toBe(r.b.h);
  expect(r.e.offset).toBeCloseTo(0.65, 9);
});

test('the page moves the cut: a plane of its own, or swept in from outside the model, drawn at once', async ({
  page,
}) => {
  const r = await page.evaluate(async () => {
    const hash = (fig) => {
      fig.drawNow();
      const cv = document.querySelector('#g canvas'),
        gl = cv.getContext(fig.renderer === 'webgl2' ? 'webgl2' : 'webgl'),
        px = new Uint8Array(cv.width * cv.height * 4);
      gl.readPixels(0, 0, cv.width, cv.height, gl.RGBA, gl.UNSIGNED_BYTE, px);
      let h = 0;
      for (let k = 0; k < px.length; k++) h = (h * 31 + px[k]) | 0;
      return h;
    };
    let fig = mountIt({ adaptive: false });
    await fig.ready;
    // a point on the base's top, near its front edge (the scene's plane, z = 0, cuts away z > 0)
    const at = () => {
      fig.drawNow();
      const [x, y] = fig.project([0.3, 0.1, 0.9]);
      return fig.pick(x, y);
    };
    const out = { none: at() };
    fig.set({ cut: true });
    out.whole = at();
    fig.set({ cut: 0.03 }); // (just in from outside: the plane past the point)
    out.early = at();
    fig.set({ cut: 0.6 });
    out.late = at();
    fig.set({ cut: true, section: { offset: 0.95 } });
    out.moved = at();
    fig.set({ section: { normal: [0, 0, -1], offset: 0 } }); // (the other half cut away)
    out.flipped = at();
    fig.set({ section: { normal: [0, 0, 1], offset: 0.4 } });
    hash(fig);
    fig.set({ section: { offset: -0.3 } });
    out.after = hash(fig);
    fig = mountIt({ adaptive: false });
    await fig.ready;
    fig.set({ cut: true, section: { offset: -0.3 } });
    out.fresh = hash(fig);
    return out;
  });
  expect(r.none).toBe('base');
  expect(r.whole).not.toBe('base');
  expect(r.early).toBe('base');
  expect(r.late).not.toBe('base');
  expect(r.moved).toBe('base');
  expect(r.flipped).toBe('base');
  expect(r.after).toBe(r.fresh); // (nothing kept from the plane before: the shadow follows it)
});
