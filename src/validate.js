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
  object: (value) => value !== null && typeof value === 'object' && !Array.isArray(value),
  array: Array.isArray,
  string: (value) => typeof value === 'string',
  number: (value) => typeof value === 'number' && Number.isFinite(value),
  integer: (value) => Number.isInteger(value),
  boolean: (value) => typeof value === 'boolean',
};
const say = (value) => JSON.stringify(value);
// a schema with its local $ref filled in
const resolve = (subschema) =>
  subschema.$ref
    ? {
        ...subschema.$ref
          .split('/')
          .slice(1)
          .reduce((node, key) => node[key], schema),
        ...subschema,
        $ref: undefined,
      }
    : subschema;
function check(subschema, value, path, out) {
  subschema = resolve(subschema);
  const errors = [],
    add = (message) => errors.push({ path, message });
  if (subschema.type && !TYPES[subschema.type](value))
    add(
      `should be ${subschema.type === 'array' ? 'a list' : subschema.type === 'object' ? 'an object' : 'a ' + subschema.type}`,
    );
  else {
    if (subschema.enum && !subschema.enum.includes(value))
      add(`should be one of ${subschema.enum.join(', ')}, not ${say(value)}`);
    if ('const' in subschema && value !== subschema.const) add(`should be ${say(subschema.const)}`);
    if (typeof value === 'number') {
      if (subschema.minimum != null && value < subschema.minimum) add(`should be at least ${subschema.minimum}`);
      if (subschema.maximum != null && value > subschema.maximum) add(`should be at most ${subschema.maximum}`);
      if (subschema.exclusiveMinimum != null && value <= subschema.exclusiveMinimum)
        add(`should be more than ${subschema.exclusiveMinimum}`);
    }
    if (typeof value === 'string') {
      if (subschema.minLength && value.length < subschema.minLength) add('should not be empty');
      if (subschema.pattern && !new RegExp(subschema.pattern).test(value))
        add(`${say(value)} does not have the right form`);
    }
    if (Array.isArray(value)) {
      if (subschema.minItems != null && value.length < subschema.minItems)
        add(`should have at least ${subschema.minItems} items`);
      if (subschema.maxItems != null && value.length > subschema.maxItems)
        add(`should have at most ${subschema.maxItems} items`);
      value.forEach((item, index) => {
        const itemSchema = (subschema.prefixItems && subschema.prefixItems[index]) || subschema.items;
        if (itemSchema) check(itemSchema, item, `${path}[${index}]`, errors);
      });
    }
    if (TYPES.object(value)) {
      for (const field of subschema.required || []) if (!(field in value)) add(`needs ${field}`);
      for (const [field, fieldValue] of Object.entries(value)) {
        const fieldSchema = subschema.properties && subschema.properties[field],
          additional = subschema.additionalProperties;
        if (fieldSchema) check(fieldSchema, fieldValue, path ? `${path}.${field}` : field, errors);
        else if (additional && typeof additional === 'object')
          check(additional, fieldValue, path ? `${path}.${field}` : field, errors);
        // (said at the field itself, so a one-sentence x-message about the object does not hide which field it is)
        else if (additional === false)
          errors.push({ path: path ? `${path}.${field}` : field, message: unknown(field, subschema) });
      }
      for (const [field, dependent] of Object.entries(subschema.dependentSchemas || {}))
        if (field in value) check(dependent, value, path, errors);
    }
    const fits = (form) => {
      const formErrors = [];
      check(form, value, path, formErrors);
      return !formErrors.length;
    };
    if (subschema.anyOf && !subschema.anyOf.some(fits)) {
      // when the value's type fits one form only (an object where the other form is false), what is wrong inside that
      // form is said, at its own field, rather than only that no form fits
      const sameType = subschema.anyOf.filter((form) => (form = resolve(form)).type && TYPES[form.type](value));
      if (sameType.length === 1) check(sameType[0], value, path, errors);
      else add('is not any of the allowed forms');
    }
    if (subschema.oneOf && subschema.oneOf.filter(fits).length !== 1)
      add('should match exactly one of the allowed forms');
  }
  // "x-message" says in one sentence what this field should be; errors deeper inside keep their own place and words
  const here = errors.filter((error) => error.path === path),
    deeper = errors.filter((error) => error.path !== path);
  out.push(...(here.length && subschema['x-message'] ? [{ path, message: subschema['x-message'] }] : here), ...deeper);
}

// A field the format does not have is most often a misspelt one ("mine" for min, "colour" for color), so the nearest
// name is offered when it is a letter or two away (a third of the word's length); a shape's field (at, rot…) written on
// the part that holds the shape is said to belong on the shape.
function unknown(field, subschema) {
  const names = Object.keys(subschema.properties || {}),
    shapeFields = schema.$defs.shape.properties;
  if (subschema.properties?.shapes && field in shapeFields)
    return `is not a field of the part: it goes on one of its shapes`;
  let closest = '',
    maxEdits = Math.max(1, Math.floor(field.length / 3));
  for (const name of names) {
    const distance = edits(field.toLowerCase(), name.toLowerCase());
    if (distance <= maxEdits) [closest, maxEdits] = [name, distance - 1];
  }
  return `is not a field here${closest ? ` (${closest}?)` : ''}`;
}
// the fewest letters to add, remove or change to turn a into b (Levenshtein)
function edits(a, b) {
  let row = [...Array(b.length + 1).keys()];
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++)
      next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    row = next;
  }
  return row[b.length];
}

// an axis (or a cut's normal) of length 0 has no direction: what it turns or slides would not move, or move by NaN
const zero = (vector) => Array.isArray(vector) && vector.length === 3 && vector.every((component) => component === 0);
const NO_WAY = 'has no direction: [0, 0, 0] points nowhere';

// the scene's own cross-references
function links(scene, out) {
  const parts = Array.isArray(scene.parts) ? scene.parts.filter((part) => part && typeof part === 'object') : [];
  const section = scene.section;
  if (section && typeof section === 'object' && zero(section.normal))
    out.push({ path: 'section.normal', message: NO_WAY });
  const names = new Set(parts.flatMap((part) => [part.id, part.group].filter(Boolean))),
    seen = new Set(),
    models = scene.models || {};
  parts.forEach((part, index) => {
    if (part.id != null && seen.has(part.id))
      out.push({ path: `parts[${index}].id`, message: `${say(part.id)} is used by two parts` });
    seen.add(part.id);
    // a handle: an axis with a direction, a range from a value to one no smaller, a first value inside it (else the
    // part would jump to the range's end the first time it is moved)
    const handle = part.handle && typeof part.handle === 'object' ? part.handle : {};
    for (const kind of ['turn', 'slide'])
      if (handle[kind] && zero(handle[kind].axis))
        out.push({ path: `parts[${index}].handle.${kind}.axis`, message: NO_WAY });
    const isNumber = (value) => typeof value === 'number';
    if (isNumber(handle.min) && isNumber(handle.max) && handle.min > handle.max)
      out.push({
        path: `parts[${index}].handle`,
        message: `its min (${handle.min}) is more than its max (${handle.max})`,
      });
    else if (
      isNumber(handle.value) &&
      ((isNumber(handle.min) && handle.value < handle.min) || (isNumber(handle.max) && handle.value > handle.max))
    )
      out.push({
        path: `parts[${index}].handle.value`,
        message: `${handle.value} is outside its range [${handle.min ?? '…'}, ${handle.max ?? '…'}]`,
      });
    for (const moved of Array.isArray(handle.moves) ? handle.moves : []) {
      if (!names.has(moved))
        out.push({ path: `parts[${index}].handle.moves`, message: `moves ${say(moved)}, which is no part or group` });
    }
    const walk = (shape, path) => {
      if (!shape || typeof shape !== 'object') return;
      // a bond between atoms that exist
      const atomCount = shape.molecule && Array.isArray(shape.molecule.atoms) ? shape.molecule.atoms.length : 0;
      if (shape.molecule && Array.isArray(shape.molecule.bonds))
        shape.molecule.bonds.forEach((bond, i) => {
          if (
            Array.isArray(bond) &&
            bond.slice(0, 2).some((atom) => Number.isInteger(atom) && (atom < 0 || atom >= atomCount))
          )
            out.push({
              path: `${path}.molecule.bonds[${i}]`,
              message: `joins an atom the molecule does not have (it has ${atomCount})`,
            });
        });
      if (typeof shape.model === 'string' && !(shape.model in models))
        out.push({ path, message: `model ${say(shape.model)} is not under the scene's models` });
      if (shape.scatter && shape.scatter.shape) walk(shape.scatter.shape, `${path}.scatter.shape`);
    };
    (Array.isArray(part.shapes) ? part.shapes : []).forEach((shape, j) => walk(shape, `parts[${index}].shapes[${j}]`));
  });
  // vessels, liquids and gases: each names what exists; a part without shapes is a liquid's or a gas's (lk3d makes it)
  const vesselIds = new Set((Array.isArray(scene.vessels) ? scene.vessels : []).map((vessel) => vessel && vessel.id)),
    liquidParts = new Set((Array.isArray(scene.liquids) ? scene.liquids : []).map((liquid) => liquid && liquid.part)),
    fluidParts = new Set([
      ...liquidParts,
      ...(Array.isArray(scene.gases) ? scene.gases : []).map((gas) => gas && gas.part),
    ]),
    motionIds = new Set((Array.isArray(scene.motions) ? scene.motions : []).map((motion) => motion && motion.id)),
    isPart = (id) => parts.some((part) => part.id === id);
  parts.forEach((part, index) => {
    if (!part.shapes && !fluidParts.has(part.id))
      out.push({ path: `parts[${index}]`, message: 'needs shapes (or is a liquid or a gas)' });
  });
  for (const [list, what] of [
    [scene.vessels, 'vessels'],
    [scene.liquids, 'liquids'],
    [scene.gases, 'gases'],
  ])
    (Array.isArray(list) ? list : []).forEach((entry, i) => {
      if (!entry || typeof entry !== 'object') return;
      const place = `${what}[${i}]`,
        bad = (field, message) => out.push({ path: `${place}.${field}`, message });
      if (entry.part != null && !isPart(entry.part)) bad('part', `${say(entry.part)} is no part`);
      if (entry.in != null && !vesselIds.has(entry.in)) bad('in', `${say(entry.in)} is no vessel`);
      if (entry.piston != null && !isPart(entry.piston)) bad('piston', `${say(entry.piston)} is no part`);
      if (entry.into != null && (!liquidParts.has(entry.into) || entry.into === entry.part))
        bad('into', `${say(entry.into)} is no other liquid`);
      if (entry.outlet && entry.outlet.valve != null && !motionIds.has(entry.outlet.valve))
        bad('outlet.valve', `${say(entry.outlet.valve)} is no motion`);
      if (
        Array.isArray(entry.inside) &&
        entry.inside.some((level, n) => Array.isArray(level) && n && level[0] <= entry.inside[n - 1][0])
      )
        bad('inside', 'heights go up from the bottom to the brim');
    });
  // joints: one id each, moving parts that exist (a part on one joint only), reading joints and motions that exist,
  // without a loop; a rod holds a slide, an aim turns
  const joints = Array.isArray(scene.joints) ? scene.joints : [],
    jointsById = new Map(),
    jointOfPart = new Map();
  joints.forEach((joint, i) => {
    if (!joint || typeof joint !== 'object') return;
    if (jointsById.has(joint.id))
      out.push({ path: `joints[${i}].id`, message: `${say(joint.id)} is used by two joints` });
    jointsById.set(joint.id, joint);
  });
  joints.forEach((joint, i) => {
    if (!joint || typeof joint !== 'object') return;
    const place = `joints[${i}]`,
      bad = (field, message) => out.push({ path: `${place}.${field}`, message });
    for (const kind of ['turn', 'slide']) if (joint[kind] && zero(joint[kind].axis)) bad(`${kind}.axis`, NO_WAY);
    for (const name of Array.isArray(joint.parts) ? joint.parts : []) {
      if (!names.has(name)) bad('parts', `moves ${say(name)}, which is no part or group`);
      else if (jointOfPart.has(name) && jointOfPart.get(name) !== joint.id)
        bad('parts', `${say(name)} is on joint ${say(jointOfPart.get(name))} already`);
      jointOfPart.set(name, joint.id);
    }
    for (const [field, id] of [
      ['parent', joint.parent],
      ['follow.joint', joint.follow && joint.follow.joint],
      ['rod.joint', joint.rod && joint.rod.joint],
      ['aim.joint', joint.aim && joint.aim.joint],
    ])
      if (id != null && !jointsById.has(id)) bad(field, `${say(id)} is no joint`);
      else if (id === joint.id) bad(field, 'a joint reads another joint, not itself');
    const drive = joint.drive && (typeof joint.drive === 'string' ? joint.drive : joint.drive.motion);
    if (drive != null && !motionIds.has(drive)) bad('drive', `${say(drive)} is no motion`);
    if (joint.rod && !joint.slide) bad('rod', 'a rod holds a slide (a piston): give the joint slide, not turn');
    if (joint.aim && !joint.turn) bad('aim', 'an aim turns its parts: give the joint turn, not slide');
    const given = ['drive', 'follow', 'rod', 'aim'].filter((source) => joint[source] != null);
    if (given.length > 1) bad(given[1], `its value comes from one place: ${given.join(' or ')}`);
  });
  // (a loop: a joint that reads itself through others)
  const visit = new Map(), // (1 while its readings are being followed, 2 once done)
    readJoints = (joint) =>
      [
        joint.parent,
        joint.follow && joint.follow.joint,
        joint.rod && joint.rod.joint,
        joint.aim && joint.aim.joint,
      ].filter((id) => jointsById.has(id));
  const loop = (joint) => {
    if (visit.get(joint.id) === 2) return false;
    if (visit.get(joint.id) === 1) return true;
    visit.set(joint.id, 1);
    const found = readJoints(joint).some((id) => loop(jointsById.get(id)));
    visit.set(joint.id, 2);
    return found;
  };
  joints.forEach((joint, i) => {
    if (joint && typeof joint === 'object' && !visit.has(joint.id) && loop(joint))
      out.push({ path: `joints[${i}]`, message: `${say(joint.id)} reads itself through other joints (a loop)` });
  });
  // motions: one id each; tracks that move parts that exist, with keys in order and within the range
  const seenMotions = new Set();
  (Array.isArray(scene.motions) ? scene.motions : []).forEach((motion, i) => {
    if (!motion || typeof motion !== 'object') return;
    if (seenMotions.has(motion.id))
      out.push({ path: `motions[${i}].id`, message: `${say(motion.id)} is used by two motions` });
    seenMotions.add(motion.id);
    const [start, end] = Array.isArray(motion.range) ? motion.range : [];
    if (!(end > start)) out.push({ path: `motions[${i}].range`, message: 'runs from a value to a larger one' });
    (Array.isArray(motion.tracks) ? motion.tracks : []).forEach((track, j) => {
      const place = `motions[${i}].tracks[${j}]`;
      if (track && track.turn && zero(track.turn.axis)) out.push({ path: `${place}.turn.axis`, message: NO_WAY });
      for (const name of (track && Array.isArray(track.parts) && track.parts) || [])
        if (!names.has(name))
          out.push({ path: `${place}.parts`, message: `moves ${say(name)}, which is no part or group` });
      for (const [keys, where] of [
        [track && track.move, 'move'],
        [track && track.turn && track.turn.keys, 'turn.keys'],
      ])
        if (
          Array.isArray(keys) &&
          keys.some((key, n) => !Array.isArray(key) || key[0] < start || key[0] > end || (n && key[0] < keys[n - 1][0]))
        )
          out.push({
            path: `${place}.${where}`,
            message: `keys go in order of their values, within the range [${start}, ${end}]`,
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
  for (const problem of guard(scene))
    if (!out.some((said) => said.path.startsWith(problem.path) || problem.path.startsWith(said.path)))
      out.push(problem);
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
  process.stdin.on('data', (chunk) => (text += chunk));
  process.stdin.on('end', () => {
    const errors = validate(JSON.parse(text));
    for (const error of errors) console.log(JSON.stringify(error));
    process.exitCode = errors.length ? 1 : 0;
  });
}
