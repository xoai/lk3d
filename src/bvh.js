// Ray queries on the CPU: a bounding-volume tree per geometry, built once. Picking the part under the pointer and the
// ambient occlusion baked into the vertices both use it, so neither ever has to read anything back from the GPU.
import { norm, cross } from './math.js';

// The tree: node k has its box at boxes[6k..6k+5] (low corner, high corner), its two children at children[2k] and
// children[2k+1] (-1 for a leaf), and a leaf's run of `triangles` at ranges[2k] (start) and ranges[2k+1] (count).
function buildBVH(mesh) {
  const positions = mesh.positions,
    indices = mesh.indices,
    triangleCount = indices.length / 3,
    triangles = new Uint32Array(triangleCount),
    centroids = new Float32Array(triangleCount * 3),
    triangleBoxes = new Float32Array(triangleCount * 6);
  for (let k = 0; k < triangleCount; k++) {
    triangles[k] = k;
    for (let axis = 0; axis < 3; axis++) {
      const v0 = positions[3 * indices[3 * k] + axis],
        v1 = positions[3 * indices[3 * k + 1] + axis],
        v2 = positions[3 * indices[3 * k + 2] + axis];
      triangleBoxes[6 * k + axis] = Math.min(v0, v1, v2);
      triangleBoxes[6 * k + 3 + axis] = Math.max(v0, v1, v2);
      centroids[3 * k + axis] = (v0 + v1 + v2) / 3;
    }
  }
  const boxes = [],
    children = [],
    ranges = [];
  function buildNode(start, end) {
    const node = ranges.length / 2,
      lo = [1e30, 1e30, 1e30],
      hi = [-1e30, -1e30, -1e30],
      centroidLo = [1e30, 1e30, 1e30],
      centroidHi = [-1e30, -1e30, -1e30];
    for (let k = start; k < end; k++) {
      const triangle = triangles[k];
      for (let axis = 0; axis < 3; axis++) {
        lo[axis] = Math.min(lo[axis], triangleBoxes[6 * triangle + axis]);
        hi[axis] = Math.max(hi[axis], triangleBoxes[6 * triangle + 3 + axis]);
        centroidLo[axis] = Math.min(centroidLo[axis], centroids[3 * triangle + axis]);
        centroidHi[axis] = Math.max(centroidHi[axis], centroids[3 * triangle + axis]);
      }
    }
    boxes.push(lo[0], lo[1], lo[2], hi[0], hi[1], hi[2]);
    ranges.push(start, end - start);
    children.push(-1, -1);
    if (end - start <= 4) return node;
    const extent = [centroidHi[0] - centroidLo[0], centroidHi[1] - centroidLo[1], centroidHi[2] - centroidLo[2]],
      splitAxis = extent[0] > extent[1] ? (extent[0] > extent[2] ? 0 : 2) : extent[1] > extent[2] ? 1 : 2;
    if (extent[splitAxis] < 1e-12) return node;
    triangles.subarray(start, end).sort((a, b) => centroids[3 * a + splitAxis] - centroids[3 * b + splitAxis]);
    const mid = (start + end) >> 1,
      left = buildNode(start, mid),
      right = buildNode(mid, end);
    children[2 * node] = left;
    children[2 * node + 1] = right;
    ranges[2 * node + 1] = 0;
    return node;
  }
  if (triangleCount) buildNode(0, triangleCount);
  return {
    triangles,
    boxes: new Float32Array(boxes),
    children: new Int32Array(children),
    ranges: new Uint32Array(ranges),
  };
}

// The nearest hit of the ray o + t·d (0 < t < tmax) on the geometry; any: stop at the first hit (for occlusion).
// accept(t, triangle) may refuse a hit (a hit on the cut-away side of a section, say).
/** @param {((t: number, triangle: number) => boolean) | null} [accept] */
function intersect(mesh, bvh, o, d, tmax = Infinity, any = false, accept = null) {
  if (!bvh.boxes.length) return null;
  const positions = mesh.positions,
    indices = mesh.indices,
    inverseDirection = [1 / d[0], 1 / d[1], 1 / d[2]],
    stack = [0];
  let best = tmax,
    hit = -1;
  for (let node; (node = stack.pop()) !== undefined;) {
    const boxes = bvh.boxes;
    let tNear = 0,
      tFar = best;
    for (let axis = 0; axis < 3; axis++) {
      let tLow = (boxes[6 * node + axis] - o[axis]) * inverseDirection[axis],
        tHigh = (boxes[6 * node + 3 + axis] - o[axis]) * inverseDirection[axis];
      if (tLow > tHigh) {
        const swap = tLow;
        tLow = tHigh;
        tHigh = swap;
      }
      if (tLow > tNear) tNear = tLow;
      if (tHigh < tFar) tFar = tHigh;
      if (tNear > tFar) break;
    }
    if (tNear > tFar) continue;
    const left = bvh.children[2 * node];
    if (left >= 0) {
      stack.push(left, bvh.children[2 * node + 1]);
      continue;
    }
    const start = bvh.ranges[2 * node],
      count = bvh.ranges[2 * node + 1];
    for (let k = start; k < start + count; k++) {
      // Möller–Trumbore
      const triangle = bvh.triangles[k],
        i0 = 3 * indices[3 * triangle],
        i1 = 3 * indices[3 * triangle + 1],
        i2 = 3 * indices[3 * triangle + 2];
      const e1x = positions[i1] - positions[i0],
        e1y = positions[i1 + 1] - positions[i0 + 1],
        e1z = positions[i1 + 2] - positions[i0 + 2],
        e2x = positions[i2] - positions[i0],
        e2y = positions[i2 + 1] - positions[i0 + 1],
        e2z = positions[i2 + 2] - positions[i0 + 2];
      const px = d[1] * e2z - d[2] * e2y,
        py = d[2] * e2x - d[0] * e2z,
        pz = d[0] * e2y - d[1] * e2x,
        det = e1x * px + e1y * py + e1z * pz;
      if (Math.abs(det) < 1e-14) continue;
      const inverseDet = 1 / det,
        tx = o[0] - positions[i0],
        ty = o[1] - positions[i0 + 1],
        tz = o[2] - positions[i0 + 2],
        u = (tx * px + ty * py + tz * pz) * inverseDet;
      if (u < 0 || u > 1) continue;
      const qx = ty * e1z - tz * e1y,
        qy = tz * e1x - tx * e1z,
        qz = tx * e1y - ty * e1x,
        v = (d[0] * qx + d[1] * qy + d[2] * qz) * inverseDet;
      if (v < 0 || u + v > 1) continue;
      const t = (e2x * qx + e2y * qy + e2z * qz) * inverseDet;
      if (t > 1e-7 && t < best && (!accept || accept(t, triangle))) {
        best = t;
        hit = triangle;
        if (any) return { t, triangle };
      }
    }
  }
  return hit < 0 ? null : { t: best, triangle: hit };
}

// Ambient occlusion per vertex: how much of the half-sky above each vertex its own shape hides, from a dozen short rays.
// It is computed a slice at a time (budget ms per slice) so the first picture never waits for it.
const DIRS = (() => {
  // cosine-weighted directions around +z, spread evenly (a Fibonacci spiral)
  const count = 12,
    out = [];
  for (let k = 0; k < count; k++) {
    const r = Math.sqrt((k + 0.5) / count),
      angle = k * 2.399963229728653;
    out.push([r * Math.cos(angle), r * Math.sin(angle), Math.sqrt(Math.max(0, 1 - r * r))]);
  }
  return out;
})();
function aoJob(mesh, bvh, reach) {
  const out = new Uint8Array(mesh.count).fill(255),
    positions = mesh.positions,
    normals = mesh.normals;
  let v = 0;
  return {
    out,
    step(budgetMs) {
      // returns true when finished
      const end = performance.now() + budgetMs;
      for (; v < mesh.count; v++) {
        if ((v & 63) === 0 && performance.now() > end) return false;
        const normal = [normals[3 * v], normals[3 * v + 1], normals[3 * v + 2]],
          tangent = Math.abs(normal[0]) < 0.9 ? norm(cross(normal, [1, 0, 0])) : norm(cross(normal, [0, 1, 0])),
          bitangent = cross(normal, tangent);
        const origin = [
          positions[3 * v] + normal[0] * reach * 0.01,
          positions[3 * v + 1] + normal[1] * reach * 0.01,
          positions[3 * v + 2] + normal[2] * reach * 0.01,
        ];
        let hits = 0;
        for (const sample of DIRS) {
          const direction = [
            tangent[0] * sample[0] + bitangent[0] * sample[1] + normal[0] * sample[2],
            tangent[1] * sample[0] + bitangent[1] * sample[1] + normal[1] * sample[2],
            tangent[2] * sample[0] + bitangent[2] * sample[1] + normal[2] * sample[2],
          ];
          if (intersect(mesh, bvh, origin, direction, reach, true)) hits++;
        }
        out[v] = Math.round(255 * (1 - (0.8 * hits) / DIRS.length));
      }
      return true;
    },
  };
}

export { buildBVH, intersect, aoJob };
