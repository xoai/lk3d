// @ts-check
// The clock every figure animates by, and the screen's refresh rate measured from frame intervals. Shared by all the
// figures on a page; reads nothing from them (each mounted figure adds its waking function to `awake`).

// The screen's refresh as this page gets it, from a run of frame intervals: their median (frame timestamps jitter, so
// the shortest interval can be far below the real one: 5 ms at 60 Hz on an iPhone, measured), snapped to the nearest
// common screen rate. 30 Hz counts: some browsers run animation at 30 (Chrome on iOS does, measured).
const RATES = [144, 120, 90, 75, 60, 50, 30].map((hz) => 1000 / hz);
/** @param {number[]} gaps frame intervals, ms */
export function refreshFrom(gaps) {
  const kept = gaps.filter((gap) => gap > 2 && gap < 200).sort((a, b) => a - b);
  if (kept.length < 5) return 1000 / 60;
  const median = kept[Math.floor(kept.length / 2)];
  return RATES.reduce((best, rate) => (Math.abs(rate - median) < Math.abs(best - median) ? rate : best), RATES[0]);
}

// One clock for every figure: animation reads it, not the frame's own timestamp, so a test or a tool can slow time or
// stop it and step it (LK3D.clock.speed = 0; LK3D.clock.step(100)) and draw every transition frame by frame, or set
// it to a time (clock.set(ms), backwards too: a video seeking its own timeline)
/** @type {Set<(was: number) => void>} the figures on the page, woken when the clock is stepped or set */
export const awake = new Set();
let clockTime = 0,
  lastWall = 0,
  speed = 1;
export const clock = {
  now() {
    const wall = performance.now();
    clockTime += (wall - (lastWall || wall)) * speed;
    lastWall = wall;
    return clockTime;
  },
  get speed() {
    return speed;
  },
  set speed(value) {
    clock.now();
    speed = Math.max(0, +value || 0);
  },
  /** @param {number} ms */
  step(ms) {
    clock.set(clock.now() + ms);
  },
  /** @param {number} ms */
  set(ms) {
    const was = clock.now();
    clockTime = +ms || 0;
    for (const wake of awake) wake(was);
  },
};
