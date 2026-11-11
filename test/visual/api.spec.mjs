// The page API wired as it says, in a real browser: what a page sets is drawn, what the reader does reaches the right
// callback, tweens give way to the page and the reader, removed and destroyed things leave nothing behind. Each test
// mounts a small scene of its own on api.html and drives it as a page would. (Chromium: the wiring is the same
// everywhere.)
/* global LK3D, mountIt, until, fig, els, figs */ // (in the page: the engine, and the helpers beforeEach puts there)
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
    // waits for what the figure does, not for a time: CI's machines draw in software and give frames slowly (and a
    // frame moves things by a tenth of a second at most); 10 s at most, then the test's own check says what is wrong
    window.until = async (ok) => {
      for (let t = 0; t < 10000 && !ok(); t += 20) await new Promise((res) => setTimeout(res, 20));
    };
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
    await until(() => calls.length > 0);
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
    await until(() => dots.offset > 0.1);
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

test("a hidden part's handle is out of the keyboard's reach too, and back when the part is shown", async ({ page }) => {
  const r = await page.evaluate(async () => {
    const fig = mountIt();
    await fig.ready;
    const input = document.querySelector('#g input[type=range]'),
      state = () => ({ reachable: !input.disabled && input.tabIndex >= 0 && !input.hidden, selected: fig.selected });
    fig.set({ hide: ['knob'] });
    input.focus(); // (as Tab would, if it still reached it)
    const hidden = state();
    input.blur();
    fig.set({ hide: [] });
    input.focus();
    return { hidden, shown: state() };
  });
  expect(r.hidden).toEqual({ reachable: false, selected: null });
  expect(r.shown).toEqual({ reachable: true, selected: 'knob' });
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
      knob = () => fig.parts.find((p) => p.id === 'knob').matrix[13];
    m.set(0.5);
    await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
    const half = { y: knob(), slider: +slider.value };
    m.play();
    await until(() => !m.playing);
    const end = { y: knob(), value: m.value, playing: m.playing };
    m.play(); // (at its end: back to the start)
    await until(() => m.value < 1);
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
    await until(() => up.volume < before.up && up.level < before.level && down.level > 0);
    const during = { up: up.volume, down: down.volume, flow: tap.flow, level: up.level, below: down.level };
    tap.set({ open: 0 });
    await until(() => tap.flow === 0);
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

test('a clock stopped and stepped: the same time pours as much and plays as far, in small steps or one big one', async ({
  page,
}) => {
  const r = await page.evaluate(async () => {
    const scene = await (await fetch('/test/visual/scenes/pour.json')).json();
    const frames = () => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
    // a second of the clock's time poured in steps (each drawn, as a tool stepping frame by frame would), from a tap
    // opened with the clock stopped; `first`: the first step taken before any frame is drawn
    const pour = async (steps, first) => {
      LK3D.clock.speed = 1;
      const fig = LK3D.mount(document.getElementById('g'), scene, { controls: false });
      await fig.ready;
      LK3D.clock.speed = 0;
      const up = fig.liquid('water'),
        v0 = up.volume;
      fig.vessel('f').set({ open: 1 });
      if (!first) await frames();
      for (const ms of steps) {
        LK3D.clock.step(ms);
        await frames();
      }
      return v0 - up.volume;
    };
    const poured = {
      small: await pour(Array(30).fill(1000 / 30)),
      tenths: await pour(Array(10).fill(100)),
      one: await pour([1000]),
      first: await pour([1000], true),
    };
    // a motion played with the clock stopped: half a second of a range a second, in one step or five
    const play = async (steps) => {
      window.scene.motions = [
        {
          id: 'lift',
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
      const fig = mountIt();
      await fig.ready;
      LK3D.clock.speed = 0;
      const m = fig.motion('lift');
      m.play();
      for (const ms of steps) {
        LK3D.clock.step(ms);
        await frames();
      }
      return m.value;
    };
    const played = { one: await play([500]), five: await play(Array(5).fill(100)) };
    LK3D.clock.speed = 1;
    return { poured, played };
  });
  const { small, tenths, one, first } = r.poured;
  expect(small).toBeGreaterThan(1); // (a funnel's worth of water flows in a second: cm³)
  for (const v of [tenths, one, first]) expect(Math.abs(v - small) / small).toBeLessThan(0.01);
  expect(r.played.one).toBeCloseTo(0.5, 6);
  expect(r.played.five).toBeCloseTo(0.5, 6);
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
      seat0 = piston().min[1] + piston().matrix[13];
    gas.set({ T: 293 * 1.5 });
    // until it has settled (it eases in by frames, which a machine drawing in software gives slowly), 20 s at most
    for (let t = 0, last = NaN; t < 20000 && gas.height !== last; t += 1000) {
      last = gas.height;
      await new Promise((res) => setTimeout(res, 1000));
    }
    return { h0, h1: gas.height, seat0, seat1: piston().min[1] + piston().matrix[13] };
  });
  expect(r.h1 - 0.2).toBeCloseTo(1.5 * (r.h0 - 0.2), 2); // (above the inside's floor at 0.2)
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

test("what a scene says is shown as words: a model's link only to a web page, a motion's slider built of its values", async ({
  page,
}) => {
  const r = await page.evaluate(async () => {
    window.scene.models = {
      a: { data: '', title: 'A', author: 'X', license: 'CC0', url: 'javascript:window.hit=1' },
      b: { data: '', title: 'B', author: 'Y', license: 'CC0', url: 'https://example.org/b' },
    };
    window.scene.motions = [
      {
        id: 'lift',
        name: '<img src=x onerror="window.hit=2">',
        range: ['0" onfocus="window.hit=3', 1],
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
    await new Promise((ok) => setTimeout(ok, 50));
    const links = [...document.querySelectorAll('#g .lk3d-credit a')].map((a) => a.getAttribute('href')),
      slider = document.querySelector('#g .lk3d-range input[aria-label^="<img"]');
    return {
      links,
      credit: document.querySelector('#g .lk3d-credit').textContent,
      img: document.querySelectorAll('#g img').length,
      words: slider.previousSibling.textContent,
      attrs: slider.getAttributeNames().sort(),
      hit: window.hit,
    };
  });
  expect(r.links).toEqual(['https://example.org/b']);
  expect(r.credit).toContain('A, X, CC0'); // (still credited, as words)
  expect(r.img).toBe(0);
  expect(r.words).toBe('<img src=x onerror="window.hit=2">');
  expect(r.attrs).not.toContain('onfocus');
  expect(r.hit).toBeUndefined();
});

test('exportGLB needs the exporter, which a page loads as a script of its own', async ({ page }) => {
  const without = await page.evaluate(async () => {
    const fig = mountIt();
    await fig.ready;
    try {
      fig.exportGLB();
      return 'no error';
    } catch (e) {
      return e.message;
    }
  });
  expect(without).toContain('lk3d-export.min.js');
  await page.addScriptTag({ url: '/dist/lk3d-export.min.js' });
  const head = await page.evaluate(async () => {
    const fig = mountIt(),
      b = fig.exportGLB();
    return [String.fromCharCode(...b.slice(0, 4)), b.length > 200];
  });
  expect(head).toEqual(['glTF', true]);
});

test("the figure's own credit: © its author (linked only to a web page) and its licence, before the models'", async ({
  page,
}) => {
  const r = await page.evaluate(async () => {
    const credit = async (o) => {
      const fig = LK3D.mount(document.getElementById('g'), { ...window.scene, ...o }, {});
      await fig.ready;
      const c = document.querySelector('#g .lk3d-credit');
      return c && { text: c.textContent, links: [...c.querySelectorAll('a')].map((a) => a.getAttribute('href')) };
    };
    return {
      own: await credit({ author: 'xoai', license: 'CC BY-NC-ND 4.0', url: 'https://example.org/' }),
      both: await credit({
        author: 'xoai',
        license: 'CC BY-NC-ND 4.0',
        url: 'javascript:window.hit=1',
        models: { m: { data: '', title: 'M', author: 'Y', license: 'CC0' } },
      }),
      licence: await credit({ license: 'CC0' }),
      none: await credit({}),
    };
  });
  expect(r.own).toEqual({ text: '© xoai, CC BY-NC-ND 4.0', links: ['https://example.org/'] });
  expect(r.both.text).toBe('© xoai, CC BY-NC-ND 4.0. 3D model: M, Y, CC0');
  expect(r.both.links).toEqual([]); // (not a web address: the name as words)
  expect(r.licence.text).toBe('CC0');
  expect(r.none).toBeNull();
});

test("lk3d's mark is in the corner of every figure, in view, in every look", async ({ page }) => {
  const r = await page.evaluate(async () => {
    const out = [];
    for (const style of ['pen', 'studio']) {
      const fig = mountIt({ style });
      await fig.ready;
      const m = document.querySelector('#g .lk3d-stage .lk3d-mark'),
        s = document.querySelector('#g .lk3d-stage').getBoundingClientRect(),
        b = m.getBoundingClientRect(),
        cs = getComputedStyle(m);
      out.push({
        text: m.textContent,
        inside: b.left >= s.left && b.top >= s.top && b.right <= s.right && b.bottom <= s.bottom && b.width > 10,
        shown: cs.display !== 'none' && cs.visibility !== 'hidden' && +cs.opacity >= 0.8,
      });
    }
    return out;
  });
  expect(r).toEqual([
    { text: 'lk3d', inside: true, shown: true },
    { text: 'lk3d', inside: true, shown: true },
  ]);
});

test('the keyboard goes through the parts: Page Down and Up choose each in turn (as a click), Escape lets go', async ({
  page,
}) => {
  const got = await page.evaluate(async () => {
    const picks = [];
    const fig = mountIt({ onPick: (p) => picks.push(p && p.id) });
    await fig.ready;
    window.fig = fig;
    return picks;
  });
  expect(got).toEqual([]);
  await page.focus('#g canvas');
  const step = async (key) => {
    await page.keyboard.press(key);
    return page.evaluate(() => [fig.selected, document.querySelector('#g [aria-live]').textContent]);
  };
  expect(await step('PageDown')).toEqual(['base', 'Base']);
  expect(await step('PageDown')).toEqual(['knob', 'Knob']);
  expect(await step('PageDown')).toEqual(['base', 'Base']); // round again
  expect(await step('PageUp')).toEqual(['knob', 'Knob']);
  expect(await step('Escape')).toEqual([null, '']);
  expect(await step('PageUp')).toEqual(['knob', 'Knob']); // from none, Page Up starts at the last
  // a hidden part is passed over
  await page.evaluate(() => fig.set({ hide: ['knob'] }));
  expect(await step('PageDown')).toEqual(['base', 'Base']);
  expect(await step('PageDown')).toEqual(['base', 'Base']);
});

test('for screen readers: a figure worked by keys, which it describes; its parts listed; what is chosen said, not what is pointed at', async ({
  page,
}) => {
  const got = await page.evaluate(async () => {
    const fig = mountIt();
    await fig.ready;
    const g = document.getElementById('g'),
      cv = g.querySelector('canvas'),
      described = document.getElementById(cv.getAttribute('aria-describedby')),
      list = g.querySelector('ul[aria-label]'),
      live = g.querySelector('[aria-live="polite"]');
    const r = cv.getBoundingClientRect();
    let at = null;
    for (let y = r.height * 0.4; y < r.height && !at; y += 4)
      for (let x = r.width * 0.2; x < r.width * 0.8 && !at; x += 8) if (fig.pick(x, y) === 'base') at = [x, y];
    cv.dispatchEvent(
      new PointerEvent('pointermove', { clientX: r.left + at[0], clientY: r.top + at[1], pointerId: 1, bubbles: true }),
    );
    await new Promise((res) => setTimeout(res, 100));
    return {
      role: cv.getAttribute('role'),
      keys: described && described.textContent,
      listName: list && list.getAttribute('aria-label'),
      items: list ? [...list.querySelectorAll('li')].map((li) => li.textContent) : [],
      saidOnHover: live && live.textContent,
      hidden: getComputedStyle(described).clip,
      en: LK3D.locales.en,
    };
  });
  expect(got.role).toBe('application');
  expect(got.keys).toBe(got.en.keys);
  expect(got.listName).toBe(got.en.parts);
  expect(got.items).toEqual(['Base', 'Knob']);
  expect(got.saidOnHover).toBe(''); // pointing is not choosing: nothing said
  expect(got.hidden).toContain('rect'); // there for screen readers, not drawn on the page
});

test('touch scrolls the page until the figure is taken hold of; then the figure has every gesture, until a touch elsewhere', async ({
  page,
}) => {
  const got = await page.evaluate(async () => {
    const fig = mountIt();
    await fig.ready;
    const stage = document.querySelector('#g .lk3d-stage'),
      cv = stage.querySelector('canvas'),
      r = cv.getBoundingClientRect(),
      ta = () => getComputedStyle(stage).touchAction;
    const before = ta();
    const at = (t, x, y) =>
      t.dispatchEvent(new PointerEvent('pointerdown', { clientX: x, clientY: y, pointerId: 2, bubbles: true }));
    at(cv, r.left + r.width / 2, r.top + r.height / 2);
    cv.dispatchEvent(
      new PointerEvent('pointerup', {
        clientX: r.left + r.width / 2,
        clientY: r.top + r.height / 2,
        pointerId: 2,
        bubbles: true,
      }),
    );
    const held = ta();
    at(document.body, 1, 1);
    return { before, held, after: ta() };
  });
  expect(got).toEqual({ before: 'pan-y', held: 'none', after: 'pan-y' });
});

for (const style of ['pen', 'ink', 'studio'])
  test(`a lost WebGL context comes back drawing the same picture, with no GL error (${style})`, async ({ page }) => {
    await page.evaluate(async (style) => {
      window.fig = mountIt({ style });
      await fig.ready;
      fig.drawNow();
    }, style);
    const stage = page.locator('#g .lk3d-stage'),
      before = await stage.screenshot();
    const got = await page.evaluate(async () => {
      const cv = document.querySelector('#g canvas[tabindex]'),
        gl = cv.getContext('webgl2'),
        x = gl.getExtension('WEBGL_lose_context');
      let gone = false,
        back = false;
      cv.addEventListener('webglcontextlost', () => (gone = true));
      cv.addEventListener('webglcontextrestored', () => (back = true));
      x.loseContext();
      await until(() => gone);
      const whileLost = fig.drawNow(); // (nothing can be drawn: false, and no error)
      x.restoreContext();
      await until(() => back);
      await until(() => fig.drawNow());
      return { whileLost, renderer: fig.renderer, lost: gl.isContextLost(), error: gl.getError() };
    });
    expect(got).toEqual({ whileLost: false, renderer: 'webgl2', lost: false, error: 0 });
    expect((await stage.screenshot()).equals(before)).toBe(true);
  });

test('a page of 24 figures: each draws when scrolled to, at most 8 hold a WebGL context, none falls back to 2D or ends blank', async ({
  page,
}) => {
  const said = [];
  page.on('console', (m) => said.push(m.text()));
  await page.evaluate(() => {
    window.els = [];
    window.figs = [];
    for (let k = 0; k < 24; k++) {
      const d = document.createElement('div');
      d.style.cssText = 'width: 480px; margin-bottom: 240px';
      document.body.append(d);
      els.push(d);
      figs.push(LK3D.mount(d, window.scene, { controls: false }));
    }
  });
  await page.evaluate(() => until(() => figs[0].stats().firstFrameMs != null));
  const first = await page.locator('.lk3d-stage').first().screenshot();
  await page.evaluate(async () => {
    for (const [k, d] of els.entries()) {
      d.scrollIntoView();
      await until(() => figs[k].stats().firstFrameMs != null);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    }
  });
  // what holds a context now, and what the first figure (scrolled far past) shows
  const got = await page.evaluate(() => {
    const live = figs.filter(
      (f, k) => f.renderer && !els[k].querySelector('canvas[tabindex]').getContext(f.renderer).isContextLost(),
    );
    const kept = els[0].querySelector('canvas.lk3d-under'),
      px = kept && kept.getContext('2d').getImageData(0, 0, kept.width, kept.height).data;
    let painted = 0;
    if (px) for (let i = 3; i < px.length; i += 4) if (px[i]) painted++;
    return { live: live.length, renderers: [...new Set(figs.map((f) => f.renderer))], painted };
  });
  expect(got.live).toBeLessThanOrEqual(8);
  expect(got.renderers).toEqual(['webgl2']);
  expect(got.painted).toBeGreaterThan(1000); // (its last picture kept while its context is given up)
  // back to the first: its context again, the same picture as when it was first drawn
  const back = await page.evaluate(async () => {
    els[0].scrollIntoView();
    await until(() => !els[0].querySelector('canvas.lk3d-under'));
    const gl = els[0].querySelector('canvas[tabindex]').getContext('webgl2');
    return { lost: gl.isContextLost(), kept: !!els[0].querySelector('canvas.lk3d-under'), error: gl.getError() };
  });
  expect(back).toEqual({ lost: false, kept: false, error: 0 });
  expect((await page.locator('.lk3d-stage').first().screenshot()).equals(first)).toBe(true);
  expect(said.filter((t) => /too many active webgl contexts|drawing in 2D/i.test(t))).toEqual([]);
});

test('a browser that cannot give a context up (no WEBGL_lose_context): past the most, the next figure still draws', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.evaluate(() => {
    for (const C of [WebGLRenderingContext, WebGL2RenderingContext]) {
      const get = C.prototype.getExtension;
      C.prototype.getExtension = function (name) {
        return name === 'WEBGL_lose_context' ? null : get.call(this, name);
      };
    }
    window.els = [];
    window.figs = [];
    for (let k = 0; k < 10; k++) {
      const d = document.createElement('div');
      d.style.cssText = 'width: 480px; margin-bottom: 240px';
      document.body.append(d);
      els.push(d);
      figs.push(LK3D.mount(d, window.scene, { controls: false }));
    }
  });
  const drawn = await page.evaluate(async () => {
    for (const [k, d] of els.entries()) {
      d.scrollIntoView();
      await until(() => figs[k].stats().firstFrameMs != null);
    }
    return figs.map((f) => f.stats().firstFrameMs != null);
  });
  expect(errors).toEqual([]);
  expect(drawn).toEqual(Array(10).fill(true));
});

test('WebGL failing while the pen look still finds its edges: the figure goes on in 2D, nothing thrown', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const got = await page.evaluate(async () => {
    // many shapes, each its own (edges found shape by shape, in slices after the first picture)
    window.scene = {
      parts: Array.from({ length: 300 }, (_, k) => ({
        id: 'p' + k,
        shapes: [{ sphere: 0.02 + k * 0.0001 }],
        at: [(k % 20) * 0.1 - 1, Math.floor(k / 20) * 0.1, 0],
      })),
    };
    const fig = mountIt({ style: 'pen', ao: false });
    let ready = false;
    fig.ready.then(() => (ready = true));
    await until(() => fig.stats().firstFrameMs != null); // (the edges' search begins after the first picture)
    for (const C of [WebGLRenderingContext, WebGL2RenderingContext])
      for (const f of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced'])
        if (C.prototype[f])
          C.prototype[f] = () => {
            throw new Error('a draw this GPU refuses');
          };
    fig.set({ explode: 0.5 });
    fig.drawNow();
    await until(() => ready);
    return { renderer: fig.renderer, ready };
  });
  expect(got).toEqual({ renderer: '2d', ready: true });
  expect(errors).toEqual([]);
});

test('turning the camera works nothing out again: no part placed again, nothing sent to the GPU, nothing stringified', async ({
  page,
}) => {
  const got = await page.evaluate(async () => {
    const bolt = { shapes: [{ cylinder: { r: 0.05, x0: 0, x1: 0.2 }, rot: [0, 0, 90] }] }; // (parts alike: one group)
    window.scene = {
      parts: [
        { id: 'base', name: 'Base', shapes: [{ box: [2, 0.2, 2] }] },
        { id: 'arm', name: 'Arm', shapes: [{ box: [1, 0.1, 0.1] }], at: [0.5, 0.3, 0] },
        { id: 'b1', ...bolt, at: [-0.6, 0.1, 0.6] },
        { id: 'b2', ...bolt, at: [0.6, 0.1, 0.6] },
      ],
      motions: [
        {
          id: 'swing',
          range: [0, 90],
          tracks: [
            {
              parts: ['b2'],
              move: [
                [0, [0, 0, 0]],
                [90, [0, 0.3, 0]],
              ],
            },
          ],
        },
      ],
      joints: [{ id: 'hinge', parts: ['arm'], turn: { axis: [0, 1, 0], center: [0, 0.3, 0] }, drive: 'swing' }],
    };
    // (and a figure with a gas under a piston, at rest: its body is not shaped again)
    const gas = await (await fetch('/test/visual/scenes/piston.json')).json();
    const count = async (spec) => {
      const fig = LK3D.mount(document.getElementById('g'), spec, { controls: false });
      await fig.ready;
      fig.drawNow();
      const gl = document.querySelector('#g canvas[tabindex]').getContext('webgl2'),
        was = fig.parts.map((p) => p.matrix),
        bd = gl.bufferData,
        js = JSON.stringify;
      let sent = 0,
        strung = 0;
      gl.bufferData = function (...a) {
        sent++;
        return bd.apply(this, a);
      };
      JSON.stringify = (...a) => (strung++, js(...a));
      for (let k = 1; k <= 5; k++) {
        fig.view({ yaw: k * 10 }, { ms: 0 });
        fig.drawNow();
      }
      const kept = fig.parts.every((p, k) => p.matrix === was[k]);
      gl.bufferData = bd;
      JSON.stringify = js;
      return { fig, was, kept, sent, strung };
    };
    const a = await count(window.scene);
    a.fig.motion('swing').set(45);
    a.fig.drawNow();
    const moved = a.fig.parts.map((p, k) => p.matrix !== a.was[k]);
    const b = await count(gas);
    return { kept: a.kept, sent: a.sent, strung: a.strung, moved, gas: [b.kept, b.sent, b.strung] };
  });
  expect(got).toEqual({ kept: true, sent: 0, strung: 0, moved: [false, true, false, true], gas: [true, 0, 0] });
});

// guided steps: a scene with three, the third framing a small part
const STEPS = () => {
  window.stepsScene = () => ({
    ...window.scene,
    parts: [
      ...window.scene.parts,
      {
        id: 'lid',
        name: 'Lid',
        group: 'top',
        shapes: [{ box: [0.6, 0.1, 0.6] }],
        at: [0.5, 0.3, 0.5],
        explode: [0, 0.8, 0],
      },
    ],
    motions: [{ id: 'lift', range: [0, 1], tracks: [{ parts: ['lid'], move: [[1, [0, 0.4, 0]]] }] }],
    steps: [
      { id: 'one', title: 'One', text: 'The <b>base</b> & <img src=x onerror="window.ran = 1">.' },
      {
        id: 'two',
        title: 'Two',
        explode: 1,
        xray: true,
        labels: ['knob'],
        select: 'knob',
        hide: ['top'],
        cut: true,
        motion: { lift: 1 },
        view: 'top',
      },
      { id: 'three', text: 'Back together, framed on the knob.', focus: ['knob'], view: { yaw: 20, pitch: 15 } },
    ],
  });
};

test("guided steps: the first at mount; Back and Next said aloud; the page's step() quiet; what a step leaves out goes back to the start", async ({
  page,
}) => {
  await page.evaluate(STEPS);
  const r = await page.evaluate(async () => {
    const calls = [],
      el = document.getElementById('g'),
      fig = LK3D.mount(el, window.stepsScene(), { adaptive: false, onStep: (i, step) => calls.push([i, step.id]) });
    await fig.ready;
    const words = el.querySelector('.lk3d-step'),
      [back, next] = el.querySelectorAll('.lk3d-step-nav button'),
      cutButton = [...el.querySelectorAll('.lk3d-bar button')].find((b) => b.textContent === 'Cut open'),
      lid = fig.parts.find((p) => p.id === 'lid'),
      look = () => ({
        step: fig.currentStep,
        explode: fig._state.explode,
        cut: fig._state.cut,
        xray: fig._state.xray,
        labels: fig.labels,
        selected: fig.selected,
        lidHidden: lid.hidden,
        lift: fig.motion('lift').value,
        pitch: Math.round(fig.camera().pitch),
        words: words.textContent,
        cutPressed: cutButton.getAttribute('aria-pressed'),
        back: back.getAttribute('aria-disabled'),
        next: next.getAttribute('aria-disabled'),
      });
    const out = {
      start: look(),
      html: words.innerHTML,
      img: !!words.querySelector('img'),
      live: words.getAttribute('aria-live'),
      count: fig.steps.length,
      callsAtMount: calls.length,
    };
    next.click();
    await until(() => fig._state.explode === 1 && fig._state.cut === true && Math.round(fig.camera().pitch) === 83);
    out.two = look();
    out.callsAfterNext = calls.slice();
    fig.step('three');
    await until(() => fig._state.explode === 0 && fig._state.cut === false);
    out.three = look();
    next.click(); // (at the last step: nothing)
    out.pastEnd = [fig.currentStep, calls.length];
    back.click();
    out.callsAfterBack = calls.slice();
    out.ran = !!window.ran;
    return out;
  });
  expect(r.count).toBe(3);
  expect(r.callsAtMount).toBe(0);
  expect(r.start).toMatchObject({ step: 0, explode: 0, cut: false, xray: false, labels: 'auto', selected: null });
  expect(r.start).toMatchObject({ lidHidden: false, lift: 0, back: 'true', next: 'false', cutPressed: 'false' });
  expect(r.start.words).toContain('Step 1 of 3');
  expect(r.html).toContain('<b>One</b>');
  expect(r.html).toContain('<b>base</b>');
  expect(r.img).toBe(false); // (a step's words keep only simple formatting)
  expect(r.ran).toBe(false);
  expect(r.live).toBe('polite');
  expect(r.callsAfterNext).toEqual([[1, 'two']]);
  expect(r.two).toMatchObject({ step: 1, explode: 1, cut: true, xray: true, labels: ['knob'], selected: 'knob' });
  expect(r.two).toMatchObject({ lidHidden: true, lift: 1, pitch: 83, back: 'false', cutPressed: 'true' });
  expect(r.two.words).toContain('Step 2 of 3');
  // (by the page: onStep not called; everything the third step leaves out back at the figure's start)
  expect(r.three).toMatchObject({ step: 2, explode: 0, cut: false, xray: false, labels: 'auto', selected: null });
  expect(r.three).toMatchObject({ lidHidden: false, lift: 0, pitch: 15, next: 'true', cutPressed: 'false' });
  expect(r.pastEnd).toEqual([2, 1]);
  expect(r.callsAfterBack).toEqual([
    [1, 'two'],
    [1, 'two'],
  ]);
});

test('a step is the same picture however the reader came to it; a part focused is framed whole, and large', async ({
  page,
}) => {
  await page.evaluate(STEPS);
  const r = await page.evaluate(async () => {
    const el = document.getElementById('g'),
      hash = (fig) => {
        fig.drawNow();
        const cv = el.querySelector('canvas'),
          gl = cv.getContext(fig.renderer === 'webgl2' ? 'webgl2' : 'webgl'),
          px = new Uint8Array(cv.width * cv.height * 4);
        gl.readPixels(0, 0, cv.width, cv.height, gl.RGBA, gl.UNSIGNED_BYTE, px);
        let h = 0;
        for (let k = 0; k < px.length; k++) h = (h * 31 + px[k]) | 0;
        return h;
      };
    let fig = LK3D.mount(el, window.stepsScene(), { adaptive: false });
    await fig.ready;
    fig.step(1, { ms: 0 });
    fig.step('three', { ms: 0 });
    const out = { via: hash(fig) };
    fig = LK3D.mount(el, window.stepsScene(), { adaptive: false, step: 'three' });
    out.atOnce = [fig.currentStep, fig._state.explode, Math.round(fig.camera().pitch)];
    await fig.ready;
    out.direct = hash(fig);
    // the knob framed: each corner of its box on the stage, the box a good part of the stage's height
    const knob = fig.parts.find((p) => p.id === 'knob'),
      stage = el.querySelector('.lk3d-stage').getBoundingClientRect(),
      corners = [0, 1, 2, 3, 4, 5, 6, 7].map((k) =>
        fig.project([0, 1, 2].map((axis) => ((k >> axis) & 1 ? knob.max : knob.min)[axis])),
      );
    out.inside = corners.every(([x, y]) => x > 0 && x < stage.width && y > 0 && y < stage.height);
    out.share = (Math.max(...corners.map((p) => p[1])) - Math.min(...corners.map((p) => p[1]))) / stage.height;
    return out;
  });
  expect(r.atOnce).toEqual([2, 0, 15]);
  expect(r.direct).toBe(r.via);
  expect(r.inside).toBe(true);
  expect(r.share).toBeGreaterThan(0.25);
});

test("the steps' panel: under the built-in controls, or on its own, or none; in the figure's words; none without steps", async ({
  page,
}) => {
  await page.evaluate(STEPS);
  const r = await page.evaluate(() => {
    const el = document.getElementById('g'),
      has = (o) => {
        const fig = LK3D.mount(el, window.stepsScene(), o);
        return [!!el.querySelector('.lk3d-steps'), !!el.querySelector('.lk3d-bar'), fig.currentStep];
      };
    const out = {
      both: has({}),
      noControls: has({ controls: false }),
      noSteps: has({ steps: false }),
      stepsOnly: has({ controls: false, steps: true }),
    };
    LK3D.mount(el, window.stepsScene(), { locale: 'vi' });
    out.vi = [el.querySelector('.lk3d-step-count').textContent, el.querySelector('.lk3d-step-nav').textContent];
    const plain = LK3D.mount(el, window.scene, {});
    plain.step(0);
    out.plain = [!!el.querySelector('.lk3d-steps'), plain.currentStep, plain.steps.length];
    return out;
  });
  expect(r.both).toEqual([true, true, 0]);
  expect(r.noControls).toEqual([false, false, 0]);
  expect(r.noSteps).toEqual([false, true, 0]);
  expect(r.stepsOnly).toEqual([true, false, 0]);
  expect(r.vi).toEqual(['Bước 1/3', 'Bước trướcBước tiếp']);
  expect(r.plain).toEqual([false, -1, 0]);
});

test('a pressed button reads on a dark page; printed, the figure keeps its picture and words without its buttons', async ({
  page,
}) => {
  await page.evaluate(STEPS);
  const r = await page.evaluate(() => {
    const el = document.getElementById('g');
    document.body.style.setProperty('--lk3d-ink', '#e9e7e3'); // (a dark page's light ink, and no highlight of its own)
    const fig = LK3D.mount(el, window.stepsScene(), {});
    fig.set({ cut: true });
    const pressed = el.querySelector('.lk3d-bar button.on');
    return { color: getComputedStyle(pressed).color, background: getComputedStyle(pressed).backgroundColor };
  });
  expect(r).toEqual({ color: 'rgb(29, 26, 30)', background: 'rgb(243, 215, 143)' });
  await page.emulateMedia({ media: 'print' });
  const shown = await page.evaluate(() =>
    Object.fromEntries(
      ['.lk3d-bar', '.lk3d-hint', '.lk3d-step-nav', '.lk3d-step', '.lk3d-canvas'].map((q) => [
        q,
        getComputedStyle(document.querySelector('#g ' + q)).display !== 'none',
      ]),
    ),
  );
  expect(shown).toEqual({
    '.lk3d-bar': false,
    '.lk3d-hint': false,
    '.lk3d-step-nav': false,
    '.lk3d-step': true,
    '.lk3d-canvas': true,
  });
});

test('the reader moves the cut: by dragging its face along its normal, or by its slider; held within what it cuts; not when the scene fixes it', async ({
  page,
}) => {
  const r = await page.evaluate(async () => {
    const el = document.getElementById('g'),
      moves = [],
      cv = () => el.querySelector('canvas'),
      ev = (type, [x, y]) => {
        const rect = cv().getBoundingClientRect();
        cv().dispatchEvent(
          new PointerEvent(type, {
            clientX: rect.left + x,
            clientY: rect.top + y,
            pointerId: 1,
            bubbles: true,
            isPrimary: true,
          }),
        );
      },
      drag = (from, by) => {
        ev('pointerdown', from);
        for (let k = 1; k <= 4; k++) ev('pointermove', [from[0] + (by[0] * k) / 4, from[1] + (by[1] * k) / 4]);
        ev('pointerup', [from[0] + by[0], from[1] + by[1]]);
      };
    let fig = LK3D.mount(el, window.scene, { adaptive: false, onSection: (s) => moves.push(s.offset) });
    await fig.ready;
    const slider = el.querySelector('input[aria-label="Move the cut through the model"]'),
      out = { hiddenWhenWhole: getComputedStyle(slider.closest('label')).display === 'none' };
    fig.set({ cut: true }); // (the scene's plane, z = 0, cuts away z > 0: its face turned to the first view)
    fig.drawNow();
    out.shownWhenCut = getComputedStyle(slider.closest('label')).display !== 'none';
    const face = fig.project([0.5, 0, 0]), // (a point of the base's cut face)
      pitch = fig.camera().pitch;
    drag(face, [0, 30]);
    out.moved = fig.section.offset;
    out.reported = moves.slice();
    out.viewKept = fig.camera().pitch === pitch;
    out.sliderFollows = Math.abs(+slider.value - (fig.section.offset + 1) / 2) < 0.01;
    fig.drawNow();
    drag(fig.project([0.5, 0, fig.section.offset]), [0, 3000]); // (far past the end: held at the base's edge)
    out.held = fig.section.offset;
    slider.value = '0.25';
    slider.dispatchEvent(new Event('input'));
    out.bySlider = fig.section.offset;
    // seen face on (from the front, the normal pointing at the eye): up and down move it instead
    fig.view('front', { ms: 0 });
    fig.drawNow();
    drag(fig.project([0.85, 0, fig.section.offset]), [0, -30]);
    out.faceOn = fig.section.offset;
    fig.drawNow();
    // (a tap on the face chooses the part; away from the knob, whose small handle a finger catches near it)
    ev('pointerdown', fig.project([0.85, 0, fig.section.offset]));
    ev('pointerup', fig.project([0.85, 0, fig.section.offset]));
    out.tapped = fig.selected;
    // a label whose place the cut has passed is not shown (it would point at nothing): the base's is its back corner,
    // z = -1, kept by the scene's plane however far it goes, cut away by the plane turned round
    const baseShown = (section) => {
      fig.set({ labels: ['base'], section });
      fig.drawNow();
      const tag = [...el.querySelectorAll('.lk3d-tag')].find((t) => t.textContent === 'Base');
      return !!tag && tag.style.display !== 'none';
    };
    out.labelKept = baseShown({ normal: [0, 0, 1], offset: -0.95 });
    out.labelCutAway = !baseShown({ normal: [0, 0, -1], offset: 0.5 });
    fig.set({ section: { normal: [0, 0, 1] } });
    // fixed by the scene: no slider, and a drag on the face turns the view
    fig = LK3D.mount(
      el,
      { ...window.scene, section: { normal: [0, 0, 1], offset: 0, fixed: true } },
      { adaptive: false },
    );
    await fig.ready;
    fig.set({ cut: true });
    fig.drawNow();
    out.fixedSlider = !!el.querySelector('input[aria-label="Move the cut through the model"]');
    const fixedPitch = fig.camera().pitch;
    drag(fig.project([0.5, 0, 0]), [0, 30]); // (up and down: the view tilts)
    out.fixed = [fig.section.offset, fig.camera().pitch !== fixedPitch];
    return out;
  });
  expect(r.hiddenWhenWhole).toBe(true);
  expect(r.shownWhenCut).toBe(true);
  expect(Math.abs(r.moved)).toBeGreaterThan(0.05);
  expect(r.reported.at(-1)).toBe(r.moved);
  expect(r.viewKept).toBe(true);
  expect(r.sliderFollows).toBe(true);
  expect(Math.abs(Math.abs(r.held) - 1)).toBeLessThan(1e-6); // (the base reaches z = ±1)
  expect(r.bySlider).toBeCloseTo(-0.5, 6);
  expect(r.faceOn).toBeGreaterThan(-0.45); // (dragged up: further along the normal)
  expect(r.tapped).toBe('base');
  expect(r.labelKept).toBe(true);
  expect(r.labelCutAway).toBe(true);
  expect(r.fixedSlider).toBe(false);
  expect(r.fixed[0]).toBe(0);
  expect(r.fixed[1]).toBe(true);
});

test("<lk3d-figure>: a scene from a JSON script inside or from src; attributes set it; the reader's moves as events; taken out, destroyed", async ({
  page,
}) => {
  await page.evaluate(STEPS);
  const r = await page.evaluate(async () => {
    const host = document.getElementById('g'),
      events = [];
    host.innerHTML = '';
    const element = document.createElement('lk3d-figure');
    element.setAttribute('locale', 'vi');
    element.setAttribute('step', 'two');
    const json = document.createElement('script');
    json.type = 'application/json';
    json.textContent = JSON.stringify(window.stepsScene());
    element.append(json);
    for (const type of ['pick', 'step', 'section', 'error'])
      host.addEventListener('lk3d-' + type, (e) => events.push([type, e.detail]));
    host.append(element);
    const figure = await element.ready;
    const out = {
      same: figure === element.figure,
      atStep: figure.currentStep,
      words: element.querySelector('.lk3d-step-count').textContent,
      info: !!element.querySelector('.lk3d-step + .lk3d-info, .lk3d-steps + .lk3d-info'),
      display: getComputedStyle(element).display,
    };
    // attributes that change the figure as they change, and one that mounts it again
    // (a step sets its own labels, so labels after it)
    element.setAttribute('look', 'ink');
    element.setAttribute('step', '0');
    element.setAttribute('labels', 'all');
    out.live = [figure.style, figure.labels, figure.currentStep, element.figure === figure];
    element.setAttribute('locale', 'en');
    out.remounted = element.figure !== figure && element.querySelector('.lk3d-step-count').textContent;
    // the reader's moves, as events: Next, then the cut's slider
    element.querySelector('.lk3d-step-nav button:last-child').click();
    element.figure.set({ cut: true });
    const slider = element.querySelector('input[aria-label="Move the cut through the model"]');
    slider.value = '0.3';
    slider.dispatchEvent(new Event('input'));
    out.events = events.map(([type, detail]) => [type, type === 'step' ? detail.index : typeof detail.offset]);
    // taken out of the page: the figure goes with it
    element.remove();
    out.destroyed = !element.figure && !element.querySelector('canvas');
    // from src, and a scene that cannot be read: its words shown, an error event
    const fromSrc = document.createElement('lk3d-figure');
    fromSrc.setAttribute('src', '/test/visual/scenes/gas.json');
    host.append(fromSrc);
    out.src = (await fromSrc.ready).parts.length > 0;
    const broken = document.createElement('lk3d-figure');
    broken.setAttribute('src', '/test/visual/scenes/nothing-here.json');
    host.append(broken);
    await until(() => events.some(([type]) => type === 'error'));
    out.error = [broken.textContent.includes('nothing-here.json'), events.filter(([type]) => type === 'error').length];
    return out;
  });
  expect(r).toMatchObject({ same: true, atStep: 1, words: 'Bước 2/3', info: true, display: 'block' });
  expect(r.live).toEqual(['ink', 'all', 0, true]);
  expect(r.remounted).toBe('Step 1 of 3');
  expect(r.events).toEqual([
    ['step', 1],
    ['section', 'number'],
  ]);
  expect(r.destroyed).toBe(true);
  expect(r.src).toBe(true);
  expect(r.error).toEqual([true, 1]);
});

test("crease shading is worked out in a worker made of lk3d's own script (by src, or inline), the same as on the page without one", async ({
  browser,
}) => {
  const engine = (await import('node:fs')).readFileSync(new URL('../../dist/lk3d.min.js', import.meta.url), 'utf8'),
    scene = JSON.parse(
      (await import('node:fs')).readFileSync(new URL('scenes/generator.json', import.meta.url), 'utf8'),
    );
  // the shading of every batch, as one hash, and whether the worker made it
  const shade = async (how) => {
    const page = await browser.newPage();
    if (how === 'no worker') await page.addInitScript(() => delete window.Worker);
    if (how === 'inline') {
      await page.setContent('<div id="g" style="width:480px"></div>');
      await page.addScriptTag({ content: engine });
    } else await page.goto('/test/visual/api.html');
    const result = await page.evaluate(async (scene) => {
      const fig = LK3D.mount(document.getElementById('g'), scene, { controls: false });
      await fig.ready;
      let hash = 0,
        shaded = 0;
      for (const part of fig.parts)
        for (const batch of part.batches)
          if (batch.ao) {
            shaded++;
            for (const value of batch.ao) hash = (hash * 31 + value) | 0;
          }
      return { hash, shaded, worker: fig.stats().aoWorker };
    }, scene);
    await page.close();
    return result;
  };
  const bySrc = await shade('src'),
    inline = await shade('inline'),
    onPage = await shade('no worker');
  expect(bySrc.shaded).toBeGreaterThan(5);
  expect([bySrc.worker, inline.worker, onPage.worker]).toEqual([true, true, false]);
  expect(inline.hash).toBe(bySrc.hash);
  expect(onPage.hash).toBe(bySrc.hash);
});
