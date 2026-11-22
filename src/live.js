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

// ---- surfaces: Stage 7
/** @param {Host} host @param {any} options */
export function surface(host, options) {
  throw new Error('lk3d: surface() is not built yet');
}
