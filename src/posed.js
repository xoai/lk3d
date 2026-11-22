// @ts-check
// A part as the geometry check and the measures see it: posed by the motions' values (each at its start unless a guided
// step says otherwise) and by its joints, solved; and its extent along an axis, from its posed vertices. Shared by
// lk3d/lint (expect: size) and lk3d/measure, so the two cannot measure differently. Not part of the runtime bundle.
import { M } from './math.js';
import { tracksOf, motionMatrix } from './motion.js';
import { jointsOf, jointOf, solve } from './joints.js';
import { stepState } from './stepstate.js';

/**
 * The state a measure is taken in: at rest (every motion at its start, nothing apart), or a guided step's (its id, or
 * its number from 1). null when the scene has no such step.
 * @param {any} scene @param {string | number | undefined} step
 * @returns {{ values: Record<string, number>, explode: number } | null}
 */
export function poseOf(scene, step) {
  if (step === undefined || step === null) return { values: {}, explode: 0 };
  const steps = (scene.steps || []).filter((/** @type {any} */ each) => each && typeof each === 'object'),
    found = typeof step === 'number' ? steps[step - 1] : steps.find((/** @type {any} */ each) => each.id === step);
  if (!found) return null;
  const state = stepState(scene, found);
  return {
    values: Object.fromEntries(
      (scene.motions || []).map((/** @type {any} */ motion) => [motion.id, state.motion(motion)]),
    ),
    explode: state.explode,
  };
}

/**
 * Each part's matrix at the motions' values: its tracks, then its joint's pose (the joints solved once a set of values).
 * @param {any} scene
 * @returns {(part: { id: string, group?: string }, values: Record<string, number>) => Float32Array | number[]}
 */
export function poser(scene) {
  const sceneJoints = jointsOf(scene),
    solved = new Map();
  return (part, values) => {
    const joint = jointOf(sceneJoints, part);
    let jointMatrix = M.id();
    if (joint) {
      const key = JSON.stringify(values);
      if (!solved.has(key)) solved.set(key, solve(sceneJoints, scene.motions, values));
      jointMatrix = solved.get(key).matrix.get(joint.id) || M.id();
    }
    return M.mul(motionMatrix(tracksOf(scene.motions, part), values), jointMatrix);
  };
}

/**
 * A built part's extent along an axis (0, 1, 2) with every vertex placed by `matrix` then its batch's own placements:
 * exact for its mesh, where a box turned with the part would grow.
 * @param {any} part a part of buildScene's result @param {ArrayLike<number>} matrix @param {number} axis
 * @returns {[number, number]}
 */
export function extentAlong(part, matrix, axis) {
  let low = Infinity,
    high = -Infinity;
  for (const batch of part.batches)
    for (const placement of batch.placements) {
      const m = M.mul(matrix, placement),
        positions = batch.mesh.positions;
      for (let k = 0; k < positions.length; k += 3) {
        const v =
          m[axis] * positions[k] + m[4 + axis] * positions[k + 1] + m[8 + axis] * positions[k + 2] + m[12 + axis];
        if (v < low) low = v;
        if (v > high) high = v;
      }
    }
  return [low, high];
}
