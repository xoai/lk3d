// Types for lk3d/measure: quantities measured on a scene's built geometry, each with its error.
import type { Scene } from './index.js';
import type { Problem } from './validate.js';
/**
 * a point: "id" (the centre of a part's box at rest), "id.label" (its label point), "id.atom[k]" (atom k, from 0, of
 * the part's first molecule shape), "id.shapes[j].atom[k]" (of shape j), or a place in scene units
 */
export type Point = string | [number, number, number];
/** the pose a measure is taken in: at rest (the default), or the state of a guided step (its id, or its number from 1) */
export interface Pose {
  step?: string | number;
}
export type Measure =
  /** one part's extent along an axis (half: a radius) */
  | ({ size: string; axis: 'x' | 'y' | 'z'; half?: boolean } & Pose)
  /** the distance between two points */
  | ({ distance: [Point, Point] } & Pose)
  /** the nearest distance between two parts' surfaces */
  | ({ gap: [string, string] } & Pose)
  /** the angle at the middle point, in degrees */
  | ({ angle: [Point, Point, Point] } & Pose)
  /** pieces drawn (each shape times its repeat, a scatter's copies), over the parts named; or the parts themselves */
  | { count: string | string[] | { parts: string[] } }
  /** a number in the scene's data, by its path (["mars", "shapes", 0, "orbit", "a"]) */
  | { read: (string | number)[] }
  /** other measures added; "-id" subtracts one */
  | { sum: string[] };
export interface Measured {
  /** each measure's value: scene units, degrees, or a count */
  values: Record<string, number>;
  /** how far each value may be from the shape it measures (0 when exact: atoms, label points written, reads, counts) */
  error: Record<string, number>;
  /** what could not be measured, at the measure's name */
  problems: Problem[];
}
export function measure(scene: Scene, measures: Record<string, Measure>): Measured;
