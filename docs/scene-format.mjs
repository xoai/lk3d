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
const d = schema.$defs;
const out = `# Scene format

A scene is plain data (JSON, or anything that becomes it). This page is generated from
[\`schema/scene.schema.json\`](../schema/scene.schema.json) by \`npm run docs\`; the validator (\`lk3d/validate\`) checks
exactly these rules, plus unique part ids, handles that move parts that exist, and shapes that name a listed model.
Fields not listed here are allowed and ignored: a page may keep its own data in a scene.

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

## Validating

\`\`\`js
import { validate } from 'lk3d/validate';
const problems = validate(scene);   // [{ path: 'parts[2].handle', message: 'a handle is exactly one of …' }]
\`\`\`

From a shell: \`node node_modules/lk3d/src/validate.js < scene.json\` prints one problem per line and exits with 1 if
there are any. Editors that understand JSON Schema complete and check scenes as you type with
\`"$schema": "https://unpkg.com/lk3d/schema/scene.schema.json"\`.

## Versions

A scene may say which version of this format it is written in: \`"lk3d": 1\`. The validator refuses a version it does
not know, and a figure warns once when its scene is newer than the engine. When a later version changes the format,
the engine keeps reading the versions before it, and the changelog says how to move a scene forward.
`;
fs.writeFileSync(path.join(HERE, 'scene-format.md'), out);
console.log('docs/scene-format.md');
