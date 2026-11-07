// Checks a scene before it is drawn, and says what is wrong where: the rules of schema/scene.schema.json (the one
// description of the format: editors read it too), plus what a schema cannot say: unique part ids, a handle that moves
// parts that exist (within its own range, about an axis that has a direction), a shape naming a model the scene lists,
// and the engine's own guard (guard.js: what LK3D.mount refuses whatever the schema says, such as a profile of more
// points than it triangulates in good time). Not part of the runtime bundle: import 'lk3d/validate'.
//   import { validate } from 'lk3d/validate';  validate(scene) → [{ path: 'parts[2].handle', message: '…' }, …]
//   node src/validate.js < scene.json            prints the problems as JSON lines; exit code 1 if there are any
import schema from '../schema/scene.schema.json' with { type: 'json' };
import { guard, values } from './guard.js';

// The part of JSON Schema 2020-12 the scene schema uses: type, enum, const, required, properties,
// additionalProperties, items, prefixItems, minItems, maxItems, minimum, maximum, exclusiveMinimum, minLength, pattern,
// anyOf, oneOf, dependentSchemas and local $ref. "x-message" on a schema replaces its own errors with one sentence.
const TYPES = {
  object: (v) => v !== null && typeof v === 'object' && !Array.isArray(v),
  array: Array.isArray,
  string: (v) => typeof v === 'string',
  number: (v) => typeof v === 'number' && Number.isFinite(v),
  integer: (v) => Number.isInteger(v),
  boolean: (v) => typeof v === 'boolean',
};
const say = (v) => JSON.stringify(v);
function check(s, v, path, out) {
  if (s.$ref)
    s = {
      ...s.$ref
        .split('/')
        .slice(1)
        .reduce((o, k) => o[k], schema),
      ...s,
      $ref: undefined,
    };
  const errs = [],
    add = (message) => errs.push({ path, message });
  if (s.type && !TYPES[s.type](v))
    add(`should be ${s.type === 'array' ? 'a list' : s.type === 'object' ? 'an object' : 'a ' + s.type}`);
  else {
    if (s.enum && !s.enum.includes(v)) add(`should be one of ${s.enum.join(', ')}, not ${say(v)}`);
    if ('const' in s && v !== s.const) add(`should be ${say(s.const)}`);
    if (typeof v === 'number') {
      if (s.minimum != null && v < s.minimum) add(`should be at least ${s.minimum}`);
      if (s.maximum != null && v > s.maximum) add(`should be at most ${s.maximum}`);
      if (s.exclusiveMinimum != null && v <= s.exclusiveMinimum) add(`should be more than ${s.exclusiveMinimum}`);
    }
    if (typeof v === 'string') {
      if (s.minLength && v.length < s.minLength) add('should not be empty');
      if (s.pattern && !new RegExp(s.pattern).test(v)) add(`${say(v)} does not have the right form`);
    }
    if (Array.isArray(v)) {
      if (s.minItems != null && v.length < s.minItems) add(`should have at least ${s.minItems} items`);
      if (s.maxItems != null && v.length > s.maxItems) add(`should have at most ${s.maxItems} items`);
      v.forEach((x, k) => {
        const it = (s.prefixItems && s.prefixItems[k]) || s.items;
        if (it) check(it, x, `${path}[${k}]`, errs);
      });
    }
    if (TYPES.object(v)) {
      for (const k of s.required || []) if (!(k in v)) add(`needs ${k}`);
      for (const [k, x] of Object.entries(v)) {
        const p = s.properties && s.properties[k],
          ap = s.additionalProperties;
        if (p) check(p, x, path ? `${path}.${k}` : k, errs);
        else if (ap && typeof ap === 'object') check(ap, x, path ? `${path}.${k}` : k, errs);
        // (said at the field itself, so a one-sentence x-message about the object does not hide which field it is)
        else if (ap === false) errs.push({ path: path ? `${path}.${k}` : k, message: 'is not a field here' });
      }
      for (const [k, d] of Object.entries(s.dependentSchemas || {})) if (k in v) check(d, v, path, errs);
    }
    const ok = (sub) => {
      const e = [];
      check(sub, v, path, e);
      return !e.length;
    };
    if (s.anyOf && !s.anyOf.some(ok)) add('is not any of the allowed forms');
    if (s.oneOf && s.oneOf.filter(ok).length !== 1) add('should match exactly one of the allowed forms');
  }
  // "x-message" says in one sentence what this field should be; errors deeper inside keep their own place and words
  const own = errs.filter((e) => e.path === path),
    deeper = errs.filter((e) => e.path !== path);
  out.push(...(own.length && s['x-message'] ? [{ path, message: s['x-message'] }] : own), ...deeper);
}

// an axis (or a cut's normal) of length 0 has no direction: what it turns or slides would not move, or move by NaN
const zero = (v) => Array.isArray(v) && v.length === 3 && v.every((x) => x === 0);
const NO_WAY = 'has no direction: [0, 0, 0] points nowhere';

// the scene's own cross-references
function links(scene, out) {
  const parts = Array.isArray(scene.parts) ? scene.parts.filter((p) => p && typeof p === 'object') : [];
  const section = scene.section;
  if (section && typeof section === 'object' && zero(section.normal))
    out.push({ path: 'section.normal', message: NO_WAY });
  const names = new Set(parts.flatMap((p) => [p.id, p.group].filter(Boolean))),
    seen = new Set(),
    models = scene.models || {};
  parts.forEach((p, k) => {
    if (p.id != null && seen.has(p.id))
      out.push({ path: `parts[${k}].id`, message: `${say(p.id)} is used by two parts` });
    seen.add(p.id);
    // a handle: an axis with a direction, a range from a value to one no smaller, a first value inside it (else the
    // part would jump to the range's end the first time it is moved)
    const h = p.handle && typeof p.handle === 'object' ? p.handle : {};
    for (const w of ['turn', 'slide'])
      if (h[w] && zero(h[w].axis)) out.push({ path: `parts[${k}].handle.${w}.axis`, message: NO_WAY });
    const num = (x) => typeof x === 'number';
    if (num(h.min) && num(h.max) && h.min > h.max)
      out.push({ path: `parts[${k}].handle`, message: `its min (${h.min}) is more than its max (${h.max})` });
    else if (num(h.value) && ((num(h.min) && h.value < h.min) || (num(h.max) && h.value > h.max)))
      out.push({
        path: `parts[${k}].handle.value`,
        message: `${h.value} is outside its range [${h.min ?? '…'}, ${h.max ?? '…'}]`,
      });
    for (const m of Array.isArray(h.moves) ? h.moves : []) {
      if (!names.has(m))
        out.push({ path: `parts[${k}].handle.moves`, message: `moves ${say(m)}, which is no part or group` });
    }
    const walk = (s, path) => {
      if (!s || typeof s !== 'object') return;
      // a bond between atoms that exist
      const atoms = s.molecule && Array.isArray(s.molecule.atoms) ? s.molecule.atoms.length : 0;
      if (s.molecule && Array.isArray(s.molecule.bonds))
        s.molecule.bonds.forEach((b, i) => {
          if (Array.isArray(b) && b.slice(0, 2).some((a) => Number.isInteger(a) && (a < 0 || a >= atoms)))
            out.push({
              path: `${path}.molecule.bonds[${i}]`,
              message: `joins an atom the molecule does not have (it has ${atoms})`,
            });
        });
      if (typeof s.model === 'string' && !(s.model in models))
        out.push({ path, message: `model ${say(s.model)} is not under the scene's models` });
      if (s.scatter && s.scatter.shape) walk(s.scatter.shape, `${path}.scatter.shape`);
    };
    (Array.isArray(p.shapes) ? p.shapes : []).forEach((s, j) => walk(s, `parts[${k}].shapes[${j}]`));
  });
  // vessels, liquids and gases: each names what exists; a part without shapes is a liquid's or a gas's (lk3d makes it)
  const vids = new Set((Array.isArray(scene.vessels) ? scene.vessels : []).map((v) => v && v.id)),
    lids = new Set((Array.isArray(scene.liquids) ? scene.liquids : []).map((l) => l && l.part)),
    fluid = new Set([...lids, ...(Array.isArray(scene.gases) ? scene.gases : []).map((x) => x && x.part)]),
    mids = new Set((Array.isArray(scene.motions) ? scene.motions : []).map((m) => m && m.id)),
    has = (id) => parts.some((p) => p.id === id);
  parts.forEach((p, k) => {
    if (!p.shapes && !fluid.has(p.id))
      out.push({ path: `parts[${k}]`, message: 'needs shapes (or is a liquid or a gas)' });
  });
  for (const [list, what] of [
    [scene.vessels, 'vessels'],
    [scene.liquids, 'liquids'],
    [scene.gases, 'gases'],
  ])
    (Array.isArray(list) ? list : []).forEach((x, i) => {
      if (!x || typeof x !== 'object') return;
      const at = `${what}[${i}]`,
        bad = (field, msg) => out.push({ path: `${at}.${field}`, message: msg });
      if (x.part != null && !has(x.part)) bad('part', `${say(x.part)} is no part`);
      if (x.in != null && !vids.has(x.in)) bad('in', `${say(x.in)} is no vessel`);
      if (x.piston != null && !has(x.piston)) bad('piston', `${say(x.piston)} is no part`);
      if (x.into != null && (!lids.has(x.into) || x.into === x.part)) bad('into', `${say(x.into)} is no other liquid`);
      if (x.outlet && x.outlet.valve != null && !mids.has(x.outlet.valve))
        bad('outlet.valve', `${say(x.outlet.valve)} is no motion`);
      if (Array.isArray(x.inside) && x.inside.some((h, n) => Array.isArray(h) && n && h[0] <= x.inside[n - 1][0]))
        bad('inside', 'heights go up from the bottom to the brim');
    });
  // joints: one id each, moving parts that exist (a part on one joint only), reading joints and motions that exist,
  // without a loop; a rod holds a slide, an aim turns
  const jl = Array.isArray(scene.joints) ? scene.joints : [],
    jids = new Map(),
    owner = new Map();
  jl.forEach((j, i) => {
    if (!j || typeof j !== 'object') return;
    if (jids.has(j.id)) out.push({ path: `joints[${i}].id`, message: `${say(j.id)} is used by two joints` });
    jids.set(j.id, j);
  });
  jl.forEach((j, i) => {
    if (!j || typeof j !== 'object') return;
    const at = `joints[${i}]`,
      bad = (field, msg) => out.push({ path: `${at}.${field}`, message: msg });
    for (const w of ['turn', 'slide']) if (j[w] && zero(j[w].axis)) bad(`${w}.axis`, NO_WAY);
    for (const n of Array.isArray(j.parts) ? j.parts : []) {
      if (!names.has(n)) bad('parts', `moves ${say(n)}, which is no part or group`);
      else if (owner.has(n) && owner.get(n) !== j.id)
        bad('parts', `${say(n)} is on joint ${say(owner.get(n))} already`);
      owner.set(n, j.id);
    }
    for (const [field, id] of [
      ['parent', j.parent],
      ['follow.joint', j.follow && j.follow.joint],
      ['rod.joint', j.rod && j.rod.joint],
      ['aim.joint', j.aim && j.aim.joint],
    ])
      if (id != null && !jids.has(id)) bad(field, `${say(id)} is no joint`);
      else if (id === j.id) bad(field, 'a joint reads another joint, not itself');
    const d = j.drive && (typeof j.drive === 'string' ? j.drive : j.drive.motion);
    if (d != null && !mids.has(d)) bad('drive', `${say(d)} is no motion`);
    if (j.rod && !j.slide) bad('rod', 'a rod holds a slide (a piston): give the joint slide, not turn');
    if (j.aim && !j.turn) bad('aim', 'an aim turns its parts: give the joint turn, not slide');
    const given = ['drive', 'follow', 'rod', 'aim'].filter((k) => j[k] != null);
    if (given.length > 1) bad(given[1], `its value comes from one place: ${given.join(' or ')}`);
  });
  // (a loop: a joint that reads itself through others)
  const jseen = new Map(),
    reads = (j) =>
      [j.parent, j.follow && j.follow.joint, j.rod && j.rod.joint, j.aim && j.aim.joint].filter((x) => jids.has(x));
  const loop = (j) => {
    if (jseen.get(j.id) === 2) return false;
    if (jseen.get(j.id) === 1) return true;
    jseen.set(j.id, 1);
    const l = reads(j).some((r) => loop(jids.get(r)));
    jseen.set(j.id, 2);
    return l;
  };
  jl.forEach((j, i) => {
    if (j && typeof j === 'object' && !jseen.has(j.id) && loop(j))
      out.push({ path: `joints[${i}]`, message: `${say(j.id)} reads itself through other joints (a loop)` });
  });
  // motions: one id each; tracks that move parts that exist, with keys in order and within the range
  const ids = new Set();
  (Array.isArray(scene.motions) ? scene.motions : []).forEach((mo, i) => {
    if (!mo || typeof mo !== 'object') return;
    if (ids.has(mo.id)) out.push({ path: `motions[${i}].id`, message: `${say(mo.id)} is used by two motions` });
    ids.add(mo.id);
    const [a, b] = Array.isArray(mo.range) ? mo.range : [];
    if (!(b > a)) out.push({ path: `motions[${i}].range`, message: 'runs from a value to a larger one' });
    (Array.isArray(mo.tracks) ? mo.tracks : []).forEach((tr, j) => {
      const at = `motions[${i}].tracks[${j}]`;
      if (tr && tr.turn && zero(tr.turn.axis)) out.push({ path: `${at}.turn.axis`, message: NO_WAY });
      for (const n of (tr && Array.isArray(tr.parts) && tr.parts) || [])
        if (!names.has(n)) out.push({ path: `${at}.parts`, message: `moves ${say(n)}, which is no part or group` });
      for (const [keys, where] of [
        [tr && tr.move, 'move'],
        [tr && tr.turn && tr.turn.keys, 'turn.keys'],
      ])
        if (
          Array.isArray(keys) &&
          keys.some((k, n) => !Array.isArray(k) || k[0] < a || k[0] > b || (n && k[0] < keys[n - 1][0]))
        )
          out.push({
            path: `${at}.${where}`,
            message: `keys go in order of their values, within the range [${a}, ${b}]`,
          });
    });
  });
}

export function validate(scene) {
  const out = values(scene); // (a scene that holds itself, or is nested past reason: said first, and only that)
  if (out.length) return out;
  check(schema, scene, '', out);
  if (TYPES.object(scene)) links(scene, out);
  // (the guard's own word only where the schema said nothing at or around the place)
  for (const g of guard(scene))
    if (!out.some((e) => e.path.startsWith(g.path) || g.path.startsWith(e.path))) out.push(g);
  return out;
}
export { schema };

// from the command line: a scene (JSON) on stdin, its problems out, one JSON object per line
// (run as `node src/validate.js`, not merely imported by a script of the same name)
const direct =
  typeof process !== 'undefined' &&
  !!process.argv?.[1] &&
  import.meta.url ===
    new URL('file://' + (/^\//.test(process.argv[1]) ? '' : '/') + process.argv[1].replace(/\\/g, '/')).href;
if (direct) {
  let text = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (d) => (text += d));
  process.stdin.on('end', () => {
    const errors = validate(JSON.parse(text));
    for (const e of errors) console.log(JSON.stringify(e));
    process.exitCode = errors.length ? 1 : 0;
  });
}
