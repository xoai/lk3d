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
// 32-bit indices); normals by central differences, tones along a ramp; refilled in place when the page updates it
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
    [sx, sz] = size || [];
  if (id != null && host.taken(id)) throw new Error(`lk3d: the id ${id} is a part's or another surface's`);
  const xs = Array.from({ length: nx }, (_, i) => -sx / 2 + (sx * i) / (nx - 1)),
    zs = Array.from({ length: nz }, (_, j) => -sz / 2 + (sz * j) / (nz - 1)),
    perStrip = Math.max(2, Math.floor(65535 / nx)),
    /** @type {any[]} */
    batches = [];
  for (let j0 = 0; j0 < nz - 1; j0 += perStrip - 1) {
    const rows = Math.min(nz - j0, perStrip),
      count = rows * nx,
      indices = [];
    for (let j = 0; j < rows - 1; j++)
      for (let i = 0; i < nx - 1; i++) {
        const k = j * nx + i;
        indices.push(k, k + nx, k + 1, k + 1, k + nx, k + nx + 1); // (anticlockwise seen from above: facing up)
      }
    const normals = new Float32Array(count * 3);
    batches.push({
      mesh: {
        positions: new Float32Array(count * 3),
        normals,
        indices,
        colors: colors ? new Uint8Array(count * 4) : null,
        count,
        twoSided: true,
      },
      placements: [host.M.trs(at, rot)],
      outlineNormals: normals,
      dynamic: true,
      from: j0, // (its first row)
    });
  }
  const part = host.part('surface', [batches[0]], { color, studioColor, material, tint: 0.4 });
  part.batches = batches;
  part.id = id ?? `surface-${++surfaces}`;
  part.soft = true; // (no shadow, no outline)
  let heights = new Float32Array(nx * nz),
    tones = colors ? new Float32Array(nx * nz) : null,
    warned = false;
  // the mesh from the heights: positions, normals, and the tones' colours
  const shape = () => {
    const at = (/** @type {number} */ i, /** @type {number} */ j) => {
      const h = heights[i + nx * j];
      if (h === h) return h;
      if (!warned) console.warn('lk3d: a surface has heights that are not numbers: drawn at 0');
      warned = true;
      return 0;
    };
    const stops = colors && host.ramp(colors, host.dark());
    for (const batch of batches) {
      const { positions, normals, colors: rgba, count } = batch.mesh;
      for (let k = 0; k < count; k++) {
        const i = k % nx,
          j = batch.from + Math.floor(k / nx),
          i0 = Math.max(0, i - 1),
          i1 = Math.min(nx - 1, i + 1),
          j0 = Math.max(0, j - 1),
          j1 = Math.min(nz - 1, j + 1),
          dx = (at(i1, j) - at(i0, j)) / (xs[i1] - xs[i0]),
          dz = (at(i, j1) - at(i, j0)) / (zs[j1] - zs[j0]),
          length = Math.hypot(dx, 1, dz);
        positions.set([xs[i], at(i, j), zs[j]], 3 * k);
        normals.set([-dx / length, 1 / length, -dz / length], 3 * k);
        if (rgba && tones) {
          const c = host.tone(stops, tones[i + nx * j], smooth);
          rgba.set([c[0] * 255, c[1] * 255, c[2] * 255, 255], 4 * k);
        }
      }
    }
  };
  shape();
  const entry = {
    id: part.id,
    parts: [part],
    visible: true,
    dirty: true,
    triangles: 2 * (nx - 1) * (nz - 1),
    reupload(/** @type {any} */ renderer) {
      if (renderer.upload) for (const batch of batches) renderer.upload(batch);
    },
    place(/** @type {any} */ renderer) {
      shape();
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
      entry.dirty = true;
      host.kick();
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
