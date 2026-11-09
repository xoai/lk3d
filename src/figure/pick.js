// @ts-check
// Picking: a ray from the eye through a point of the stage, against each part's bounding-volume trees (bvh.js, each
// built when first needed, or in idle time: idle.js); the nearest hit on a part that is drawn and not cut away. Owns
// bvhOf_, pickHit_ and pickAt_; reads built_ and state_, and calls rayAt_ and cutPlane_.
import { M, add, mulv } from '../math.js';
import { buildBVH, intersect } from '../bvh.js';

/** @param {import('./context').Ctx} c */
export function makePick(c) {
  const trees = new WeakMap(); // (per geometry: parts alike share one tree)
  c.bvhOf_ = (batch) => {
    if (!batch.bvh) {
      if (!trees.has(batch.mesh)) trees.set(batch.mesh, buildBVH(batch.mesh));
      batch.bvh = trees.get(batch.mesh);
    }
    return batch.bvh;
  };
  // where the ray origin + direction t enters a part's box as it is now (its box at rest, moved by its matrix), or
  // Infinity
  function rayBox(origin, direction, part) {
    const lo = [Infinity, Infinity, Infinity],
      hi = [-Infinity, -Infinity, -Infinity];
    for (let corner = 0; corner < 8; corner++) {
      const world = M.pt(part.matrix, [
        corner & 1 ? part.max[0] : part.min[0],
        corner & 2 ? part.max[1] : part.min[1],
        corner & 4 ? part.max[2] : part.min[2],
      ]);
      for (let axis = 0; axis < 3; axis++) {
        lo[axis] = Math.min(lo[axis], world[axis]);
        hi[axis] = Math.max(hi[axis], world[axis]);
      }
    }
    let enter = 0,
      leave = Infinity;
    for (let axis = 0; axis < 3; axis++) {
      if (!direction[axis]) {
        if (origin[axis] < lo[axis] || origin[axis] > hi[axis]) return Infinity; // (parallel to this side, and outside it)
        continue;
      }
      const toLo = (lo[axis] - origin[axis]) / direction[axis],
        toHi = (hi[axis] - origin[axis]) / direction[axis];
      enter = Math.max(enter, Math.min(toLo, toHi));
      leave = Math.min(leave, Math.max(toLo, toHi));
    }
    return enter <= leave ? enter : Infinity;
  }
  c.pickHit_ = (x, y, minAlpha = 0.3) => {
    // parts fainter than minAlpha let the ray through; the part hit, and where along the ray (A + D t)
    const { origin, direction } = c.rayAt_(x, y),
      plane = c.cutPlane_();
    let best = Infinity,
      /** @type {string | null} */
      id = null;
    for (const part of c.built_.parts) {
      if (part.drawAlpha < minAlpha || rayBox(origin, direction, part) >= best) continue; // (missed by the ray, or behind a nearer hit)
      for (const batch of part.batches)
        for (const placed of batch.placements) {
          // (the ray into the shape's own frame: the tree is built there)
          const toShape = M.invert(M.mul(part.matrix, placed)),
            shapeOrigin = M.pt(toShape, origin),
            shapeDirection = M.dir(toShape, direction);
          // (a hit on the side the cut takes away does not count)
          const accept =
            c.state_.cut && part.cut
              ? (t) => {
                  const point = add(origin, mulv(direction, t));
                  return plane[0] * point[0] + plane[1] * point[1] + plane[2] * point[2] + plane[3] <= 0;
                }
              : null;
          const hit = intersect(batch.mesh, c.bvhOf_(batch), shapeOrigin, shapeDirection, best, false, accept);
          if (hit && hit.t < best) {
            best = hit.t;
            id = part.id;
          }
        }
    }
    return { id, t: best, origin, direction };
  };
  c.pickAt_ = (x, y, minAlpha) => c.pickHit_(x, y, minAlpha).id;
}
