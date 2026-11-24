// @ts-check
// dist/lk3d-story.min.js: sequences and the tour (story.js) for a page that loads lk3d as a script (dist/lk3d.min.js).
// Load it after lk3d; a scene with sequences then mounts. It joins through LK3D.use, which refuses it, naming what it
// lacks, on a core too old for it.
import { story, NEEDS } from './story.js';

const global = /** @type {any} */ (globalThis);
// (inside the crease-shading worker, which runs the page's script text, core and add-ons together: nothing to do)
if (!global.lk3dAO) {
  const core = global.LK3D;
  if (!core || !core.use) throw new Error('lk3d-story: needs lk3d 0.8.0 or later, loaded first (dist/lk3d.min.js)');
  if (!core.story) core.use('story', Object.assign(story, { core }), NEEDS); // (a second load: nothing changes)
}
