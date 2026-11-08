// The scene's types (scene.d.ts) are generated from the schema: they must be what the schema makes now, and the
// generator must refuse what it cannot say rather than leave it out.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const schema = () => JSON.parse(fs.readFileSync(path.join(ROOT, 'schema/scene.schema.json'), 'utf8'));
const gen = () => import('../scripts/types.mjs');

test('scene.d.ts is what schema/scene.schema.json makes (npm run types)', async () => {
  const { generate } = await gen();
  const now = fs.readFileSync(path.join(ROOT, 'scene.d.ts'), 'utf8');
  assert.ok(now === (await generate()), 'scene.d.ts is out of date with the schema: run npm run types');
});

test('a change to the schema changes the types', async () => {
  const { generate } = await gen();
  const s = schema();
  s.$defs.part.properties.material.enum.push('velvet');
  s.$defs.shape.properties.cylinder.properties.r.description = 'A planted description.';
  const text = await generate(s);
  assert.match(text, /\| 'velvet';/);
  assert.match(text, /A planted description\./);
});

test('every $def and every shape kind has its type', async () => {
  const { generate } = await gen();
  const s = schema(),
    text = await generate(s);
  for (const name of Object.keys(s.$defs)) {
    const ts = name.charAt(0).toUpperCase() + name.slice(1);
    assert.match(text, new RegExp(`export (type|interface) ${ts}\\b`), ts);
  }
  for (const o of s.$defs.shape.oneOf) assert.match(text, new RegExp(`Form<ShapeFields, '${o.required[0]}'`));
});

test('the generator refuses what it cannot say', async () => {
  const { generate } = await gen();
  const unknown = schema();
  unknown.$defs.gas.properties.T.multipleOf = 0.5;
  await assert.rejects(generate(unknown), /does not know the keyword "multipleOf"/);
  const unnamed = schema();
  unnamed.properties.view.anyOf = [{ required: ['yaw'] }, { required: ['dist'] }];
  await assert.rejects(generate(unnamed), /give this object a name/);
  const ambiguous = schema();
  ambiguous.$defs.joint.oneOf = [{ required: ['turn', 'slide'] }, { required: ['slide'] }];
  await assert.rejects(generate(ambiguous), /do not tell them apart/);
});
