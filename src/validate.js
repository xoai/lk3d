// Checks a scene before it is drawn, and says what is wrong where: the rules of schema/scene.schema.json (the one
// description of the format: editors read it too), plus what a schema cannot say: unique part ids, a handle that moves
// parts that exist, a shape naming a model the scene lists. Not part of the runtime bundle: import 'lk3d/validate'.
//   import { validate } from 'lk3d/validate';  validate(scene) → [{ path: 'parts[2].handle', message: '…' }, …]
//   node src/validate.js < scene.json            prints the problems as JSON lines; exit code 1 if there are any
import schema from '../schema/scene.schema.json' with { type: 'json' };

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

// the scene's own cross-references
function links(scene, out) {
  const parts = Array.isArray(scene.parts) ? scene.parts.filter((p) => p && typeof p === 'object') : [];
  const names = new Set(parts.flatMap((p) => [p.id, p.group].filter(Boolean))),
    seen = new Set(),
    models = scene.models || {};
  parts.forEach((p, k) => {
    if (p.id != null && seen.has(p.id))
      out.push({ path: `parts[${k}].id`, message: `${say(p.id)} is used by two parts` });
    seen.add(p.id);
    for (const m of (p.handle && Array.isArray(p.handle.moves) && p.handle.moves) || []) {
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
  const out = [];
  check(schema, scene, '', out);
  if (TYPES.object(scene)) links(scene, out);
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
