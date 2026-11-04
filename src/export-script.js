// dist/lk3d-export.min.js: the glTF exporter for a page that loads lk3d as a script (export.js says why it is apart).
// Load it after dist/lk3d.min.js; fig.exportGLB() then works.
import { toGLB } from './gltf-write.js';

if (!globalThis.LK3D) throw new Error('lk3d-export: load dist/lk3d.min.js first');
globalThis.LK3D.toGLB = toGLB;
