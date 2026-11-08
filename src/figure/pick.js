// @ts-check
// Picking: a ray from the eye through a point of the stage, against each part's bounding-volume trees (bvh.js, each
// built when first needed, or in idle time: idle.js); the nearest hit on a part that is drawn and not cut away. Owns
// bvhOf_, pickHit_ and pickAt_; reads built_ and state_, and calls rayAt_ and cutPlane_.
import { M, add, mulv } from '../math.js';
import { buildBVH, intersect } from '../bvh.js';

/** @param {import('./context').Ctx} c */
export function makePick(c) {
  const trees = new WeakMap(); // (per geometry: parts alike share one tree)
  c.bvhOf_ = (b) => {
    if (!b.bvh) {
      if (!trees.has(b.geo)) trees.set(b.geo, buildBVH(b.geo));
      b.bvh = trees.get(b.geo);
    }
    return b.bvh;
  };
  // where the ray A + D t enters a part's box as it is now (its box at rest, moved by its matrix), or Infinity
  function rayBox(A, D, p) {
    const lo = [Infinity, Infinity, Infinity],
      hi = [-Infinity, -Infinity, -Infinity];
    for (let k = 0; k < 8; k++) {
      const w = M.pt(p.m, [k & 1 ? p.hi[0] : p.lo[0], k & 2 ? p.hi[1] : p.lo[1], k & 4 ? p.hi[2] : p.lo[2]]);
      for (let a = 0; a < 3; a++) {
        lo[a] = Math.min(lo[a], w[a]);
        hi[a] = Math.max(hi[a], w[a]);
      }
    }
    let t0 = 0,
      t1 = Infinity;
    for (let a = 0; a < 3; a++) {
      if (!D[a]) {
        if (A[a] < lo[a] || A[a] > hi[a]) return Infinity; // (parallel to this side, and outside it)
        continue;
      }
      const u = (lo[a] - A[a]) / D[a],
        v = (hi[a] - A[a]) / D[a];
      t0 = Math.max(t0, Math.min(u, v));
      t1 = Math.min(t1, Math.max(u, v));
    }
    return t0 <= t1 ? t0 : Infinity;
  }
  c.pickHit_ = (px, py, see = 0.3) => {
    // parts fainter than `see` let the ray through; the part hit, and where along the ray (A + D t)
    const { A, D } = c.rayAt_(px, py),
      plane = c.cutPlane_();
    let best = Infinity,
      id = null;
    for (const p of c.built_.parts) {
      if (p.drawAlpha < see || rayBox(A, D, p) >= best) continue; // (missed by the ray, or behind a nearer hit)
      for (const b of p.batches)
        for (const placed of b.mats) {
          // (the ray into the shape's own frame: the tree is built there)
          const toShape = M.invert(M.mul(p.m, placed)),
            o = M.pt(toShape, A),
            d = M.dir(toShape, D);
          // (a hit on the side the cut takes away does not count)
          const accept =
            c.state_.cut && p.cut
              ? (t) => {
                  const w = add(A, mulv(D, t));
                  return plane[0] * w[0] + plane[1] * w[1] + plane[2] * w[2] + plane[3] <= 0;
                }
              : null;
          const hit = intersect(b.geo, c.bvhOf_(b), o, d, best, false, accept);
          if (hit && hit.t < best) {
            best = hit.t;
            id = p.id;
          }
        }
    }
    return { id, t: best, A, D };
  };
  c.pickAt_ = (px, py, see) => c.pickHit_(px, py, see).id;
}
