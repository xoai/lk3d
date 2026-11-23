// The page API wired as it says, in a real browser: what a page sets is drawn, what the reader does reaches the right
// callback, tweens give way to the page and the reader, removed and destroyed things leave nothing behind. Each test
// mounts a small scene of its own on api.html and drives it as a page would. (Chromium: the wiring is the same
// everywhere.)
/* global LK3D, mountIt, until, fig, els, figs, moves, calls */ // (in the page: the engine, and the helpers beforeEach puts there)
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
  // (what is chosen is said through the figure's one queue of words, picks and descriptions alike: a moment later; the
  // region is emptied before each message, so the state is read once, in the poll, not again after it: words said
  // twice running would otherwise be caught in between, empty)
  const step = async (key, words) => {
    await page.keyboard.press(key);
    let seen;
    await expect
      .poll(async () => {
        seen = await page.evaluate(() => [fig.selected, document.querySelector('#g [aria-live]').textContent]);
        return seen[1];
      })
      .toBe(words);
    return seen;
  };
  expect(await step('PageDown', 'Base')).toEqual(['base', 'Base']);
  expect(await step('PageDown', 'Knob')).toEqual(['knob', 'Knob']);
  expect(await step('PageDown', 'Base')).toEqual(['base', 'Base']); // round again
  expect(await step('PageUp', 'Knob')).toEqual(['knob', 'Knob']);
  expect(await step('Escape', '')).toEqual([null, '']);
  expect(await step('PageUp', 'Knob')).toEqual(['knob', 'Knob']); // from none, Page Up starts at the last
  // a hidden part is passed over
  await page.evaluate(() => fig.set({ hide: ['knob'] }));
  expect(await step('PageDown', 'Base')).toEqual(['base', 'Base']);
  expect(await step('PageDown', 'Base')).toEqual(['base', 'Base']);
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

// a part the page turns (set({ move: { id: { by, turn } } })): an arm along x from the origin, and a block with a slide
// handle along x, seen face on
const ARM = {
  view: { yaw: 0, pitch: 0, projection: 'ortho' },
  check: { float: true },
  parts: [
    { id: 'arm', name: 'Arm', shapes: [{ box: [1, 0.1, 0.1], at: [0.5, 0, 0] }] },
    {
      id: 'slider',
      name: 'Slider',
      at: [0, -1, 0],
      shapes: [{ box: [0.3, 0.3, 0.3] }],
      handle: { slide: { axis: [1, 0, 0] }, min: -1, max: 1, label: 'Slider' },
    },
  ],
};

test("a part the page turns is turned about its centre, then shifted in the scene's axes; a turn-only change moves it", async ({
  page,
}) => {
  const got = await page.evaluate(async (scene) => {
    window.fig = LK3D.mount(document.getElementById('g'), scene, { controls: false, labels: 'all' });
    await fig.ready;
    const tip = (move) => {
      fig.set({ move: { arm: move } });
      fig.drawNow();
      return fig.project([1, 0, 0], 'arm');
    };
    const label = () => document.querySelector('#g .lk3d-tag').getBoundingClientRect();
    const before = label();
    const z = (angle, extra = {}) => ({ turn: { axis: [0, 0, 1], angle, center: [0, 0, 0] }, ...extra });
    const out = {
      up: [tip(z(90)), fig.project([0, 1, 0])],
      half: [tip(z(45)), fig.project([Math.SQRT1_2, Math.SQRT1_2, 0])],
      shifted: [tip(z(90, { by: [0.5, 0, 0] })), fig.project([0.5, 1, 0])],
      shift: [tip([0, 0.5, 0]), fig.project([1, 0.5, 0])],
    };
    tip(z(90));
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    out.labelMoved = Math.hypot(label().x - before.x, label().y - before.y);
    const refused = (turn) => {
      try {
        fig.set({ move: { arm: { turn } } });
        return 'set';
      } catch (e) {
        return e.message;
      }
    };
    out.refusals = [refused({ axis: [0, 0, 1], angle: 'x' }), refused({ axis: [0, 0, 0], angle: 30 })];
    return out;
  }, ARM);
  for (const key of ['up', 'half', 'shifted', 'shift']) {
    const [at, want] = got[key];
    expect(Math.hypot(at[0] - want[0], at[1] - want[1]), key).toBeLessThan(0.5);
  }
  expect(got.labelMoved).toBeGreaterThan(5);
  for (const message of got.refusals) expect(message).toMatch(/move\.arm\.turn/);
});

test("a turned part's slide handle follows the pointer along its turned axis", async ({ page }) => {
  const [from, to] = await page.evaluate(async (scene) => {
    window.fig = LK3D.mount(document.getElementById('g'), scene, { controls: false });
    await fig.ready;
    fig.set({ move: { slider: { turn: { axis: [0, 0, 1], angle: 90, center: [0, -1, 0] } } } });
    fig.drawNow();
    return [fig.project([0, -1, 0]), fig.project([0, -0.5, 0])]; // (its axis, turned: the scene's +y)
  }, ARM);
  const box = await page.locator('#g canvas[tabindex]').boundingBox();
  await page.mouse.move(box.x + from[0], box.y + from[1]);
  await page.mouse.down();
  for (let k = 1; k <= 5; k++)
    await page.mouse.move(box.x + from[0] + ((to[0] - from[0]) * k) / 5, box.y + from[1] + ((to[1] - from[1]) * k) / 5);
  await page.mouse.up();
  expect(await page.evaluate(() => fig.handle('slider').value)).toBeGreaterThan(0.4);
});

// what is under a point: a box seen face on, with its section free to move
const BOX = { view: { yaw: 0, pitch: 0 }, parts: [{ id: 'b', name: 'Box', shapes: [{ box: [1, 1, 1] }] }] };

test("hit: a part's surface along the ray, facing the eye; a plane the page names; a pointer event; a cut face", async ({
  page,
}) => {
  const got = await page.evaluate(async (scene) => {
    window.fig = LK3D.mount(document.getElementById('g'), scene, { controls: false });
    await fig.ready;
    fig.drawNow();
    const cv = document.querySelector('#g canvas[tabindex]'),
      r = cv.getBoundingClientRect(),
      [x, y] = [r.width / 2, r.height / 2];
    const ray = fig.ray(x, y),
      hit = fig.hit(x, y),
      byEvent = fig.hit(new PointerEvent('pointermove', { clientX: r.left + x, clientY: r.top + y })),
      plane = fig.hit(x, y, { plane: { point: [0, 0, -3], normal: [0, 0, 1] } }),
      corner = fig.hit(2, 2),
      toward = ray.direction.map((d) => -d);
    fig.set({ section: { normal: toward, offset: 0 }, cut: 1 });
    fig.drawNow();
    return { ray, hit, byEvent, plane, corner, cut: fig.hit(x, y), toward };
  }, BOX);
  const { ray, hit } = got,
    at = (t) => ray.origin.map((o, i) => o + ray.direction[i] * t),
    near = (a, b, tolerance) => a.every((v, i) => Math.abs(v - b[i]) <= tolerance);
  expect(Math.hypot(...ray.direction)).toBeCloseTo(1, 9);
  expect(hit.id).toBe('b');
  expect(Math.max(...hit.point.map(Math.abs))).toBeCloseTo(0.5, 4); // (on the box's surface)
  expect(near(hit.point, at(hit.distance), 1e-4)).toBe(true);
  expect(hit.normal.reduce((sum, n, i) => sum + n * ray.direction[i], 0)).toBeLessThan(0); // (facing the eye)
  expect(near(got.byEvent.point, hit.point, 1e-6)).toBe(true);
  expect(got.plane.id).toBe(null);
  expect(got.plane.point[2]).toBeCloseTo(-3, 6);
  expect(got.corner).toBe(null);
  expect(got.cut.cut).toBe(true);
  expect(got.cut.point.reduce((sum, p, i) => sum + p * got.toward[i], 0)).toBeCloseTo(0, 4); // (on the cut plane)
  expect(near(got.cut.normal, got.toward, 1e-3)).toBe(true);
});

test('a drag the page takes with onPress leaves the view still and ignores another pointer; one it declines turns it', async ({
  page,
}) => {
  await page.evaluate(async (scene) => {
    window.calls = { press: 0, drag: 0, release: 0, hits: [] };
    window.fig = LK3D.mount(document.getElementById('g'), scene, {
      controls: false,
      onPress: (hit) => (calls.press++, calls.hits.push(hit && hit.id), hit?.id === 'b'),
      onDrag: () => calls.drag++,
      onRelease: () => calls.release++,
    });
    await fig.ready;
  }, BOX);
  const camera = () => page.evaluate(() => JSON.stringify(fig.camera()));
  const box = await page.locator('#g canvas[tabindex]').boundingBox(),
    [x, y] = [box.x + box.width / 2, box.y + box.height / 2],
    before = await camera();
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let k = 1; k <= 5; k++) await page.mouse.move(x + 20 * k, y + 8 * k);
  await page.evaluate(
    ([x, y]) => {
      const cv = document.querySelector('#g canvas[tabindex]');
      for (const type of ['pointerdown', 'pointermove', 'pointerup'])
        cv.dispatchEvent(
          new PointerEvent(type, { pointerId: 7, pointerType: 'touch', clientX: x, clientY: y, bubbles: true }),
        );
    },
    [x - 80, y],
  );
  await page.mouse.up();
  expect(await camera()).toBe(before);
  const calls = await page.evaluate(() => calls);
  expect(calls).toMatchObject({ press: 1, release: 1, hits: ['b'] });
  expect(calls.drag).toBeGreaterThanOrEqual(4);
  // a press beside the box: declined, so the view turns, as ever
  await page.mouse.move(box.x + 10, box.y + 10);
  await page.mouse.down();
  for (let k = 1; k <= 5; k++) await page.mouse.move(box.x + 10 + 25 * k, box.y + 10);
  await page.mouse.up();
  expect(await camera()).not.toBe(before);
});

test('a touch the page takes with onPress does not scroll the page; one it declines does', async ({
  browser,
  baseURL,
}) => {
  const scrolled = async (claim) => {
    const context = await browser.newContext({ baseURL, viewport: { width: 520, height: 420 }, hasTouch: true }),
      page = await context.newPage();
    await page.goto('/test/visual/api.html');
    await page.evaluate(
      async ([scene, claim]) => {
        document.body.append(Object.assign(document.createElement('div'), { style: 'height: 3000px' }));
        window.fig = LK3D.mount(document.getElementById('g'), scene, { controls: false, onPress: () => claim });
        await fig.ready;
      },
      [BOX, claim],
    );
    const cdp = await context.newCDPSession(page),
      at = (y) => [{ x: 240, y }],
      before = await page.evaluate(() => JSON.stringify(fig.camera()));
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at(200) });
    for (let k = 1; k <= 8; k++)
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: at(200 - 20 * k) });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(300);
    const y = await page.evaluate(() => scrollY),
      camera = await page.evaluate(() => JSON.stringify(fig.camera()));
    await context.close();
    return { y, camera, before };
  };
  const claimed = await scrolled(true),
    declined = await scrolled(false);
  expect(claimed.y).toBe(0);
  expect(claimed.camera).toBe(claimed.before); // (the page's gesture: the view did not turn)
  expect(declined.y).toBeGreaterThan(0);
});

test('surface() and arrows() say which script to load without the live add-on; with it, arrows draw and hit passes them by', async ({
  page,
}) => {
  const got = await page.evaluate(async (scene) => {
    window.fig = LK3D.mount(document.getElementById('g'), scene, { controls: false });
    await fig.ready;
    const live = LK3D.live,
      refused = [];
    LK3D.live = undefined; // (as on a page that did not load dist/lk3d-live.min.js)
    for (const kind of ['surface', 'arrows'])
      try {
        fig[kind]({});
      } catch (e) {
        refused.push(e.message);
      }
    LK3D.live = live;
    const cv = document.querySelector('#g canvas[tabindex]'),
      gl = cv.getContext('webgl2'),
      mid = fig.project([0, 0, 0.9]),
      pixel = () => {
        fig.drawNow();
        const out = new Uint8Array(4);
        gl.readPixels(Math.round(mid[0]), Math.round(cv.height - mid[1]), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, out);
        return [...out.slice(0, 3)];
      };
    const empty = pixel(),
      a = fig.arrows({ count: 1, radius: 0.06, color: '#d00000' });
    a.set(0, [-1, 0, 0.9], [1, 0, 0.9]);
    const drawn = pixel(),
      hit = fig.hit(...mid);
    a.remove();
    return { refused, empty, drawn, removed: pixel(), hit: hit && hit.id };
  }, BOX);
  expect(got.refused).toHaveLength(2);
  for (const message of got.refused) expect(message).toMatch(/lk3d-live\.min\.js/);
  expect(got.drawn).not.toEqual(got.empty);
  expect(got.removed).toEqual(got.empty);
  expect(got.hit).not.toMatch(/arrows/);
});

test('a surface is drawn as the page shapes it, refilled when it updates, and its tones follow the page from light to dark', async ({
  page,
}) => {
  const got = await page.evaluate(async () => {
    window.fig = LK3D.mount(
      document.getElementById('g'),
      {
        view: { yaw: 0, pitch: 89, projection: 'ortho' },
        parts: [{ id: 'base', name: 'Base', at: [0, -0.5, 0], shapes: [{ box: [2.4, 0.1, 2.4] }] }],
      },
      { controls: false, style: 'pen' },
    );
    await fig.ready;
    const cv = document.querySelector('#g canvas[tabindex]'),
      gl = cv.getContext('webgl2'),
      pixel = (point) => {
        fig.drawNow();
        const [x, y] = fig.project(point),
          out = new Uint8Array(4);
        gl.readPixels(Math.round(x), Math.round(cv.height - y), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, out);
        return [...out.slice(0, 3)];
      };
    const s = fig.surface({ id: 'sheet', size: [2, 2], res: [21, 21], colors: 'heat', smooth: true });
    s.tones.fill(1); // (the ramp's last stop: a strong colour on a light page, near white on a dark one)
    s.update();
    const light = pixel([0.5, 0, 0.5]);
    for (let k = 0; k < s.heights.length; k++) s.heights[k] = 0.3;
    s.tones.fill(0);
    s.update();
    const low = pixel([0.5, 0.3, 0.5]);
    s.tones.fill(1);
    s.update();
    fig.set({ theme: 'dark' });
    const dark = pixel([0.5, 0.3, 0.5]);
    return { light, low, dark, renderer: fig.renderer };
  });
  const lightness = (c) => c[0] + c[1] + c[2];
  expect(got.renderer).toBe('webgl2');
  expect(lightness(got.low)).toBeLessThan(lightness(got.light) - 60); // (refilled: the first stop, darker)
  expect(lightness(got.dark)).toBeGreaterThan(lightness(got.light) + 60); // (the dark page's stops: near white)
});

test('hit finds a surface where its heights are, and the 2D fallback draws a grid of at most 64 × 64 from it', async ({
  page,
}) => {
  const got = await page.evaluate(async () => {
    const scene = {
        view: { yaw: 0, pitch: 89, projection: 'ortho' },
        parts: [{ id: 'base', name: 'Base', at: [0, -0.5, 0], shapes: [{ box: [2.4, 0.1, 2.4] }] }],
      },
      shape = (s, n) => {
        for (let j = 0; j < n; j++)
          for (let i = 0; i < n; i++) s.heights[i + n * j] = 0.2 * Math.sin((6 * i) / n) * Math.cos((5 * j) / n);
        s.update();
      };
    window.fig = LK3D.mount(document.getElementById('g'), scene, { controls: false });
    await fig.ready;
    const s = fig.surface({ id: 'sheet', size: [2, 2], res: [129, 129] });
    shape(s, 129);
    fig.drawNow();
    const hits = [
      [0.3, -0.4],
      [-0.6, 0.5],
      [0.05, 0.05],
    ].map(([x, z]) => {
      const h = fig.hit(...fig.project([x, 0.1, z]));
      return h && { id: h.id, off: Math.abs(h.point[1] - s.heightAt(h.point[0], h.point[2])) };
    });
    fig.destroy();
    window.fig = LK3D.mount(document.getElementById('g'), scene, { controls: false, force2d: true });
    await fig.ready;
    const flat = fig.surface({ id: 'sheet', size: [2, 2], res: [129, 129] });
    shape(flat, 129);
    const drawn = fig.drawNow();
    return { hits, renderer: fig.renderer, drawn, hit2d: fig.hit(...fig.project([0.3, 0.1, -0.4]))?.id };
  });
  for (const h of got.hits) {
    expect(h.id).toBe('sheet');
    expect(h.off).toBeLessThan(0.01 * (2 / 128)); // (within 1 % of a cell)
  }
  expect(got).toMatchObject({ renderer: '2d', drawn: true, hit2d: 'sheet' });
});

// a marker the reader moves across a tray: a plane handle
const PLANE = {
  view: { yaw: 0, pitch: 60 },
  describe: { p: 'P is at {value}.' },
  check: { float: ['p'] },
  parts: [
    { id: 'tray', name: 'Tray', shapes: [{ box: [4, 0.2, 4] }] },
    {
      id: 'p',
      name: 'Point P',
      at: [0, 0.3, 0],
      shapes: [{ sphere: 0.2 }],
      handle: {
        plane: {
          axes: [
            [1, 0, 0],
            [0, 0, 1],
          ],
        },
        min: [-1.5, -1.5],
        max: [1.5, 1.5],
        snap: 0.1,
        label: 'Point P',
      },
    },
  ],
};

test('a plane handle moves by the mouse in its plane, holds still seen edge-on, and its pair goes through state', async ({
  page,
}) => {
  const [from, to] = await page.evaluate(async (scene) => {
    window.moves = [];
    window.fig = LK3D.mount(document.getElementById('g'), scene, {
      controls: false,
      onHandle: (id, v) => moves.push(v),
    });
    await fig.ready;
    fig.drawNow();
    return [fig.project([0, 0.3, 0]), fig.project([0.5, 0.3, 0.5])];
  }, PLANE);
  const box = await page.locator('#g canvas[tabindex]').boundingBox();
  await page.mouse.move(box.x + from[0], box.y + from[1]);
  await page.mouse.down();
  for (let k = 1; k <= 6; k++)
    await page.mouse.move(box.x + from[0] + ((to[0] - from[0]) * k) / 6, box.y + from[1] + ((to[1] - from[1]) * k) / 6);
  await page.mouse.up();
  const got = await page.evaluate(async () => {
    const value = fig.handle('p').value,
      state = fig.state(),
      text = fig.describe();
    fig.set({ handles: { p: [0, 0] } });
    fig.set(await LK3D.decodeState(await LK3D.encodeState(state)));
    return { value, inState: state.handles.p, text, back: fig.handle('p').value, last: moves.at(-1) };
  });
  const tenths = (pair) => pair.map((v) => Math.round(v * 10) / 10 + 0);
  expect(tenths(got.value)).toEqual([0.5, 0.5]);
  expect(tenths(got.inState)).toEqual([0.5, 0.5]);
  expect(tenths(got.last)).toEqual([0.5, 0.5]); // (onHandle hears the pair)
  expect(got.text).toContain('P is at 0.5, 0.5.');
  expect(tenths(got.back)).toEqual([0.5, 0.5]);
  // seen edge-on (an orthographic view along the plane: every ray runs along it), a drag moves nothing
  const [edge, beyond] = await page.evaluate(() => {
    fig.set({ projection: 'ortho', camera: { yaw: 0, pitch: 0, target: [0, 0.3, 0] } });
    fig.drawNow();
    return [fig.project([0.5, 0.3, 0.5]), fig.project([1, 0.3, 0.5])];
  });
  await page.mouse.move(box.x + edge[0], box.y + edge[1]);
  await page.mouse.down();
  await page.mouse.move(box.x + beyond[0], box.y + beyond[1] - 30);
  await page.mouse.up();
  const after = await page.evaluate(() => fig.handle('p').value);
  expect(tenths(after)).toEqual([0.5, 0.5]); // (held: the ray never meets the plane)
});

test('a plane handle is two inputs: Tab reaches each, its keys step its axis by snap, each says its own number', async ({
  page,
}) => {
  await page.evaluate(async (scene) => {
    window.fig = LK3D.mount(document.getElementById('g'), scene, {
      controls: false,
      handleText: (id, v, axis) => `axis ${axis}: ${Array.isArray(v) ? v[axis] : v}`,
    });
    await fig.ready;
  }, PLANE);
  const x = page.getByRole('slider', { name: 'Point P, along x' }),
    z = page.getByRole('slider', { name: 'Point P, along z' });
  await x.focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Tab'); // (the next input: the plane's other axis)
  await expect(z).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  const value = await page.evaluate(() => fig.handle('p').value.map((v) => Math.round(v * 100) / 100 + 0));
  expect(value).toEqual([0.2, -0.1]);
  expect(await x.getAttribute('aria-valuetext')).toBe('axis 0: 0.2');
  expect(await z.getAttribute('aria-valuetext')).toBe('axis 1: -0.1');
  // named axes, and the Vietnamese words
  const names = await page.evaluate(async (scene) => {
    fig.destroy();
    const named = JSON.parse(JSON.stringify(scene));
    named.parts[1].handle.plane.names = ['trái–phải', 'trước–sau'];
    named.parts[1].handle.plane.axes = [
      [1, 0, 1],
      [-1, 0, 1],
    ];
    const read = () => [...document.querySelectorAll('#g input[type=range]')].map((i) => i.getAttribute('aria-label'));
    window.fig = LK3D.mount(document.getElementById('g'), named, { controls: false });
    const given = read();
    fig.destroy();
    named.parts[1].handle.plane.names = undefined;
    window.fig = LK3D.mount(document.getElementById('g'), named, { controls: false, locale: 'vi' });
    return [given, read()];
  }, PLANE);
  expect(names[0]).toEqual(['Point P, trái–phải', 'Point P, trước–sau']);
  expect(names[1]).toEqual(['Point P, hướng thứ nhất', 'Point P, hướng thứ hai']);
});

test('onPress taking a press over a handle leaves the handle; a page press while a handle is held goes to the handle', async ({
  page,
}) => {
  await page.evaluate(async (scene) => {
    window.calls = 0;
    window.claim = true;
    window.fig = LK3D.mount(document.getElementById('g'), scene, {
      controls: false,
      onPress: () => (window.calls++, window.claim),
    });
    await fig.ready;
    fig.drawNow();
  }, PLANE);
  const box = await page.locator('#g canvas[tabindex]').boundingBox(),
    [from, to] = await page.evaluate(() => [fig.project([0, 0.3, 0]), fig.project([0.5, 0.3, 0.5])]),
    drag = async () => {
      await page.mouse.move(box.x + from[0], box.y + from[1]);
      await page.mouse.down();
      for (let k = 1; k <= 4; k++)
        await page.mouse.move(
          box.x + from[0] + ((to[0] - from[0]) * k) / 4,
          box.y + from[1] + ((to[1] - from[1]) * k) / 4,
        );
      if (k2) await k2();
      await page.mouse.up();
    };
  let k2 = null;
  await drag();
  expect(await page.evaluate(() => fig.handle('p').value)).toEqual([0, 0]); // (the page took it)
  // the page declines: the reader holds the handle, and a second finger's press is not offered to the page
  await page.evaluate(() => {
    window.claim = false;
    window.calls = 0;
  });
  k2 = () =>
    page.evaluate(
      ([x, y]) => {
        window.claim = true;
        const cv = document.querySelector('#g canvas[tabindex]');
        cv.dispatchEvent(
          new PointerEvent('pointerdown', {
            pointerId: 9,
            pointerType: 'touch',
            clientX: x,
            clientY: y,
            bubbles: true,
          }),
        );
        cv.dispatchEvent(
          new PointerEvent('pointerup', { pointerId: 9, pointerType: 'touch', clientX: x, clientY: y, bubbles: true }),
        );
      },
      [box.x + 20, box.y + 20],
    );
  await drag();
  const after = await page.evaluate(() => ({
    calls,
    value: fig.handle('p').value.map((v) => Math.round(v * 10) / 10 + 0),
  }));
  expect(after).toEqual({ calls: 1, value: [0.5, 0.5] }); // (offered the first press only; the handle moved)
});

test('a handle takes only a value of its own shape; a turn on a mirror part is applied as given', async ({ page }) => {
  const got = await page.evaluate(async (scene) => {
    const plane = JSON.parse(JSON.stringify(scene));
    plane.parts.push({
      id: 'knob',
      name: 'Knob',
      at: [1.5, 0.2, -1.5],
      shapes: [{ sphere: 0.1 }],
      handle: { turn: { axis: [0, 1, 0] } },
    });
    plane.parts.push({ id: 'l', name: 'Peg', at: [1.5, 0.2, 1.5], shapes: [{ sphere: 0.1 }] });
    plane.parts.push({ id: 'r', mirrorOf: 'l', plane: 'x' });
    window.fig = LK3D.mount(document.getElementById('g'), plane, { controls: false });
    await fig.ready;
    fig.handle('p').set(5); // (a number for a plane handle: ignored)
    fig.handle('knob').set([1, 2]); // (a pair for a turn: ignored)
    fig.set({ handles: { p: 3 } });
    const kept = [fig.handle('p').value, fig.handle('knob').value];
    fig.set({ move: { r: { turn: { axis: [0, 0, 1], angle: 90, center: [-1.5, 0.2, 1.5] } } } });
    fig.drawNow();
    const at = fig.project([-1.5, 0.3, 1.5], 'r'),
      want = fig.project([-1.6, 0.2, 1.5]); // (the point 0.1 above its centre, turned 90° about z: 0.1 to −x)
    return { kept, off: Math.hypot(at[0] - want[0], at[1] - want[1]) };
  }, PLANE);
  expect(got.kept).toEqual([[0, 0], 0]);
  expect(got.off).toBeLessThan(0.5);
});

test('a surface is never cut: drawn and hit whole with the model cut open', async ({ page }) => {
  const got = await page.evaluate(async () => {
    window.fig = LK3D.mount(
      document.getElementById('g'),
      {
        view: { yaw: 0, pitch: 89, projection: 'ortho' },
        section: { normal: [1, 0, 0], offset: 0 },
        parts: [{ id: 'base', name: 'Base', at: [0, -0.5, 0], shapes: [{ box: [2.4, 0.1, 2.4] }] }],
      },
      { controls: false },
    );
    await fig.ready;
    const s = fig.surface({ id: 'sheet', size: [2, 2], res: [9, 9] });
    s.heights.fill(0.1);
    s.update();
    fig.set({ cut: 1 });
    fig.drawNow();
    return [0.6, -0.6].map((x) => fig.hit(...fig.project([x, 0.1, 0]))?.id);
  });
  expect(got).toEqual(['sheet', 'sheet']); // (beyond the plane and before it)
});

test('lines added to a figure still waiting for its first WebGL context draw in WebGL when it gets one, not in 2D', async ({
  page,
}) => {
  const said = [];
  page.on('console', (m) => said.push(m.text()));
  const got = await page.evaluate(async () => {
    window.els = [];
    window.figs = [];
    // eight figures hold the contexts; a ninth, far below, waits for one (backend.js: MAX_GL)
    for (let k = 0; k < 9; k++) {
      const d = document.createElement('div');
      d.style.cssText = k === 8 ? 'width: 480px; margin-top: 6000px' : 'width: 120px; display: inline-block';
      document.body.append(d);
      els.push(d);
      figs.push(LK3D.mount(d, window.scene, { controls: false }));
    }
    const late = figs[8],
      waited = late.renderer;
    // (lines made while it has no context: their buffers belong to none until it gets one)
    late.lines({ count: 1, radius: 0.05, color: '#d00000' }).set(0, [-1, 0.5, 0], [1, 0.5, 0]);
    els[8].scrollIntoView();
    await until(() => late.renderer && late.drawNow());
    return { waited, renderer: late.renderer };
  });
  expect(said.filter((s) => /2D instead/.test(s))).toEqual([]);
  expect(got).toEqual({ waited: '', renderer: 'webgl2' });
});

test('lines drawn before a lost WebGL context are drawn again, the same, once it comes back', async ({ page }) => {
  await page.evaluate(async () => {
    window.fig = mountIt();
    await fig.ready;
    fig.lines({ count: 1, radius: 0.05, color: '#d00000' }).set(0, [-1, 0.5, 0], [1, 0.5, 0]);
    fig.drawNow();
  });
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
    x.restoreContext();
    await until(() => back);
    await until(() => fig.drawNow());
    return { renderer: fig.renderer, error: gl.getError() };
  });
  expect(got).toEqual({ renderer: 'webgl2', error: 0 });
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
    // labels and the cut: the base's label point is its back corner, z = -1. Kept by the scene's plane, it shows where
    // it is; cut away by the plane turned round, while the rest of the base stays, it points at the base's cut face (on
    // the plane); the knob (z from -0.08 to 0.08) cut away whole, its label shows not at all
    const tagOf = (section, id, name) => {
      fig.set({ labels: [id], section });
      fig.drawNow();
      const tag = [...el.querySelectorAll('.lk3d-tag')].find((t) => t.textContent === name);
      return !!tag && tag.style.display !== 'none';
    };
    out.labelKept = tagOf({ normal: [0, 0, 1], offset: -0.95 }, 'base', 'Base');
    out.labelOnFace = tagOf({ normal: [0, 0, -1], offset: 0.5 }, 'base', 'Base');
    const leader = [...el.querySelectorAll('.lk3d-lines circle')].find((dot) => dot.style.display !== 'none'),
      onPlane = fig.project([1, 0.1, -0.5]); // (the label point moved onto the plane z = -0.5)
    out.pointsAtFace =
      !!leader && Math.hypot(+leader.getAttribute('cx') - onPlane[0], +leader.getAttribute('cy') - onPlane[1]) < 2;
    out.labelCutAway = !tagOf({ normal: [0, 0, 1], offset: -0.5 }, 'knob', 'Knob');
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
  expect(r.labelOnFace).toBe(true);
  expect(r.pointsAtFace).toBe(true);
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
    models = (await import('node:fs')).readFileSync(new URL('../../dist/lk3d-models.min.js', import.meta.url), 'utf8'),
    scene = JSON.parse(
      (await import('node:fs')).readFileSync(new URL('scenes/generator.json', import.meta.url), 'utf8'),
    );
  // the shading of every batch, as one hash, and whether the worker made it
  const shade = async (how) => {
    const page = await browser.newPage();
    if (how === 'no worker') await page.addInitScript(() => delete window.Worker);
    if (how === 'inline' || how === 'inline with models') {
      await page.setContent('<div id="g" style="width:480px"></div>');
      // (as lessonkit inlines them: the core and, for a page with a model, the models add-on, in one script)
      await page.addScriptTag({ content: how === 'inline' ? engine : engine + '\n' + models });
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
    withModels = await shade('inline with models'),
    onPage = await shade('no worker');
  expect(bySrc.shaded).toBeGreaterThan(5);
  expect([bySrc.worker, inline.worker, withModels.worker, onPage.worker]).toEqual([true, true, true, false]);
  expect(inline.hash).toBe(bySrc.hash);
  expect(withModels.hash).toBe(bySrc.hash);
  expect(onPage.hash).toBe(bySrc.hash);
});

test('dimensions: a length to a part follows it as the reader moves it, in the unit asked; an angle in degrees; steps and the page choose which show; listed for screen readers', async ({
  page,
}) => {
  const r = await page.evaluate(async () => {
    const el = document.getElementById('g'),
      scene = {
        ...window.scene,
        unit: 'dm',
        parts: [
          ...window.scene.parts,
          {
            id: 'slider',
            name: 'Slider',
            shapes: [{ box: [0.1, 0.1, 0.1] }],
            at: [0.4, 0.15, 0.6],
            handle: { slide: { axis: [1, 0, 0] }, value: 0, min: -0.3, max: 0.5 },
          },
        ],
        dimensions: [
          {
            id: 'gap',
            name: 'the gap',
            from: [0, 0.15, 0.6],
            to: { part: 'slider', at: [0.4, 0.15, 0.6] },
            offset: [0, 0.2, 0],
            unit: 'mm',
            digits: 0,
          },
          {
            id: 'corner',
            angle: [
              [1, 0.1, 1],
              [-1, 0.1, 1],
              [-1, 0.1, -1],
            ],
            hidden: true,
          },
          { id: 'own', from: [-1, -0.1, 1], to: [1, -0.1, 1], text: 'the width' },
        ],
        steps: [{ title: 'All' }, { title: 'The corner', dimensions: ['corner'] }, { title: 'None', dimensions: [] }],
      };
    const fig = LK3D.mount(el, scene, { adaptive: false, controls: false, steps: false });
    await fig.ready;
    const shown = () =>
      [...el.querySelectorAll('.lk3d-dimtext')].filter((t) => t.style.display !== 'none').map((t) => t.textContent);
    fig.drawNow();
    const out = { start: shown(), readers: el.querySelector('ul[aria-label="Dimensions"]').textContent };
    fig.handle('slider').set(0.35);
    fig.drawNow();
    out.moved = shown();
    fig.step(1, { ms: 0 });
    fig.drawNow();
    out.corner = shown();
    fig.step(2, { ms: 0 });
    fig.drawNow();
    out.none = shown();
    fig.set({ dimensions: ['own'] });
    fig.drawNow();
    out.page = shown();
    fig.set({ dimensions: null });
    fig.drawNow();
    out.back = shown();
    // (each value drawn on its line: the gap's at the middle, on the stage, of its two ends raised by the offset)
    const gap = el.querySelector('.lk3d-dimtext'),
      [x, y] = gap.style.transform.match(/-?[\d.]+/g).map(Number),
      [a, b] = [fig.project([0, 0.35, 0.6]), fig.project([0.75, 0.35, 0.6])], // (the line's ends: to the slider at 0.75)
      middle = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    out.onLine = Math.hypot(x - middle[0], y - middle[1]) < 1.5;
    return out;
  });
  expect(r.start).toEqual(['40 mm', 'the width']); // (the corner is hidden until named)
  expect(r.readers).toContain('the gap: 40 mm');
  expect(r.moved).toEqual(['75 mm', 'the width']);
  expect(r.corner).toEqual(['90°']);
  expect(r.none).toEqual([]);
  expect(r.page).toEqual(['the width']);
  expect(r.back).toEqual(['75 mm', 'the width']);
  expect(r.onLine).toBe(true);
});

test('a quarter cut: only what lies beyond both planes is cut away; the reader drags either face; a single cut again without the second plane', async ({
  page,
}) => {
  const r = await page.evaluate(async () => {
    const el = document.getElementById('g'),
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
      };
    // the base's front half (z > 0) on the left (x < 0) is beyond both planes: cut away; its front right, beyond one only, stays
    const scene = {
        ...window.scene,
        section: { normal: [0, 0, 1], offset: 0, second: { normal: [-1, 0, 0], offset: 0 } },
      },
      fig = LK3D.mount(el, scene, { adaptive: false, controls: false });
    await fig.ready;
    const at = (point) => {
      fig.drawNow();
      const [x, y] = fig.project(point);
      return fig.pick(x, y);
    };
    fig.set({ cut: true });
    const out = {
      frontLeft: at([-0.6, 0.1, 0.9]),
      frontRight: at([0.6, 0.1, 0.9]),
      section: fig.section,
    };
    // the second plane's face (x = 0, inside the base, in front), dragged: that plane moves, the first stays
    fig.drawNow();
    const face = fig.project([0, 0.02, 0.6]);
    ev('pointerdown', face);
    for (let k = 1; k <= 4; k++) ev('pointermove', [face[0] + 10 * k, face[1]]);
    ev('pointerup', [face[0] + 40, face[1]]);
    out.dragged = fig.section;
    // the second plane taken away: a single cut, the front right cut away too
    fig.set({ section: { second: null } });
    out.single = [at([0.6, 0.1, 0.9]), fig.section.second === null]; // (null without a second plane: 0.4.0)
    return out;
  });
  expect(r.frontLeft).not.toBe('base');
  expect(r.frontRight).toBe('base');
  expect(r.section).toEqual({ normal: [0, 0, 1], offset: 0, second: { normal: [-1, 0, 0], offset: 0 } });
  expect(r.dragged.offset).toBe(0); // (the first plane where it was)
  expect(Math.abs(r.dragged.second.offset)).toBeGreaterThan(0.05); // (the second moved)
  expect(r.single).toEqual([expect.not.stringMatching(/^base$/), true]);
});

test('a glTF model needs the models add-on: the core alone refuses it by name; an <lk3d-figure> before both scripts draws once the add-on comes', async ({
  browser,
}) => {
  // (a fresh page: beforeEach's has the engine already, which would have defined <lk3d-figure> before this test's)
  const page = await browser.newPage();
  const fs = await import('node:fs'),
    { sceneToGLB } = await import('../../src/gltf-write.js');
  const engine = fs.readFileSync(new URL('../../dist/lk3d.min.js', import.meta.url), 'utf8'),
    models = fs.readFileSync(new URL('../../dist/lk3d-models.min.js', import.meta.url), 'utf8'),
    glb = Buffer.from(sceneToGLB({ parts: [{ id: 'b', name: 'B', shapes: [{ box: [1, 1, 1] }] }] })).toString('base64'),
    scene = { models: { cube: { data: glb } }, parts: [{ id: 'm', name: 'Model', shapes: [{ model: 'cube' }] }] };
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.setContent(
    `<lk3d-figure id="f" style="display:block;width:400px"><script type="application/json">${JSON.stringify(scene)}</script></lk3d-figure><div id="g" style="width:400px"></div>`,
  );
  await page.addScriptTag({ content: engine });
  const refused = await page.evaluate((s) => {
    try {
      LK3D.mount(document.getElementById('g'), s, { controls: false });
      return 'mounted';
    } catch (e) {
      return e.message;
    }
  }, scene);
  expect(refused).toMatch(/cube/);
  expect(refused).toMatch(/lk3d-models\.min\.js/);
  expect(await page.evaluate(() => document.getElementById('f').figure)).toBe(null); // (refused, waiting)
  await page.addScriptTag({ content: models });
  await page.waitForFunction(() => document.getElementById('f').figure, null, { timeout: 10000 });
  expect(await page.evaluate(() => document.getElementById('f').figure.parts.length)).toBe(1);
  // and a figure mounted by the page itself, now that the reader is here
  expect(
    await page.evaluate((s) => LK3D.mount(document.getElementById('g'), s, { controls: false }).parts.length, scene),
  ).toBe(1);
  // loaded again: nothing changes
  await page.addScriptTag({ content: models });
  expect(errors).toEqual([]);
  await page.close();
  // loaded before the core: it says what to do
  const early = await browser.newPage(),
    said = [];
  early.on('pageerror', (e) => said.push(String(e.message)));
  await early.setContent('<p>x</p>');
  await early.addScriptTag({ content: models }).catch(() => {});
  expect(said.join()).toMatch(/lk3d-models: load dist\/lk3d\.min\.js first/);
  await early.close();
});

test("the figure's state: read, set back the same, with liquids and a paused motion; who changed it; what the page locks", async ({
  page,
}) => {
  const r = await page.evaluate(async () => {
    const pour = await (await fetch('/test/visual/scenes/pour.json')).json(),
      changes = [];
    // (a motion of its own: the beaker slid along x)
    pour.motions = [
      {
        id: 'slide',
        range: [0, 2],
        tracks: [
          {
            parts: ['beaker'],
            move: [
              [0, [0, 0, 0]],
              [2, [2, 0, 0]],
            ],
          },
        ],
      },
    ];
    const fig = LK3D.mount(document.getElementById('g'), pour, {
      onChange: (state, cause) => changes.push(cause),
      lock: ['handles'],
    });
    await fig.ready;
    // the liquids, the vessels and the motions as they are; a state set back is the same state
    const motion = fig.motion(pour.motions[0].id);
    motion.set(pour.motions[0].range[1] / 2);
    fig.set({ cut: 0.5, liquids: { water: 20 }, vessels: { f: { open: 0 } } });
    const before = fig.state();
    fig.set({ cut: 0, explode: 1, xray: true });
    fig.set(before);
    const after = fig.state();
    // set() is the page; the first frame told nothing
    await until(() => changes.length >= 1);
    // a motion played and paused by the state: paused stays paused, after the step too
    motion.play();
    fig.set({ ...fig.state(), playing: [] });
    const paused = !motion.playing;
    return { before, after, changes, paused, lock: fig.state().handles };
  });
  expect(r.after).toEqual(r.before);
  expect(r.before.liquids.water).toBe(20);
  expect(r.before.vessels).toEqual({ f: { open: 0 } });
  expect(r.before.cut).toBe(0.5);
  expect(r.changes[0]).toBe('page');
  expect(r.paused).toBe(true);
  // a locked handle cannot be dragged; the page still moves it; the cut button turns a half-swept cut off
  const knob = await page.evaluate(async () => {
    const fig = mountIt({ controls: true, lock: ['handles'] });
    await fig.ready;
    const [x, y] = fig.project([0, 0.15, 0.08]);
    return { x, y, rect: document.getElementById('g').querySelector('canvas').getBoundingClientRect().toJSON() };
  });
  await page.mouse.move(knob.rect.x + knob.x, knob.rect.y + knob.y);
  await page.mouse.down();
  await page.mouse.move(knob.rect.x + knob.x + 60, knob.rect.y + knob.y + 10, { steps: 6 });
  await page.mouse.up();
  const after = await page.evaluate(async () => {
    const fig = document.getElementById('g').lk3d,
      dragged = fig.state().handles.knob;
    fig.handle('knob').set(30);
    fig.set({ cut: 0.5 });
    document.querySelector('#g .lk3d-bar button[aria-pressed]').click(); // (the Cut button: pressed while it is on)
    return { dragged, set: fig.state().handles.knob, cut: fig.state().cut, locked: fig.state().v };
  });
  expect(after.dragged).toBe(0);
  expect(after.set).toBe(30);
  expect(after.cut).toBe(0);
});

test("the figure in words: the scene's own sentences with {value}, the Describe button, nothing cut in 2D, the page's change unsaid", async ({
  page,
}) => {
  const r = await page.evaluate(async () => {
    window.scene.title = 'A dial';
    window.scene.section = { normal: [1, 0, 0], offset: 0 };
    window.scene.motions = [
      {
        id: 'm',
        range: [0, 2],
        tracks: [
          {
            parts: ['knob'],
            move: [
              [0, [0, 0, 0]],
              [2, [0, 0.1, 0]],
            ],
          },
        ],
      },
    ];
    window.scene.describe = { m: 'Lifted by {value} mm.', knob: 'The knob is at {value}°.' };
    const fig = mountIt({ controls: true });
    await fig.ready;
    fig.motion('m').set(1.25);
    fig.set({ cut: true });
    const words = fig.describe();
    // the Describe button says it aloud (the live region, emptied first)
    const region = [...document.querySelectorAll('#g [aria-live]')].find((e) => !e.closest('.lk3d-steps'));
    [...document.querySelectorAll('#g .lk3d-bar button')].find((b) => b.textContent === 'Describe').click();
    await until(() => region.textContent.includes('A dial.'));
    const spoken = region.textContent;
    // the page's own change is not said (only the reader's are)
    region.textContent = '';
    fig.set({ xray: true });
    await new Promise((done) => setTimeout(done, 1300));
    const pageSaid = region.textContent;
    // in the 2D fallback there is no cut, so none is said
    const flat = mountIt({ force2d: true });
    await flat.ready;
    flat.set({ cut: true });
    return { words, spoken, pageSaid, flat: flat.describe(), renderer: flat.renderer };
  });
  expect(r.words).toBe('A dial. Put together. Cut open across x. Lifted by 1.25 mm. The knob is at 0°.');
  expect(r.spoken).toBe(r.words);
  expect(r.pageSaid).toBe('');
  expect(r.renderer).toBe('2d');
  expect(r.flat).not.toMatch(/Cut open/);
});

test("set(state()) draws the same picture after the reader's own changes: a handle dragged, the cut, a paused motion, a turn; and with liquids", async ({
  page,
}) => {
  await page.evaluate(async () => {
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
              [1, [0, 0.2, 0]],
            ],
          },
        ],
      },
    ];
    window.scene.section = { normal: [0, 0, 1], offset: 0 };
    window.fig = mountIt({ controls: true });
    await fig.ready;
  });
  const canvas = await page.locator('#g canvas').boundingBox();
  // the reader: drags the knob round, turns the view, plays the motion and pauses it, cuts it open, takes it apart
  const knob = await page.evaluate(() => fig.project([0, 0.15, 0.08]));
  await page.mouse.move(canvas.x + knob[0], canvas.y + knob[1]);
  await page.mouse.down();
  await page.mouse.move(canvas.x + knob[0] + 50, canvas.y + knob[1] + 20, { steps: 5 });
  await page.mouse.up();
  await page.mouse.move(canvas.x + 40, canvas.y + 40);
  await page.mouse.down();
  await page.mouse.move(canvas.x + 120, canvas.y + 70, { steps: 5 });
  await page.mouse.up();
  const bar = (name) => page.locator('#g .lk3d-bar button', { hasText: name }).first();
  await bar('Play').click();
  await page.waitForTimeout(300);
  await bar('Pause').click();
  await bar('Cut open').click();
  await bar('Take apart').click();
  const same = await page.evaluate(async () => {
    await new Promise((done) => setTimeout(done, 1200)); // (the glides end)
    LK3D.clock.speed = 0;
    const kept = fig.state(),
      before = await fig.picture();
    fig.set({
      explode: 0,
      cut: 0,
      xray: true,
      camera: { yaw: 10, pitch: 5 },
      handles: { knob: 0 },
      motion: { lift: 0 },
    });
    await fig.picture();
    fig.set(kept);
    const after = await fig.picture();
    LK3D.clock.speed = 1;
    return { equal: before === after, moved: kept.handles.knob !== 0 && kept.motion.lift > 0 && kept.cut === 1 };
  });
  expect(same.moved).toBe(true);
  expect(same.equal).toBe(true);
  // liquids: their volumes and an outlet shut, set back as they were
  const liquids = await page.evaluate(async () => {
    const pour = await (await fetch('/test/visual/scenes/pour.json')).json();
    const fig = LK3D.mount(document.getElementById('g'), pour, { controls: false });
    await fig.ready;
    LK3D.clock.speed = 0;
    fig.set({ liquids: { water: 18, 'water-below': 14 }, vessels: { f: { open: 0 } } });
    const kept = fig.state(),
      before = await fig.picture();
    fig.set({ liquids: { water: 30, 'water-below': 2 } });
    await fig.picture();
    fig.set(kept);
    const after = await fig.picture();
    LK3D.clock.speed = 1;
    return before === after;
  });
  expect(liquids).toBe(true);
});

test('the recipes run: a story told by scrolling, each step printed as a picture (the state put back), a state in a link; picture() refuses a hidden figure', async ({
  page,
}) => {
  const r = await page.evaluate(async () => {
    // (the story: blocks of text, each naming a step, scrolled past; as docs/recipes.md writes it)
    window.scene.steps = [
      { id: 'whole', title: 'The whole' },
      { id: 'apart', title: 'Apart', explode: 1 },
    ];
    document.body.insertAdjacentHTML(
      'beforeend',
      '<div id="story"><section data-step="whole" style="height:120vh">The whole</section><section data-step="apart" style="height:120vh">Apart</section></div>',
    );
    const fig = mountIt({ steps: false });
    await fig.ready;
    const still = matchMedia('(prefers-reduced-motion: reduce)');
    const watch = new IntersectionObserver(
      (entries) => {
        for (const entry of entries)
          if (entry.isIntersecting) fig.step(entry.target.dataset.step, { ms: still.matches ? 0 : 900 });
      },
      { rootMargin: '-45% 0px -45% 0px' },
    );
    for (const block of document.querySelectorAll('[data-step]')) watch.observe(block);
    document.querySelector('[data-step="apart"]').scrollIntoView({ block: 'center' });
    await until(() => fig.currentStep === 1);
    const scrolled = fig.currentStep;
    // printing each step: a picture each, and the figure put back as it was
    fig.set({ camera: { yaw: 33, pitch: 12 } });
    const kept = fig.state(),
      pictures = [];
    for (let k = 0; k < fig.steps.length; k++) {
      fig.step(k, { ms: 0 });
      pictures.push(await fig.picture());
    }
    fig.set(kept);
    const restored = JSON.stringify(fig.state()) === JSON.stringify(kept);
    // a state in a link, and back
    const text = await LK3D.encodeState(fig.state()),
      back = await LK3D.decodeState(text);
    // picture() of a figure the page hides
    document.getElementById('g').style.display = 'none';
    const refused = await fig.picture().then(
      () => 'drawn',
      (e) => e.message,
    );
    document.getElementById('g').style.display = '';
    return {
      scrolled,
      pictures: pictures.map((p) => p.slice(0, 22)),
      different: pictures[0] !== pictures[1],
      restored,
      linked: JSON.stringify(back) === JSON.stringify(kept),
      refused,
    };
  });
  expect(r.scrolled).toBe(1);
  expect(r.pictures).toEqual(['data:image/png;base64,', 'data:image/png;base64,']);
  expect(r.different).toBe(true);
  expect(r.restored).toBe(true);
  expect(r.linked).toBe(true);
  expect(r.refused).toMatch(/not on the page/);
});

test("the card over the stage: the chosen part's own text under the page's, rows of values, closed by its ×, Escape or choosing nothing; no HTML gets in", async ({
  page,
}) => {
  const got = await page.evaluate(async () => {
    window.scene.parts[0].note = 'The <b>base</b> <img src=x onerror="window.hacked=1">';
    window.scene.parts[0].card = { eyebrow: 'Frame', source: 'Measured on the model' };
    const picks = [];
    window.fig = mountIt({ card: true, locale: 'vi', onPick: (p) => picks.push(p && p.id) });
    await fig.ready;
    const card = document.querySelector('#g .lk3d-stage > .lk3d-card'),
      text = (name) => card.querySelector('.lk3d-' + name)?.innerHTML ?? null,
      seen = () => ({
        hidden: card.hidden,
        eyebrow: text('eyebrow'),
        title: text('title'),
        body: text('body'),
        source: text('source'),
        rows: [...card.querySelectorAll('dl > div')].map((row) => [...row.children].map((cell) => cell.textContent)),
      });
    const atStart = seen();
    fig.select('base');
    const chosen = seen();
    // the page's: rows (a number with the locale's decimal mark), merged with what it gave before, over the part's own
    fig.card({
      rows: [
        ['Lực', 667],
        ['Ứng suất', '28,4 N/cm²'],
      ],
    });
    fig.card({ title: 'Đế <i>máy</i>', rows: [['Lực', 667.5]] });
    const added = seen(),
      sameNode = card.querySelector('.lk3d-close');
    fig.card({ rows: [['Lực', 667.5]] }); // (the same again: nothing rebuilt)
    const kept = card.querySelector('.lk3d-close') === sameNode;
    fig.card(null);
    const own = seen();
    fig.card({ rows: [['Lực', 1]] });
    fig.select('knob'); // (another part: the page's content is dropped)
    const other = seen();
    fig.select(null);
    const none = seen();
    return { atStart, chosen, added, kept, own, other, none, hacked: !!window.hacked, picks };
  });
  expect(got.atStart.hidden).toBe(true);
  expect(got.chosen).toEqual({
    hidden: false,
    eyebrow: 'Frame',
    title: 'Base',
    body: 'The <b>base</b> &lt;img src=x onerror="window.hacked=1"&gt;',
    source: 'Measured on the model',
    rows: [],
  });
  expect(got.added.title).toBe('Đế <i>máy</i>');
  expect(got.added.eyebrow).toBe('Frame');
  expect(got.added.rows).toEqual([['Lực', '667,5']]);
  expect(got.kept).toBe(true);
  expect(got.own).toMatchObject({ title: 'Base', rows: [] });
  expect(got.other).toMatchObject({ hidden: false, title: 'Knob', eyebrow: null, rows: [] });
  expect(got.none.hidden).toBe(true);
  expect(got.hacked).toBe(false);
  expect(got.picks).toEqual([]); // (the page's own select() is not the reader's pick)

  // the reader: the × lets the part go (onPick(null)) and gives the keys back to the canvas; so does Escape in the card
  await page.evaluate(() => fig.select('base'));
  await page.click('#g .lk3d-close');
  expect(
    await page.evaluate(() => ({
      selected: fig.selected,
      hidden: document.querySelector('#g .lk3d-card').hidden,
      focus: document.activeElement === document.querySelector('#g canvas[tabindex]'),
    })),
  ).toEqual({ selected: null, hidden: true, focus: true });
  await page.evaluate(() => fig.select('base'));
  await page.focus('#g .lk3d-close');
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => [fig.selected, document.querySelector('#g .lk3d-card').hidden])).toEqual([
    null,
    true,
  ]);
  // Escape on the canvas, as before; and Tab goes on past the card (nothing holds the focus)
  await page.evaluate(() => fig.select('base'));
  await page.focus('#g canvas[tabindex]');
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => document.querySelector('#g .lk3d-card').hidden)).toBe(true);
  await page.evaluate(() => fig.select('base'));
  await page.focus('#g .lk3d-close');
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => document.querySelector('#g .lk3d-card').contains(document.activeElement))).toBe(
    false,
  );
  // the close button is named in the figure's language
  expect(await page.getAttribute('#g .lk3d-close', 'aria-label')).toBe('Đóng');
  // the page's own words with no part chosen (a tour's step): closed by the × and by Escape on the canvas alike, and
  // dropped when the reader chooses a part (onPick may give them again)
  const hidden = () => page.evaluate(() => document.querySelector('#g .lk3d-card').hidden);
  await page.evaluate(() => (fig.select(null), fig.card({ title: 'Bước một', body: 'Màng tế bào' })));
  expect(await hidden()).toBe(false);
  await page.click('#g .lk3d-close');
  expect(await hidden()).toBe(true);
  await page.evaluate(() => fig.card({ title: 'Bước một' }));
  await page.focus('#g canvas[tabindex]');
  await page.keyboard.press('Escape');
  expect(await hidden()).toBe(true);
  await page.evaluate(() => fig.card({ title: 'Bước một' }));
  await page.keyboard.press('PageDown');
  expect(await page.evaluate(() => document.querySelector('#g .lk3d-title').textContent)).toBe('Base');
});

test('the card needs the live add-on, and says so; without card: true there is none, and fig.card does nothing', async ({
  page,
}) => {
  const got = await page.evaluate(async () => {
    const live = LK3D.live;
    LK3D.live = undefined; // (as on a page that did not load dist/lk3d-live.min.js)
    let refused = '';
    try {
      mountIt({ card: true });
    } catch (e) {
      refused = e.message;
    }
    LK3D.live = live;
    const fig = mountIt();
    await fig.ready;
    fig.select('base');
    fig.card({ title: 'x' });
    return { refused, cards: document.querySelectorAll('#g .lk3d-card').length };
  });
  expect(got.refused).toMatch(/lk3d-live\.min\.js/);
  expect(got.cards).toBe(0);
});

test("a label's second line: set by the page, as often as it changes, as safe HTML; the label grows to hold it", async ({
  page,
}) => {
  const got = await page.evaluate(async () => {
    window.fig = mountIt({ labels: 'all' });
    await fig.ready;
    fig.drawNow();
    const tag = () => document.querySelector('#g .lk3d-tag[data-id="base"]'),
      box = () => tag().getBoundingClientRect(),
      before = box();
    fig.tagText('base', '667 N · cách khớp 22 mm <script>window.hacked=1</script>');
    fig.drawNow();
    await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
    const after = box(),
      sub = tag().querySelector('.lk3d-sub');
    // (wide enough for its longer line: its width as measured holds the text)
    const fits = sub.scrollWidth <= tag().clientWidth;
    fig.tagText('base', 488);
    const number = tag().querySelector('.lk3d-sub').textContent;
    fig.tagText('base', null);
    fig.tagText('nothing', 'x'); // (no such part: nothing)
    return {
      grew: after.height - before.height,
      wider: after.width > before.width,
      text: sub.innerHTML,
      fits,
      number,
      gone: !tag().querySelector('.lk3d-sub'),
      hacked: !!window.hacked,
    };
  });
  expect(got.grew).toBeGreaterThan(10);
  expect(got.wider).toBe(true);
  expect(got.text).toBe('667 N · cách khớp 22 mm &lt;script&gt;window.hacked=1&lt;/script&gt;');
  expect(got.fits).toBe(true);
  expect(got.number).toBe('488');
  expect(got.gone).toBe(true);
  expect(got.hacked).toBe(false);
});
