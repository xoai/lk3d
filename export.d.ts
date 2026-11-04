// Types for lk3d/export: lk3d itself, with the glTF exporter set (fig.exportGLB() works), and a scene to .glb directly.
import type { Scene } from './index.js';
export * from './index.js';
export { default } from './index.js';
/** a scene (data) to .glb bytes, without a page: posed at the motions' values (motion, else their starts) and the
 * joints'; animate: each motion as an animation, samples poses along its range (120) */
export function sceneToGLB(
  scene: Scene,
  o?: {
    motion?: Record<string, number>;
    joints?: Record<string, number>;
    animate?: boolean;
    samples?: number;
    quality?: number;
  },
): Uint8Array;
