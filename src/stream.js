// Streams: air, gas or liquid as a volume moving along a path (a jet leaving a nozzle, air drawn into an intake, blood
// in a vessel). The GPU draws it (shaders.js STREAM_FS) as a density field inside a tube round the path: filaments
// carried downstream, broken into runs, stirred by turbulence and rolled up towards the edge, coloured by a ramp along
// the path, fading in and out at its ends. Here: the path's points with their distance along it, the radius profile (an
// annulus when it has an inner radius: a bypass duct), the speed along the path, and the hull, a tube a little wider
// than the stream, that the shader is drawn on.
//
// The air is moved by its travel time, not its distance: a filament at distance s has been on its way for
// tau(s) = integral of ds / u(s), and the field is drawn at tau(s) - t. So it speeds up where the stream narrows and
// slows where it widens (by continuity, speed times area stays the same, unless `speeds` says otherwise), stretching
// as it speeds up, and it never runs backwards. The turbulence changes as the air travels, not as the clock runs: a
// stream that stops, stops changing.
import { sub, len, norm, cross, add, mulv, dot, carry } from './math.js';

export const MAX_POINTS = 16, // points of a path (uniforms)
  TABLE_SAMPLES = 24; // samples of the table along the path: inner radius, outer radius, travel time (uniforms)

// stops [[f, a, b…], …] along the path (f from 0 at its start to 1 at its end): the values at f, linear between stops
export function at(stops, f) {
  let k = 0;
  while (k + 2 < stops.length && f > stops[k + 1][0]) k++;
  const before = stops[k],
    after = stops[Math.min(k + 1, stops.length - 1)],
    weight = after[0] > before[0] ? Math.max(0, Math.min(1, (f - before[0]) / (after[0] - before[0]))) : 0;
  return before.slice(1).map((value, i) => value + (after[i + 1] - value) * weight);
}
// radius: a number, or stops [[f, rOut], …] or [[f, rIn, rOut], …]; as stops [f, rIn, rOut]
const profile = (radius) =>
  (typeof radius === 'number' ? [[0, radius]] : radius?.length ? radius : [[0, 0.1]]).map((stop) =>
    stop.length > 2 ? stop : [stop[0], 0, stop[1]],
  );
export const radiusAt = at;

export function makeStream(options = {}) {
  const path = (options.path || []).filter((point, k, all) => k === 0 || len(sub(point, all[k - 1])) > 1e-9); // (repeats left out)
  if (path.length < 2) throw new Error('lk3d: a stream needs a path of two points or more');
  if (path.length > MAX_POINTS)
    throw new Error(`lk3d: a stream's path has at most ${MAX_POINTS} points (this one has ${path.length})`);
  const distances = [0];
  for (let k = 1; k < path.length; k++) distances.push(distances[k - 1] + len(sub(path[k], path[k - 1])));
  const total = distances[distances.length - 1] || 1,
    radii = profile(options.radius),
    pointTable = new Float32Array(MAX_POINTS * 4),
    table = new Float32Array(TABLE_SAMPLES * 3),
    area = (f) => {
      const [inner, outer] = at(radii, f);
      return Math.max(1e-6, outer * outer - inner * inner);
    },
    // the speed along the path, as a fraction of `speed`: given, or by continuity (1 at the start)
    speedAt = (f) => Math.min(20, Math.max(0.05, options.speeds ? at(options.speeds, f)[0] : area(0) / area(f)));
  path.forEach((point, k) => pointTable.set([point[0], point[1], point[2], distances[k]], 4 * k));
  for (let k = 0, tau = 0; k < TABLE_SAMPLES; k++) {
    if (k)
      for (let j = 0; j < 8; j++)
        tau += total / (TABLE_SAMPLES - 1) / 8 / speedAt((k - 1 + (j + 0.5) / 8) / (TABLE_SAMPLES - 1));
    table.set([...at(radii, k / (TABLE_SAMPLES - 1)), tau], 3 * k);
  }
  // the hull: rings round the path, a quarter wider than the stream there, closed at both ends
  const hullPositions = [],
    hullIndices = [],
    SIDES = 14,
    rings = [];
  /** @type {number[] | null} */
  let normal = null,
    /** @type {number[] | null} */
    previousTangent = null;
  for (let k = 0; k + 1 < path.length; k++) {
    // the frame round the path, carried from one segment to the next (so the rings do not twist at a bend)
    const tangent = norm(sub(path[k + 1], path[k]));
    const carried = normal && previousTangent && carry(normal, previousTangent, tangent);
    normal = carried
      ? norm(sub(carried, mulv(tangent, dot(carried, tangent))))
      : norm(Math.abs(tangent[1]) < 0.9 ? cross(tangent, [0, 1, 0]) : cross(tangent, [1, 0, 0]));
    previousTangent = tangent;
    const binormal = cross(tangent, normal),
      ringCount = Math.max(
        1,
        Math.min(
          24,
          Math.ceil((distances[k + 1] - distances[k]) / (radiusAt(radii, distances[k] / total)[1] * 0.6 || 1)),
        ),
      );
    for (let j = k ? 1 : 0; j <= ringCount; j++) {
      const ringCenter = add(path[k], mulv(sub(path[k + 1], path[k]), j / ringCount)),
        radius =
          radiusAt(radii, (distances[k] + ((distances[k + 1] - distances[k]) * j) / ringCount) / total)[1] * 1.25 +
          1e-3;
      // at a bend, the ring lies in the plane halving it (a mitre), so the two segments' tubes meet without overlap
      let mitre =
        j === ringCount && k + 2 < path.length ? norm(add(tangent, norm(sub(path[k + 2], path[k + 1])))) : tangent;
      if (dot(tangent, mitre) < 0.1) mitre = tangent; // (a path doubling back has no plane halving its turn)
      rings.push(hullPositions.length / 3);
      for (let side = 0; side < SIDES; side++) {
        const angle = (side / SIDES) * 2 * Math.PI,
          offset = add(mulv(normal, radius * Math.cos(angle)), mulv(binormal, radius * Math.sin(angle)));
        hullPositions.push(...add(add(ringCenter, offset), mulv(tangent, -dot(offset, mitre) / dot(tangent, mitre))));
      }
    }
  }
  for (let k = 0; k + 1 < rings.length; k++)
    for (let side = 0; side < SIDES; side++) {
      const a = rings[k] + side,
        b = rings[k] + ((side + 1) % SIDES),
        c = rings[k + 1] + side,
        d = rings[k + 1] + ((side + 1) % SIDES);
      hullIndices.push(a, b, c, b, d, c); // (faces out: the shader is drawn on the far side, the back faces)
    }
  for (const [ring, tip, atEnd] of [
    [rings[0], path[0], false],
    [rings[rings.length - 1], path[path.length - 1], true],
  ]) {
    const tipIndex = hullPositions.length / 3;
    hullPositions.push(...tip);
    for (let side = 0; side < SIDES; side++)
      hullIndices.push(
        tipIndex,
        ring + (atEnd ? side : (side + 1) % SIDES),
        ring + (atEnd ? (side + 1) % SIDES : side),
      );
  }
  const stream = {
    pointTable,
    pointCount: path.length,
    total,
    radii,
    table,
    scale: 11 / Math.max(...radii.map((stop) => stop[2])), // the field's size along the path
    hull: { positions: new Float32Array(hullPositions), indices: new Uint16Array(hullIndices) },
    center: mulv(path.reduce(add, [0, 0, 0]), 1 / path.length), // (streams are drawn far to near by it)
    box: [0, 1, 2].map((axis) =>
      [0, 1].map((isMax) =>
        hullPositions.filter((_, k) => k % 3 === axis).reduce((x, y) => (isMax ? Math.max(x, y) : Math.min(x, y))),
      ),
    ), // (the hull's bounds: how far a ray marches)
    reach: Math.max(...radii.map((stop) => stop[2])) * 2.6, // how far a ray may cross it
    speed: options.speed ?? 0,
    density: options.density ?? 1,
    turbulence: options.turbulence ?? 0.5,
    swirl: options.swirl ?? 0.5,
    fade: options.fade ?? 0.7,
    ramp: options.ramp,
    visible: true,
    phase: 0,
    step(dt) {
      stream.phase = (stream.phase + stream.speed * dt) % 3000; // (kept small for the GPU's precision: a rare jump in the pattern)
    },
  };
  return stream;
}
