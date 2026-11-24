// Checks a scene before it is drawn, and says what is wrong where: the rules of schema/scene.schema.json (the one
// description of the format: editors read it too), plus what a schema cannot say: unique part ids, a handle that moves
// parts that exist (within its own range, about an axis that has a direction), a shape naming a model the scene lists,
// and the engine's own guard (guard.js: what LK3D.mount refuses whatever the schema says, such as a profile of more
// points than it triangulates in good time). Not part of the runtime bundle: import 'lk3d/validate'.
//   import { validate } from 'lk3d/validate';  validate(scene) → [{ path: 'parts[2].handle', message: '…' }, …]
//   node src/validate.js < scene.json            prints the problems as JSON lines; exit code 1 if there are any
import schema from '../schema/scene.schema.json' with { type: 'json' };
import { guard, values } from './guard.js';
import { jointsOf, jointOf } from './joints.js';
import { partsNamed, settersOf } from './sequence.js';

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
      // (a key whose value is undefined is absent, as JSON.stringify leaves it out: { ...scene, expect: undefined })
      for (const field of subschema.required || []) if (value[field] === undefined) add(`needs ${field}`);
      for (const [field, fieldValue] of Object.entries(value)) {
        if (fieldValue === undefined) continue;
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
        if (value[field] !== undefined) check(dependent, value, path, errors);
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
  if (section && typeof section === 'object' && section.second && zero(section.second.normal))
    out.push({ path: 'section.second.normal', message: NO_WAY });
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
    // a plane handle: two axes at right angles, and its min, max and value pairs [u, v]; any other handle, numbers
    const plane = handle.plane && typeof handle.plane === 'object' ? handle.plane : null,
      axes =
        plane && Array.isArray(plane.axes) && plane.axes.length === 2 && plane.axes.every(Array.isArray) && plane.axes;
    if (axes && axes.some(zero)) out.push({ path: `parts[${index}].handle.plane.axes`, message: NO_WAY });
    else if (axes) {
      const [a, b] = axes.map((axis) => axis.map((v) => v / Math.hypot(...axis)));
      if (Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) > 1e-6)
        out.push({ path: `parts[${index}].handle.plane.axes`, message: 'its two axes are not perpendicular' });
    }
    for (const key of ['min', 'max', 'value'])
      if (key in handle && Array.isArray(handle[key]) !== !!plane)
        out.push({
          path: `parts[${index}].handle.${key}`,
          message: plane
            ? "a plane handle's min, max and value are pairs [u, v]"
            : 'only a plane handle takes a pair [u, v]',
        });
    // (each axis of a plane handle's range, or the one range of any other)
    for (const k of plane ? [0, 1] : [null]) {
      const pick = (/** @type {any} */ v) => (k == null ? v : Array.isArray(v) ? v[k] : undefined),
        min = pick(handle.min),
        max = pick(handle.max),
        value = pick(handle.value),
        axis = k == null ? '' : ` along its ${k ? 'second' : 'first'} axis`;
      if (isNumber(min) && isNumber(max) && min > max)
        out.push({ path: `parts[${index}].handle`, message: `its min (${min}) is more than its max (${max})${axis}` });
      else if (isNumber(value) && ((isNumber(min) && value < min) || (isNumber(max) && value > max)))
        out.push({
          path: `parts[${index}].handle.value`,
          message: `${value} is outside its range [${min ?? '…'}, ${max ?? '…'}]${axis}`,
        });
    }
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
    if (!part.shapes && !fluidParts.has(part.id) && part.mirrorOf === undefined)
      out.push({ path: `parts[${index}]`, message: 'needs shapes (or is a liquid or a gas, or a mirror)' });
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
  dimensions(scene, out, parts);
  steps(scene, out, names, parts);
  expectations(scene, out, parts);
  sequences(scene, out, names, parts);
  groups(scene, out);
  // place: the parts it names exist (lk3d check works out the rest: lint.js, place.js)
  parts.forEach((part, index) => {
    const place = part.place;
    if (!place || typeof place !== 'object') return;
    for (const key of ['on', 'under', 'in', 'against', 'alignedWith'])
      if (typeof place[key] === 'string' && !parts.some((other) => other.id === place[key]))
        out.push({ path: `parts[${index}].place.${key}`, message: `${say(place[key])} is no part` });
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

// expect: each item names parts or groups that exist, and not a name that is both (which would it mean?); a range from
// a value to one no smaller; a step that is there (by its id, or its number from 1)
function expectations(scene, out, parts) {
  const ids = new Set(parts.map((part) => part.id)),
    groups = new Set(parts.map((part) => part.group).filter(Boolean)),
    steps = (Array.isArray(scene.steps) ? scene.steps : []).filter((step) => step && typeof step === 'object');
  (Array.isArray(scene.expect) ? scene.expect : []).forEach((item, i) => {
    if (!item || typeof item !== 'object') return;
    const bad = (field, message) => out.push({ path: `expect[${i}]${field}`, message });
    for (const field of ['inside', 'touches', 'clear', 'above', 'size', 'seen', 'of', 'with']) {
      const name = item[field];
      if (typeof name !== 'string') continue;
      if (!ids.has(name) && !groups.has(name)) bad(`.${field}`, `${say(name)} is no part or group`);
      else if (ids.has(name) && groups.has(name))
        bad(`.${field}`, `${say(name)} is both a part and a group: name another part or group`);
    }
    for (const field of ['by', 'is'])
      if (Array.isArray(item[field]) && item[field][0] > item[field][1])
        bad(`.${field}`, `its least (${item[field][0]}) is more than its greatest (${item[field][1]})`);
    if (item.seen != null && item.sequence == null && item.stage == null) {
      const there =
        typeof item.step === 'number'
          ? item.step >= 1 && item.step <= steps.length
          : steps.some((s) => s.id === item.step);
      if (!there) bad('.step', `${say(item.step)} is no step (an id, or a number from 1 to ${steps.length})`);
    } else if (item.seen != null) {
      const sequence = (Array.isArray(scene.sequences) ? scene.sequences : []).find((q) => q && q.id === item.sequence),
        count = sequence && Array.isArray(sequence.stages) ? sequence.stages.length : 0;
      if (item.step != null) bad('', "is seen at a step or at a sequence's stage, not both");
      else if (!sequence) bad('.sequence', `${say(item.sequence)} is no sequence`);
      else if (!(item.stage >= 1 && item.stage <= count))
        bad('.stage', `${say(item.stage)} is no stage of ${say(item.sequence)} (from 1 to ${count})`);
    }
  });
}

// dimensions: one id each; the parts their points ride on exist; a length between two places, an angle with arms
function dimensions(scene, out, parts) {
  const seen = new Set(),
    isPart = (id) => parts.some((part) => part.id === id);
  (Array.isArray(scene.dimensions) ? scene.dimensions : []).forEach((dimension, i) => {
    if (!dimension || typeof dimension !== 'object') return;
    const bad = (field, message) => out.push({ path: `dimensions[${i}]${field}`, message });
    if (dimension.id != null) {
      if (seen.has(dimension.id)) bad('.id', `${say(dimension.id)} is used by two dimensions`);
      seen.add(dimension.id);
    }
    const points = [
      ['.from', dimension.from],
      ['.to', dimension.to],
      ...(Array.isArray(dimension.angle) ? dimension.angle.map((point, k) => [`.angle[${k}]`, point]) : []),
    ];
    for (const [field, point] of points)
      if (point && typeof point === 'object' && !Array.isArray(point) && point.part != null && !isPart(point.part))
        bad(`${field}.part`, `${say(point.part)} is no part`);
    // (the same place twice, where neither rides on a part: nothing to measure)
    const same = (a, b) => Array.isArray(a) && Array.isArray(b) && a.every((value, k) => value === b[k]);
    if (same(dimension.from, dimension.to)) bad('.to', 'is where from is: a length needs two places');
    if (
      Array.isArray(dimension.angle) &&
      (same(dimension.angle[0], dimension.angle[1]) || same(dimension.angle[2], dimension.angle[1]))
    )
      bad('.angle', 'has an arm of no length: its points are a point on each arm, and the vertex between them');
    if (dimension.from && dimension.angle) bad('', 'is a length (from, to) or an angle, not both');
    if (dimension.unit && !scene.unit)
      bad('.unit', `converts to ${say(dimension.unit)}, but the scene has no unit to convert from`);
  });
}

// a scene's sequences as the motions they are (lk3d-story expands them: sequence.js): their ids and ranges
function sequenceMotions(scene) {
  return (Array.isArray(scene.sequences) ? scene.sequences : [])
    .filter((sequence) => sequence && typeof sequence === 'object' && Array.isArray(sequence.stages))
    .map((sequence) => {
      const n = sequence.stages.length;
      return { id: sequence.id, range: [0, n], value: sequence.build ? n : 0, sequence: true };
    });
}

// the motions each sequence holds at their start while it is away from its own: those that set the value of a joint
// of a part it moves (by drive, or through follow, rod or aim)
function heldBy(scene) {
  const out = new Map();
  /** @type {any} */ let sceneJoints = null;
  try {
    sceneJoints = jointsOf(scene);
  } catch {
    // (a loop, or a joint read that is not there: said where the joints are checked)
  }
  for (const sequence of Array.isArray(scene.sequences) ? scene.sequences : []) {
    const motionIds = new Set();
    if (sceneJoints && sequence && Array.isArray(sequence.stages))
      for (const stage of sequence.stages)
        for (const part of partsNamed(scene, Array.isArray(stage?.parts) ? stage.parts : [])) {
          const joint = jointOf(sceneJoints, part);
          if (joint) for (const id of settersOf(sceneJoints, joint)) motionIds.add(id);
        }
    out.set(sequence?.id, motionIds);
  }
  return out;
}

// sequences: one id among the motions and sequences; each stage names parts or groups that exist, none in two stages,
// and has something to move (by, a path, a turn, or a part with a non-zero explode vector)
function sequences(scene, out, names, parts) {
  const motionIds = new Set((Array.isArray(scene.motions) ? scene.motions : []).map((motion) => motion && motion.id)),
    seen = new Set();
  (Array.isArray(scene.sequences) ? scene.sequences : []).forEach((sequence, i) => {
    if (!sequence || typeof sequence !== 'object') return;
    const bad = (field, message) => out.push({ path: `sequences[${i}]${field}`, message });
    if (motionIds.has(sequence.id)) bad('.id', `${say(sequence.id)} is a motion's id too: ids are unique among both`);
    else if (seen.has(sequence.id)) bad('.id', `${say(sequence.id)} is used by two sequences`);
    seen.add(sequence.id);
    const staged = new Map(); // (each part's stage, from 1)
    (Array.isArray(sequence.stages) ? sequence.stages : []).forEach((stage, j) => {
      if (!stage || typeof stage !== 'object' || !Array.isArray(stage.parts)) return;
      const place = `.stages[${j}]`;
      for (const name of stage.parts)
        if (!names.has(name)) bad(`${place}.parts`, `names ${say(name)}, which is no part or group`);
      const moved = partsNamed({ parts }, stage.parts);
      for (const part of moved)
        if (staged.has(part.id) && staged.get(part.id) !== j + 1)
          bad(
            `${place}.parts`,
            `names ${say(part.id)}, already in stage ${staged.get(part.id)}: a part is in one stage`,
          );
        else staged.set(part.id, j + 1);
      const explodes = moved.some((part) => Array.isArray(part.explode) && part.explode.some((v) => v));
      if (!stage.by && !stage.path && !stage.turn && !explodes && moved.length)
        bad(place, 'has nothing to move: give it by, a path or a turn, or name parts with an explode vector');
    });
  });
}

// motions that are alternatives (group): at least two, never a loop played as a clip (then), never two setting the
// value of the same joint (a joint keeps one drive; a parent only carries)
function groups(scene, out) {
  const motions = Array.isArray(scene.motions) ? scene.motions : [];
  /** @type {any} */ let sceneJoints = null;
  try {
    sceneJoints = jointsOf(scene);
  } catch {
    // (said where the joints are checked)
  }
  const sets = (id) =>
    sceneJoints
      ? sceneJoints.order.filter((joint) => settersOf(sceneJoints, joint).has(id)).map((joint) => joint.id)
      : [];
  motions.forEach((motion, i) => {
    if (!motion || typeof motion !== 'object') return;
    if (motion.then === 'start' && motion.loop)
      out.push({ path: `motions[${i}].then`, message: "a loop plays on: then: 'start' is for a motion played once" });
    if (motion.group == null) return;
    const others = motions.filter((other) => other && other !== motion && other.group === motion.group);
    if (!others.length)
      out.push({
        path: `motions[${i}].group`,
        message: `${say(motion.group)} has one motion: a group is of alternatives`,
      });
    const mine = sets(motion.id);
    for (const other of others) {
      const shared = sets(other.id).find((joint) => mine.includes(joint));
      if (shared && motions.indexOf(other) > i)
        out.push({
          path: `motions[${i}].group`,
          message: `${say(motion.id)} and ${say(other.id)} both set the joint ${say(shared)}: a group's motions set joints of their own`,
        });
    }
  });
}

// guided steps: one id each; what they name exists (parts and groups, motions within their range; a part labelled has
// a label); a cut only where
// the scene offers one; a part chosen or labelled that the same step does not hide; home, the figure's first view, not
// given parts to frame as well (it has its own target)
function steps(scene, out, names, parts) {
  const motions = new Map(
      [...(Array.isArray(scene.motions) ? scene.motions : []), ...sequenceMotions(scene)]
        .filter((motion) => motion)
        .map((motion) => [motion.id, motion]),
    ),
    held = heldBy(scene),
    seen = new Set(),
    list = (value) => (Array.isArray(value) ? value : []);
  (Array.isArray(scene.steps) ? scene.steps : []).forEach((step, i) => {
    if (!step || typeof step !== 'object') return;
    const bad = (field, message) => out.push({ path: `steps[${i}].${field}`, message });
    if (step.id != null) {
      if (seen.has(step.id)) bad('id', `${say(step.id)} is used by two steps`);
      seen.add(step.id);
    }
    const hidden = list(step.hide),
      hides = (name) => {
        const part = parts.find((each) => each.id === name);
        return hidden.includes(name) || (part && hidden.includes(part.group));
      };
    for (const field of ['focus', 'hide', 'labels'])
      for (const name of list(step[field]))
        if (!names.has(name)) bad(field, `names ${say(name)}, which is no part or group`);
        else if (field !== 'hide' && hides(name)) bad(field, `names ${say(name)}, which this step hides`);
        else if (field === 'labels' && parts.some((part) => part.id === name && (part.label === false || !part.name)))
          bad(field, `names ${say(name)}, which has no label (no name, or label: false)`);
    if (step.select != null && typeof step.select === 'string') {
      if (!parts.some((part) => part.id === step.select)) bad('select', `${say(step.select)} is no part`);
      else if (hides(step.select)) bad('select', `${say(step.select)} is hidden by this step`);
    }
    if (step.view === 'home' && list(step.focus).length)
      bad('focus', 'frames parts, but the view is home (the first view, with its own target): give angles instead');
    if (step.cut && scene.section === false) bad('cut', 'cuts, but the scene offers no cut (section: false)');
    const valued = step.motion && typeof step.motion === 'object' ? step.motion : {};
    for (const [id, value] of Object.entries(valued)) {
      const motion = motions.get(id),
        [start, end] = (motion && Array.isArray(motion.range) && motion.range) || [];
      if (!motion) bad(`motion.${id}`, `${say(id)} is no motion`);
      else if (!motion.loop && typeof value === 'number' && (value < start || value > end))
        bad(`motion.${id}`, `${value} is outside its range [${start}, ${end}]`);
    }
    for (const id of list(step.play)) if (!motions.has(id)) bad('play', `${say(id)} is no motion`);
    // (motions of one group are alternatives: a step plays one of them)
    const playedGroups = list(step.play)
      .map((id) => motions.get(id)?.group)
      .filter(Boolean);
    const twice = playedGroups.find((group, k) => playedGroups.indexOf(group) !== k);
    if (twice) bad('play', `plays two motions of the group ${say(twice)}: they play one at a time`);
    // (a sequence away from its start: the step's own value for it, or it plays it)
    for (const motion of motions.values()) {
      if (!motion.sequence) continue;
      const away = list(step.play).includes(motion.id) || (motion.id in valued && valued[motion.id] !== motion.value);
      if (!away) continue;
      if (step.explode > 0)
        bad('explode', `takes the model apart while ${say(motion.id)} is away from its start: one way apart at a time`);
      for (const id of list(step.play))
        if (held.get(motion.id)?.has(id))
          bad('play', `plays ${say(id)}, which ${say(motion.id)} holds at its start while it is away from it`);
    }
    const dimensionIds = new Set(list(scene.dimensions).map((dimension) => dimension && dimension.id));
    for (const id of list(step.dimensions))
      if (!dimensionIds.has(id)) bad('dimensions', `${say(id)} is no dimension (give it an id)`);
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
