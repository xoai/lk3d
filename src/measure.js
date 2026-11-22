// Quantities measured on a scene's built geometry, each with its error: what a page or a lesson compares with the
// numbers its text states (a bond angle, a radius, a gap, a count of blades). Not part of the runtime bundle: import
// 'lk3d/measure'.
//   import { measure } from 'lk3d/measure';
//   measure(scene, { name: { angle: ['h2o.atom[1]', 'h2o.atom[0]', 'h2o.atom[2]'] }, … })
//     → { values: { name: 104.48 }, error: { name: 0 }, problems: [{ path, message }] }
// (The kinds are built in the next step of this work; until then every measure is refused, by name.)

/**
 * @param {object} scene
 * @param {Record<string, object>} measures
 * @returns {{ values: Record<string, number>, error: Record<string, number>, problems: { path: string, message: string }[] }}
 */
export function measure(scene, measures) {
  const problems = Object.keys(measures || {}).map((name) => ({ path: name, message: 'measuring is not built yet' }));
  return { values: {}, error: {}, problems };
}
