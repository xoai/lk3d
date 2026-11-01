// Shapes: every part of a scene is built from simple shapes generated here (no model files). A shape repeated around an
// axis stays one shape drawn many times (instancing), so a ring of 28 fins costs the memory of one fin.
import { D2R, M, sub, add, mulv, dot, cross, len, norm, rgb } from './math.js';
import science, { rng } from './science.js';
import { load as loadModel } from './gltf.js';

// A mesh is positions, normals and triangles; every triangle is turned to face the way its normals point, so shapes
// can be written without minding winding order. Vertices may also carry a colour (c: r, g, b, a per vertex, 0-255):
// alpha 255 is the vertex's own colour (an atom, a rock layer), alpha 0 takes the part's colour.
class Geo {
  constructor() {
    this.p = [];
    this.n = [];
    this.i = [];
    this.c = null;
    this.uv = null;
    this.tex = null;
  } // uv, tex: a textured model's
  get count() {
    return this.p.length / 3;
  }
  v(p, n) {
    this.p.push(p[0], p[1], p[2]);
    this.n.push(n[0], n[1], n[2]);
    if (this.c) this.c.push(0, 0, 0, 0);
    if (this.uv) this.uv.push(0, 0);
    return this.count - 1;
  }
  // colour the vertices from `from` on (all, by default)
  paint(hex, from = 0) {
    const [r, g, b] = rgb(hex).map((v) => Math.round(v * 255));
    if (!this.c) this.c = new Array(this.count * 4).fill(0);
    const c = this.c;
    for (let k = from; k < this.count; k++) {
      c[4 * k] = r;
      c[4 * k + 1] = g;
      c[4 * k + 2] = b;
      c[4 * k + 3] = 255;
    }
    return this;
  }
  tri(a, b, c) {
    // (scalar arithmetic: this runs for every triangle of every scene)
    const P = this.p,
      N = this.n,
      a3 = 3 * a,
      b3 = 3 * b,
      c3 = 3 * c;
    const ux = P[b3] - P[a3],
      uy = P[b3 + 1] - P[a3 + 1],
      uz = P[b3 + 2] - P[a3 + 2],
      vx = P[c3] - P[a3],
      vy = P[c3 + 1] - P[a3 + 1],
      vz = P[c3 + 2] - P[a3 + 2];
    const fx = uy * vz - uz * vy,
      fy = uz * vx - ux * vz,
      fz = ux * vy - uy * vx;
    const d =
      fx * (N[a3] + N[b3] + N[c3]) +
      fy * (N[a3 + 1] + N[b3 + 1] + N[c3 + 1]) +
      fz * (N[a3 + 2] + N[b3 + 2] + N[c3 + 2]);
    if (d < 0) this.i.push(a, c, b);
    else this.i.push(a, b, c);
  }
  quad(a, b, c, d) {
    this.tri(a, b, c);
    this.tri(a, c, d);
  }
  // g placed by m. Normals go through the cofactor matrix (the inverse transpose, up to scale), so they stay
  // perpendicular under a stretch; a mirror (det < 0) also turns the triangles round, so faces still point out.
  add(g, m) {
    const base = this.count,
      P = g.p,
      N = g.n;
    const c0 = m[5] * m[10] - m[6] * m[9],
      c1 = m[6] * m[8] - m[4] * m[10],
      c2 = m[4] * m[9] - m[5] * m[8]; // c1 × c2
    const d0 = m[9] * m[2] - m[10] * m[1],
      d1 = m[10] * m[0] - m[8] * m[2],
      d2 = m[8] * m[1] - m[9] * m[0]; // c2 × c0
    const e0 = m[1] * m[6] - m[2] * m[5],
      e1 = m[2] * m[4] - m[0] * m[6],
      e2 = m[0] * m[5] - m[1] * m[4]; // c0 × c1
    const det = m[0] * c0 + m[1] * c1 + m[2] * c2,
      s = det < 0 ? -1 : 1;
    for (let k = 0; k < g.count; k++) {
      const x = P[3 * k],
        y = P[3 * k + 1],
        z = P[3 * k + 2],
        a = N[3 * k],
        b = N[3 * k + 1],
        c = N[3 * k + 2];
      const nx = s * (c0 * a + d0 * b + e0 * c),
        ny = s * (c1 * a + d1 * b + e1 * c),
        nz = s * (c2 * a + d2 * b + e2 * c),
        l = Math.hypot(nx, ny, nz) || 1;
      this.p.push(
        m[0] * x + m[4] * y + m[8] * z + m[12],
        m[1] * x + m[5] * y + m[9] * z + m[13],
        m[2] * x + m[6] * y + m[10] * z + m[14],
      );
      this.n.push(nx / l, ny / l, nz / l);
    }
    if (g.c || this.c) {
      // colours: keep both sides' (alpha 0 where a side had none)
      if (!this.c) this.c = new Array(base * 4).fill(0);
      if (g.c) for (const v of g.c) this.c.push(v);
      else for (let k = 0; k < g.count * 4; k++) this.c.push(0);
    }
    if (g.uv || this.uv) {
      // texture coordinates likewise (0 where a side had none), and the maps they belong to
      if (!this.uv) this.uv = new Array(base * 2).fill(0);
      if (g.uv) for (const v of g.uv) this.uv.push(v);
      else for (let k = 0; k < g.count * 2; k++) this.uv.push(0);
      this.tex = this.tex || g.tex;
    }
    const I = g.i;
    if (s > 0) for (const k of I) this.i.push(base + k);
    else for (let t = 0; t < I.length; t += 3) this.i.push(base + I[t], base + I[t + 2], base + I[t + 1]);
    return this;
  }
}

// Revolve a profile of [x, r] points around the x axis. Each profile segment gets its own normals, so the edges
// between segments stay crisp (machined parts); smooth: true blends them (spheres, tori). from/to (degrees) make a
// sector, closed with flat sides (the profile must then be a closed, convex outline).
function lathe(profile, o = {}) {
  const g = new Geo(),
    seg = Math.max(6, Math.round(((o.seg || 48) * (o.q || 1) * ((o.to ?? 360) - (o.from ?? 0))) / 360));
  const a0 = (o.from ?? 0) * D2R,
    a1 = (o.to ?? 360) * D2R,
    full = Math.abs(a1 - a0 - 2 * Math.PI) < 1e-6;
  const raw = o.mirror ? profile.map(([x, r]) => [-x, r]).reverse() : profile;
  const closed = o.closed ?? (!full && raw.length > 2);
  // long straight stretches get points along them, so shading computed per vertex (ambient occlusion) has somewhere to
  // vary: a long wall would otherwise have vertices only at its two ends
  let ext = 0;
  for (const a of raw) for (const b of raw) ext = Math.max(ext, Math.hypot(a[0] - b[0], a[1] - b[1]));
  const maxSeg = o.maxSeg || ((o.q ?? 1) < 0.75 ? Infinity : ext / 5),
    pts = []; // not for the coarse 2D or phone geometry
  for (let k = 0; k < raw.length; k++) {
    const a = raw[k],
      b = raw[(k + 1) % raw.length];
    pts.push(a);
    if (k + 1 === raw.length && !closed) break;
    const n = Math.floor(Math.hypot(b[0] - a[0], b[1] - a[1]) / maxSeg);
    for (let j = 1; j <= n && !o.smooth; j++) {
      const t = j / (n + 1);
      pts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  const segs = [];
  for (let k = 0; k + 1 < pts.length + (closed ? 1 : 0); k++) segs.push([pts[k], pts[(k + 1) % pts.length]]);
  const at = (x, r, a) => [x, r * Math.cos(a), r * Math.sin(a)];
  // normals point out of the solid whichever way round the profile was written: a profile traced counter-clockwise in
  // the (x, r) plane (closed along the axis if it is open) has them flipped
  let area = 0;
  for (let k = 0; k < pts.length; k++) {
    const a = pts[k],
      b = pts[(k + 1) % pts.length];
    area += a[0] * b[1] - b[0] * a[1];
  }
  const sgn = area > 0 ? -1 : 1;
  const segN = segs.map(([p, q]) => {
    const dx = q[0] - p[0],
      dr = q[1] - p[1],
      l = Math.hypot(dx, dr) || 1;
    return [(-dr / l) * sgn, (dx / l) * sgn];
  });
  segs.forEach(([p, q], s) => {
    let n0 = segN[s],
      n1 = segN[s];
    if (o.smooth) {
      const prev = segN[(s - 1 + segs.length) % segs.length],
        next = segN[(s + 1) % segs.length];
      if (s > 0 || closed) n0 = [n0[0] + prev[0], n0[1] + prev[1]];
      if (s < segs.length - 1 || closed) n1 = [n1[0] + next[0], n1[1] + next[1]];
    }
    const ring = [];
    for (let k = 0; k <= seg; k++) {
      const a = a0 + ((a1 - a0) * k) / seg,
        c = Math.cos(a),
        sn = Math.sin(a);
      const N0 = norm([n0[0], n0[1] * c, n0[1] * sn]),
        N1 = norm([n1[0], n1[1] * c, n1[1] * sn]);
      ring.push([g.v(at(p[0], p[1], a), N0), g.v(at(q[0], q[1], a), N1)]);
    }
    for (let k = 0; k < seg; k++) {
      const [a, b] = ring[k],
        [c, d] = ring[k + 1];
      if (p[1] < 1e-9 && q[1] < 1e-9) continue;
      g.quad(a, b, d, c);
    }
  });
  if (!full)
    for (const [ang, sgn] of [
      [a0, -1],
      [a1, 1],
    ]) {
      // the two flat sides of a sector: a fan over the profile
      const n = [0, -Math.sin(ang) * sgn, Math.cos(ang) * sgn],
        ids = pts.map(([x, r]) => g.v(at(x, r, ang), n));
      for (let k = 1; k + 1 < ids.length; k++) g.tri(ids[0], ids[k], ids[k + 1]);
    }
  return g;
}
function cylinder({ r, x0 = -0.5, x1 = 0.5, ri = 0, r1 }, o) {
  const R1 = r1 ?? r;
  return ri > 0
    ? lathe(
        [
          [x0, ri],
          [x0, r],
          [x1, R1],
          [x1, ri],
        ],
        { ...o, closed: true },
      )
    : lathe(
        [
          [x0, 0],
          [x0, r],
          [x1, R1],
          [x1, 0],
        ],
        o,
      );
}
function box(s) {
  const g = new Geo(),
    [a, b, c] = s.map((v) => v / 2);
  const F = [
    [
      [1, 0, 0],
      [
        [a, -b, -c],
        [a, b, -c],
        [a, b, c],
        [a, -b, c],
      ],
    ],
    [
      [-1, 0, 0],
      [
        [-a, -b, -c],
        [-a, -b, c],
        [-a, b, c],
        [-a, b, -c],
      ],
    ],
    [
      [0, 1, 0],
      [
        [-a, b, -c],
        [-a, b, c],
        [a, b, c],
        [a, b, -c],
      ],
    ],
    [
      [0, -1, 0],
      [
        [-a, -b, -c],
        [a, -b, -c],
        [a, -b, c],
        [-a, -b, c],
      ],
    ],
    [
      [0, 0, 1],
      [
        [-a, -b, c],
        [a, -b, c],
        [a, b, c],
        [-a, b, c],
      ],
    ],
    [
      [0, 0, -1],
      [
        [-a, -b, -c],
        [-a, b, -c],
        [a, b, -c],
        [a, -b, -c],
      ],
    ],
  ];
  for (const [n, vs] of F) {
    const ids = vs.map((p) => g.v(p, n));
    g.quad(ids[0], ids[1], ids[2], ids[3]);
  }
  return g;
}
function sphere(r, o) {
  // o.seg: segments around (32 by default; 8 for a tiny bead repeated hundreds of times)
  const seg = o.seg || 32,
    n = Math.max(4, Math.round((seg / 2) * (o.q || 1))),
    prof = [];
  for (let k = 0; k <= n; k++) {
    const t = (Math.PI * k) / n;
    prof.push([-r * Math.cos(t), r * Math.sin(t)]);
  }
  return lathe(prof, { ...o, smooth: true, seg });
}
function torus([R, r], o) {
  const n = Math.max(6, Math.round(12 * (o.q || 1))),
    prof = [];
  for (let k = 0; k < n; k++) {
    const t = (2 * Math.PI * k) / n;
    prof.push([r * Math.cos(t), R + r * Math.sin(t)]);
  }
  return lathe(prof, { ...o, smooth: true, closed: true });
}
// A round tube along a path (parallel-transported frames, so it does not twist). r: a radius, or one per point
// (a tapering branch).
function tube(path, r, o = {}) {
  const g = new Geo(),
    rs = Math.max(5, Math.round(8 * (o.q || 1))),
    closed = !!o.closed,
    P = path,
    n = P.length;
  if (n < 2) return g;
  const T = P.map((_, k) =>
    norm(sub(P[closed ? (k + 1) % n : Math.min(k + 1, n - 1)], P[closed ? (k - 1 + n) % n : Math.max(k - 1, 0)])),
  );
  let u = Math.abs(T[0][0]) < 0.9 ? norm(cross(T[0], [1, 0, 0])) : norm(cross(T[0], [0, 1, 0]));
  const rings = [];
  for (let k = 0; k < n; k++) {
    if (k > 0) {
      const ax = cross(T[k - 1], T[k]);
      if (len(ax) > 1e-9) {
        u = norm(sub(u, mulv(T[k], dot(u, T[k]))));
      }
    }
    const w = cross(T[k], u),
      ring = [];
    for (let j = 0; j <= rs; j++) {
      const a = (2 * Math.PI * j) / rs,
        d = add(mulv(u, Math.cos(a)), mulv(w, Math.sin(a)));
      ring.push(g.v(add(P[k], mulv(d, Array.isArray(r) ? r[k] : r)), d));
    }
    rings.push(ring);
  }
  for (let k = 0; k < n - 1 + (closed ? 1 : 0); k++) {
    const A = rings[k],
      B = rings[(k + 1) % n];
    for (let j = 0; j < rs; j++) g.quad(A[j], A[j + 1], B[j + 1], B[j]);
  }
  if (!closed)
    for (const [k, s] of [
      [0, -1],
      [n - 1, 1],
    ]) {
      // flat ends
      const c = g.v(P[k], mulv(T[k], s)),
        ids = rings[k].map((_, j) =>
          g.v([g.p[3 * rings[k][j]], g.p[3 * rings[k][j] + 1], g.p[3 * rings[k][j] + 2]], mulv(T[k], s)),
        );
      for (let j = 0; j < rs; j++) g.tri(c, ids[j], ids[j + 1]);
    }
  return g;
}
function helix({ r, x0 = -0.5, x1 = 0.5, turns = 8, wire = 0.02 }, o) {
  const n = Math.max(24, Math.round(turns * 16 * (o.q || 1))),
    path = [];
  for (let k = 0; k <= n; k++) {
    const t = k / n,
      a = 2 * Math.PI * turns * t;
    path.push([x0 + (x1 - x0) * t, r * Math.cos(a), r * Math.sin(a)]);
  }
  return tube(path, wire, o);
}
// A rounded rectangular loop of wire lying in the x-z plane at height y = R: a coil around a stator tooth.
function loop({ a = 0.8, b = 0.12, R = 0.4, wire = 0.02, corner = 0.03, turns = 1, gap = 0 }, o) {
  const g = new Geo(),
    cs = 5;
  for (let t = 0; t < turns; t++) {
    // turns stack outwards from the axis, like the layers of a winding
    const A = a / 2,
      B = b / 2,
      c = Math.min(corner, A, B),
      y = R + t * gap,
      path = [];
    const arc = (cx, cz, a0) => {
      for (let k = 0; k <= cs; k++) {
        const ang = a0 + ((Math.PI / 2) * k) / cs;
        path.push([cx + c * Math.cos(ang), y, cz + c * Math.sin(ang)]);
      }
    };
    arc(A - c, B - c, 0);
    arc(-A + c, B - c, Math.PI / 2);
    arc(-A + c, -B + c, Math.PI);
    arc(A - c, -B + c, 1.5 * Math.PI);
    g.add(tube(path, wire, { ...o, closed: true }), M.id());
  }
  return g;
}
const SHAPES = {
  lathe: (v, s, o) =>
    lathe(v, { ...o, seg: s.seg, from: s.from, to: s.to, smooth: s.smooth, closed: s.closed, mirror: s.mirror }),
  cylinder: (v, s, o) => cylinder(v, { ...o, seg: s.seg }),
  box: (v) => box(v),
  sphere: (v, s, o) => sphere(v, { ...o, seg: s.seg }),
  torus: (v, s, o) => torus(v, o),
  tube: (v, s, o) => tube(v, s.r || 0.02, { ...o, closed: s.closed }),
  helix: (v, s, o) => helix(v, o),
  loop: (v, s, o) => loop(v, o),
};
// cells, molecules, rock, planets, blades: each takes its parameters and the build options (quality q)
for (const [k, fn] of Object.entries(science({ Geo, lathe, tube, sphere, cylinder })))
  SHAPES[k] = (v, s, o) => fn(v, o);
// One shape of a part: its geometry (in the shape's own frame) and the placements it is drawn at: one, copies around
// an axis (repeat), or copies scattered at random inside a region (scatter: ribosomes, vesicles, stars). color: paints
// the shape in its own colour (alpha 255), so one part can hold differently coloured shapes.
function buildShape(s, q, ctx = {}) {
  if (s.detail) q *= s.detail; // detail: 0.5 for a shape repeated hundreds of times (blades), 2 for a close-up
  if (s.scatter) return scatterShape(s, q, ctx);
  if (s.model != null) return modelShape(s, ctx);
  const kind = Object.keys(SHAPES).find((k) => k in s);
  if (!kind)
    throw new Error(
      'lk3d: a shape needs one of ' + Object.keys(SHAPES).join(', ') + ', scatter: ' + JSON.stringify(s).slice(0, 80),
    );
  const geo = SHAPES[kind](s[kind], s, { q }),
    place = M.trs(s.at, s.rot, s.scale);
  if (s.color) geo.paint(s.color);
  const rep = s.repeat ? (typeof s.repeat === 'number' ? { n: s.repeat } : s.repeat) : { n: 1 };
  const axis = rep.axis || 'x',
    rot = axis === 'x' ? M.rotX : axis === 'y' ? M.rotY : M.rotZ,
    mats = [];
  for (let k = 0; k < rep.n; k++)
    mats.push(M.mul(rot(((rep.start || 0) + (rep.step ?? 360 / rep.n) * k) * D2R), place));
  return { geo, mats };
}
// scatter: {shape: {…a shape…}, n, within: {sphere: r} | {shell: [ri, r]} | {box: [x, y, z]}, avoid: [{sphere: r, at}],
// size: [min, max], seed}. Each copy turned at random and scaled evenly, so all are drawn by instancing.
// model: a model the scene lists under `models` (models: {heart: {data: the .glb as base64}}), or one node of it:
// {model: heart, node: …}
function modelShape(s, ctx) {
  const m = (ctx.models || {})[s.model];
  if (!m || !m.data)
    throw new Error(`lk3d: no model "${s.model}" in the scene's models (each needs its .glb as base64 in data)`);
  const geo = loadModel(Geo, m.data, s.node);
  if (s.color) geo.paint(s.color);
  return { geo, mats: [M.trs(s.at, s.rot, s.scale)] };
}
function scatterShape(s, q, ctx) {
  const o = s.scatter,
    inner = buildShape(o.shape, q * (o.detail ?? 0.5), ctx),
    R = rng(o.seed ?? 1),
    place = M.trs(s.at, s.rot, s.scale);
  const w = o.within || { sphere: 1 },
    [s0, s1] = o.size || [1, 1],
    mats = [];
  const inside = (p) =>
    w.box ? true : Math.hypot(...p) <= (w.sphere ?? w.shell[1]) && (!w.shell || Math.hypot(...p) >= w.shell[0]);
  const avoided = (p) =>
    (o.avoid || []).some(
      (a) =>
        Math.hypot(p[0] - (a.at || [0, 0, 0])[0], p[1] - (a.at || [0, 0, 0])[1], p[2] - (a.at || [0, 0, 0])[2]) <
        a.sphere,
    );
  const span = w.box ? w.box : [2, 2, 2].map((k) => k * (w.sphere ?? w.shell[1]));
  for (let tries = 0; mats.length < (o.n || 50) && tries < (o.n || 50) * 60; tries++) {
    const p = span.map((d) => (R() - 0.5) * d);
    if (!inside(p) || avoided(p)) continue;
    const k = s0 + (s1 - s0) * R(),
      m = M.mul(M.trs(p, [R() * 360, R() * 360, R() * 360], [k, k, k]), inner.mats[0]);
    mats.push(M.mul(place, m));
  }
  return { geo: inner.geo, mats };
}

// Normals for the outline: the average at each position, so the inked silhouette has no gaps at sharp edges.
function outlineNormals(g) {
  // positions grouped by a numeric hash of their rounded coordinates (exact match checked)
  const n = g.count,
    P = g.p,
    Nn = g.n,
    q = new Int32Array(n * 3),
    rep = new Int32Array(n),
    buckets = new Map(),
    acc = new Float32Array(n * 3),
    out = new Float32Array(n * 3);
  for (let k = 0; k < n; k++) {
    const x = (q[3 * k] = Math.round(P[3 * k] * 1e4)),
      y = (q[3 * k + 1] = Math.round(P[3 * k + 1] * 1e4)),
      z = (q[3 * k + 2] = Math.round(P[3 * k + 2] * 1e4));
    const h = (Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)) | 0;
    let list = buckets.get(h),
      r = -1;
    if (list)
      for (const j of list)
        if (q[3 * j] === x && q[3 * j + 1] === y && q[3 * j + 2] === z) {
          r = j;
          break;
        }
    if (r < 0) {
      r = k;
      if (list) list.push(k);
      else buckets.set(h, [k]);
    }
    rep[k] = r;
    acc[3 * r] += Nn[3 * k];
    acc[3 * r + 1] += Nn[3 * k + 1];
    acc[3 * r + 2] += Nn[3 * k + 2];
  }
  for (let k = 0; k < n; k++) {
    const r = rep[k],
      x = acc[3 * r],
      y = acc[3 * r + 1],
      z = acc[3 * r + 2],
      l = Math.hypot(x, y, z) || 1;
    out[3 * k] = x / l;
    out[3 * k + 1] = y / l;
    out[3 * k + 2] = z / l;
  }
  return out;
}

// The bounding box of a geometry seen through a matrix.
function bounds(g, m) {
  const lo = [1e9, 1e9, 1e9],
    hi = [-1e9, -1e9, -1e9];
  for (let k = 0; k < g.count; k++) {
    const p = m ? M.pt(m, [g.p[3 * k], g.p[3 * k + 1], g.p[3 * k + 2]]) : [g.p[3 * k], g.p[3 * k + 1], g.p[3 * k + 2]];
    for (let a = 0; a < 3; a++) {
      if (p[a] < lo[a]) lo[a] = p[a];
      if (p[a] > hi[a]) hi[a] = p[a];
    }
  }
  return { lo, hi };
}

const MATERIALS = {
  // [metalness, roughness, wrap: light reaching round into the shade, as through soft tissue]
  metal: [0.9, 0.35],
  steel: [0.85, 0.45],
  copper: [0.95, 0.3],
  gold: [1, 0.25],
  plastic: [0, 0.5],
  rubber: [0, 0.9],
  paint: [0.1, 0.4],
  glass: [0, 0.05],
  magnet: [0.2, 0.45],
  matte: [0, 0.8],
  wood: [0, 0.7],
  tissue: [0, 0.6, 0.5],
  membrane: [0, 0.5, 0.4],
  skin: [0, 0.55, 0.45],
  bone: [0, 0.65, 0.15],
  rock: [0, 0.9],
  soil: [0, 0.95],
  ice: [0, 0.15, 0.2],
  water: [0.02, 0.08],
  gas: [0, 0.4, 0.3],
};
// fine surface detail drawn by the studio look (WebGL 2), in the part's own coordinates: kind, and its default scale
// (bumps per unit) and strength
const SURFACES = { brushed: [1, 40], knurl: [2, 60], ribs: [3, 80], grain: [4, 6], skin: [5, 30], cast: [6, 25] };
const surface = (s) =>
  s && SURFACES[s.kind] ? [SURFACES[s.kind][0], s.scale ?? SURFACES[s.kind][1], s.strength ?? 0.5] : [0, 0, 0];

// a rotation with a uniform scale (and a translation): det > 0 and three columns of one length, at right angles
function rigid(m) {
  const c = [
      [m[0], m[1], m[2]],
      [m[4], m[5], m[6]],
      [m[8], m[9], m[10]],
    ],
    l = Math.hypot(...c[0]),
    tol = 1e-6 * l;
  const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  return (
    Math.abs(Math.hypot(...c[1]) - l) < tol &&
    Math.abs(Math.hypot(...c[2]) - l) < tol &&
    Math.abs(dot(c[0], c[1])) < tol * l &&
    Math.abs(dot(c[1], c[2])) < tol * l &&
    Math.abs(dot(c[0], c[2])) < tol * l &&
    dot(
      [
        c[0][1] * c[1][2] - c[0][2] * c[1][1],
        c[0][2] * c[1][0] - c[0][0] * c[1][2],
        c[0][0] * c[1][1] - c[0][1] * c[1][0],
      ],
      c[2],
    ) > 0
  );
}

// A scene: parts, each a list of batches (one geometry, drawn at one or more placements). Shapes of a part that are not
// repeated are merged into one batch, so a part costs one draw for its plain shapes plus one per repeated shape.
function buildScene(spec, q = 1) {
  const parts = (spec.parts || []).map((p, k) => {
    const place = M.trs(p.at, p.rot, p.scale),
      merged = new Geo(),
      batches = [];
    for (const s of p.shapes || []) {
      const b = buildShape(s, q, { models: spec.models }),
        mats = b.mats.map((m) => M.mul(place, m));
      if (b.geo.tex) {
        const g = new Geo();
        for (const m of mats) g.add(b.geo, m);
        batches.push({ geo: g, mats: [M.id()] });
        continue;
      } // a textured model: a batch of its own
      // copies are drawn by the GPU only when each is a rotation and a uniform scale (its shader turns normals by the
      // matrix itself); a mirrored or stretched copy is baked into the part's own geometry instead
      if (mats.length === 1 || !mats.every(rigid)) for (const m of mats) merged.add(b.geo, m);
      else batches.push({ geo: b.geo, mats });
    }
    if (merged.count) batches.unshift({ geo: merged, mats: [M.id()] });
    let lo = [1e9, 1e9, 1e9],
      hi = [-1e9, -1e9, -1e9],
      tris = 0,
      anchor = null,
      best = -1e9;
    for (const b of batches) {
      b.out = outlineNormals(b.geo);
      tris += (b.geo.i.length / 3) * b.mats.length;
      for (const m of b.mats) {
        const bb = bounds(b.geo, m);
        for (let a = 0; a < 3; a++) {
          lo[a] = Math.min(lo[a], bb.lo[a]);
          hi[a] = Math.max(hi[a], bb.hi[a]);
        }
      }
    }
    if (tris > 2e6) throw new Error(`lk3d: part ${p.id} has ${Math.round(tris)} triangles; the limit is 2 million`);
    // where its label points: given, or the top of the part near its middle (the centre of a ring is empty space)
    const mid = mulv(add(lo, hi), 0.5);
    for (const b of batches)
      for (const m of b.mats) {
        const g = b.geo,
          step = Math.max(1, Math.floor(g.count / 4000));
        for (let v = 0; v < g.count; v += step) {
          const w = M.pt(m, [g.p[3 * v], g.p[3 * v + 1], g.p[3 * v + 2]]),
            score = w[1] - 0.35 * Math.abs(w[0] - mid[0]) - 0.35 * Math.abs(w[2] - mid[2]);
          if (score > best) {
            best = score;
            anchor = w;
          }
        }
      }
    return {
      id: p.id || 'p' + k,
      name: p.name || '',
      note: p.note || '',
      group: p.group || '',
      label: p.label,
      spin: p.spin || null,
      handle: p.handle || null,
      color: rgb(p.color),
      studioColor: rgb(p.studioColor || p.color),
      mat: [...(MATERIALS[p.material] || MATERIALS.paint), 0].slice(0, 3),
      material: p.material || 'paint',
      surf: surface(p.surface),
      refract: p.refract || 0,
      alpha: p.opacity ?? 1,
      xray: !!p.xray,
      accent: !!p.accent,
      explode: p.explode || [0, 0, 0],
      offset: [0, 0, 0],
      batches,
      lo,
      hi,
      center: mid,
      tris,
      anchor: Array.isArray(p.label) ? p.label : anchor || mid,
      hidden: !!p.hidden,
      emit: [0, 0, 0],
      glowColor: rgb(p.glow || '#ffcf6a'),
      index: k,
    };
  });
  let lo = [1e9, 1e9, 1e9],
    hi = [-1e9, -1e9, -1e9];
  for (const p of parts)
    for (let a = 0; a < 3; a++) {
      lo[a] = Math.min(lo[a], p.lo[a]);
      hi[a] = Math.max(hi[a], p.hi[a]);
    }
  return { parts, lo, hi, center: mulv(add(lo, hi), 0.5), radius: len(sub(hi, lo)) / 2 || 1 };
}

// For tests and tools: a part as one plain geometry, every instance placed (what v1 drew).
function flatten(part) {
  const g = new Geo();
  for (const b of part.batches) for (const m of b.mats) g.add(b.geo, m);
  return g;
}

export { Geo, SHAPES, buildShape, buildScene, flatten, outlineNormals, bounds, MATERIALS, SURFACES };
