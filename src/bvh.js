// Ray queries on the CPU: a bounding-volume tree per geometry, built once. Picking the part under the pointer and the
// ambient occlusion baked into the vertices both use it, so neither ever has to read anything back from the GPU.
import { norm, cross } from './math.js';

function buildBVH(g) {
  const P = g.p,
    I = g.i,
    n = I.length / 3,
    tri = new Uint32Array(n),
    cen = new Float32Array(n * 3),
    tb = new Float32Array(n * 6);
  for (let k = 0; k < n; k++) {
    tri[k] = k;
    for (let a = 0; a < 3; a++) {
      const v0 = P[3 * I[3 * k] + a],
        v1 = P[3 * I[3 * k + 1] + a],
        v2 = P[3 * I[3 * k + 2] + a];
      tb[6 * k + a] = Math.min(v0, v1, v2);
      tb[6 * k + 3 + a] = Math.max(v0, v1, v2);
      cen[3 * k + a] = (v0 + v1 + v2) / 3;
    }
  }
  const box = [],
    kids = [],
    range = [];
  function rec(s, e) {
    const id = range.length / 2,
      lo = [1e30, 1e30, 1e30],
      hi = [-1e30, -1e30, -1e30],
      clo = [1e30, 1e30, 1e30],
      chi = [-1e30, -1e30, -1e30];
    for (let k = s; k < e; k++) {
      const t = tri[k];
      for (let a = 0; a < 3; a++) {
        lo[a] = Math.min(lo[a], tb[6 * t + a]);
        hi[a] = Math.max(hi[a], tb[6 * t + 3 + a]);
        clo[a] = Math.min(clo[a], cen[3 * t + a]);
        chi[a] = Math.max(chi[a], cen[3 * t + a]);
      }
    }
    box.push(lo[0], lo[1], lo[2], hi[0], hi[1], hi[2]);
    range.push(s, e - s);
    kids.push(-1, -1);
    if (e - s <= 4) return id;
    const ext = [chi[0] - clo[0], chi[1] - clo[1], chi[2] - clo[2]],
      ax = ext[0] > ext[1] ? (ext[0] > ext[2] ? 0 : 2) : ext[1] > ext[2] ? 1 : 2;
    if (ext[ax] < 1e-12) return id;
    tri.subarray(s, e).sort((x, y) => cen[3 * x + ax] - cen[3 * y + ax]);
    const mid = (s + e) >> 1,
      l = rec(s, mid),
      r = rec(mid, e);
    kids[2 * id] = l;
    kids[2 * id + 1] = r;
    range[2 * id + 1] = 0;
    return id;
  }
  if (n) rec(0, n);
  return { tri, box: new Float32Array(box), kids: new Int32Array(kids), range: new Uint32Array(range) };
}

// The nearest hit of the ray o + t·d (0 < t < tmax) on the geometry; any: stop at the first hit (for occlusion).
// accept(t, triangle) may refuse a hit (a hit on the cut-away side of a section, say).
/** @param {((t: number, tri: number) => boolean) | null} [accept] */
function intersect(g, bvh, o, d, tmax = Infinity, any = false, accept = null) {
  if (!bvh.box.length) return null;
  const P = g.p,
    I = g.i,
    inv = [1 / d[0], 1 / d[1], 1 / d[2]],
    stack = [0];
  let best = tmax,
    hit = -1;
  for (let nd; (nd = stack.pop()) !== undefined;) {
    const B = bvh.box;
    let t0 = 0,
      t1 = best;
    for (let a = 0; a < 3; a++) {
      let ta = (B[6 * nd + a] - o[a]) * inv[a],
        tb = (B[6 * nd + 3 + a] - o[a]) * inv[a];
      if (ta > tb) {
        const x = ta;
        ta = tb;
        tb = x;
      }
      if (ta > t0) t0 = ta;
      if (tb < t1) t1 = tb;
      if (t0 > t1) break;
    }
    if (t0 > t1) continue;
    const l = bvh.kids[2 * nd];
    if (l >= 0) {
      stack.push(l, bvh.kids[2 * nd + 1]);
      continue;
    }
    const s = bvh.range[2 * nd],
      c = bvh.range[2 * nd + 1];
    for (let k = s; k < s + c; k++) {
      // Möller–Trumbore
      const t = bvh.tri[k],
        i0 = 3 * I[3 * t],
        i1 = 3 * I[3 * t + 1],
        i2 = 3 * I[3 * t + 2];
      const e1x = P[i1] - P[i0],
        e1y = P[i1 + 1] - P[i0 + 1],
        e1z = P[i1 + 2] - P[i0 + 2],
        e2x = P[i2] - P[i0],
        e2y = P[i2 + 1] - P[i0 + 1],
        e2z = P[i2 + 2] - P[i0 + 2];
      const px = d[1] * e2z - d[2] * e2y,
        py = d[2] * e2x - d[0] * e2z,
        pz = d[0] * e2y - d[1] * e2x,
        det = e1x * px + e1y * py + e1z * pz;
      if (Math.abs(det) < 1e-14) continue;
      const id = 1 / det,
        tx = o[0] - P[i0],
        ty = o[1] - P[i0 + 1],
        tz = o[2] - P[i0 + 2],
        u = (tx * px + ty * py + tz * pz) * id;
      if (u < 0 || u > 1) continue;
      const qx = ty * e1z - tz * e1y,
        qy = tz * e1x - tx * e1z,
        qz = tx * e1y - ty * e1x,
        v = (d[0] * qx + d[1] * qy + d[2] * qz) * id;
      if (v < 0 || u + v > 1) continue;
      const tt = (e2x * qx + e2y * qy + e2z * qz) * id;
      if (tt > 1e-7 && tt < best && (!accept || accept(tt, t))) {
        best = tt;
        hit = t;
        if (any) return { t: tt, tri: t };
      }
    }
  }
  return hit < 0 ? null : { t: best, tri: hit };
}

// Ambient occlusion per vertex: how much of the half-sky above each vertex its own shape hides, from a dozen short rays.
// It is computed a slice at a time (budget ms per slice) so the first picture never waits for it.
const DIRS = (() => {
  // cosine-weighted directions around +z, spread evenly (a Fibonacci spiral)
  const n = 12,
    out = [];
  for (let k = 0; k < n; k++) {
    const r = Math.sqrt((k + 0.5) / n),
      a = k * 2.399963229728653;
    out.push([r * Math.cos(a), r * Math.sin(a), Math.sqrt(Math.max(0, 1 - r * r))]);
  }
  return out;
})();
function aoJob(g, bvh, reach) {
  const out = new Uint8Array(g.count).fill(255),
    P = g.p,
    N = g.n;
  let v = 0;
  return {
    out,
    step(budgetMs) {
      // returns true when finished
      const end = performance.now() + budgetMs;
      for (; v < g.count; v++) {
        if ((v & 63) === 0 && performance.now() > end) return false;
        const n = [N[3 * v], N[3 * v + 1], N[3 * v + 2]],
          t = Math.abs(n[0]) < 0.9 ? norm(cross(n, [1, 0, 0])) : norm(cross(n, [0, 1, 0])),
          b = cross(n, t);
        const o = [
          P[3 * v] + n[0] * reach * 0.01,
          P[3 * v + 1] + n[1] * reach * 0.01,
          P[3 * v + 2] + n[2] * reach * 0.01,
        ];
        let hits = 0;
        for (const s of DIRS) {
          const d = [
            t[0] * s[0] + b[0] * s[1] + n[0] * s[2],
            t[1] * s[0] + b[1] * s[1] + n[1] * s[2],
            t[2] * s[0] + b[2] * s[1] + n[2] * s[2],
          ];
          if (intersect(g, bvh, o, d, reach, true)) hits++;
        }
        out[v] = Math.round(255 * (1 - (0.8 * hits) / DIRS.length));
      }
      return true;
    },
  };
}

export { buildBVH, intersect, aoJob };
