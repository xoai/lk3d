// @ts-check
// Picking: a ray from the eye through a point of the stage, against each part's bounding-volume trees (bvh.js, each
// built when first needed, or in idle time: idle.js); the nearest hit on a part that is drawn and not cut away, and
// whether what is seen there is the part's cut face. Owns bvhOf_, pickHit_ and pickAt_; reads built_ and state_, and
// calls rayAt_, cutPlane_ and cutPlane2_.
import { M, add, sub, mulv, cross, dot, norm } from '../math.js';
import { buildBVH, intersect } from '../bvh.js';

// whether a triangle's outward face (its corners anticlockwise) is turned away from a ray going this way
/** @param {{ positions: ArrayLike<number>, indices: ArrayLike<number> }} mesh @param {number} triangle @param {number[]} direction */
function facesAway(mesh, triangle, direction) {
  const [a, b, d] = [0, 1, 2].map((corner) => 3 * mesh.indices[3 * triangle + corner]),
    corner = (index) => [mesh.positions[index], mesh.positions[index + 1], mesh.positions[index + 2]],
    normal = cross(sub(corner(b), corner(a)), sub(corner(d), corner(a)));
  return dot(normal, direction) > 0;
}

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
      plane = c.cutPlane_(),
      second = c.cutPlane2_();
    let best = Infinity,
      /** @type {string | null} */
      id = null,
      onCut = false,
      /** @type {any} */
      seen = null; // (the triangle hit, for hit()'s normal: its mesh, its index, and the ray into its frame)
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
            c.state_.cut && part.cut && c.renderer_.kind !== '2d' // (the 2D fallback draws no cut)
              ? (t) => {
                  const point = add(origin, mulv(direction, t)),
                    beyond = (p) => p[0] * point[0] + p[1] * point[1] + p[2] * point[2] + p[3] > 0;
                  return !(beyond(plane) && beyond(second)); // (cut away only beyond both, in a quarter cut)
                }
              : null;
          const hit = intersect(batch.mesh, c.bvhOf_(batch), shapeOrigin, shapeDirection, best, false, accept);
          if (hit && hit.t < best) {
            best = hit.t;
            id = part.id;
            // (a cut part's surface seen from inside, its outward face turned away from the eye: the ray came in
            // through the cut, so what is seen there is the cut face, filled at the plane)
            onCut = !!accept && facesAway(batch.mesh, hit.triangle, shapeDirection);
            seen = { mesh: batch.mesh, triangle: hit.triangle, toShape };
          }
        }
    }
    return { id, t: best, origin, direction, onCut, seen };
  };
  c.pickAt_ = (x, y, minAlpha) => c.pickHit_(x, y, minAlpha).id;
  // where a ray seen to meet a cut face crosses the cut: the first plane's face, or in a quarter cut the second's, where
  // the ray's crossing of the first lies outside the cut-away wedge; null if the ray runs along it
  c.cutCrossing_ = (origin, direction) => {
    const crossing = (/** @type {number[]} */ plane) => {
      const facing = dot(plane.slice(0, 3), direction);
      return Math.abs(facing) < 1e-9
        ? null
        : add(origin, mulv(direction, -(dot(plane.slice(0, 3), origin) + plane[3]) / facing));
    };
    const first = c.cutPlane_(),
      other = c.cutPlane2_();
    let plane = first,
      point = crossing(first);
    const second = !point || dot(other.slice(0, 3), point) + other[3] < 0;
    if (second) point = crossing((plane = other));
    return point && { point, plane, second };
  };
  // what is under a point of the stage, for the page (fig.hit): the nearest part or surface (an addition with a hit),
  // the point there, the face's direction (facing the eye), how far along the ray, and whether it is a cut face; or
  // where the ray meets a plane the page names
  c.hit_ = (x, y, { plane, surfaces = true, minAlpha = 0.3 } = {}) => {
    const { origin, direction } = c.rayAt_(x, y),
      facingEye = (/** @type {number[]} */ normal) => (dot(normal, direction) > 0 ? mulv(normal, -1) : normal);
    if (plane) {
      const normal = norm(plane.normal),
        facing = dot(normal, direction),
        t = Math.abs(facing) < 1e-9 ? -1 : dot(normal, sub(plane.point, origin)) / facing;
      return t > 0
        ? { id: null, point: add(origin, mulv(direction, t)), normal: facingEye(normal), distance: t, cut: false }
        : null;
    }
    const found = c.pickHit_(x, y, minAlpha);
    /** @type {any} */
    let best = null;
    if (found.id) {
      const cutAt = found.onCut && c.cutCrossing_(origin, direction);
      if (cutAt)
        best = {
          id: found.id,
          point: cutAt.point,
          normal: facingEye(norm(cutAt.plane.slice(0, 3))),
          distance: dot(sub(cutAt.point, origin), direction),
          cut: true,
        };
      else {
        // (the triangle's normal in its shape's frame, into the scene by the inverse transpose of its matrix)
        const { mesh, triangle, toShape } = /** @type {any} */ (found.seen),
          corner = (/** @type {number} */ k) => {
            const i = 3 * mesh.indices[3 * triangle + k];
            return [mesh.positions[i], mesh.positions[i + 1], mesh.positions[i + 2]];
          },
          n = cross(sub(corner(1), corner(0)), sub(corner(2), corner(0)));
        best = {
          id: found.id,
          point: add(origin, mulv(direction, found.t)),
          normal: facingEye(
            norm([0, 1, 2].map((r) => toShape[4 * r] * n[0] + toShape[4 * r + 1] * n[1] + toShape[4 * r + 2] * n[2])),
          ),
          distance: found.t,
          cut: false,
        };
      }
    }
    if (surfaces)
      for (const addition of c.additions_)
        if (addition.hit && addition.visible) {
          const h = addition.hit(origin, direction);
          if (h && (!best || h.t < best.distance))
            best = { id: h.id, point: h.point, normal: facingEye(norm(h.normal)), distance: h.t, cut: false };
        }
    return best;
  };
}
