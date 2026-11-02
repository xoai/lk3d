// Shapes for the sciences, generated from a few numbers: cells and organelles (ellipsoid, capsule, blob, shell,
// scatter), neurons and vessels (tree), molecules (molecule, dna), rock (extrude, terrain), planets (shell, ring,
// orbit) and machines with airfoils (blade). Every random choice comes from a seed, so a scene is the same each time;
// detail follows the quality q (coarser on phones and in the 2D fallback).
import { D2R, M, sub, add, mulv, dot, cross, len, norm } from './math.js';

// seeded random numbers in [0, 1) (mulberry32)
function rng(seed) {
  let a = (seed * 2654435761) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// smooth noise in 3D, about -1..1: values on an integer lattice, blended with smoothstep
function noise3(seed) {
  const R = rng(seed),
    V = Float64Array.from({ length: 512 }, () => R() * 2 - 1);
  const h = (i, j, k) => V[((i * 73856093) ^ (j * 19349663) ^ (k * 83492791)) & 511];
  const s = (t) => t * t * (3 - 2 * t);
  return (x, y, z) => {
    const i = Math.floor(x),
      j = Math.floor(y),
      k = Math.floor(z),
      u = s(x - i),
      v = s(y - j),
      w = s(z - k);
    const l = (a, b, t) => a + (b - a) * t;
    return l(
      l(l(h(i, j, k), h(i + 1, j, k), u), l(h(i, j + 1, k), h(i + 1, j + 1, k), u), v),
      l(l(h(i, j, k + 1), h(i + 1, j, k + 1), u), l(h(i, j + 1, k + 1), h(i + 1, j + 1, k + 1), u), v),
      w,
    );
  };
}
// an even mesh of the unit sphere (no crowded poles): an icosahedron, each triangle split in four `level` times
function icosphere(level) {
  const t = (1 + Math.sqrt(5)) / 2;
  let pos = [
    [-1, t, 0],
    [1, t, 0],
    [-1, -t, 0],
    [1, -t, 0],
    [0, -1, t],
    [0, 1, t],
    [0, -1, -t],
    [0, 1, -t],
    [t, 0, -1],
    [t, 0, 1],
    [-t, 0, -1],
    [-t, 0, 1],
  ].map(norm);
  let tris = [
    [0, 11, 5],
    [0, 5, 1],
    [0, 1, 7],
    [0, 7, 10],
    [0, 10, 11],
    [1, 5, 9],
    [5, 11, 4],
    [11, 10, 2],
    [10, 7, 6],
    [7, 1, 8],
    [3, 9, 4],
    [3, 4, 2],
    [3, 2, 6],
    [3, 6, 8],
    [3, 8, 9],
    [4, 9, 5],
    [2, 4, 11],
    [6, 2, 10],
    [8, 6, 7],
    [9, 8, 1],
  ];
  for (let l = 0; l < level; l++) {
    const mid = new Map(),
      m = (a, b) => {
        const k = a < b ? a * 1e6 + b : b * 1e6 + a;
        if (!mid.has(k)) {
          mid.set(k, pos.length);
          pos.push(norm(mulv(add(pos[a], pos[b]), 0.5)));
        }
        return mid.get(k);
      };
    tris = tris.flatMap(([a, b, c]) => {
      const ab = m(a, b),
        bc = m(b, c),
        ca = m(c, a);
      return [
        [a, ab, ca],
        [b, bc, ab],
        [c, ca, bc],
        [ab, bc, ca],
      ];
    });
  }
  return { pos, tris };
}
const levelFor = (q, base = 3) => Math.max(1, Math.min(5, Math.round(base + Math.log2(Math.max(0.25, q || 1)))));

export default ({ Geo, lathe, tube, sphere, cylinder }) => {
  // a closed mesh from shared vertices, with normals given (or averaged from the faces around each vertex)
  function meshOf(pos, tris, normals) {
    let N = normals;
    if (!N) {
      // from the faces; turned outwards if the triangles were written the other way round (negative volume)
      let vol = 0;
      for (const [a, b, c] of tris) vol += dot(pos[a], cross(pos[b], pos[c]));
      const s = vol < 0 ? -1 : 1;
      N = pos.map(() => [0, 0, 0]);
      for (const [a, b, c] of tris) {
        const f = mulv(cross(sub(pos[b], pos[a]), sub(pos[c], pos[a])), s);
        for (const v of [a, b, c]) N[v] = add(N[v], f);
      }
      N = N.map(norm);
    }
    const g = new Geo();
    pos.forEach((p, k) => g.v(p, N[k]));
    for (const [a, b, c] of tris) g.tri(a, b, c);
    return g;
  }
  // a matrix that takes the x axis from a to b (length |b − a|), for rods between two points
  function between(a, b) {
    const d = sub(b, a),
      L = len(d),
      x = mulv(d, 1 / L),
      up = Math.abs(x[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const z = norm(cross(x, up)),
      y = cross(z, x);
    return { m: [x[0], x[1], x[2], 0, y[0], y[1], y[2], 0, z[0], z[1], z[2], 0, a[0], a[1], a[2], 1], L, y };
  }

  // ellipsoid: [a, b, c], semi-axes along x, y, z (a cell, a nucleus, an egg)
  function ellipsoid([a, b, c], o) {
    const { pos, tris } = icosphere(levelFor(o.q));
    return meshOf(
      pos.map(([x, y, z]) => [a * x, b * y, c * z]),
      tris,
      pos.map(([x, y, z]) => norm([x / a, y / b, z / c])),
    );
  }
  // capsule: {r, x0, x1}: a cylinder with round ends, along x (a mitochondrion, a bacterium, a pill)
  function capsule({ r, x0 = -0.5, x1 = 0.5 }, o) {
    const n = Math.max(4, Math.round(8 * (o.q || 1))),
      prof = [];
    for (let k = 0; k <= n; k++) {
      const t = ((Math.PI / 2) * k) / n;
      prof.push([x0 - r * Math.cos(t), r * Math.sin(t)]);
    }
    for (let k = 0; k <= n; k++) {
      const t = ((Math.PI / 2) * k) / n;
      prof.push([x1 + r * Math.sin(t), r * Math.cos(t)]);
    }
    return lathe(prof, { ...o, smooth: true });
  }
  // blob: {r, amp, freq, seed, stretch: [sx, sy, sz]}: a sphere with a smooth, irregular surface (a cell body, a
  // nucleus, a rock, a small moon): its radius varies by ±amp
  function blob({ r = 0.5, amp = 0.15, freq = 1.6, seed = 1, stretch = [1, 1, 1] }, o) {
    const { pos, tris } = icosphere(levelFor(o.q, 4)),
      n = noise3(seed);
    return meshOf(
      pos.map((p) => {
        const k = r * (1 + amp * n(p[0] * freq + 7.1, p[1] * freq + 3.3, p[2] * freq + 5.7));
        return [p[0] * k * stretch[0], p[1] * k * stretch[1], p[2] * k * stretch[2]];
      }),
      tris,
    );
  }
  // shell: {r, ri, from, to}: a sphere around the x axis, hollow inside ri, with the wedge outside from..to (degrees)
  // cut away to show the inside (Earth's layers, a cell's membrane); ri: 0 for a solid core
  function shell({ r, ri = 0, from = 0, to = 360 }, o) {
    const g = new Geo(),
      nt = Math.max(8, Math.round(24 * (o.q || 1))),
      full = Math.abs(to - from - 360) < 1e-6;
    const np = Math.max(6, Math.round((48 * (o.q || 1) * (to - from)) / 360)),
      a0 = from * D2R,
      a1 = to * D2R;
    const dir = (t, f) => [Math.cos(t), Math.sin(t) * Math.cos(f), Math.sin(t) * Math.sin(f)];
    for (const [rad, s] of ri > 0
      ? [
          [r, 1],
          [ri, -1],
        ]
      : [[r, 1]]) {
      const grid = [];
      for (let i = 0; i <= nt; i++) {
        const row = [];
        for (let j = 0; j <= np; j++) {
          const d = dir((Math.PI * i) / nt, a0 + ((a1 - a0) * j) / np);
          row.push(g.v(mulv(d, rad), mulv(d, s)));
        }
        grid.push(row);
      }
      for (let i = 0; i < nt; i++)
        for (let j = 0; j < np; j++) g.quad(grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]);
    }
    if (!full)
      for (const [ang, sg] of [
        [a0, -1],
        [a1, 1],
      ]) {
        // the cut faces: half-discs, or half-rings
        const n = [0, -Math.sin(ang) * sg, Math.cos(ang) * sg];
        const out = [],
          inn = [];
        for (let i = 0; i <= nt; i++) {
          const d = dir((Math.PI * i) / nt, ang);
          out.push(g.v(mulv(d, r), n));
          if (ri > 0) inn.push(g.v(mulv(d, ri), n));
        }
        if (ri > 0) for (let i = 0; i < nt; i++) g.quad(out[i], out[i + 1], inn[i + 1], inn[i]);
        else {
          const c = g.v([0, 0, 0], n);
          for (let i = 0; i < nt; i++) g.tri(c, out[i], out[i + 1]);
        }
      }
    return g;
  }
  // tree: branching tubes, tapering (dendrites, axon terminals, blood vessels, roots, a river's tributaries).
  // {at, dir, length, r, levels, branches, spread (degrees), shrink, taper, bend, seed}
  function tree(
    {
      at = [0, 0, 0],
      dir = [1, 0, 0],
      length = 1,
      r = 0.04,
      levels = 3,
      branches = 2,
      spread = 35,
      shrink = 0.65,
      taper = 0.6,
      bend = 0.12,
      seed = 1,
    },
    o,
  ) {
    const g = new Geo(),
      R = rng(seed),
      segs = Math.max(4, Math.round(8 * (o.q || 1)));
    const grow = (p0, d0, L, r0, level) => {
      const d = norm(d0),
        side = norm(cross(d, Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0])),
        up = cross(side, d),
        path = [p0],
        radii = [];
      let p = p0,
        dd = d;
      for (let k = 1; k <= segs; k++) {
        // a gently wandering path
        dd = norm(add(dd, add(mulv(side, (R() - 0.5) * bend), mulv(up, (R() - 0.5) * bend))));
        p = add(p, mulv(dd, L / segs));
        path.push(p);
      }
      const r1 = r0 * taper;
      for (let k = 0; k <= segs; k++) radii.push(r0 + ((r1 - r0) * k) / segs);
      g.add(tube(path, radii, o), M.id());
      if (level >= levels) return;
      for (let b = 0; b < branches; b++) {
        const k = b === branches - 1 ? segs : Math.max(1, Math.round(segs * (0.45 + 0.5 * R()))),
          az = 2 * Math.PI * (b / branches + 0.3 * R());
        const perp = add(mulv(side, Math.cos(az)), mulv(up, Math.sin(az))),
          sp = spread * D2R * (0.6 + 0.8 * R());
        grow(
          path[k],
          add(mulv(dd, Math.cos(sp)), mulv(perp, Math.sin(sp))),
          L * shrink * (0.8 + 0.4 * R()),
          radii[k] * 0.85,
          level + 1,
        );
      }
    };
    grow(at, dir, length, r, 1);
    return g;
  }
  // molecule: {atoms: [{el, at: [x, y, z] (ångström)}], bonds: [[i, j, order]], scale, style: 'ball' | 'space'}:
  // atoms in their usual (CPK) colours, ball-and-stick or space-filling; bonds in the two atoms' colours
  function molecule({ atoms = [], bonds = [], scale = 1, style = 'ball', bond = 0.09 }, o) {
    const g = new Geo();
    atoms.forEach((a) => {
      const e = ELEMENTS[a.el] || ELEMENTS.X,
        rad = (a.r ?? (style === 'space' ? e[2] : e[1])) * scale;
      const s = sphere(rad, o).paint(a.color || e[0]);
      g.add(s, M.trans(mulv(a.at, scale)));
    });
    if (style !== 'space')
      for (const [i, j, order = 1] of bonds) {
        const A = mulv(atoms[i].at, scale),
          B = mulv(atoms[j].at, scale),
          { y } = between(A, B),
          w = bond * scale * (order > 1 ? 0.6 : 1);
        for (let k = 0; k < order; k++) {
          // a double or triple bond: rods side by side
          const off = mulv(y, (k - (order - 1) / 2) * w * 2.6),
            a = add(A, off),
            b = add(B, off),
            mid = mulv(add(a, b), 0.5);
          for (const [p, q, el] of [
            [a, mid, atoms[i].el],
            [mid, b, atoms[j].el],
          ]) {
            const t = between(p, q),
              rod = cylinder({ r: w, x0: 0, x1: t.L }, o).paint((ELEMENTS[el] || ELEMENTS.X)[0]);
            g.add(rod, t.m);
          }
        }
      }
    return g;
  }
  // dna: {pairs, seq, r, rise, twist, groove, scale}: a double helix along x in nanometres (radius 1, rise 0.34 per
  // base pair, 10.5 pairs per turn): two backbones and the base pairs between them, coloured A T G C
  function dna(
    {
      pairs = 12,
      seq = 'ATGCGTACGTTAGC',
      r = 1,
      rise = 0.34,
      twist = 360 / 10.5,
      groove = 150,
      wire = 0.11,
      scale = 1,
    },
    o,
  ) {
    const g = new Geo(),
      S = (p) => mulv(p, scale),
      pt = (k, a) => S([k * rise, r * Math.cos(a), r * Math.sin(a)]);
    const n = Math.max(2, pairs),
      per = Math.max(3, Math.round(6 * (o.q || 1))),
      strands = [[], []];
    for (let k = 0; k <= (n - 1) * per; k++) {
      const t = k / per,
        a = t * twist * D2R;
      strands[0].push(pt(t, a));
      strands[1].push(pt(t, a + groove * D2R));
    }
    g.add(tube(strands[0], wire * scale, o).paint(BACKBONE[0]), M.id());
    g.add(tube(strands[1], wire * scale, o).paint(BACKBONE[1]), M.id());
    const PAIR = { A: 'T', T: 'A', G: 'C', C: 'G' };
    for (let k = 0; k < n; k++) {
      const b = seq[k % seq.length].toUpperCase(),
        a = k * twist * D2R,
        p = pt(k, a),
        q = pt(k, a + groove * D2R),
        mid = mulv(add(p, q), 0.5);
      for (const [x, y, base] of [
        [p, mid, b],
        [mid, q, PAIR[b] || 'A'],
      ]) {
        const t = between(x, y);
        g.add(cylinder({ r: wire * 0.6 * scale, x0: 0, x1: t.L }, o).paint(BASES[base]), t.m);
      }
    }
    return g;
  }
  // extrude: {outline: [[x, y], …], depth}: a flat outline (any simple polygon) made solid along z (a rock layer seen
  // in section, a fault block, a Golgi cisterna, a tooth's cross-section)
  function extrude({ outline, depth = 0.2 }) {
    const g = new Geo(),
      P = outline.length && signedArea(outline) < 0 ? outline.slice().reverse() : outline,
      z = depth / 2,
      tri = earcut(P);
    for (const [s, zz] of [
      [1, z],
      [-1, -z],
    ]) {
      const ids = P.map(([x, y]) => g.v([x, y, zz], [0, 0, s]));
      for (const [a, b, c] of tri) g.tri(ids[a], ids[b], ids[c]);
    }
    for (let k = 0; k < P.length; k++) {
      const a = P[k],
        b = P[(k + 1) % P.length],
        n = norm([b[1] - a[1], a[0] - b[0], 0]);
      g.quad(g.v([a[0], a[1], -z], n), g.v([b[0], b[1], -z], n), g.v([b[0], b[1], z], n), g.v([a[0], a[1], z], n));
    }
    return g;
  }
  // terrain: {size: [x, z], res, base, height: {amp, freq, seed}, layers: [{thick, color}], top, tilt}: a block of
  // ground whose top is a smooth landscape and whose sides show its rock layers (top layer first, the last one to the
  // bottom); tilt (degrees) dips the layers along x
  function terrain({ size = [2, 2], res = 24, base = 0.6, height = {}, layers = [], top = '#7a9a55', tilt = 0 }, o) {
    const g = new Geo(),
      n = Math.max(6, Math.round(res * (o.q || 1))),
      nz = noise3(height.seed ?? 3),
      [sx, sz] = size;
    const h = (x, z) => base + (height.amp ?? 0.12) * nz(x * (height.freq ?? 1.5), 0.37, z * (height.freq ?? 1.5));
    const X = (i) => -sx / 2 + (sx * i) / n,
      Z = (j) => -sz / 2 + (sz * j) / n;
    // the top surface, normals from the slope
    const grid = [];
    for (let i = 0; i <= n; i++) {
      const row = [];
      for (let j = 0; j <= n; j++) {
        const x = X(i),
          z = Z(j),
          e = 1e-3;
        row.push(
          g.v(
            [x, h(x, z), z],
            norm([-(h(x + e, z) - h(x - e, z)) / (2 * e), 1, -(h(x, z + e) - h(x, z - e)) / (2 * e)]),
          ),
        );
      }
      grid.push(row);
    }
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) g.quad(grid[i][j], grid[i][j + 1], grid[i + 1][j + 1], grid[i + 1][j]);
    g.paint(top);
    // the layer boundaries under a point: from the top down, then the bottom (y = 0)
    const bounds = (x) => {
      let y = base + Math.tan(tilt * D2R) * x;
      const out = [];
      for (const L of layers.slice(0, -1)) {
        y -= L.thick;
        out.push(y);
      }
      return out;
    };
    const colour = (k) => (layers[Math.min(k, layers.length - 1)] || { color: '#9a8466' }).color;
    // the four sides, in bands of colour
    const side = (pts, nrm) => {
      for (let k = 0; k + 1 < pts.length; k++) {
        const [x0, z0] = pts[k],
          [x1, z1] = pts[k + 1],
          t0 = h(x0, z0),
          t1 = h(x1, z1),
          b0 = bounds(x0),
          b1 = bounds(x1);
        const lev0 = [t0, ...b0.map((y) => Math.min(t0, Math.max(0, y))), 0],
          lev1 = [t1, ...b1.map((y) => Math.min(t1, Math.max(0, y))), 0];
        for (let L = 0; L + 1 < lev0.length; L++) {
          if (lev0[L] - lev0[L + 1] < 1e-9 && lev1[L] - lev1[L + 1] < 1e-9) continue;
          const from = g.count;
          g.quad(
            g.v([x0, lev0[L], z0], nrm),
            g.v([x0, lev0[L + 1], z0], nrm),
            g.v([x1, lev1[L + 1], z1], nrm),
            g.v([x1, lev1[L], z1], nrm),
          );
          g.paint(colour(L), from);
        }
      }
    };
    const edge = (f) => Array.from({ length: n + 1 }, (_, k) => f(k));
    side(
      edge((k) => [X(k), -sz / 2]),
      [0, 0, -1],
    );
    side(
      edge((k) => [sx / 2, Z(k)]),
      [1, 0, 0],
    );
    side(
      edge((k) => [X(n - k), sz / 2]),
      [0, 0, 1],
    );
    side(
      edge((k) => [-sx / 2, Z(n - k)]),
      [-1, 0, 0],
    );
    const from = g.count; // the bottom
    g.quad(
      g.v([-sx / 2, 0, -sz / 2], [0, -1, 0]),
      g.v([sx / 2, 0, -sz / 2], [0, -1, 0]),
      g.v([sx / 2, 0, sz / 2], [0, -1, 0]),
      g.v([-sx / 2, 0, sz / 2], [0, -1, 0]),
    );
    g.paint(colour(layers.length - 1), from);
    return g;
  }
  // ring: {r, ri, thickness}: a flat ring around the x axis (Saturn's rings, a washer)
  const ring = ({ r, ri, thickness = 0.01 }, o) => cylinder({ r, ri, x0: -thickness / 2, x1: thickness / 2 }, o);
  // orbit: {a, e, wire}: an ellipse in the x-z plane with a focus at the origin (where the Sun is): semi-major axis a,
  // eccentricity e
  function orbit({ a, e = 0, wire = 0.01 }, o) {
    const n = Math.max(48, Math.round(160 * (o.q || 1))),
      b = a * Math.sqrt(1 - e * e),
      path = [];
    for (let k = 0; k < n; k++) {
      const t = (2 * Math.PI * k) / n;
      path.push([a * (Math.cos(t) - e), 0, b * Math.sin(t)]);
    }
    return tube(path, wire, { ...o, closed: true });
  }
  // blade: {root, span, chord, tip, twist, thickness, camber}: an airfoil blade standing out along y from radius root
  // to root + span, its chord along x (a fan, compressor or turbine blade; repeat it around the x axis). The section is
  // a NACA-style airfoil of the given thickness and camber (fractions of the chord), turned by twist (degrees) at the
  // root, decreasing to 0 at the tip
  function blade(
    { root = 0.2, span = 0.5, chord = 0.15, tip, twist = 35, thickness = 0.1, camber = 0.04, sweep = 0 },
    o,
  ) {
    const ns = Math.max(4, Math.round(10 * (o.q || 1))),
      na = Math.max(8, Math.round(16 * (o.q || 1))),
      pos = [],
      tris = [];
    const yt = (x) =>
      5 * thickness * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);
    const yc = (x) => camber * 4 * x * (1 - x);
    const ring = []; // the airfoil's outline: upper surface from the leading edge back, lower surface forward
    for (let k = 0; k <= na; k++) {
      const x = (1 - Math.cos((Math.PI * k) / na)) / 2;
      ring.push([x, yc(x) + yt(x)]);
    }
    for (let k = na - 1; k > 0; k--) {
      const x = (1 - Math.cos((Math.PI * k) / na)) / 2;
      ring.push([x, yc(x) - yt(x)]);
    }
    for (let s = 0; s <= ns; s++) {
      const u = s / ns,
        c = chord + ((tip ?? chord) - chord) * u,
        a = twist * (1 - u) * D2R,
        y = root + span * u,
        dx = sweep * span * u;
      for (const [x, z] of ring) {
        const X = (x - 0.5) * c,
          Z = z * c;
        pos.push([X * Math.cos(a) - Z * Math.sin(a) + dx, y, X * Math.sin(a) + Z * Math.cos(a)]);
      }
    }
    const m = ring.length;
    for (let s = 0; s < ns; s++)
      for (let k = 0; k < m; k++) {
        const a = s * m + k,
          b = s * m + ((k + 1) % m),
          c = a + m,
          d = b + m;
        tris.push([a, b, d], [a, d, c]);
      }
    for (const [s, flip] of [
      [0, true],
      [ns, false],
    ]) {
      // root and tip, closed by a fan from the section's middle
      const cIdx = pos.length,
        base = s * m;
      pos.push(
        mulv(
          pos.slice(base, base + m).reduce((p, q) => add(p, q), [0, 0, 0]),
          1 / m,
        ),
      );
      for (let k = 0; k < m; k++)
        tris.push(flip ? [cIdx, base + ((k + 1) % m), base + k] : [cIdx, base + k, base + ((k + 1) % m)]);
    }
    return meshOf(pos, tris);
  }
  return { ellipsoid, capsule, blob, shell, tree, molecule, dna, extrude, terrain, ring, orbit, blade };
};
export { rng, earcut, signedArea };

// [colour (CPK, as Jmol draws them), ball radius (Å, for ball-and-stick), van der Waals radius (Å, space-filling)]
const ELEMENTS = {
  H: ['#ffffff', 0.25, 1.2],
  He: ['#d9ffff', 0.3, 1.4],
  Li: ['#cc80ff', 0.5, 1.82],
  Be: ['#c2ff00', 0.42, 1.53],
  B: ['#ffb5b5', 0.38, 1.92],
  C: ['#3d3d3d', 0.36, 1.7],
  N: ['#3050f8', 0.34, 1.55],
  O: ['#ff2d1f', 0.33, 1.52],
  F: ['#90e050', 0.3, 1.47],
  P: ['#ff8000', 0.45, 1.8],
  S: ['#ffd02a', 0.45, 1.8],
  Cl: ['#1ff01f', 0.44, 1.75],
  Na: ['#ab5cf2', 0.5, 2.27],
  K: ['#8f40d4', 0.55, 2.75],
  Mg: ['#8aff00', 0.45, 1.73],
  Ca: ['#3dff00', 0.5, 2.31],
  Fe: ['#e06633', 0.45, 2.0],
  Cu: ['#c88033', 0.45, 1.4],
  Zn: ['#7d80b0', 0.45, 1.39],
  Ne: ['#b3e3f5', 0.32, 1.54],
  Ar: ['#80d1e3', 0.4, 1.88],
  Br: ['#a62929', 0.47, 1.85],
  I: ['#940094', 0.52, 1.98],
  Si: ['#f0c8a0', 0.45, 2.1],
  Al: ['#bfa6a6', 0.45, 1.84],
  X: ['#ff1493', 0.4, 1.6],
};
const BACKBONE = ['#e0a14a', '#6b8fd6'],
  BASES = { A: '#e8574a', T: '#4a90d9', G: '#f2c14e', C: '#5cb85c' };
function signedArea(P) {
  let a = 0;
  for (let k = 0; k < P.length; k++) {
    const p = P[k],
      q = P[(k + 1) % P.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}
// triangles of a simple polygon given counter-clockwise (ear clipping: fine for the few dozen points of an outline)
function earcut(P) {
  const idx = P.map((_, k) => k),
    out = [],
    cr = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const inTri = (p, a, b, c) => cr(a, b, p) >= 0 && cr(b, c, p) >= 0 && cr(c, a, p) >= 0;
  let guard = 0;
  while (idx.length > 3 && guard++ < 10000) {
    let cut = false;
    for (let k = 0; k < idx.length; k++) {
      const i0 = idx[(k + idx.length - 1) % idx.length],
        i1 = idx[k],
        i2 = idx[(k + 1) % idx.length],
        a = P[i0],
        b = P[i1],
        c = P[i2];
      if (cr(a, b, c) <= 1e-12) continue; // a reflex corner is not an ear
      if (idx.some((j) => j !== i0 && j !== i1 && j !== i2 && inTri(P[j], a, b, c))) continue;
      out.push([i0, i1, i2]);
      idx.splice(k, 1);
      cut = true;
      break;
    }
    if (!cut) break; // degenerate outline: stop rather than loop
  }
  if (idx.length === 3) out.push(idx.slice());
  return out;
}
