// @ts-check
// What a page shapes and points with, drawn as parts: arrows (lines with a cone at each tip) and surfaces (heights on a
// grid, as one smooth mesh). The live add-on (live-script.js, dist/lk3d-live.min.js) and the ES module (index.js) give
// them to the core as LK3D.live; each is made with what the figure lends (its host: additions.js), never from the
// figure's own fields, and imports no module of the core.

/** @typedef {any} Host */

// ---- arrows: shafts on the lent cylinder and heads on the lent cone, both drawn by instancing (one draw each)
/** @param {Host} host @param {{ count?: number, radius?: number, head?: { length?: number, radius?: number },
 *   color?: string, studioColor?: string, glow?: string | null }} options */
export function arrows(
  host,
  { count = 8, radius = 0.01, head = {}, color = '#ffcc55', studioColor, glow = null } = {},
) {
  /** @returns {{ mesh: any, placements: any[], outlineNormals: any, dynamic: boolean }} */
  const batch = (/** @type {any} */ mesh) => ({
    mesh,
    placements: [],
    outlineNormals: host.outlines(mesh),
    dynamic: true,
  });
  const shafts = batch(host.unit('cylinder')),
    heads = batch(host.unit('cone')),
    look = { color, studioColor, glow },
    parts = [host.part('arrows', [shafts], look), host.part('arrows', [heads], look)],
    /** @type {(any[] | null)[]} */
    list = new Array(count).fill(null);
  const entry = {
    parts,
    visible: true,
    dirty: true,
    reupload(/** @type {any} */ renderer) {
      if (renderer.upload) for (const each of [shafts, heads]) renderer.upload(each);
    },
    place() {
      shafts.placements = [];
      heads.placements = [];
      for (const arrow of list) {
        if (!arrow) continue;
        const [from, to, own] = arrow,
          along = [to[0] - from[0], to[1] - from[1], to[2] - from[2]],
          length = Math.hypot(along[0], along[1], along[2]);
        if (length < 1e-6) continue; // (too short to draw)
        const r = own ?? radius;
        let headLength = head.length ?? 4 * r,
          headRadius = head.radius ?? 2.2 * r;
        if (length < 2.5 * headLength) {
          // (a short arrow: its head at most 40 % of it, as wide for its length as a full one)
          const shrink = (0.4 * length) / headLength;
          headLength *= shrink;
          headRadius *= shrink;
        }
        const base = from.map((value, axis) => value + (along[axis] * (length - headLength)) / length);
        shafts.placements.push(host.rod(from, base, r));
        heads.placements.push(host.rod(base, to, headRadius));
      }
      host.instances(shafts);
      host.instances(heads);
    },
  };
  const changed = () => {
    entry.dirty = true;
    host.kick();
  };
  host.add(entry);
  return {
    /** @param {number} k @param {number[] | null} from @param {number[]} [to] @param {number} [own] */
    set(k, from, to, own) {
      if (k >= 0 && k < count) list[k] = from && to ? [from, to, own] : null;
      changed();
    },
    clear() {
      list.fill(null);
      changed();
    },
    glow(/** @type {number} */ strength) {
      for (const part of parts) part.emission = part.glowColor.map((/** @type {number} */ v) => v * strength);
      host.kick();
    },
    remove: () => host.remove(entry),
    get visible() {
      return entry.visible;
    },
    set visible(on) {
      entry.visible = on;
      host.kick();
    },
  };
}

// ---- surfaces: heights the page writes for each point of a grid (i along x, j along z: index i + nx * j), drawn as
// one two-sided mesh, in strips of rows that share their edge rows (each under 65,536 points, so no device needs
// 32-bit indices); normals by central differences, tones along a ramp; refilled in place when the page updates it. The
// 2D fallback, which sorts every triangle, draws a grid of at most 64 × 64 sampled from it. A ray finds it by marching
// over its heights (no tree to build again each frame)
let surfaces = 0;
/** @param {Host} host @param {any} options */
export function surface(
  host,
  {
    id,
    size,
    res,
    at = [0, 0, 0],
    rot = [0, 0, 0],
    material = 'water',
    color = '#9fc3d9',
    studioColor,
    colors,
    smooth,
  } = {},
) {
  const [nx, nz] = res || [],
    [sx, sz] = size || [],
    whole = (/** @type {any} */ n) => Number.isInteger(n) && n >= 2 && n <= 512;
  if (!(whole(nx) && whole(nz)))
    throw new Error(`lk3d: a surface's res is two whole numbers from 2 to 512, not ${res}`);
  if (!(sx > 0 && sz > 0)) throw new Error(`lk3d: a surface's size is two numbers above 0, not ${size}`);
  if (id != null && host.taken(id)) throw new Error(`lk3d: the id ${id} is a part's or another surface's`);
  const triangles = 2 * (nx - 1) * (nz - 1),
    now = host.triangles(),
    most = host.maxTriangles();
  if (now + triangles > most)
    throw new Error(
      `lk3d: the surface would have ${triangles} triangles; the limit here is ${most} with the scene's ${now}`,
    );
  const M = host.M,
    placement = M.trs(at, rot),
    toLocal = M.invert(placement),
    dx = sx / (nx - 1),
    dz = sz / (nz - 1);
  let heights = new Float32Array(nx * nz),
    tones = colors ? new Float32Array(nx * nz) : null,
    warned = false;
  // a height at a point of the grid's index space (fractional between points): bilinear; NaN drawn as 0, said once
  const height = (/** @type {number} */ k) => {
    const h = heights[k];
    if (h === h) return h;
    if (!warned) console.warn('lk3d: a surface has heights that are not numbers: drawn at 0');
    warned = true;
    return 0;
  };
  const sample = (/** @type {number} */ fi, /** @type {number} */ fj) => {
    const i = Math.min(nx - 2, Math.floor(fi)),
      j = Math.min(nz - 2, Math.floor(fj)),
      u = fi - i,
      v = fj - j,
      k = i + nx * j;
    return (
      (height(k) * (1 - u) + height(k + 1) * u) * (1 - v) + (height(k + nx) * (1 - u) + height(k + nx + 1) * u) * v
    );
  };
  // a grid of gx × gz points over the surface, in strips: its batches, each vertex's place in the surface's index space
  const grid = (/** @type {number} */ gx, /** @type {number} */ gz) => {
    const perStrip = Math.max(2, Math.floor(65535 / gx)),
      /** @type {any[]} */
      made = [];
    for (let from = 0; from < gz - 1; from += perStrip - 1) {
      const rows = Math.min(gz - from, perStrip),
        count = rows * gx,
        indices = [];
      for (let j = 0; j < rows - 1; j++)
        for (let i = 0; i < gx - 1; i++) {
          const k = j * gx + i;
          indices.push(k, k + gx, k + 1, k + 1, k + gx, k + gx + 1); // (anticlockwise seen from above: facing up)
        }
      const normals = new Float32Array(count * 3);
      made.push({
        mesh: {
          positions: new Float32Array(count * 3),
          normals,
          indices,
          colors: colors ? new Uint8Array(count * 4) : null,
          count,
          twoSided: true,
        },
        placements: [placement],
        outlineNormals: normals,
        dynamic: true,
        from, // (its first row, in this grid)
        gx,
        step: [(nx - 1) / (gx - 1), (nz - 1) / (gz - 1)], // (this grid's spacing in the surface's index space)
      });
    }
    return made;
  };
  const batches = grid(nx, nz);
  /** @type {any[] | null} */
  let small = nx > 64 || nz > 64 ? null : batches; // (the 2D fallback's grid: made when first needed)
  // the mesh from the heights: positions, normals, and the tones' colours. The full grid reads its points' heights
  // straight (no sampling, nothing made for each point: a 256 × 256 surface reshaped every frame); the 2D fallback's
  // smaller grid samples between them. The ramp is looked up in a table of 256 colours, made once a call
  const shape = (/** @type {any[]} */ list) => {
    const stops = colors && host.ramp(colors, host.dark()),
      table = stops && Array.from({ length: 256 }, (_, k) => host.tone(stops, k / 255, smooth));
    for (const batch of list) {
      const { positions, normals, colors: rgba, count } = batch.mesh,
        [si, sj] = batch.step,
        exact = si === 1 && sj === 1;
      for (let k = 0; k < count; k++) {
        const fi = (k % batch.gx) * si,
          fj = (batch.from + ((k / batch.gx) | 0)) * sj;
        let y, gradX, gradZ;
        if (exact) {
          const c = fi + nx * fj,
            left = fi > 0 ? 1 : 0,
            right = fi < nx - 1 ? 1 : 0,
            back = fj > 0 ? nx : 0,
            front = fj < nz - 1 ? nx : 0;
          y = height(c);
          gradX = (height(c + right) - height(c - left)) / ((left + right) * dx);
          gradZ = (height(c + front) - height(c - back)) / (((back + front) / nx) * dz);
        } else {
          const i0 = Math.max(0, fi - si),
            i1 = Math.min(nx - 1, fi + si),
            j0 = Math.max(0, fj - sj),
            j1 = Math.min(nz - 1, fj + sj);
          y = sample(fi, fj);
          gradX = (sample(i1, fj) - sample(i0, fj)) / ((i1 - i0) * dx);
          gradZ = (sample(fi, j1) - sample(fi, j0)) / ((j1 - j0) * dz);
        }
        const length = Math.hypot(gradX, 1, gradZ);
        positions[3 * k] = fi * dx - sx / 2;
        positions[3 * k + 1] = y;
        positions[3 * k + 2] = fj * dz - sz / 2;
        normals[3 * k] = -gradX / length;
        normals[3 * k + 1] = 1 / length;
        normals[3 * k + 2] = -gradZ / length;
        if (rgba && tones && table) {
          const tone = tones[Math.round(fi) + nx * Math.round(fj)],
            colour = table[tone > 0 ? (tone < 1 ? Math.round(tone * 255) : 255) : 0];
          rgba[4 * k] = colour[0] * 255;
          rgba[4 * k + 1] = colour[1] * 255;
          rgba[4 * k + 2] = colour[2] * 255;
          rgba[4 * k + 3] = 255;
        }
      }
    }
  };
  const part = host.part('surface', batches, { color, studioColor, material, tint: 0.4 });
  part.id = id ?? `surface-${++surfaces}`;
  part.soft = true; // (no shadow, no outline)
  part.cut = false; // (an open sheet: cut, its underside would be drawn as a cap)
  shape(batches);
  // where a ray (in the scene) meets the surface: marched in the surface's frame a quarter of a cell at a time, within
  // the box of its heights, the crossing then found by halving
  const hit = (/** @type {number[]} */ origin, /** @type {number[]} */ direction) => {
    const o = M.pt(toLocal, origin),
      d = M.dir(toLocal, direction);
    let low = Infinity,
      high = -Infinity;
    for (let k = 0; k < nx * nz; k++) {
      const h = height(k);
      low = Math.min(low, h);
      high = Math.max(high, h);
    }
    // (the ray's stretch inside the box: x, z over the grid, y between the lowest and highest heights)
    let enter = 0,
      leave = Infinity;
    for (const [axis, a, b] of [
      [0, -sx / 2, sx / 2],
      [1, low - 1e-6, high + 1e-6],
      [2, -sz / 2, sz / 2],
    ]) {
      if (Math.abs(d[axis]) < 1e-12) {
        if (o[axis] < a || o[axis] > b) return null;
        continue;
      }
      const t0 = (a - o[axis]) / d[axis],
        t1 = (b - o[axis]) / d[axis];
      enter = Math.max(enter, Math.min(t0, t1));
      leave = Math.min(leave, Math.max(t0, t1));
    }
    if (enter > leave) return null;
    const above = (/** @type {number} */ t) => {
      const p = [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t];
      return (
        p[1] -
        sample(Math.max(0, Math.min(nx - 1, (p[0] + sx / 2) / dx)), Math.max(0, Math.min(nz - 1, (p[2] + sz / 2) / dz)))
      );
    };
    const step = (0.25 * Math.min(dx, dz)) / Math.max(1e-12, Math.hypot(d[0], d[2])),
      first = above(enter);
    for (let t = enter, last = first; t < leave;) {
      let next = Math.min(leave, t + step),
        here = above(next);
      if (last > 0 && here > 0) {
        // (both ends above: a crest between them may still reach the ray, a thin one too; the least gap between ray and
        // surface on this stretch, found by thirds (a cell or two: near enough to one dip), and the crossing before it)
        let a = t,
          b = next;
        for (let k = 0; k < 30; k++) {
          const m1 = a + (b - a) / 3,
            m2 = b - (b - a) / 3;
          if (above(m1) < above(m2)) b = m2;
          else a = m1;
        }
        const lowest = above((a + b) / 2);
        if (lowest <= 0) {
          next = (a + b) / 2;
          here = lowest;
        }
      }
      if (Math.sign(here) !== Math.sign(last) || here === 0) {
        let a = t,
          b = next;
        for (let k = 0; k < 40; k++) {
          const middle = (a + b) / 2;
          if (Math.sign(above(middle)) === Math.sign(last)) a = middle;
          else b = middle;
        }
        const tHit = (a + b) / 2,
          local = [o[0] + d[0] * tHit, o[1] + d[1] * tHit, o[2] + d[2] * tHit],
          fi = Math.max(0, Math.min(nx - 1, (local[0] + sx / 2) / dx)),
          fj = Math.max(0, Math.min(nz - 1, (local[2] + sz / 2) / dz)),
          i0 = Math.max(0, fi - 0.5),
          i1 = Math.min(nx - 1, fi + 0.5),
          j0 = Math.max(0, fj - 0.5),
          j1 = Math.min(nz - 1, fj + 0.5),
          gradX = (sample(i1, fj) - sample(i0, fj)) / ((i1 - i0) * dx), // (the span itself: half a cell less at an edge)
          gradZ = (sample(fi, j1) - sample(fi, j0)) / ((j1 - j0) * dz);
        return { id: part.id, t: tHit, point: M.pt(placement, local), normal: M.dir(placement, [-gradX, 1, -gradZ]) };
      }
      t = next;
      last = here;
    }
    return null;
  };
  const entry = {
    id: part.id,
    parts: [part],
    visible: true,
    dirty: true,
    triangles,
    hit,
    reupload(/** @type {any} */ renderer) {
      if (renderer.upload) for (const batch of batches) renderer.upload(batch);
    },
    place(/** @type {any} */ renderer) {
      if (heights.length !== nx * nz || (tones && tones.length !== nx * nz)) return;
      if (host.renderer() === '2d') {
        // (the 2D fallback: the small grid, sampled from the heights)
        part.batches = small ||= grid(Math.min(nx, 64), Math.min(nz, 64));
        shape(small);
        return;
      }
      part.batches = batches;
      shape(batches);
      if (renderer.refill) for (const batch of batches) renderer.refill(batch);
    },
  };
  host.add(entry);
  return {
    id: part.id,
    get heights() {
      return heights;
    },
    set heights(values) {
      heights = values;
    },
    get tones() {
      return tones;
    },
    set tones(values) {
      tones = values;
    },
    // after writing heights or tones: drawn in the next frame, once however often it is called
    update() {
      if (heights.length !== nx * nz || (tones && tones.length !== nx * nz))
        throw new Error(`lk3d: a surface's heights and tones hold ${nx} × ${nz} = ${nx * nz} numbers each`);
      entry.dirty = true;
      host.kick();
    },
    // the height at a point of the surface's own frame (x across, z deep, from its centre): bilinear; NaN outside
    heightAt(/** @type {number} */ x, /** @type {number} */ z) {
      const fi = (x + sx / 2) / dx,
        fj = (z + sz / 2) / dz;
      return fi < 0 || fj < 0 || fi > nx - 1 || fj > nz - 1 ? NaN : sample(fi, fj);
    },
    get visible() {
      return entry.visible;
    },
    set visible(on) {
      entry.visible = on;
      host.kick();
    },
    remove: () => host.remove(entry),
  };
}
