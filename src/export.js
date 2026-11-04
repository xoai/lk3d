// The glTF exporter, kept out of the global script: most pages never export, and every reader would download it.
// Importing this module gives lk3d with fig.exportGLB() working (and the exporter's own functions); the script
// dist/lk3d-export.min.js does the same for the global LK3D (export-script.js).
import LK3D from './index.js';
import { toGLB } from './gltf-write.js';

LK3D.toGLB = toGLB;

export * from './index.js';
export { default } from './index.js';
export { toGLB, sceneToGLB } from './gltf-write.js';
