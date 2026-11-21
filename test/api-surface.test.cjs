// The public surface lk3d offers a page, recorded in test/api-surface.json: the keys of LK3D, a figure's methods and
// getters, <lk3d-figure>'s attributes and events, and the scene format's keys (top level, part, step). A change to any
// of them fails here until api-surface.json is updated in the same commit, so every change to the surface is seen in
// review. To record a change you mean:   API_SURFACE_WRITE=1 node --test test/api-surface.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const FILE = path.join(__dirname, 'api-surface.json');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

// the keys of the figure's API: the object literal makeApi builds (src/figure/api.js), one key per entry at its first
// level (a method, a getter or a value)
function figureKeys(source) {
  const start = source.indexOf('const api = (c.api_ = {');
  assert.ok(start >= 0, 'src/figure/api.js builds the API as one object literal');
  const body = source.slice(start, source.indexOf('\n  });', start));
  const keys = new Set();
  for (const [, k] of body.matchAll(/^ {4}(?:get |async )?([A-Za-z]\w*)\s*(?:\(|:|,)/gm)) keys.add(k);
  return [...keys].sort();
}
// <lk3d-figure>: the attributes it watches (LIVE and MOUNTED) and the events it raises (say('…') → lk3d-…)
function elementSurface(source) {
  const list = (name) =>
    [...(source.match(new RegExp(`${name} = \\[([^\\]]*)\\]`))?.[1] ?? '').matchAll(/'([\w-]+)'/g)].map((m) => m[1]);
  return {
    attributes: [...list('LIVE'), ...list('MOUNTED')].sort(),
    events: [...new Set([...source.matchAll(/say\('([\w-]+)'/g)].map((m) => 'lk3d-' + m[1]))].sort(),
  };
}
async function surface() {
  const LK3D = (await import('../src/index.js')).default;
  const schema = JSON.parse(read('schema/scene.schema.json'));
  return {
    LK3D: Object.keys(LK3D).sort(),
    figure: figureKeys(read('src/figure/api.js')),
    element: elementSurface(read('src/element.js')),
    scene: {
      top: Object.keys(schema.properties).sort(),
      part: Object.keys(schema.$defs.part.properties).sort(),
      step: Object.keys(schema.$defs.step.properties).sort(),
    },
  };
}
const diff = (was, now, at = '') =>
  typeof was !== 'object' || Array.isArray(was)
    ? [
        ...now.filter((k) => !was.includes(k)).map((k) => `+ ${at}${k}`),
        ...was.filter((k) => !now.includes(k)).map((k) => `- ${at}${k}`),
      ]
    : [...new Set([...Object.keys(was), ...Object.keys(now)])].flatMap((k) =>
        diff(was[k] ?? [], now[k] ?? [], `${at}${k}.`),
      );

test('the public surface is the one recorded in test/api-surface.json', async () => {
  const now = await surface();
  if (process.env.API_SURFACE_WRITE) fs.writeFileSync(FILE, JSON.stringify(now, null, 2) + '\n');
  const was = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  const changes = diff(was, now);
  assert.deepEqual(
    changes,
    [],
    `the public surface changed:\n${changes.join('\n')}\nIf you mean it, record it: API_SURFACE_WRITE=1 node --test test/api-surface.test.cjs`,
  );
});

test('a method added to the figure, an attribute or a scene key would be caught', async () => {
  const api = read('src/figure/api.js').replace(
    '    stats() {',
    '    planted() {\n      return 1;\n    },\n    stats() {',
  );
  assert.ok(figureKeys(api).includes('planted'));
  assert.ok(!figureKeys(read('src/figure/api.js')).includes('planted'));
  const element = read('src/element.js').replace("const LIVE = ['look',", "const LIVE = ['planted', 'look',");
  assert.ok(elementSurface(element).attributes.includes('planted'));
  const was = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  assert.deepEqual(diff(was, { ...was, figure: [...was.figure, 'planted'].sort() }), ['+ figure.planted']);
});
