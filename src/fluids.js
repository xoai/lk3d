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
  let volume = 0;
  for (let k = 0; k + 1 < inside.length; k++) {
    const [h0, r0] = inside[k],
      [h1, r1] = inside[k + 1];
    if (h <= h0 || h1 <= h0) continue;
    const top = Math.min(h, h1),
      topRadius = r0 + ((r1 - r0) * (top - h0)) / (h1 - h0);
    volume += (Math.PI * (top - h0) * (r0 * r0 + r0 * topRadius + topRadius * topRadius)) / 3;
  }
  return volume;
}
export const capacity = (inside) => volumeBelow(inside, inside[inside.length - 1][0]);
// the height at which the volume below is the given one (held at the bottom and the brim): by halving, the volume
// growing with height
export function heightOf(inside, volume) {
  let low = inside[0][0],
    high = inside[inside.length - 1][0];
  if (volume <= 0) return low;
  if (volume >= capacity(inside)) return high;
  for (let k = 0; k < 48; k++) {
    const middle = (low + high) / 2;
    if (volumeBelow(inside, middle) < volume) low = middle;
    else high = middle;
  }
  return (low + high) / 2;
}
// the inside's radius at height h
export function radiusAt(inside, h) {
  let segment = 0;
  while (segment + 2 < inside.length && h > inside[segment + 1][0]) segment++;
  const [h0, r0] = inside[segment],
    [h1, r1] = inside[segment + 1];
  return h1 > h0 ? r0 + (r1 - r0) * Math.max(0, Math.min(1, (h - h0) / (h1 - h0))) : r0;
}
// liquids in one vessel, stacked as they settle: the densest at the bottom; each one's bottom and top height
export function stack(inside, liquids) {
  let volume = 0;
  return liquids
    .slice()
    .sort((a, b) => b.density - a.density)
    .map((liquid) => {
      const bottom = heightOf(inside, volume);
      volume += liquid.volume;
      return { liquid, bottom, top: heightOf(inside, volume) };
    });
}
// the outline a lathe turns into the body of liquid (or gas) from h0 to h1 in this inside: from the axis up the wall and
// back, a hair inside it (so it does not flicker against the glass)
export function body(inside, h0, h1) {
  if (h1 - h0 < 1e-9) return null;
  const inset = 0.985,
    wall = [[h0, radiusAt(inside, h0) * inset]];
  for (const [h, r] of inside) if (h > h0 && h < h1) wall.push([h, r * inset]);
  wall.push([h1, radiusAt(inside, h1) * inset]);
  return [[h0, 0], ...wall, [h1, 0]];
}
// Torricelli: the volume a second through an outlet of the given radius, a depth below the surface (cd: how much of
// the hole the stream fills, about 0.6 for a sharp-edged one); g in the same units as radius and depth
export const outflow = (radius, depth, g, cd = 0.6) =>
  depth > 0 ? cd * Math.PI * radius * radius * Math.sqrt(2 * g * depth) : 0;
// the stream falling from a start point with a velocity (a projectile under g, downwards), until it is at height yEnd:
// its points and its radius at each, which narrows as it speeds up (continuity: r² × speed stays the same)
export function jet(start, velocity, startRadius, g, yEnd, steps = 12) {
  const vy = velocity[1],
    // the time it takes to fall to yEnd: start.y + vy·t − g·t²/2 = yEnd
    fallTime = (vy + Math.sqrt(Math.max(0, vy * vy + 2 * g * (start[1] - yEnd)))) / g,
    startSpeed = Math.hypot(...velocity) || 1e-9,
    points = [];
  for (let k = 0; k <= steps; k++) {
    const t = (fallTime * k) / steps,
      velocityNow = [velocity[0], vy - g * t, velocity[2]];
    points.push([
      start[0] + velocity[0] * t,
      start[1] + vy * t - (g * t * t) / 2,
      start[2] + velocity[2] * t,
      startRadius * Math.sqrt(startSpeed / Math.hypot(...velocityNow)),
    ]);
  }
  return points;
}
// the ideal gas (pV = nRT): the height a free piston rests at over some moles at a temperature (kelvin), under a
// pressure outside (pascals) and a piston of mass kg (its weight over the inside's area there adds to the pressure)
export function pistonHeight(inside, moles, temperature, pressure, mass, unitsPerMetre) {
  let height = heightOf(inside, ((moles * RGAS * temperature) / pressure) * unitsPerMetre ** 3);
  // (the piston's weight: a little more pressure, so a little less volume; settled in a few steps)
  for (let k = 0; mass && k < 8; k++) {
    const area = Math.PI * (radiusAt(inside, height) / unitsPerMetre) ** 2;
    height = heightOf(inside, ((moles * RGAS * temperature) / (pressure + (mass * G) / area)) * unitsPerMetre ** 3);
  }
  return height;
}
// a buoyant plume from a small source (Morton, Taylor and Turner): it widens as it rises, its radius growing about 0.12
// for each unit of height, and slows, its speed falling as height to the power −1/3. As a stream's path, radius and
// speeds (relative to the speed where it leaves the source)
export function plume(at, height, sourceRadius) {
  const pointSourceDepth = sourceRadius / 0.12, // (where a point source would be, below the real one)
    stops = [0, 0.25, 0.5, 1];
  return {
    path: [at, [at[0], at[1] + height, at[2]]],
    radius: stops.map((fraction) => [fraction, sourceRadius + 0.12 * fraction * height]),
    speeds: stops.map((fraction) => [fraction, Math.cbrt(pointSourceDepth / (pointSourceDepth + fraction * height))]),
  };
}

// ---- the scene's fluids as the engine and the check use them
// its vessels by id, its liquids and gases with their state (a liquid's volume; a gas's moles, temperature, outside
// pressure), g in scene units, and unitsPerMetre, scene units in a metre
export function fluidsOf(spec) {
  const unitsPerMetre = UNITS[spec.unit || 'm'],
    vessels = new Map((spec.vessels || []).map((vessel) => [vessel.id, { at: [0, 0, 0], ...vessel }]));
  return {
    unitsPerMetre,
    g: G * unitsPerMetre,
    vessels,
    liquids: (spec.liquids || []).map((liquid) => ({ density: 1, ...liquid, volume: liquid.volume ?? 0 })),
    gases: (spec.gases || []).map((gas) => ({ p: 101325, mass: 0, ...gas })),
  };
}
// a body of liquid or gas from h0 to h1 in a vessel, as a shape: the lathe of its outline, stood upright at the vessel
export function shapeOf(vessel, h0, h1) {
  const outline = body(vessel.inside, h0, h1);
  return outline && { lathe: outline, rot: [0, 0, 90], at: vessel.at };
}
// every liquid's and gas's body now, by part: liquids stacked in their vessels by density, each gas up to its piston
// (where it rests, or its height in gasHeights while it moves; and each gas's height, for its piston)
export function bodies(fluids, gasHeights) {
  const shapes = new Map(),
    heights = new Map();
  for (const vessel of fluids.vessels.values()) {
    const held = fluids.liquids.filter((liquid) => liquid.in === vessel.id && liquid.volume > 0);
    for (const layer of stack(vessel.inside, held))
      shapes.set(layer.liquid.part, shapeOf(vessel, layer.bottom, layer.top));
  }
  for (const liquid of fluids.liquids) if (!shapes.has(liquid.part)) shapes.set(liquid.part, null);
  for (const gas of fluids.gases) {
    const vessel = fluids.vessels.get(gas.in),
      height =
        gasHeights?.get(gas.part) ?? pistonHeight(vessel.inside, gas.n, gas.T, gas.p, gas.mass, fluids.unitsPerMetre); // (where it is now, if moving)
    heights.set(gas.part, height);
    shapes.set(gas.part, shapeOf(vessel, vessel.inside[0][0], height));
  }
  return { shapes, heights };
}
