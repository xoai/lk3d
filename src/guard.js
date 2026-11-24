// The engine's own check of a scene, before anything is built, so a scene from anyone either builds or is refused with a
// sentence naming the place. The full validator (lk3d/validate: the schema and the cross-references, 6 KB gzipped)
// does not fit the global script's size budget, so this checks only what building cannot check as it goes: that the
// scene is plain data (finite numbers, no loops, not too deep, lists not too long, not too many values in all: what
// anything walking a scene, the validator too, then does without running out of stack or time), parts as a list of
// objects, and the points of what is triangulated (a profile, an outline: the time that takes grows faster than their
// number). Everything else is said where building meets it (geometry.js: a shape that cannot be built is named, and
// what a scene asks for is counted against the triangle limit before and while it is made). The validator runs this
// check too, so `lk3d check` refuses whatever mount would.
//   guard(scene) → [{ path: 'parts[2].shapes[0].lathe', message: '…' }, …]
export const LIMITS = { depth: 32, items: 1e5, values: 1e6, points: 1000 };
const POINTS = /^(lathe|outline|inside|layers)$/; // (a lathe's profile, an outline, a vessel's inside, terrain's layers)
const TIMES = /^(ms|dwell|hold)$/; // (steps', sequences' and stages' times)

export function values(scene) {
  const out = [],
    walking = new Set(), // (the objects on the path from the scene down to here)
    bad = (path, message) => out.push({ path, message });
  let count = 0;
  const walk = (value, path, key, depth) => {
    const type = typeof value;
    if (++count > LIMITS.values) return count === LIMITS.values + 1 && bad('', 'has more than a million values');
    if (type === 'number') {
      if (!Number.isFinite(value)) bad(path, `is ${value}, not a finite number`);
      // (a time a step, a sequence or a stage takes, in ms: up to a minute)
      else if (TIMES.test(key) && !(value >= 0 && value <= 6e4)) bad(path, 'is a time in ms, from 0 to 60000');
    } else if (type === 'object' && value) {
      const isList = Array.isArray(value),
        most = POINTS.test(key) ? LIMITS.points : key === 'stages' ? 64 : LIMITS.items;
      if (walking.has(value)) return bad(path, 'holds itself (a loop)');
      if (depth > LIMITS.depth) return bad(path, `is nested more than ${LIMITS.depth} deep`);
      if (isList && value.length > most) return bad(path, `has ${value.length} items; at most ${most}`);
      walking.add(value);
      for (const k of Object.keys(value))
        walk(value[k], isList ? `${path}[${k}]` : path ? `${path}.${k}` : k, k, depth + 1);
      walking.delete(value);
    } else if (type !== 'string' && type !== 'boolean' && value != null) bad(path, `is a ${type}, not data`);
  };
  walk(scene, '', '', 0);
  return out;
}

export function guard(scene) {
  const out = values(scene),
    isObject = (value) => value && typeof value === 'object' && !Array.isArray(value),
    listOfObjects = (list, path, what) =>
      (Array.isArray(list) && [...list].every(isObject)) || out.push({ path, message: 'should be a list of ' + what }); // (holes too)
  if (out.length) return out;
  if (!isObject(scene)) return [{ path: '', message: 'should be an object (a scene)' }];
  if (listOfObjects(scene.parts, 'parts', 'parts') === true) {
    scene.parts.forEach(
      (part, index) => part.shapes === undefined || listOfObjects(part.shapes, `parts[${index}].shapes`, 'shapes'),
    );
    out.push(...mirrors(scene));
  }
  return out;
}

// A mirror part (mirrorOf: B, plane) is B's shapes reflected, and nothing of its own that would place or move it: what
// it may not have, and the B it may not mirror, refused here, where validate, build and mount all look
const OWN = ['shapes', 'at', 'rot', 'scale', 'place', 'spin', 'handle'];
function mirrors(scene) {
  const out = [],
    byId = new Map(scene.parts.map((part) => [part.id, part])),
    fluids = new Set(
      [...(Array.isArray(scene.liquids) ? scene.liquids : []), ...(Array.isArray(scene.gases) ? scene.gases : [])].map(
        (fluid) => fluid && fluid.part,
      ),
    );
  scene.parts.forEach((part, index) => {
    if (part.mirrorOf === undefined) return;
    const say = (message) => out.push({ path: `parts[${index}]`, message }),
      b = byId.get(part.mirrorOf),
      own = OWN.filter((key) => part[key] !== undefined);
    if (own.length)
      say(`is a mirror (mirrorOf) and so has no ${own.join(', ')} of its own: it takes ${part.mirrorOf}'s, reflected`);
    if (part.mirrorOf === part.id) say(`mirrors itself: mirrorOf names another part`);
    else if (!b) say(`mirrors "${part.mirrorOf}", which is no part`);
    else if (b.mirrorOf !== undefined) say(`mirrors ${b.id}, itself a mirror: mirror ${b.mirrorOf} instead`);
    else if (b.handle) say(`mirrors ${b.id}, which has a handle: a mirror cannot follow it`);
    else if (fluids.has(b.id)) say(`mirrors ${b.id}, a liquid's or a gas's part: lk3d makes its shape as it fills`);
  });
  return out;
}
