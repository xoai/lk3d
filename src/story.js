// @ts-check
// The story add-on (dist/lk3d-story.min.js, and built into the ES module): sequences, a model taken apart or built
// stage by stage. It expands each of a scene's sequences into the motion the core plays (sequence.js), gives the page
// fig.sequence(id), and holds the rules a sequence brings (join). It reaches a figure only through what the core lends
// (LK3D.hostNames) and its public API; the core (story.core) gives it the clock and reduced motion.
import { expand, pacing, settersOf } from './sequence.js';

/** the host's names this add-on uses: LK3D.use refuses it on a core that lacks one */
export const NEEDS = [
  'motions',
  'setMotion',
  'stopMotion',
  'playing',
  'towards',
  'rule',
  'animate',
  'explode',
  'state',
  'parts',
  'spec',
  'given',
];

const startOf = (/** @type {any} */ motion) => motion.value ?? motion.range[0];

/** a figure's sequences' rules, installed as it mounts: one sequence away from its start at a time; never with explode
 * (taking apart puts every sequence back, a sequence leaving sets explode to 0); while away, it holds the motions that
 * set its parts' joints at their start, and a page's or the reader's call on one of those wins (the sequence goes back
 * first), unless the same set() gives the sequence too
 * @param {any} host */
export function join(host) {
  const motions = host.motions(),
    state = host.state(),
    sequences = motions.filter((/** @type {any} */ motion) => motion.stages);
  if (!sequences.length) return;
  const joints = { byId: new Map((host.spec().joints || []).map((/** @type {any} */ joint) => [joint.id, joint])) },
    away = (/** @type {any} */ motion) => state.motion[motion.id] !== startOf(motion),
    /** @type {Map<any, Set<string>>} each sequence: the motions it holds */
    held = new Map(
      sequences.map((/** @type {any} */ sequence) => [
        sequence,
        new Set(
          host
            .parts()
            .flatMap((/** @type {any} */ part) =>
              part.joint && part.tracks.some((/** @type {any} */ each) => each.motion === sequence)
                ? [...settersOf(joints, part.joint)]
                : [],
            ),
        ),
      ]),
    ),
    /** @type {Map<string, () => void>} motions gliding back to their start: how to stop each */
    glides = new Map();
  let inner = false;
  const set = (/** @type {any} */ motion, /** @type {number} */ value) => {
    inner = true;
    try {
      host.setMotion(motion, value);
    } finally {
      inner = false;
    }
  };
  // a motion back to its start: at once, or gliding there over ms of the clock's time (at once when motion is reduced)
  const back = (/** @type {any} */ motion, ms = 0) => {
    host.stopMotion(motion);
    const from = state.motion[motion.id],
      to = startOf(motion),
      core = story.core,
      start = core.clock.now();
    const step = (/** @type {number} */ now) => {
      const f = ms && !core.reduce ? Math.min(1, (now - start) / ms) : 1;
      set(motion, from + (to - from) * f);
      if (f < 1) return true;
      glides.delete(motion.id);
      return false;
    };
    if (step(start)) glides.set(motion.id, host.animate(step));
  };
  host.rule((/** @type {any} */ motion, /** @type {number | undefined} */ value) => {
    // taken apart: every sequence to its start (value: 0, at once; else gliding over that many ms)
    if (!motion) return void held.forEach((_, sequence) => away(sequence) && back(sequence, value));
    if (!inner && glides.has(motion.id)) (glides.get(motion.id)?.(), glides.delete(motion.id));
    if (!motion.stages) {
      const holder = [...held].find(([sequence, ids]) => ids.has(motion.id) && away(sequence))?.[0],
        given = host.given();
      if (!holder) return;
      if (given && holder.id in given) return true; // (the same set() gives the sequence: the motion stays at its start)
      if (value !== startOf(motion)) back(holder); // (played, or set elsewhere: the call wins)
      return;
    }
    if (value === undefined) return void (state.explode > 0 && host.explode(0, 300)); // (played: glides together)
    if (value === startOf(motion)) return;
    if (state.explode && host.towards().explode !== 0) host.explode(0);
    for (const other of motions)
      if (
        other !== motion &&
        (held.has(other) || held.get(motion)?.has(other.id)) &&
        (host.playing().has(other.id) || away(other))
      )
        back(other);
  });
}

/** fig.sequence(id): a sequence's handle, over the motion it is expanded into
 * @param {any} fig the figure's API @param {any} motion the sequence's motion (expand's) */
export function sequence(fig, motion) {
  const player = fig.motion(motion.id);
  return {
    get value() {
      return player.value;
    },
    stages: motion.range[1],
    // the stage begun: 3 at 2.5 and at 3.0; 0 at 0
    get stage() {
      return Math.max(0, Math.ceil(player.value - 1e-9));
    },
    get playing() {
      return player.playing;
    },
    set: (/** @type {number} */ v) => player.set(v),
    play: () => (player.play(), Promise.resolve()),
    stop: () => player.stop(),
  };
}

/** @type {any} (core: the LK3D it joined, set by its entry script) */
export const story = { expand, pacing, sequence, join, core: null };
