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

export const MAXP = 16, // points of a path (uniforms)
  NT = 24; // samples of the table along the path: inner radius, outer radius, travel time (uniforms)

// stops [[f, a, b…], …] along the path (f from 0 at its start to 1 at its end): the values at f, linear between stops
export function at(st, f) {
  let k = 0;
  while (k + 2 < st.length && f > st[k + 1][0]) k++;
  const a = st[k],
    b = st[Math.min(k + 1, st.length - 1)],
    t = b[0] > a[0] ? Math.max(0, Math.min(1, (f - a[0]) / (b[0] - a[0]))) : 0;
  return a.slice(1).map((v, i) => v + (b[i + 1] - v) * t);
}
// radius: a number, or stops [[f, rOut], …] or [[f, rIn, rOut], …]; as stops [f, rIn, rOut]
const profile = (radius) =>
  (typeof radius === 'number' ? [[0, radius]] : radius?.length ? radius : [[0, 0.1]]).map((r) =>
    r.length > 2 ? r : [r[0], 0, r[1]],
  );
export const radiusAt = at;

export function makeStream(o = {}) {
  const P = (o.path || []).filter((p, k, a) => k === 0 || len(sub(p, a[k - 1])) > 1e-9); // (repeats left out)
  if (P.length < 2) throw new Error('lk3d: a stream needs a path of two points or more');
  if (P.length > MAXP) throw new Error(`lk3d: a stream's path has at most ${MAXP} points (this one has ${P.length})`);
  const cum = [0];
  for (let k = 1; k < P.length; k++) cum.push(cum[k - 1] + len(sub(P[k], P[k - 1])));
  const total = cum[cum.length - 1] || 1,
    rad = profile(o.radius),
    pts = new Float32Array(MAXP * 4),
    tab = new Float32Array(NT * 3),
    area = (f) => {
      const [ri, ro] = at(rad, f);
      return Math.max(1e-6, ro * ro - ri * ri);
    },
    // the speed along the path, as a fraction of `speed`: given, or by continuity (1 at the start)
    u = (f) => Math.min(20, Math.max(0.05, o.speeds ? at(o.speeds, f)[0] : area(0) / area(f)));
  P.forEach((p, k) => pts.set([p[0], p[1], p[2], cum[k]], 4 * k));
  for (let k = 0, tau = 0; k < NT; k++) {
    if (k) for (let j = 0; j < 8; j++) tau += total / (NT - 1) / 8 / u((k - 1 + (j + 0.5) / 8) / (NT - 1));
    tab.set([...at(rad, k / (NT - 1)), tau], 3 * k);
  }
  // the hull: rings round the path, a quarter wider than the stream there, closed at both ends
  const V = [],
    I = [],
    SEG = 14,
    rings = [];
  let N = null,
    T0 = null;
  for (let k = 0; k + 1 < P.length; k++) {
    // the frame round the path, carried from one segment to the next (so the rings do not twist at a bend)
    const T = norm(sub(P[k + 1], P[k]));
    const C = N && carry(N, T0, T);
    N = C ? norm(sub(C, mulv(T, dot(C, T)))) : norm(Math.abs(T[1]) < 0.9 ? cross(T, [0, 1, 0]) : cross(T, [1, 0, 0]));
    T0 = T;
    const B = cross(T, N),
      n = Math.max(1, Math.min(24, Math.ceil((cum[k + 1] - cum[k]) / (radiusAt(rad, cum[k] / total)[1] * 0.6 || 1))));
    for (let j = k ? 1 : 0; j <= n; j++) {
      const c = add(P[k], mulv(sub(P[k + 1], P[k]), j / n)),
        r = radiusAt(rad, (cum[k] + ((cum[k + 1] - cum[k]) * j) / n) / total)[1] * 1.25 + 1e-3;
      // at a bend, the ring lies in the plane halving it (a mitre), so the two segments' tubes meet without overlap
      let M = j === n && k + 2 < P.length ? norm(add(T, norm(sub(P[k + 2], P[k + 1])))) : T;
      if (dot(T, M) < 0.1) M = T; // (a path doubling back has no plane halving its turn)
      rings.push(V.length / 3);
      for (let a = 0; a < SEG; a++) {
        const t = (a / SEG) * 2 * Math.PI,
          d = add(mulv(N, r * Math.cos(t)), mulv(B, r * Math.sin(t)));
        V.push(...add(add(c, d), mulv(T, -dot(d, M) / dot(T, M))));
      }
    }
  }
  for (let k = 0; k + 1 < rings.length; k++)
    for (let a = 0; a < SEG; a++) {
      const p = rings[k] + a,
        q = rings[k] + ((a + 1) % SEG),
        r = rings[k + 1] + a,
        s = rings[k + 1] + ((a + 1) % SEG);
      I.push(p, q, r, q, s, r); // (faces out: the shader is drawn on the far side, the back faces)
    }
  for (const [ring, c, out] of [
    [rings[0], P[0], false],
    [rings[rings.length - 1], P[P.length - 1], true],
  ]) {
    const m = V.length / 3;
    V.push(...c);
    for (let a = 0; a < SEG; a++) I.push(m, ring + (out ? a : (a + 1) % SEG), ring + (out ? (a + 1) % SEG : a));
  }
  const S = {
    pts,
    n: P.length,
    total,
    rad,
    tab,
    scale: 11 / Math.max(...rad.map((r) => r[2])), // the field's size along the path
    hull: { p: new Float32Array(V), i: new Uint16Array(I) },
    center: mulv(P.reduce(add, [0, 0, 0]), 1 / P.length), // (streams are drawn far to near by it)
    box: [0, 1, 2].map((a) =>
      [0, 1].map((m) => V.filter((_, k) => k % 3 === a).reduce((x, y) => (m ? Math.max(x, y) : Math.min(x, y)))),
    ), // (the hull's bounds: how far a ray marches)
    reach: Math.max(...rad.map((r) => r[2])) * 2.6, // how far a ray may cross it
    speed: o.speed ?? 0,
    density: o.density ?? 1,
    turbulence: o.turbulence ?? 0.5,
    swirl: o.swirl ?? 0.5,
    fade: o.fade ?? 0.7,
    ramp: o.ramp,
    visible: true,
    phase: 0,
    step(dt) {
      S.phase = (S.phase + S.speed * dt) % 3000; // (kept small for the GPU's precision: a rare jump in the pattern)
    },
  };
  return S;
}
