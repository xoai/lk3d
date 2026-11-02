// Types for lk3d/lint: the geometry check of a scene, with how big the scene is.
import type { Scene } from './index.js';
import type { Problem } from './validate.js';
export interface Summary {
  /** parts, the shapes written in the scene, and every shape as placed (repeats counted) */
  parts: number;
  shapes: number;
  placed: number;
  triangles: number;
  /** parts marked accent, and parts with a name (a label) */
  accents: number;
  named: number;
  /** the model's size across, in scene units */
  size: number;
}
export function lint(scene: Scene, o?: { quality?: number }): { problems: Problem[]; summary: Summary };
