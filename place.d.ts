// Types for lk3d/place: parts placed by their relation to others, worked out into the `at` the engine reads.
import type { Scene } from './index.js';
import type { Problem } from './validate.js';
/** the scene with each placed part's at worked out from its place (a copy); throws, naming the part, if one cannot be */
export function resolvePlace<T extends Scene>(scene: T): T;
/** each placed part's at, by its place among the parts, and what stops one being worked out */
export function placements(scene: Scene): { at: Map<number, [number, number, number]>; problems: Problem[] };
/** a scene file's text with each placed part's at written in: only those numbers change */
export function patchPlace(text: string): string;
