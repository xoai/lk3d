// Flow: streaks that run along paths (air through an engine, blood along a vessel, water round a bend), each a thin
// ribbon that fades from its head to its tail and takes its colour from a ramp along the path (cool at the intake,
// hot at the exhaust). Their geometry is made here on the CPU, every frame they move; a renderer only widens them on
// screen and blends them. pathOf() is also what particles along a path use.
import { sub, mulv, len, rgb } from './math.js';

// a polyline measured by its length: at(distance) is the point that far along it; into(distance, out, offset) writes
// it into out[offset..offset+2] (without making an array: thousands of streaks are placed every frame)
export function pathOf(points, closed = false) {
  const path = points.length > 1 ? points : [points[0], points[0]],
    segments = [];
  let total = 0;
  for (let k = 0; k + 1 < path.length + (closed ? 1 : 0); k++) {
    const start = path[k],
      end = path[(k + 1) % path.length],
      length = len(sub(end, start));
    segments.push([start, end, length, total]);
    total += length;
  }
  const into = (distance, out, offset) => {
    // the segment the distance falls in: the last that starts at or before it (halving: a field line may have hundreds)
    let k = 0,
      last = segments.length - 1;
    while (k < last) {
      const middle = (k + last + 1) >> 1;
      if (segments[middle][3] <= distance) k = middle;
      else last = middle - 1;
    }
    const [start, end, length, startDistance] = segments[k],
      t = length ? Math.max(0, Math.min(1, (distance - startDistance) / length)) : 0;
    for (let j = 0; j < 3; j++) out[offset + j] = start[j] + (end[j] - start[j]) * t;
  };
  return {
    total,
    into,
    at(distance) {
      const point = [0, 0, 0];
      into(distance, point, 0);
      return point;
    },
  };
}

// Colour ramps, four stops from the start of a path to its end. On a light page a colour reads by its saturation, so
// the light-page ramps end in a strong colour; white, which would vanish into the paper, ends only the dark ones.
const RAMPS = {
  heat: [
    ['#7c2414', '#d0561d', '#efab22'],
    ['#8a2a16', '#e0561f', '#ffb02e', '#fff2c8'],
  ],
  cool: [
    ['#1d4b86', '#4d9bd8'],
    ['#2b5d9e', '#8cc4f2', '#e3f3ff'],
  ],
};
// a ramp (a preset's name, one colour or a list of them) as four evenly spaced colours, for a light or a dark page
export function ramp(given, dark) {
  const stops =
    typeof given === 'string' && RAMPS[given]
      ? RAMPS[given][dark ? 1 : 0]
      : given
        ? [].concat(given)
        : RAMPS.cool[dark ? 1 : 0];
  const colors = stops.map(rgb);
  return [0, 1, 2, 3].map((i) => {
    const position = (i / 3) * (colors.length - 1),
      k = Math.min(Math.max(0, colors.length - 2), Math.floor(position)),
      fraction = position - k,
      lower = colors[k],
      upper = colors[Math.min(colors.length - 1, k + 1)];
    return lower.map((value, j) => value + (upper[j] - value) * fraction);
  });
}
// the colour a ramp gives at t (0: the path's start, 1: its end), as the shader works it out
export function rampAt(colors, t) {
  const position = Math.max(0, Math.min(1, t)) * 3,
    k = Math.min(2, Math.floor(position)),
    fraction = position - k;
  return colors[k].map((value, j) => value + (colors[k + 1][j] - value) * fraction);
}

// a streak's fixed random numbers (the same every time: pictures can be compared)
const random = (streak, which) => {
  const x = Math.sin(streak * 12.9898 + which * 78.233) * 43758.5453;
  return x - Math.floor(x);
};
const unit = (streak, which) => {
  const vector = [random(streak, which) - 0.5, random(streak, which + 1) - 0.5, random(streak, which + 2) - 0.5],
    length = len(vector) || 1;
  return mulv(vector, 1 / length);
};
export const STREAK_POINTS = 4; // points along a streak: three segments, enough to bend round a curve
export const STRIDE = 9; // floats a vertex: x, y, z, side (±1); a direction along the streak, t on the ramp; alpha
export const MAX_STREAKS = 8000; // streaks in one flow (their vertices fit 16-bit indices)

// A flow's state and geometry. update(m) writes the first drawnCount streaks (count × amount) into vertices, placed by the
// matrix m of the part that carries them (or none); step(dt) moves them on.
export function makeFlow(options = {}) {
  const lines = options.paths || (options.path ? [options.path] : []);
  if (!lines.length || !lines[0].length) throw new Error('lk3d: a flow needs a path');
  const paths = lines.map((line) => pathOf(line, !!options.closed)),
    count = Math.max(1, Math.min(MAX_STREAKS, Math.round(options.count ?? 300)));
  const flow = {
    count,
    closed: !!options.closed,
    speed: options.speed ?? 0,
    amount: options.amount ?? 1,
    length: options.length ?? 0.12,
    width: options.width ?? 1.6,
    spread: options.spread ?? 0,
    opacity: options.opacity ?? 0.85,
    ramp: options.ramp,
    visible: true,
    travelled: 0,
    drawnCount: 0,
    vertices: new Float32Array(count * STREAK_POINTS * 2 * STRIDE),
    // each streak: its path, where it starts, how fast it goes, and how it wanders round the path
    seeds: Array.from({ length: count }, (_, i) => ({
      path: paths[i % paths.length],
      start: random(i, 1),
      pace: 0.8 + 0.4 * random(i, 2),
      offset: mulv(unit(i, 3), Math.sqrt(random(i, 6))),
      wobble: mulv(unit(i, 7), 0.5),
      phase: random(i, 10) * 6.2832,
      turns: 1 + 2 * random(i, 11),
    })),
    step(dt) {
      flow.travelled += flow.speed * dt;
    },
    update(m) {
      const drawnCount = (flow.drawnCount = Math.round(flow.count * Math.max(0, Math.min(1, flow.amount)))),
        vertices = flow.vertices,
        points = new Float64Array(STREAK_POINTS * 3), // (one small array a frame: nothing a streak)
        point = new Float64Array(3);
      for (let i = 0; i < drawnCount; i++) {
        const seed = flow.seeds[i],
          pathLength = seed.path.total,
          streakLength = flow.length * pathLength,
          head = pathLength
            ? (((seed.start * pathLength + flow.travelled * seed.pace) % pathLength) + pathLength) % pathLength
            : 0;
        for (let k = 0; k < STREAK_POINTS; k++) {
          let distance = head - (streakLength * k) / (STREAK_POINTS - 1);
          if (flow.closed) distance = ((distance % pathLength) + pathLength) % pathLength;
          else distance = Math.max(0, distance);
          const along = pathLength ? distance / pathLength : 0,
            wave = Math.sin(seed.phase + 6.2832 * seed.turns * along),
            // fading from head to tail, and in and out at an open path's ends (no streak pops into or out of sight)
            ends = flow.closed ? 1 : Math.max(0, Math.min(1, along / 0.06, (1 - along) / 0.06));
          seed.path.into(distance, point, 0);
          for (let j = 0; j < 3; j++) point[j] += (seed.offset[j] + seed.wobble[j] * wave) * flow.spread;
          for (let j = 0; j < 3; j++)
            points[3 * k + j] = m ? m[j] * point[0] + m[4 + j] * point[1] + m[8 + j] * point[2] + m[12 + j] : point[j];
          for (let side = 0; side < 2; side++) {
            const vertex = ((i * STREAK_POINTS + k) * 2 + side) * STRIDE;
            vertices[vertex + 3] = side ? 1 : -1;
            vertices[vertex + 7] = along;
            vertices[vertex + 8] = (1 - k / (STREAK_POINTS - 1)) * ends;
          }
        }
        // each point's place, and the streak's direction there (towards the head)
        for (let k = 0; k < STREAK_POINTS; k++) {
          const behind = 3 * Math.max(0, k - 1),
            ahead = 3 * Math.min(STREAK_POINTS - 1, k + 1);
          for (let side = 0; side < 2; side++) {
            const vertex = ((i * STREAK_POINTS + k) * 2 + side) * STRIDE;
            for (let j = 0; j < 3; j++) {
              vertices[vertex + j] = points[3 * k + j];
              vertices[vertex + 4 + j] = points[behind + j] - points[ahead + j];
            }
          }
        }
      }
    },
  };
  return flow;
}

// the triangles of that many streaks: two a segment
export function flowIndices(streakCount) {
  const indices = new Uint16Array(streakCount * (STREAK_POINTS - 1) * 6);
  let offset = 0;
  for (let i = 0; i < streakCount; i++)
    for (let k = 0; k < STREAK_POINTS - 1; k++) {
      const first = (i * STREAK_POINTS + k) * 2;
      indices.set([first, first + 1, first + 2, first + 1, first + 3, first + 2], offset);
      offset += 6;
    }
  return indices;
}
