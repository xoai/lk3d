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
  /** the elements whose bonds the chemistry check could not test (no covalent radius for them at that bond's order) */
  unchecked: string[];
}
/** a finding of the check: a problem (lk3d check fails), or a warning (lk3d check says it and passes) */
export interface Finding extends Problem {
  level?: 'warning';
}
/** each part's id, and the ids of the parts whose surfaces it meets at rest (within the lint's contact tolerance) */
export type Contacts = Record<string, string[]>;
export function lint(
  scene: Scene,
  o?: { quality?: number },
): { problems: Finding[]; summary: Summary; contacts: Contacts };
