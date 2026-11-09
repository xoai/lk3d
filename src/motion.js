// Motions: parts that move together as one value goes along a range (a piston's stroke as the crank turns, a thrust
// reverser's sleeve sliding back, a valve opening, the stages of a cycle). Written in the scene as keyframes, so a
// motion is data like the rest: validated, run through its range by the geometry check, set or played by the page and
// the reader. Here the maths, shared by the engine and the check:
//   motions: [{ id, name, range: [a, b], value, loop, speed,
//               tracks: [{ parts: [ids or groups], move: [[t, [x, y, z]], …], turn: { axis, center, keys: [[t, °], …] },
//                          ease }] }]
// A track's keys are values of the motion (t) and where the parts are then: moved by [x, y, z], turned by degrees
// about an axis through center; between keys, a straight line (ease: true, a smooth start and stop at each key).
import { M, mulv } from './math.js';
import { rotAxis } from './handles.js';

// a value between keys [[t, v], …] (v a number or a vector), held past the first and last
export function between(keys, t, ease) {
  let keyIndex = 0;
  while (keyIndex + 2 < keys.length && t > keys[keyIndex + 1][0]) keyIndex++;
  const [t0, before] = keys[keyIndex],
    [t1, after] = keys[Math.min(keyIndex + 1, keys.length - 1)];
  let fraction = t1 > t0 ? Math.max(0, Math.min(1, (t - t0) / (t1 - t0))) : 0;
  if (ease) fraction = fraction * fraction * (3 - 2 * fraction);
  return Array.isArray(before)
    ? before.map((value, i) => value + (after[i] - value) * fraction)
    : before + (after - before) * fraction;
}

// the tracks that move a part (it is named, or its group), with their motion
export const tracksOf = (motions, part) =>
  (motions || []).flatMap((motion) =>
    (motion.tracks || [])
      .filter((track) => (track.parts || []).some((name) => name === part.id || name === part.group))
      .map((track) => ({ motion, track })),
  );

// a motion's value when none is given: where the scene starts it
export const startOf = (motion) => motion.value ?? motion.range[0];

// a part's matrix at the motions' values ({id: value}), its tracks applied in the order the scene lists them
export function motionMatrix(tracks, values) {
  let m = M.id();
  for (const { motion, track } of tracks) {
    const t = values[motion.id] ?? startOf(motion);
    if (track.move) m = M.mul(m, M.trans(between(track.move, t, track.ease)));
    if (track.turn) {
      const center = track.turn.center || [0, 0, 0];
      m = M.mul(
        m,
        M.mul(
          M.trans(center),
          M.mul(
            rotAxis(track.turn.axis, (between(track.turn.keys, t, track.ease) * Math.PI) / 180),
            M.trans(mulv(center, -1)),
          ),
        ),
      );
    }
  }
  return m;
}
