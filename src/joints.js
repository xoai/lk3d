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

const { pt, dir } = M; // (a point, and a direction, through a matrix)
// the joints a joint reads: its parent and the one its value comes from
const reads = (j) =>
  [j.parent, j.follow && j.follow.joint, j.rod && j.rod.joint, j.aim && j.aim.joint].filter((x) => x != null);

// the scene's joints in an order where each comes after those it reads; null when there are none. Throws on a joint
// that reads itself through others (a loop) or one that isn't there (the validator says it first)
export function jointsOf(scene) {
  const list = scene.joints || [];
  if (!list.length) return null;
  const byId = new Map(list.map((j) => [j.id, j])),
    order = [],
    state = new Map();
  const visit = (j, path) => {
    if (state.get(j.id) === 2) return;
    if (state.get(j.id) === 1) throw new Error(`lk3d: joints ${[...path, j.id].join(' → ')} read each other in a loop`);
    state.set(j.id, 1);
    for (const r of reads(j)) {
      if (!byId.has(r)) throw new Error(`lk3d: joint ${j.id} reads ${r}, which is no joint`);
      visit(byId.get(r), [...path, j.id]);
    }
    state.set(j.id, 2);
    order.push(j);
  };
  for (const j of list) visit(j, []);
  return { order, byId };
}

// the joint that moves a part (it is named, or its group), or null
export const jointOf = (J, p) =>
  (J && J.order.find((j) => (j.parts || []).some((n) => n === p.id || n === p.group))) || null;

// the motions a joint's value depends on (directly or through the joints it reads)
export function motionsOf(J, j, seen = new Set()) {
  if (seen.has(j.id)) return new Set();
  seen.add(j.id);
  const out = new Set();
  const d = j.drive && (typeof j.drive === 'string' ? j.drive : j.drive.motion);
  if (d) out.add(d);
  for (const r of reads(j)) for (const m of motionsOf(J, J.byId.get(r), seen)) out.add(m);
  return out;
}

const scaled = (o, v) => (o.keys ? between(o.keys, v) : v * (o.ratio ?? 1) + (o.offset ?? 0));

// each joint's value and matrix (scene coordinates at rest → where its parts are now) for the motions' values
// ({motion id: value}, missing ones at their start) and the page's values for joints ({joint id: value})
export function solve(J, motions, values = {}, joints = {}) {
  const val = new Map(),
    mat = new Map();
  const moValue = (id) => {
    const mo = (motions || []).find((x) => x.id === id);
    return values[id] ?? (mo ? (mo.value ?? mo.range[0]) : 0);
  };
  for (const j of J.order) {
    const W = j.parent != null ? mat.get(j.parent) : M.id(),
      c = (j.turn && j.turn.center) || [0, 0, 0],
      axis = norm((j.turn || j.slide).axis);
    let v = j.value ?? 0;
    if (j.drive != null) v = typeof j.drive === 'string' ? moValue(j.drive) : scaled(j.drive, moValue(j.drive.motion));
    if (j.follow) v = scaled(j.follow, val.get(j.follow.joint));
    if (j.rod && j.slide) {
      // the pin, slid s along the axis, stays the rod's length from the point it hangs on:
      // |P + sA − Q| = L  →  s = d·A ∓ √((d·A)² − |d|² + L²), d = Q − P; the root that is 0 at rest
      const Q = pt(mat.get(j.rod.joint), j.rod.at),
        P = pt(W, j.rod.pin),
        A = norm(dir(W, axis)),
        d = sub(Q, P),
        d0 = sub(j.rod.at, j.rod.pin),
        L2 = dot(d0, d0),
        k = dot(d, A),
        disc = Math.max(0, k * k - dot(d, d) + L2);
      v = k - Math.sign(dot(d0, axis) || 1) * Math.sqrt(disc);
    }
    if (j.aim && j.turn) {
      // turned about the axis (through c, carried by the parent) so that c → at points where it points at rest
      const inv = M.invert(W),
        Q = pt(inv, pt(mat.get(j.aim.joint), j.aim.at)),
        flat = (u) => sub(u, mulv(axis, dot(u, axis))),
        a = flat(sub(j.aim.at, c)),
        b = flat(sub(Q, c));
      v = (Math.atan2(dot(axis, cross(a, b)), dot(a, b)) * 180) / Math.PI;
    }
    if (joints[j.id] != null && !j.rod && !j.aim) v = joints[j.id];
    const local = j.turn
      ? M.mul(M.trans(c), M.mul(rotAxis(axis, (v * Math.PI) / 180), M.trans(mulv(c, -1))))
      : M.trans(mulv(axis, v));
    val.set(j.id, v);
    mat.set(j.id, M.mul(W, local));
  }
  return { value: val, matrix: mat };
}

export { pt as transformPoint };
