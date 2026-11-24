// @ts-check
// Sequences: a model taken apart (or built) part by part, as a list of stages. Each is expanded here into an ordinary
// motion over [0, N] (N stages), so everything that knows motions knows sequences: the figure's state and set(), the
// steps, the geometry check, the glTF export. Its value is the stages done: 2.5 is halfway through stage 3. Pure, shared
// by the story add-on (story.js), lk3d/lint, the CLI and the exporter:
//   expand(sequence, scene) → { id, name, range: [0, N], value, speed, tracks, stages, holds }
//   pacing(sequence) → [[value, seconds], …]: when each value is reached, played (each stage its ms, then its hold)
//   settersOf(joints, joint) → the motions that set a joint's value (a sequence holds them while away)
// In stage k's window [k − 1, k] only stage k's parts move. A teardown's part rests below k − 1, leaves over the window
// (by `by`, along `path`, or by its own explode vector) and stays out from k on (faded to 0.15 over the window's last
// 30 % with after: 'fade'). A build is written in build order: its stage k's parts are away (at the end of their way,
// faded to 0) below k − 1, come in over the window (faded in over its first 20 %), and rest from k on.
import { between } from './motion.js';

export const MS = 1000, // (a stage's duration and its hold when played, unless the scene says)
  HOLD = 400,
  KEYS = 12; // (a path, or keys of a turn, read at this many points a stage, its eased fraction read straight)

const smooth = (/** @type {number} */ f) => f * f * (3 - 2 * f);
const isZero = (/** @type {any} */ v) => !Array.isArray(v) || v.every((x) => !x);

/** the parts a stage names (ids, and the parts of a group named), each once
 * @param {any} scene @param {string[]} names */
export function partsNamed(scene, names) {
  const out = [];
  for (const part of scene.parts || [])
    if (part && (names.includes(part.id) || (part.group && names.includes(part.group)))) out.push(part);
  return out;
}

/** each stage's duration and hold (ms), the stage's own over the sequence's
 * @param {any} sequence */
export const timing = (sequence) =>
  sequence.stages.map((/** @type {any} */ stage) => ({
    ms: stage.ms ?? sequence.ms ?? MS,
    hold: stage.hold ?? sequence.hold ?? HOLD,
  }));

/** a sequence as a motion over [0, N]
 * @param {any} sequence @param {any} scene */
export function expand(sequence, scene) {
  const N = sequence.stages.length,
    build = !!sequence.build,
    times = timing(sequence),
    /** @type {any[]} */ tracks = [];
  sequence.stages.forEach((/** @type {any} */ stage, index) => {
    const k = index + 1,
      eased = stage.ease !== false,
      // a key at fraction f of the stage, as a value of the motion: a build runs its way backwards
      at = (/** @type {number} */ f) => k - 1 + f,
      way = (/** @type {number} */ f) => (build ? 1 - f : f),
      /** @type {any} */ fade = build
        ? [
            [k - 1, 0],
            [k - 0.8, 1],
          ]
        : sequence.after === 'fade'
          ? [
              [k - 0.3, 1],
              [k, 0.15],
            ]
          : null,
      // a way read at KEYS points of the eased fraction (a path, keys of a turn): straight between them
      sampled = (/** @type {any[]} */ keys) =>
        Array.from({ length: KEYS + 1 }, (_, i) => {
          const f = i / KEYS;
          return [at(f), between(keys, way(eased ? smooth(f) : f))];
        }),
      // two keys, eased by the track (a smooth start and stop once over the stage)
      ends = (/** @type {any} */ out, /** @type {any} */ rest) => [
        [k - 1, build ? out : rest],
        [k, build ? rest : out],
      ];
    /** @type {any} */
    let turn = null;
    if (stage.turn) {
      const t = stage.turn;
      turn = {
        axis: t.axis,
        center: t.center,
        keys: t.keys ? sampled(t.keys) : ends(t.angle ?? 0, 0),
      };
    }
    // its way: by, a path, or each part's own explode vector (one track per distinct one; a zero vector counts as none)
    /** @type {[string[], any][]} */
    let ways;
    if (stage.path) ways = [[stage.parts, sampled(stage.path)]];
    else if (stage.by) ways = [[stage.parts, ends(stage.by, [0, 0, 0])]];
    else {
      /** @type {Map<string, string[]>} */
      const byVector = new Map();
      for (const part of partsNamed(scene, stage.parts))
        if (!isZero(part.explode)) {
          const key = JSON.stringify(part.explode);
          byVector.set(key, [...(byVector.get(key) || []), part.id]);
        }
      ways = [...byVector].map(([vector, ids]) => [ids, ends(JSON.parse(vector), [0, 0, 0])]);
      if (!ways.length && turn) ways = [[stage.parts, null]];
    }
    const straight = !!stage.path || !!(stage.turn && stage.turn.keys);
    for (const [parts, move] of ways)
      tracks.push({
        parts,
        ...(move && { move }),
        ...(turn && { turn }),
        ...(fade && { fade }),
        ...(eased && !straight && { ease: true }),
      });
  });
  const total = times.reduce((sum, t) => sum + t.ms, 0);
  return {
    id: sequence.id,
    ...(sequence.name != null && { name: sequence.name }),
    range: [0, N],
    value: build ? N : 0,
    speed: (N * 1000) / Math.max(1, total),
    tracks,
    stages: sequence.stages,
    holds: times,
  };
}

/** when each value of a sequence is reached as it is played from 0 to N: [value, seconds] pairs, at least 8 a stage,
 * each hold as a pair at the stage's end
 * @param {any} sequence @param {number} [per] */
export function pacing(sequence, per = 8) {
  const out = [[0, 0]];
  let time = 0;
  timing(sequence).forEach((/** @type {{ ms: number, hold: number }} */ t, index) => {
    for (let i = 1; i <= per; i++) out.push([index + i / per, (time + (t.ms * i) / per) / 1000]);
    time += t.ms + t.hold;
    if (t.hold) out.push([index + 1, time / 1000]);
  });
  return out;
}

// the motions that set a joint's value: its drive, or through the joints it follows, rods to or aims at (a parent only
// carries the joint, it does not set its value). A sequence holds these at their start while it moves the joint's
// parts; two motions of one group may not share one
/** @param {{ byId: Map<string, any> }} sceneJoints @param {any} joint @param {Set<string>} [seen] @returns {Set<string>} */
export function settersOf(sceneJoints, joint, seen = new Set()) {
  if (seen.has(joint.id)) return new Set();
  seen.add(joint.id);
  const motionIds = new Set();
  const drivingMotion = joint.drive && (typeof joint.drive === 'string' ? joint.drive : joint.drive.motion);
  if (drivingMotion) motionIds.add(drivingMotion);
  for (const readId of [joint.follow && joint.follow.joint, joint.rod && joint.rod.joint, joint.aim && joint.aim.joint])
    if (readId != null && sceneJoints.byId.has(readId))
      for (const motionId of settersOf(sceneJoints, sceneJoints.byId.get(readId), seen)) motionIds.add(motionId);
  return motionIds;
}
