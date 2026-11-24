// Joints: parts posed by the way they are joined, not by keys for each one (as URDF and the robot viewers do). A crank
// turns; the piston slides as far as its rod lets it; the rod swings to stay on the crank pin; a cam turns at half
// speed; a rocker follows the cam's lobe. Written in the scene as data:
//   joints: [{ id, parts: [ids or groups], parent: joint id,
//              turn: { axis, center } | slide: { axis },             what the joint lets its parts do
//              value,                                                 its value at first (degrees or scene units; 0)
//              drive: motion id | { motion, ratio, offset, keys },    its value from a motion's (as it is, or scaled,
//                                                                     or read off keys [[motion value, value], …])
//              follow: { joint, ratio, offset, keys },                its value from another joint's (a gear, a cam)
//              rod: { joint, at, pin },                               a slide held by a rod of fixed length: from
//                                                                     `at` (a point carried by `joint`) to `pin` (a
//                                                                     point of this joint's parts), as long as at rest
//              aim: { joint, at } }]                                  a turn that keeps its parts pointing at `at`
//                                                                     (carried by `joint`): the rod between the two
// Every point and axis is written where the parts are drawn (at rest, every joint at 0). A joint's parts move with its
// parent first (a rod on its piston). A page sets a joint's value directly (set({ joints: { crank: 90 } })), over its
// drive. Here the maths, shared by the engine and the geometry check: the joints in order (each after those it reads),
// and their matrices for the motions' values.
import { M, sub, mulv, dot, cross, norm } from './math.js';
import { rotAxis } from './handles.js';
import { between } from './motion.js';

const { pt: transformPoint, dir: transformDirection } = M;
// the joints a joint reads: its parent and the one its value comes from
const reads = (joint) =>
  [joint.parent, joint.follow && joint.follow.joint, joint.rod && joint.rod.joint, joint.aim && joint.aim.joint].filter(
    (id) => id != null,
  );

// the scene's joints in an order where each comes after those it reads; null when there are none. Throws on a joint
// that reads itself through others (a loop) or one that isn't there (the validator says it first)
export function jointsOf(scene) {
  const list = scene.joints || [];
  if (!list.length) return null;
  const byId = new Map(list.map((joint) => [joint.id, joint])),
    order = [],
    state = new Map();
  const visit = (joint, path) => {
    if (state.get(joint.id) === 2) return;
    if (state.get(joint.id) === 1)
      throw new Error(`lk3d: joints ${[...path, joint.id].join(' → ')} read each other in a loop`);
    state.set(joint.id, 1);
    for (const readId of reads(joint)) {
      if (!byId.has(readId)) throw new Error(`lk3d: joint ${joint.id} reads ${readId}, which is no joint`);
      visit(byId.get(readId), [...path, joint.id]);
    }
    state.set(joint.id, 2);
    order.push(joint);
  };
  for (const joint of list) visit(joint, []);
  return { order, byId };
}

// the joint that moves a part (it is named, or its group), or null
export const jointOf = (sceneJoints, part) =>
  (sceneJoints &&
    sceneJoints.order.find((joint) => (joint.parts || []).some((name) => name === part.id || name === part.group))) ||
  null;

// the motions a joint's value depends on (directly or through the joints it reads)
export function motionsOf(sceneJoints, joint, seen = new Set()) {
  if (seen.has(joint.id)) return new Set();
  seen.add(joint.id);
  const motionIds = new Set();
  const drivingMotion = joint.drive && (typeof joint.drive === 'string' ? joint.drive : joint.drive.motion);
  if (drivingMotion) motionIds.add(drivingMotion);
  for (const readId of reads(joint))
    for (const motionId of motionsOf(sceneJoints, sceneJoints.byId.get(readId), seen)) motionIds.add(motionId);
  return motionIds;
}

const scaled = (rule, value) =>
  rule.keys ? between(rule.keys, value) : value * (rule.ratio ?? 1) + (rule.offset ?? 0);

// each joint's value and matrix (scene coordinates at rest → where its parts are now) for the motions' values
// ({motion id: value}, missing ones at their start) and the page's values for joints ({joint id: value})
export function solve(sceneJoints, motions, values = {}, joints = {}) {
  const jointValues = new Map(),
    jointMatrices = new Map();
  const motionValue = (id) => {
    const motion = (motions || []).find((each) => each.id === id);
    return values[id] ?? (motion ? (motion.value ?? motion.range[0]) : 0);
  };
  for (const joint of sceneJoints.order) {
    const parentMatrix = joint.parent != null ? jointMatrices.get(joint.parent) : M.id(),
      center = (joint.turn && joint.turn.center) || [0, 0, 0],
      axis = norm((joint.turn || joint.slide).axis);
    let value = joint.value ?? 0;
    if (joint.drive != null)
      value =
        typeof joint.drive === 'string'
          ? motionValue(joint.drive)
          : scaled(joint.drive, motionValue(joint.drive.motion));
    if (joint.follow) value = scaled(joint.follow, jointValues.get(joint.follow.joint));
    if (joint.rod && joint.slide) {
      // the pin, slid s along the axis, stays the rod's length from the point it hangs on:
      // |P + sA − Q| = L  →  s = d·A ∓ √((d·A)² − |d|² + L²), d = Q − P; the root that is 0 at rest
      // (P the pin, A the axis, Q the point the rod hangs on, L the rod's length at rest)
      const hangPoint = transformPoint(jointMatrices.get(joint.rod.joint), joint.rod.at),
        pin = transformPoint(parentMatrix, joint.rod.pin),
        slideAxis = norm(transformDirection(parentMatrix, axis)),
        pinToHang = sub(hangPoint, pin),
        pinToHangAtRest = sub(joint.rod.at, joint.rod.pin),
        rodLength2 = dot(pinToHangAtRest, pinToHangAtRest),
        along = dot(pinToHang, slideAxis),
        discriminant = Math.max(0, along * along - dot(pinToHang, pinToHang) + rodLength2);
      value = along - Math.sign(dot(pinToHangAtRest, axis) || 1) * Math.sqrt(discriminant);
    }
    if (joint.aim && joint.turn) {
      // turned about the axis (through center, carried by the parent) so that center → at points where it points at rest
      const toParent = M.invert(parentMatrix),
        target = transformPoint(toParent, transformPoint(jointMatrices.get(joint.aim.joint), joint.aim.at)),
        flat = (vector) => sub(vector, mulv(axis, dot(vector, axis))),
        atRest = flat(sub(joint.aim.at, center)),
        now = flat(sub(target, center));
      value = (Math.atan2(dot(axis, cross(atRest, now)), dot(atRest, now)) * 180) / Math.PI;
    }
    if (joints[joint.id] != null && !joint.rod && !joint.aim) value = joints[joint.id];
    const local = joint.turn
      ? M.mul(M.trans(center), M.mul(rotAxis(axis, (value * Math.PI) / 180), M.trans(mulv(center, -1))))
      : M.trans(mulv(axis, value));
    jointValues.set(joint.id, value);
    jointMatrices.set(joint.id, M.mul(parentMatrix, local));
  }
  return { value: jointValues, matrix: jointMatrices };
}

export { transformPoint };
