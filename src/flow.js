// Flow: streaks that run along paths (air through an engine, blood along a vessel, water round a bend), each a thin
// ribbon that fades from its head to its tail and takes its colour from a ramp along the path (cool at the intake,
// hot at the exhaust). Their geometry is made here on the CPU, every frame they move; a renderer only widens them on
// screen and blends them. pathOf() is also what particles along a path use.
import { sub, mulv, len, rgb } from './math.js';

// a polyline measured by its length: at(s) is the point s along it; into(s, out, o) writes it into out[o..o+2]
// (without making an array: thousands of streaks are placed every frame)
export function pathOf(points, closed = false) {
  const P = points.length > 1 ? points : [points[0], points[0]],
    segs = [];
  let total = 0;
  for (let k = 0; k + 1 < P.length + (closed ? 1 : 0); k++) {
    const a = P[k],
      b = P[(k + 1) % P.length],
      l = len(sub(b, a));
    segs.push([a, b, l, total]);
    total += l;
  }
  const into = (s, out, o) => {
    let k = 0;
    while (k < segs.length - 1 && s > segs[k][3] + segs[k][2]) k++;
    const [a, b, l, s0] = segs[k],
      t = l ? Math.max(0, Math.min(1, (s - s0) / l)) : 0;
    for (let j = 0; j < 3; j++) out[o + j] = a[j] + (b[j] - a[j]) * t;
  };
  return {
    total,
    into,
    at(s) {
      const p = [0, 0, 0];
      into(s, p, 0);
      return p;
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
export function ramp(r, dark) {
  const stops =
    typeof r === 'string' && RAMPS[r] ? RAMPS[r][dark ? 1 : 0] : r ? [].concat(r) : RAMPS.cool[dark ? 1 : 0];
  const c = stops.map(rgb);
  return [0, 1, 2, 3].map((i) => {
    const x = (i / 3) * (c.length - 1),
      k = Math.min(Math.max(0, c.length - 2), Math.floor(x)),
      f = x - k,
      a = c[k],
      b = c[Math.min(c.length - 1, k + 1)];
    return a.map((v, j) => v + (b[j] - v) * f);
  });
}
// the colour a ramp gives at t (0: the path's start, 1: its end), as the shader works it out
export function rampAt(r4, t) {
  const x = Math.max(0, Math.min(1, t)) * 3,
    k = Math.min(2, Math.floor(x)),
    f = x - k;
  return r4[k].map((v, j) => v + (r4[k + 1][j] - v) * f);
}

// a streak's fixed random numbers (the same every time: pictures can be compared)
const rnd = (i, k) => {
  const x = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
  return x - Math.floor(x);
};
const unit = (i, k) => {
  const v = [rnd(i, k) - 0.5, rnd(i, k + 1) - 0.5, rnd(i, k + 2) - 0.5],
    l = len(v) || 1;
  return mulv(v, 1 / l);
};
export const PTS = 4; // points along a streak: three segments, enough to bend round a curve
export const STRIDE = 9; // floats a vertex: x, y, z, side (±1); a direction along the streak, t on the ramp; alpha
export const MAX = 8000; // streaks in one flow (their vertices fit 16-bit indices)

// A flow's state and geometry. update(m) writes the first n streaks (n = count × amount) into verts, placed by the
// matrix m of the part that carries them (or none); step(dt) moves them on.
export function makeFlow(o = {}) {
  const lines = o.paths || (o.path ? [o.path] : []);
  if (!lines.length || !lines[0].length) throw new Error('lk3d: a flow needs a path');
  const paths = lines.map((p) => pathOf(p, !!o.closed)),
    count = Math.max(1, Math.min(MAX, Math.round(o.count ?? 300)));
  const F = {
    count,
    closed: !!o.closed,
    speed: o.speed ?? 0,
    amount: o.amount ?? 1,
    length: o.length ?? 0.12,
    width: o.width ?? 1.6,
    spread: o.spread ?? 0,
    opacity: o.opacity ?? 0.85,
    ramp: o.ramp,
    visible: true,
    dist: 0,
    n: 0,
    verts: new Float32Array(count * PTS * 2 * STRIDE),
    // each streak: its path, where it starts, how fast it goes, and how it wanders round the path
    seeds: Array.from({ length: count }, (_, i) => ({
      path: paths[i % paths.length],
      u: rnd(i, 1),
      pace: 0.8 + 0.4 * rnd(i, 2),
      off: mulv(unit(i, 3), Math.sqrt(rnd(i, 6))),
      wob: mulv(unit(i, 7), 0.5),
      phase: rnd(i, 10) * 6.2832,
      turns: 1 + 2 * rnd(i, 11),
    })),
    step(dt) {
      F.dist += F.speed * dt;
    },
    update(m) {
      const n = (F.n = Math.round(F.count * Math.max(0, Math.min(1, F.amount)))),
        V = F.verts,
        P = new Float64Array(PTS * 3), // (one small array a frame: nothing a streak)
        p = new Float64Array(3);
      for (let i = 0; i < n; i++) {
        const S = F.seeds[i],
          T = S.path.total,
          L = F.length * T,
          head = T ? (((S.u * T + F.dist * S.pace) % T) + T) % T : 0;
        for (let k = 0; k < PTS; k++) {
          let s = head - (L * k) / (PTS - 1);
          if (F.closed) s = ((s % T) + T) % T;
          else s = Math.max(0, s);
          const u = T ? s / T : 0,
            wave = Math.sin(S.phase + 6.2832 * S.turns * u),
            // fading from head to tail, and in and out at an open path's ends (no streak pops into or out of sight)
            ends = F.closed ? 1 : Math.max(0, Math.min(1, u / 0.06, (1 - u) / 0.06));
          S.path.into(s, p, 0);
          for (let j = 0; j < 3; j++) p[j] += (S.off[j] + S.wob[j] * wave) * F.spread;
          for (let j = 0; j < 3; j++)
            P[3 * k + j] = m ? m[j] * p[0] + m[4 + j] * p[1] + m[8 + j] * p[2] + m[12 + j] : p[j];
          for (let side = 0; side < 2; side++) {
            const o = ((i * PTS + k) * 2 + side) * STRIDE;
            V[o + 3] = side ? 1 : -1;
            V[o + 7] = u;
            V[o + 8] = (1 - k / (PTS - 1)) * ends;
          }
        }
        // each point's place, and the streak's direction there (towards the head)
        for (let k = 0; k < PTS; k++) {
          const a = 3 * Math.max(0, k - 1),
            b = 3 * Math.min(PTS - 1, k + 1);
          for (let side = 0; side < 2; side++) {
            const o = ((i * PTS + k) * 2 + side) * STRIDE;
            for (let j = 0; j < 3; j++) {
              V[o + j] = P[3 * k + j];
              V[o + 4 + j] = P[a + j] - P[b + j];
            }
          }
        }
      }
    },
  };
  return F;
}

// the triangles of n streaks: two a segment
export function flowIndices(n) {
  const I = new Uint16Array(n * (PTS - 1) * 6);
  let j = 0;
  for (let i = 0; i < n; i++)
    for (let k = 0; k < PTS - 1; k++) {
      const v = (i * PTS + k) * 2;
      I.set([v, v + 1, v + 2, v + 1, v + 3, v + 2], j);
      j += 6;
    }
  return I;
}
