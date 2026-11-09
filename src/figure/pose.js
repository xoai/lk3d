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
  for (const part of c.built_.parts)
    if (part.handle) {
      const handle = part.handle,
        parts = [
          part,
          ...c.built_.parts.filter(
            (other) =>
              other !== part && (handle.moves || []).some((moved) => moved === other.id || moved === other.group),
          ),
        ];
      const grip = {
        part,
        handle,
        value: HD.hold(handle, handle.value ?? 0), // (a first value outside the range: at its end from the start, not on the first drag)
        parts,
        path: handle.along ? HD.measure(handle.along.path, handle.along.closed) : null,
        input: null,
        round: !!handle.turn && handle.min == null && handle.max == null, // (a turn with no stops, a rotor: it goes round and round)
      };
      handles.push(grip);
      for (const carried of parts) carried.handleOf = grip;
    }
  // motions: what moves each part, and where each motion starts
  for (const motion of c.motions_) c.state_.motion[motion.id] = startOf(motion);
  for (const part of c.built_.parts) part.tracks = tracksOf(c.motions_, part);
  // joints (joints.js): parts posed by how they are joined; their matrices worked out once for each set of values:
  // again only when a motion's or a joint's value changed (poseVersion_, counted up where they are set)
  const joints = jointsOf(c.spec_);
  for (const part of c.built_.parts) part.joint = jointOf(joints, part);
  c.poseVersion_ = 0;
  let posedVersion = -1,
    /** @type {ReturnType<typeof solveJoints> | null} */
    pose = null;
  const jointMatrix = (part) => {
    if (!pose || posedVersion !== c.poseVersion_) {
      pose = solveJoints(joints, c.motions_, c.state_.motion, c.state_.joints);
      posedVersion = c.poseVersion_;
    }
    return pose.matrix.get(part.joint.id);
  };

  // where taking apart and the page's offset put a part (a move), and its frame there
  c.offsetOf_ = (part) => add(mulv(part.explode, c.state_.explode), part.offset);
  c.baseMatrix_ = (part) => M.trans(c.offsetOf_(part));
  c.modelMatrix_ = (part) => {
    let m = c.baseMatrix_(part);
    if (part.tracks.length) m = M.mul(m, motionMatrix(part.tracks, c.state_.motion));
    if (part.joint) m = M.mul(m, jointMatrix(part));
    if (part.handleOf) m = M.mul(m, HD.matrix(part.handleOf.handle, part.handleOf.value, part.handleOf.path));
    if (part.spin) {
      const angle = c.state_.spin * D2R * (part.spin.ratio ?? 1),
        center = part.spin.center || [0, 0, 0];
      const rotation = part.spin.axis === 'y' ? M.rotY(angle) : part.spin.axis === 'z' ? M.rotZ(angle) : M.rotX(angle);
      m = M.mul(m, M.mul(M.trans(center), M.mul(rotation, M.trans(mulv(center, -1)))));
    }
    return m;
  };

  // ---- taking apart, tweened, or set at once by the page (its own value wins over a running tween)
  /** @type {((now: number) => boolean) | null} */
  let explodeTween = null;
  const setExplode = (amount) => {
    c.state_.explode = Math.max(0, Math.min(1, amount));
    if (c.controls_.explode) c.controls_.explode(c.state_.explode);
  };
  c.explodeNow_ = (amount) => {
    if (explodeTween) c.animations_.delete(explodeTween);
    explodeTween = null;
    setExplode(amount);
  };
  c.tweenExplode_ = (to) => {
    const from = c.state_.explode,
      start = clock.now(),
      ms = LK3D.reduce ? 1 : 900;
    const tween = (now) => {
      const progress = Math.max(0, Math.min(1, (now - start) / ms)),
        eased = progress < 0.5 ? 4 * progress * progress * progress : 1 - Math.pow(-2 * progress + 2, 3) / 2;
      setExplode(from + (to - from) * eased);
      c.markDirty_();
      if (progress >= 1) {
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
  c.setMotion_ = (motion, value) => {
    const [low, high] = motion.range;
    c.state_.motion[motion.id] = motion.loop
      ? low + ((((value - low) % (high - low)) + (high - low)) % (high - low))
      : Math.max(low, Math.min(high, value));
    c.poseVersion_++;
    if (c.controls_.motion) c.controls_.motion(motion.id);
    c.kick_();
  };
  c.stopMotion_ = (motion) => {
    c.animations_.delete(playing.get(motion.id));
    playing.delete(motion.id);
    if (c.controls_.motion) c.controls_.motion(motion.id);
  };
  c.playMotion_ = (motion) => {
    c.stopMotion_(motion);
    const [low, high] = motion.range,
      back = !motion.loop && c.state_.motion[motion.id] >= high; // (at its end: played back to the start)
    if (LK3D.reduce) return motion.loop || c.setMotion_(motion, back ? low : high); // (no movement: straight to where it goes)
    let last = clock.now();
    const step = (now) => {
      // (the whole of a step of the clock stopped by hand; while it runs, at most 50 ms: not a leap after a hidden tab)
      const dt = Math.max(0, Math.min(clock.speed ? 0.05 : 1e9, (now - last) / 1000)),
        value = c.state_.motion[motion.id] + (back ? -1 : 1) * (motion.speed ?? high - low) * dt * c.state_.timeScale;
      last = now;
      c.setMotion_(motion, value);
      if (!motion.loop && (back ? value <= low : value >= high)) return (c.stopMotion_(motion), false);
      return true;
    };
    playing.set(motion.id, step);
    c.animations_.add(step);
    if (c.controls_.motion) c.controls_.motion(motion.id);
    c.kick_();
  };
}
