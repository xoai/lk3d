// The public surface lk3d offers a page, recorded in test/api-surface.json: the keys of LK3D, a figure's methods and
// getters, <lk3d-figure>'s attributes and events, the scene format's keys (top level, part, step), and what each
// module subpath exports (lk3d/validate, lk3d/lint, lk3d/measure…). A change to any
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
// each module subpath of package.json's exports (not '.', not the bundles): the names it exports
async function subpaths() {
  const exports = JSON.parse(read('package.json')).exports,
    out = {};
  for (const [key, entry] of Object.entries(exports))
    if (key !== '.' && typeof entry === 'object' && entry.default.startsWith('./src/'))
      out[key] = Object.keys(await import(path.join(ROOT, entry.default))).sort();
  return out;
}
async function surface() {
  const LK3D = (await import('../src/index.js')).default;
  const schema = JSON.parse(read('schema/scene.schema.json'));
  const keys = Object.keys(LK3D).sort(); // (before the subpaths: lk3d/export adds toGLB to LK3D when imported)
  return {
    subpaths: await subpaths(),
    LK3D: keys,
    figure: figureKeys(read('src/figure/api.js')),
    element: elementSurface(read('src/element.js')),
    scene: {
      top: Object.keys(schema.properties).sort(),
      part: Object.keys(schema.$defs.part.properties).sort(),
      step: Object.keys(schema.$defs.step.properties).sort(),
    },
  };
}
// (a list against a list, key by key otherwise; a section missing on one side is empty there)
const empty = (other) => (Array.isArray(other) ? [] : {});
const diff = (was, now, at = '') =>
  Array.isArray(was) || Array.isArray(now)
    ? [
        ...now.filter((k) => !was.includes(k)).map((k) => `+ ${at}${k}`),
        ...was.filter((k) => !now.includes(k)).map((k) => `- ${at}${k}`),
      ]
    : [...new Set([...Object.keys(was), ...Object.keys(now)])].flatMap((k) =>
        diff(was[k] ?? empty(now[k]), now[k] ?? empty(was[k]), `${at}${k}.`),
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
