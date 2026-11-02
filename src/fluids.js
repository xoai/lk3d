// Liquids and gases by their laws, not by simulation: what a teacher writes on the board, worked out for the vessel the
// scene draws. Shared by the engine (which moves and draws them) and the check (which tests them); pure functions,
// every one tested against its closed form.
//   vessels: [{ id, part, at, inside: [[h, r], …], outlet: { radius, tip, dir, valve, cd } }]
//   liquids: [{ part, in, volume, density, into }]      gases: [{ part, in, piston, n, T, p, mass }]
// Heights are along the vertical through `at` (gravity is down, so a liquid's surface is level); lengths in scene
// units, which the scene's `unit` turns into metres (g and R are SI).
export const G = 9.81, // m/s²
  RGAS = 8.314, // J/(mol·K)
  UNITS = { mm: 1000, cm: 100, dm: 10, m: 1, km: 0.001 }; // scene units in a metre

// the volume of a vessel's inside below height h: the frustums between its points (a straight wall between two)
export function volumeBelow(inside, h) {
  let v = 0;
  for (let k = 0; k + 1 < inside.length; k++) {
    const [h0, r0] = inside[k],
      [h1, r1] = inside[k + 1];
    if (h <= h0 || h1 <= h0) continue;
    const t = Math.min(h, h1),
      rt = r0 + ((r1 - r0) * (t - h0)) / (h1 - h0);
    v += (Math.PI * (t - h0) * (r0 * r0 + r0 * rt + rt * rt)) / 3;
  }
  return v;
}
export const capacity = (inside) => volumeBelow(inside, inside[inside.length - 1][0]);
// the height at which the volume below is v (held at the bottom and the brim): by halving, the volume growing with h
export function heightOf(inside, v) {
  let lo = inside[0][0],
    hi = inside[inside.length - 1][0];
  if (v <= 0) return lo;
  if (v >= capacity(inside)) return hi;
  for (let k = 0; k < 48; k++) {
    const m = (lo + hi) / 2;
    if (volumeBelow(inside, m) < v) lo = m;
    else hi = m;
  }
  return (lo + hi) / 2;
}
// the inside's radius at height h
export function radiusAt(inside, h) {
  let k = 0;
  while (k + 2 < inside.length && h > inside[k + 1][0]) k++;
  const [h0, r0] = inside[k],
    [h1, r1] = inside[k + 1];
  return h1 > h0 ? r0 + (r1 - r0) * Math.max(0, Math.min(1, (h - h0) / (h1 - h0))) : r0;
}
// liquids in one vessel, stacked as they settle: the densest at the bottom; each one's bottom and top height
export function stack(inside, liquids) {
  let v = 0;
  return liquids
    .slice()
    .sort((a, b) => b.density - a.density)
    .map((l) => {
      const h0 = heightOf(inside, v);
      v += l.volume;
      return { l, h0, h1: heightOf(inside, v) };
    });
}
// the outline a lathe turns into the body of liquid (or gas) from h0 to h1 in this inside: from the axis up the wall and
// back, a hair inside it (so it does not flicker against the glass)
export function body(inside, h0, h1) {
  if (h1 - h0 < 1e-9) return null;
  const k = 0.985,
    wall = [[h0, radiusAt(inside, h0) * k]];
  for (const [h, r] of inside) if (h > h0 && h < h1) wall.push([h, r * k]);
  wall.push([h1, radiusAt(inside, h1) * k]);
  return [[h0, 0], ...wall, [h1, 0]];
}
// Torricelli: the volume a second through an outlet of radius a, H below the surface (cd: how much of the hole the
// stream fills, about 0.6 for a sharp-edged one); g in the same units as a and H
export const outflow = (a, H, g, cd = 0.6) => (H > 0 ? cd * Math.PI * a * a * Math.sqrt(2 * g * H) : 0);
// the stream falling from point p with velocity v (a projectile under g, downwards), until it is at height yEnd: its
// points and its radius at each, which narrows as it speeds up (continuity: r² × speed stays the same)
export function jet(p, v, r0, g, yEnd, n = 12) {
  const vy = v[1],
    // the time it takes to fall to yEnd: p.y + vy·t − g·t²/2 = yEnd
    T = (vy + Math.sqrt(Math.max(0, vy * vy + 2 * g * (p[1] - yEnd)))) / g,
    s0 = Math.hypot(...v) || 1e-9,
    out = [];
  for (let k = 0; k <= n; k++) {
    const t = (T * k) / n,
      w = [v[0], vy - g * t, v[2]];
    out.push([
      p[0] + v[0] * t,
      p[1] + vy * t - (g * t * t) / 2,
      p[2] + v[2] * t,
      r0 * Math.sqrt(s0 / Math.hypot(...w)),
    ]);
  }
  return out;
}
// the ideal gas: the height a free piston rests at over n moles at T kelvin, under p pascals outside and a piston of
// mass kg (its weight over the inside's area there adds to the pressure); m: scene units in a metre
export function pistonHeight(inside, n, T, p, mass, m) {
  let h = heightOf(inside, ((n * RGAS * T) / p) * m ** 3);
  // (the piston's weight: a little more pressure, so a little less volume; settled in a few steps)
  for (let k = 0; mass && k < 8; k++) {
    const A = Math.PI * (radiusAt(inside, h) / m) ** 2;
    h = heightOf(inside, ((n * RGAS * T) / (p + (mass * G) / A)) * m ** 3);
  }
  return h;
}
// a buoyant plume from a small source (Morton, Taylor and Turner): it widens as it rises, its radius growing about 0.12
// for each unit of height, and slows, its speed falling as height to the power −1/3. As a stream's path, radius and
// speeds (relative to the speed where it leaves the source)
export function plume(at, height, r0) {
  const z0 = r0 / 0.12, // (where a point source would be, below the real one)
    stops = [0, 0.25, 0.5, 1];
  return {
    path: [at, [at[0], at[1] + height, at[2]]],
    radius: stops.map((f) => [f, r0 + 0.12 * f * height]),
    speeds: stops.map((f) => [f, Math.cbrt(z0 / (z0 + f * height))]),
  };
}

// ---- the scene's fluids as the engine and the check use them
// its vessels by id, its liquids and gases with their state (a liquid's volume; a gas's moles, temperature, outside
// pressure), g in scene units, and m, scene units in a metre
export function fluidsOf(spec) {
  const m = UNITS[spec.unit || 'm'],
    vessels = new Map((spec.vessels || []).map((v) => [v.id, { at: [0, 0, 0], ...v }]));
  return {
    m,
    g: G * m,
    vessels,
    liquids: (spec.liquids || []).map((l) => ({ density: 1, ...l, volume: l.volume ?? 0 })),
    gases: (spec.gases || []).map((x) => ({ p: 101325, mass: 0, ...x })),
  };
}
// a body of liquid or gas from h0 to h1 in a vessel, as a shape: the lathe of its outline, stood upright at the vessel
export function shapeOf(v, h0, h1) {
  const o = body(v.inside, h0, h1);
  return o && { lathe: o, rot: [0, 0, 90], at: v.at };
}
// every liquid's and gas's body now, by part: liquids stacked in their vessels by density, each gas up to its piston
// (where it rests, or gasH's height while it moves; and each gas's height, for its piston)
export function bodies(F, gasH) {
  const out = new Map(),
    heights = new Map();
  for (const v of F.vessels.values()) {
    const here = F.liquids.filter((l) => l.in === v.id && l.volume > 0);
    for (const s of stack(v.inside, here)) out.set(s.l.part, shapeOf(v, s.h0, s.h1));
  }
  for (const l of F.liquids) if (!out.has(l.part)) out.set(l.part, null);
  for (const x of F.gases) {
    const v = F.vessels.get(x.in),
      h = gasH?.get(x.part) ?? pistonHeight(v.inside, x.n, x.T, x.p, x.mass, F.m); // (where it is now, if moving)
    heights.set(x.part, h);
    out.set(x.part, shapeOf(v, v.inside[0][0], h));
  }
  return { out, heights };
}
