// dist/lk3d-models.min.js: the glTF reader for a page that loads lk3d as a script (dist/lk3d.min.js) and shows a model.
// Load it after lk3d; <lk3d-figure>s refused before it came are drawn then. Its matrices are the core's (LK3D.M: the
// build points math.js at them), so it carries only the reader and four small vector sums.
import { load, parseGLB, bytes } from './gltf.js';

const global = /** @type {any} */ (globalThis);
// (inside the crease-shading worker, which runs the page's script text, core and add-on together: nothing to do)
if (!global.lk3dAO) {
  if (!global.LK3D || !global.LK3D.useModels) throw new Error('lk3d-models: load dist/lk3d.min.js first');
  global.LK3D.useModels({ load, parseGLB, bytes }); // (a second load gives the same reader again: nothing changes)
}
