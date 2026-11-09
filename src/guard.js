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

export function values(scene) {
  const out = [],
    walking = new Set(), // (the objects on the path from the scene down to here)
    bad = (path, message) => out.push({ path, message });
  let count = 0;
  const walk = (value, path, key, depth) => {
    const type = typeof value;
    if (++count > LIMITS.values) return count === LIMITS.values + 1 && bad('', 'has more than a million values');
    if (type === 'number') Number.isFinite(value) || bad(path, `is ${value}, not a finite number`);
    else if (type === 'object' && value) {
      const isList = Array.isArray(value),
        most = POINTS.test(key) ? LIMITS.points : LIMITS.items;
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
  if (listOfObjects(scene.parts, 'parts', 'parts') === true)
    scene.parts.forEach(
      (part, index) => part.shapes === undefined || listOfObjects(part.shapes, `parts[${index}].shapes`, 'shapes'),
    );
  return out;
}
