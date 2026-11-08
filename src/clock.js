// @ts-check
// The clock every figure animates by, and the screen's refresh rate measured from frame intervals. Shared by all the
// figures on a page; reads nothing from them (each mounted figure adds its waking function to `awake`).

// The screen's refresh as this page gets it, from a run of frame intervals: their median (frame timestamps jitter, so
// the shortest interval can be far below the real one: 5 ms at 60 Hz on an iPhone, measured), snapped to the nearest
// common screen rate. 30 Hz counts: some browsers run animation at 30 (Chrome on iOS does, measured).
const RATES = [144, 120, 90, 75, 60, 50, 30].map((hz) => 1000 / hz);
/** @param {number[]} gaps frame intervals, ms */
export function refreshFrom(gaps) {
  const g = gaps.filter((x) => x > 2 && x < 200).sort((a, b) => a - b);
  if (g.length < 5) return 1000 / 60;
  const med = g[Math.floor(g.length / 2)];
  return RATES.reduce((best, r) => (Math.abs(r - med) < Math.abs(best - med) ? r : best), RATES[0]);
}

// One clock for every figure: animation reads it, not the frame's own timestamp, so a test or a tool can slow time or
// stop it and step it (LK3D.clock.speed = 0; LK3D.clock.step(100)) and draw every transition frame by frame, or set
// it to a time (clock.set(ms), backwards too: a video seeking its own timeline)
/** @type {Set<(was: number) => void>} the figures on the page, woken when the clock is stepped or set */
export const awake = new Set();
let clockT = 0,
  wall = 0,
  speed = 1;
export const clock = {
  now() {
    const w = performance.now();
    clockT += (w - (wall || w)) * speed;
    wall = w;
    return clockT;
  },
  get speed() {
    return speed;
  },
  set speed(v) {
    clock.now();
    speed = Math.max(0, +v || 0);
  },
  /** @param {number} ms */
  step(ms) {
    clock.set(clock.now() + ms);
  },
  /** @param {number} ms */
  set(ms) {
    const was = clock.now();
    clockT = +ms || 0;
    for (const k of awake) k(was);
  },
};
