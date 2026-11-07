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
    on = new Set(),
    bad = (path, message) => out.push({ path, message });
  let n = 0;
  const walk = (v, path, key, depth) => {
    const t = typeof v;
    if (++n > LIMITS.values) return n === LIMITS.values + 1 && bad('', 'has more than a million values');
    if (t === 'number') Number.isFinite(v) || bad(path, `is ${v}, not a finite number`);
    else if (t === 'object' && v) {
      const list = Array.isArray(v),
        most = POINTS.test(key) ? LIMITS.points : LIMITS.items;
      if (on.has(v)) return bad(path, 'holds itself (a loop)');
      if (depth > LIMITS.depth) return bad(path, `is nested more than ${LIMITS.depth} deep`);
      if (list && v.length > most) return bad(path, `has ${v.length} items; at most ${most}`);
      on.add(v);
      for (const k of Object.keys(v)) walk(v[k], list ? `${path}[${k}]` : path ? `${path}.${k}` : k, k, depth + 1);
      on.delete(v);
    } else if (t !== 'string' && t !== 'boolean' && v != null) bad(path, `is a ${t}, not data`);
  };
  walk(scene, '', '', 0);
  return out;
}

export function guard(scene) {
  const out = values(scene),
    obj = (v) => v && typeof v === 'object' && !Array.isArray(v),
    objs = (l, path, what) =>
      (Array.isArray(l) && [...l].every(obj)) || out.push({ path, message: 'should be a list of ' + what }); // (holes too)
  if (out.length) return out;
  if (!obj(scene)) return [{ path: '', message: 'should be an object (a scene)' }];
  if (objs(scene.parts, 'parts', 'parts') === true)
    scene.parts.forEach((p, k) => p.shapes === undefined || objs(p.shapes, `parts[${k}].shapes`, 'shapes'));
  return out;
}
