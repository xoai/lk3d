// @ts-check
// dist/lk3d-live.min.js: surfaces and arrows (live.js) and the card over the stage (card.js) for a page that loads lk3d as a script (dist/lk3d.min.js) and
// draws them. Load it after lk3d; fig.surface(), fig.arrows() and mount's card then work. It reaches a figure only through what the
// core lends it (fig's host, plain names), so it runs with any build of the core whose LK3D.hostVersion it was made for.
import { surface, arrows } from './live.js';
import { card } from './card.js';

const global = /** @type {any} */ (globalThis);
// (inside the crease-shading worker, which runs the page's script text, core and add-ons together: nothing to do)
if (!global.lk3dAO) {
  const core = global.LK3D;
  if (!core) throw new Error('lk3d-live: load dist/lk3d.min.js first');
  if (core.hostVersion !== 1)
    throw new Error(`lk3d-live: made for lk3d's host 1; this page's lk3d has host ${core.hostVersion}`);
  if (!core.live) core.live = { surface, arrows, card }; // (a second load: nothing changes)
}
