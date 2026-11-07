// Writes docs/scene-format.md from schema/scene.schema.json, so the reference says what the validator checks.
//   node docs/scene-format.mjs   (npm run docs)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const schema = JSON.parse(fs.readFileSync(path.join(HERE, '../schema/scene.schema.json'), 'utf8'));
const resolve = (s) => (s && s.$ref ? { ...schema.$defs[s.$ref.split('/').pop()], ...s } : s || {});
function type(s) {
  s = resolve(s);
  if (s.enum) return s.enum.map((v) => `\`${JSON.stringify(v)}\``).join(' \\| ');
  if ('const' in s) return `\`${JSON.stringify(s.const)}\``;
  if (s.anyOf && !s.type) return s.anyOf.map(type).join(' or ');
  if (s.type === 'array') {
    if (s.prefixItems) return `[${s.prefixItems.map(type).join(', ')}]`;
    return `list of ${s.items ? type(s.items) : 'values'}`;
  }
  if (s.type === 'object' && s.additionalProperties) return `map of name → ${type(s.additionalProperties)}`;
  let t = s.type || 'any';
  if (s.exclusiveMinimum != null) t += ` > ${s.exclusiveMinimum}`;
  if (s.minimum != null) t += ` ≥ ${s.minimum}`;
  if (s.maximum != null) t += ` ≤ ${s.maximum}`;
  return t;
}
const vecName = (s) => (s.$ref ? { vec3: '[x, y, z]', color: 'colour "#rrggbb"' }[s.$ref.split('/').pop()] : null);
function table(obj, required = []) {
  const rows = Object.entries(obj.properties || {}).map(([k, s]) => {
    const r = resolve(s),
      says = s.description || r.description || r['x-message'] || '';
    return `| \`${k}\`${required.includes(k) ? ' (required)' : ''} | ${vecName(s) || type(s)} | ${says.replace(/\|/g, '\\|')} |`;
  });
  return ['| Field | Type | Meaning |', '|---|---|---|', ...rows].join('\n');
}
const d = schema.$defs,
  cap = (s) => s.charAt(0).toUpperCase() + s.slice(1),
  low = (s) => s.charAt(0).toLowerCase() + s.slice(1);
const out = `# Scene format

A scene is plain data (JSON, or anything that becomes it). This page is generated from
[\`schema/scene.schema.json\`](../schema/scene.schema.json) by \`npm run docs\`; the validator (\`lk3d/validate\`) checks
exactly these rules, plus what they name: unique part, motion and joint ids; handles, motions and joints that move
parts that exist; shapes that name a listed model; liquids and gases in vessels that exist; joints that read joints
and motions that exist, without a loop.
A shape, a motion, a joint, a vessel, a liquid and a gas take only the fields listed for them (a misspelt one is an error). A scene, its view and a part may carry fields not listed here, which lk3d ignores: a page may keep its own data in a scene.

## Scene

${schema.description}

${table(schema, schema.required)}

## Part

${table(d.part, d.part.required)}

${d.part.dependentSchemas.refract['x-message']}.

## Shape

Exactly one kind per shape (see [shapes](shapes.md) for each kind's parameters and a picture), plus placement:

${table({ properties: Object.fromEntries(Object.entries(d.shape.properties).filter(([k]) => !d.shape.oneOf.some((o) => o.required[0] === k))) })}

Kinds: ${d.shape.oneOf.map((o) => `\`${o.required[0]}\``).join(', ')}.

## Handle

${d.handle.description} ${d.handle['x-message']}.

${table(d.handle)}

## Model

${table(d.model)}

## View

${schema.properties.view.description}

${table(schema.properties.view)}

## Motion

${schema.properties.motions.description} See [motions](handles-and-lines.md#motions-parts-that-move-together).

${table(d.motion, d.motion.required)}

Each of \`tracks\`: ${low(d.motion.properties.tracks.items.description)} ${cap(d.motion.properties.tracks.items['x-message'])}.

${table(d.motion.properties.tracks.items, d.motion.properties.tracks.items.required)}

## Joint

${schema.properties.joints.description} ${cap(d.joint['x-message'])}. See
[joints](handles-and-lines.md#joints-parts-posed-by-how-they-are-joined).

${table(d.joint, d.joint.required)}

\`follow\` (and \`drive\` as an object, with \`motion\` in place of \`joint\`):

${table(d.joint.properties.follow, d.joint.properties.follow.required)}

## Vessel

${schema.properties.vessels.description} See [liquids and gases](fluids.md).

${table(d.vessel, d.vessel.required)}

The \`outlet\`:

${table(d.vessel.properties.outlet, d.vessel.properties.outlet.required)}

## Liquid

${schema.properties.liquids.description}

${table(d.liquid, d.liquid.required)}

## Gas

${schema.properties.gases.description}

${table(d.gas, d.gas.required)}

## Validating

\`\`\`js
import { validate } from 'lk3d/validate';
const problems = validate(scene);   // [{ path: 'parts[2].handle', message: 'a handle is exactly one of …' }]
\`\`\`

From a shell: \`node node_modules/lk3d/src/validate.js < scene.json\` prints one problem per line and exits with 1 if
there are any. Editors that understand JSON Schema complete and check scenes as you type with
\`"$schema": "https://raw.githubusercontent.com/xoai/lk3d/main/schema/scene.schema.json"\`.

A scene stays small enough to draw: each count has a bound (\`seg\` 512, \`repeat\` 1000, \`scatter.n\` 10000, …), and
counts that multiply past 2 million triangles in a part (10 million in all; 1 million where memory is small, see
[\`maxTriangles\`](api.md#mountel-scene-options--figure)) are refused before anything is built. The engine itself also
refuses lists of more than 100 000 items, profiles and outlines (\`lathe\`, \`extrude.outline\`, a vessel's \`inside\`,
terrain's \`layers\`) of more than 1000 points, and anything nested more than 32 deep.

## Versions

A scene may say which version of this format it is written in: \`"lk3d": 1\`. The validator refuses a version it does
not know, and a figure warns once when its scene is newer than the engine. When a later version changes the format,
the engine keeps reading the versions before it, and the changelog says how to move a scene forward.
`;
fs.writeFileSync(path.join(HERE, 'scene-format.md'), out);
console.log('docs/scene-format.md');
