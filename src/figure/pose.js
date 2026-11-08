// @ts-check
// Where each part is: taken apart, moved by the page, by its handle, its motions and joints, and the spin; and the
// motions played and the taking apart tweened. Owns handles_, poseVersion_, playing_, offsetOf_, baseMatrix_,
// modelMatrix_, setMotion_, playMotion_, stopMotion_, explodeNow_ and tweenExplode_; reads built_, state_, motions_,
// spec_, animations_ and controls_, and calls markDirty_ and kick_.
import { D2R, M, add, mulv } from '../math.js';
import * as HD from '../handles.js';
import { tracksOf, motionMatrix, startOf } from '../motion.js';
import { jointsOf, jointOf, solve as solveJoints } from '../joints.js';
import { clock } from '../clock.js';
import LK3D from '../namespace.js';

/** @param {import('./context').Ctx} c */
export function makePose(c) {
  // handles: parts the reader moves directly (and the parts each one carries with it), each kept as a grip
  const handles = (c.handles_ = []);
  for (const p of c.built_.parts)
    if (p.handle) {
      const h = p.handle,
        parts = [
          p,
          ...c.built_.parts.filter((q) => q !== p && (h.moves || []).some((k) => k === q.id || k === q.group)),
        ];
      const grip = {
        part: p,
        handle: h,
        value: HD.hold(h, h.value ?? 0), // (a first value outside the range: at its end from the start, not on the first drag)
        parts,
        path: h.along ? HD.measure(h.along.path, h.along.closed) : null,
        input: null,
        round: !!h.turn && h.min == null && h.max == null, // (a turn with no stops, a rotor: it goes round and round)
      };
      handles.push(grip);
      for (const q of parts) q.handleOf = grip;
    }
  // motions: what moves each part, and where each motion starts
  for (const mo of c.motions_) c.state_.motion[mo.id] = startOf(mo);
  for (const p of c.built_.parts) p.tracks = tracksOf(c.motions_, p);
  // joints (joints.js): parts posed by how they are joined; their matrices worked out once for each set of values:
  // again only when a motion's or a joint's value changed (poseVersion_, counted up where they are set)
  const joints = jointsOf(c.spec_);
  for (const p of c.built_.parts) p.joint = jointOf(joints, p);
  c.poseVersion_ = 0;
  let posed = -1,
    /** @type {ReturnType<typeof solveJoints> | null} */
    pose = null;
  const jointMatrix = (p) => {
    if (!pose || posed !== c.poseVersion_) {
      pose = solveJoints(joints, c.motions_, c.state_.motion, c.state_.joints);
      posed = c.poseVersion_;
    }
    return pose.matrix.get(p.joint.id);
  };

  // where taking apart and the page's offset put a part (a move), and its frame there
  c.offsetOf_ = (p) => add(mulv(p.explode, c.state_.explode), p.offset);
  c.baseMatrix_ = (p) => M.trans(c.offsetOf_(p));
  c.modelMatrix_ = (p) => {
    let m = c.baseMatrix_(p);
    if (p.tracks.length) m = M.mul(m, motionMatrix(p.tracks, c.state_.motion));
    if (p.joint) m = M.mul(m, jointMatrix(p));
    if (p.handleOf) m = M.mul(m, HD.matrix(p.handleOf.handle, p.handleOf.value, p.handleOf.path));
    if (p.spin) {
      const a = c.state_.spin * D2R * (p.spin.ratio ?? 1),
        o = p.spin.center || [0, 0, 0];
      const r = p.spin.axis === 'y' ? M.rotY(a) : p.spin.axis === 'z' ? M.rotZ(a) : M.rotX(a);
      m = M.mul(m, M.mul(M.trans(o), M.mul(r, M.trans(mulv(o, -1)))));
    }
    return m;
  };

  // ---- taking apart, tweened, or set at once by the page (its own value wins over a running tween)
  /** @type {((now: number) => boolean) | null} */
  let explodeTween = null;
  const setExplode = (v) => {
    c.state_.explode = Math.max(0, Math.min(1, v));
    if (c.controls_.explode) c.controls_.explode(c.state_.explode);
  };
  c.explodeNow_ = (v) => {
    if (explodeTween) c.animations_.delete(explodeTween);
    explodeTween = null;
    setExplode(v);
  };
  c.tweenExplode_ = (to) => {
    const from = c.state_.explode,
      t0 = clock.now(),
      ms = LK3D.reduce ? 1 : 900;
    const tween = (now) => {
      const u = Math.max(0, Math.min(1, (now - t0) / ms)),
        e = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
      setExplode(from + (to - from) * e);
      c.markDirty_();
      if (u >= 1) {
        c.animations_.delete(tween);
        explodeTween = null;
        return false;
      }
      return true;
    };
    if (explodeTween) c.animations_.delete(explodeTween);
    explodeTween = tween;
    c.animations_.add(tween);
    c.kick_();
  };

  // ---- motions (motion.js): a value set by the page or the reader, or played: on along its range at its speed (a
  // second a range by default), round again if it loops, else to its end and back the next time it is played
  const playing = (c.playing_ = new Map()); // a motion's id → its step in the frame loop
  c.setMotion_ = (mo, v) => {
    const [a, b] = mo.range;
    c.state_.motion[mo.id] = mo.loop ? a + ((((v - a) % (b - a)) + (b - a)) % (b - a)) : Math.max(a, Math.min(b, v));
    c.poseVersion_++;
    if (c.controls_.motion) c.controls_.motion(mo.id);
    c.kick_();
  };
  c.stopMotion_ = (mo) => {
    c.animations_.delete(playing.get(mo.id));
    playing.delete(mo.id);
    if (c.controls_.motion) c.controls_.motion(mo.id);
  };
  c.playMotion_ = (mo) => {
    c.stopMotion_(mo);
    const [a, b] = mo.range,
      back = !mo.loop && c.state_.motion[mo.id] >= b; // (at its end: played back to the start)
    if (LK3D.reduce) return mo.loop || c.setMotion_(mo, back ? a : b); // (no movement: straight to where it goes)
    let last = clock.now();
    const step = (now) => {
      // (the whole of a step of the clock stopped by hand; while it runs, at most 50 ms: not a leap after a hidden tab)
      const dt = Math.max(0, Math.min(clock.speed ? 0.05 : 1e9, (now - last) / 1000)),
        v = c.state_.motion[mo.id] + (back ? -1 : 1) * (mo.speed ?? b - a) * dt * c.state_.timeScale;
      last = now;
      c.setMotion_(mo, v);
      if (!mo.loop && (back ? v <= a : v >= b)) return (c.stopMotion_(mo), false);
      return true;
    };
    playing.set(mo.id, step);
    c.animations_.add(step);
    if (c.controls_.motion) c.controls_.motion(mo.id);
    c.kick_();
  };
}
