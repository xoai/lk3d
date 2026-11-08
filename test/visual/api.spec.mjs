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
      knob = () => fig.parts.find((p) => p.id === 'knob').m[13];
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
      seat0 = piston().lo[1] + piston().m[13];
    gas.set({ T: 293 * 1.5 });
    // until it has settled (it eases in by frames, which a machine drawing in software gives slowly), 20 s at most
    for (let t = 0, last = NaN; t < 20000 && gas.height !== last; t += 1000) {
      last = gas.height;
      await new Promise((res) => setTimeout(res, 1000));
    }
    return { h0, h1: gas.height, seat0, seat1: piston().lo[1] + piston().m[13] };
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
        was = fig.parts.map((p) => p.m),
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
      const kept = fig.parts.every((p, k) => p.m === was[k]);
      gl.bufferData = bd;
      JSON.stringify = js;
      return { fig, was, kept, sent, strung };
    };
    const a = await count(window.scene);
    a.fig.motion('swing').set(45);
    a.fig.drawNow();
    const moved = a.fig.parts.map((p, k) => p.m !== a.was[k]);
    const b = await count(gas);
    return { kept: a.kept, sent: a.sent, strung: a.strung, moved, gas: [b.kept, b.sent, b.strung] };
  });
  expect(got).toEqual({ kept: true, sent: 0, strung: 0, moved: [false, true, false, true], gas: [true, 0, 0] });
});
