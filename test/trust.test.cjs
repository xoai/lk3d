// Scenes and models from people you don't trust: each one either builds or is refused with a plain sentence (an Error,
// not a TypeError, a RangeError or a stack overflow, saying "lk3d…" and where), quickly, without taking the memory of
// the page. Hostile inputs written by hand (loops, a count of two billion, offsets past the file, a branch a million
// deep, a profile of 5000 points, an image claiming 100000 pixels a side), then a seeded fuzz of every reference scene
// and model: wrong types, huge numbers, NaN, negative counts, cycles, truncated buffers, out-of-range indices.
//   npm test          (SEED=n to fuzz with another seed; FUZZ=n for n times as many cases)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const LK3D = require('../src/index.js');
const { Geo, buildFitting } = require('../src/geometry.js');
const { load, parseGLB, dims } = require('../src/gltf.js');
const { validate } = require('../src/validate.js');

const HERE = path.join(__dirname, '..');
const b64 = (f) => fs.readFileSync(path.join(HERE, f)).toString('base64');
const CARD = b64('test/visual/assets/card.glb'),
  BALL = b64('test/visual/assets/ball.glb');
// a lesson's own model, a scanned skull, where the repository has it (lessonkit's; lk3d's examples carry the same file)
const SKULL = ['../../lessons/nguoi-toi-co/art/knm-er-3733.glb', 'examples/assets/knm-er-3733.glb']
  .map((f) => path.join(HERE, f))
  .find((f) => fs.existsSync(f));

// a plain refusal: an Error of lk3d's own (not a TypeError, RangeError…) with a sentence after its prefix
function plain(e, prefix = /^lk3d( model)?: \S/) {
  assert.equal(e.constructor, Error, `not a plain Error: ${e.constructor.name}: ${e.message}`);
  assert.match(e.message, prefix);
  return true;
}
const refused = (f, re) => {
  const t = Date.now();
  assert.throws(
    f,
    (e) => plain(e) && (!re || re.test(e.message) || assert.fail(`"${e.message}" does not match ${re}`)),
  );
  assert.ok(Date.now() - t < 2000, `refused in ${Date.now() - t} ms`);
};
const one = (shape, more = {}) => ({ parts: [{ id: 'a', shapes: [shape] }], ...more });

// a .glb from its JSON and binary chunks (bin: bytes), as base64
function glb(json, bin = Buffer.alloc(0)) {
  const pad = (b, c) => Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4, c)]);
  const J = pad(Buffer.from(JSON.stringify(json)), 0x20),
    B = pad(Buffer.from(bin), 0),
    head = Buffer.alloc(12),
    ch = (b, t) => {
      const h = Buffer.alloc(8);
      h.writeUInt32LE(b.length, 0);
      h.writeUInt32LE(t, 4);
      return Buffer.concat([h, b]);
    };
  head.writeUInt32LE(0x46546c67, 0);
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(12 + 8 + J.length + 8 + B.length, 8);
  return Buffer.concat([head, ch(J, 0x4e4f534a), ch(B, 0x004e4942)]).toString('base64');
}
// one triangle: three float positions, then three uint16 indices
const TRI = Buffer.concat([
  Buffer.from(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]).buffer),
  Buffer.from(new Uint16Array([0, 1, 2, 0]).buffer),
]);
const triangle = (change = (j) => j) =>
  change({
    asset: { version: '2.0' },
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' },
      { bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR' },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 36 },
      { buffer: 0, byteOffset: 36, byteLength: 6 },
    ],
    buffers: [{ byteLength: 44 }],
  });
const readModel = (json, bin = TRI) => load(Geo, glb(json, bin));

test('a scene in a form the engine cannot build is refused, naming the place', () => {
  const loop = one({ box: [1, 1, 1] });
  loop.parts[0].shapes[0].self = loop.parts[0];
  refused(() => LK3D.build(loop), /^lk3d: parts\[0\]\.shapes\[0\]\.self: holds itself/);
  let deep = [1, 1, 1];
  for (let k = 0; k < 100; k++) deep = [deep];
  refused(() => LK3D.build(one({ box: deep })), /nested more than 32 deep/);
  refused(() => LK3D.build(one({ sphere: NaN })), /^lk3d: parts\[0\]\.shapes\[0\]\.sphere: is NaN/);
  refused(() => LK3D.build(one({ sphere: 1, at: [0, Infinity, 0] })), /at\[1\]: is Infinity/);
  refused(() => LK3D.build(one({ sphere: () => 1 })), /is a function, not data/);
  refused(() => LK3D.build(null), /^lk3d: the scene: should be an object/);
  refused(() => LK3D.build({ parts: 'p' }), /^lk3d: parts: should be a list of parts/);
  refused(() => LK3D.build({ parts: [, { id: 'b', shapes: [] }] }), /^lk3d: parts: should be a list of parts/); // eslint-disable-line no-sparse-arrays
  refused(
    () => LK3D.build({ parts: [{ id: 'a', shapes: { box: [1, 1, 1] } }] }),
    /parts\[0\]\.shapes: should be a list/,
  );
  // shapes of the wrong form: said at the shape, not as "object is not iterable" from deep inside
  for (const s of [
    { torus: 5 },
    { box: { x: 1 } },
    { lathe: 7 },
    { tube: 'a path' },
    { scatter: { n: 3 } },
    { molecule: { atoms: [{ el: 'C', at: [0, 0, 0] }], bonds: [[0, 7]] } },
    { terrain: { size: 2 } },
    { model: 'nowhere' },
  ])
    refused(() => LK3D.build(one(s)), /^lk3d: parts\[0\]\.shapes\[0\]: /);
  refused(
    () => LK3D.build({ parts: [{ id: 'g', shapes: [] }], gases: [{ part: 'g', in: 'none' }] }),
    /^lk3d: vessels, liquids and gases: /,
  );
  // what the full validator says too: the guard's limits are part of `lk3d check`
  const lathe = one({ lathe: Array.from({ length: 5000 }, (_, k) => [k / 5000, 0.5]) });
  refused(() => LK3D.build(lathe), /^lk3d: parts\[0\]\.shapes\[0\]\.lathe: has 5000 items; at most 1000$/);
  assert.ok(validate(lathe).some((e) => e.path === 'parts[0].shapes[0].lathe' && /at most 1000/.test(e.message)));
  assert.deepEqual(
    validate(loop).map((e) => e.path),
    ['parts[0].shapes[0].self'],
  ); // (said, not a stack overflow)
});

test('what a scene asks to be built is counted: refused at once, or as it reaches the limit, never after', () => {
  // asked in counts the estimate reads, or that multiply past reason: refused before building
  refused(() => LK3D.build(one({ tree: { levels: 1e6, branches: 1 } })), /would have at least/); // (no stack overflow)
  refused(() => LK3D.build(one({ shell: { r: 1, to: 1e12 } })), /would have at least/);
  refused(() => LK3D.build(one({ tube: Array.from({ length: 99999 }, (_, k) => [k, 0, 0]) }), 1, 1e5), /at least/);
  refused(
    () =>
      LK3D.build(
        one({
          molecule: {
            atoms: [
              { el: 'C', at: [0, 0, 0] },
              { el: 'O', at: [1, 0, 0] },
            ],
            bonds: [[0, 1, 1e7]],
          },
        }),
      ),
    /at least/,
  );
  // a detail multiplied in scatters inside scatters stops at 16: no path of a billion points
  let s = { orbit: { a: 1 } };
  for (let k = 0; k < 6; k++) s = { scatter: { shape: s, n: 1, detail: 8 }, detail: 8 };
  assert.ok(LK3D.build(one(s), 1).parts[0].tris < 1e6);
  // not foreseen by the estimate: stopped as the limit is reached, with the same sentence
  const t = Date.now();
  refused(
    () =>
      LK3D.build(
        one({
          lathe: [
            [0, 1],
            [1, 1],
          ],
          to: 3.6e9,
          seg: 3,
        }),
        1,
        1e5,
      ),
    /the limit is 100000/,
  );
  refused(
    () =>
      LK3D.build(
        {
          parts: Array.from({ length: 40 }, (_, k) => ({
            id: 'p' + k,
            shapes: [{ sphere: 1, seg: 256 }],
            scale: [1, 2, 1],
          })),
        },
        1,
        1e6,
      ),
    /the limit is 1 million/,
  );
  assert.ok(Date.now() - t < 3000);
  // a model counted before its values are read (a scene's limit, not the file's say-so)
  refused(
    () => LK3D.build({ models: { m: { data: BALL } }, parts: [{ id: 'm', shapes: [{ model: 'm' }] }] }, 1, 100),
    /the limit is 100$/,
  );
});

test('a device with little memory gets a lower limit: coarser where that fits, else a plain refusal', () => {
  // 1.4 million triangles at full detail: drawn at half on a phone's limit, refused where even a quarter is too many
  const heavy = {
    parts: Array.from({ length: 6 }, (_, k) => ({ id: 'p' + k, at: [k, 0, 0], shapes: [{ sphere: 0.4, seg: 512 }] })),
  };
  assert.ok(LK3D.build(heavy, 1).parts.reduce((n, p) => n + p.tris, 0) > 1e6);
  const S = buildFitting(heavy, 1, 1e6);
  assert.equal(S.q, 0.5);
  assert.ok(S.parts.reduce((n, p) => n + p.tris, 0) <= 1e6);
  assert.throws(
    () => buildFitting(heavy, 1, 2e4),
    (e) => plain(e) && /the limit is 20000/.test(e.message),
  );
  // every reference scene, and every example's, fits a phone's limit at a phone's detail without being made coarser
  for (const d of ['test/visual/scenes', 'examples/scenes'])
    for (const f of fs.readdirSync(path.join(HERE, d))) {
      const scene = JSON.parse(fs.readFileSync(path.join(HERE, d, f), 'utf8'));
      for (const m of Object.values(scene.models || {})) if (m.file) m.data = CARD;
      assert.equal(buildFitting(scene, 0.6, 1e6).q, 0.6, `${d}/${f}`);
    }
});

test('a hostile .glb is refused with a sentence, at once, before any large allocation', () => {
  assert.ok(readModel(triangle()).count === 3, 'the triangle itself is read');
  const cases = {
    'a node its own child': (j) => ((j.nodes[0].children = [0]), j),
    'nodes in a loop': (j) => ((j.nodes = [{ children: [1] }, { mesh: 0, children: [0] }]), j),
    'a node with two parents (a diamond, a thousand times over)': (j) => {
      j.nodes = Array.from({ length: 40 }, (_, k) => ({ children: k < 39 ? [k + 1, k + 1] : [], mesh: 0 }));
      return j;
    },
    'a count of two billion': (j) => ((j.accessors[0].count = 2 ** 31), j),
    'a negative count': (j) => ((j.accessors[0].count = -3), j),
    'an offset past the data': (j) => ((j.bufferViews[0].byteOffset = 2 ** 31), j),
    'a negative offset': (j) => ((j.accessors[0].byteOffset = -12), j),
    'an offset that is no number': (j) => ((j.bufferViews[0].byteOffset = { at: 4 }), j),
    'a stride of a billion': (j) => ((j.bufferViews[0].byteStride = 1e9), j),
    'a view longer than the file': (j) => ((j.bufferViews[1].byteLength = 1e6), j),
    'a missing view': (j) => ((j.accessors[0].bufferView = 7), j),
    'indices not in threes': (j) => ((j.accessors[1].count = 2), j),
    'an unknown component type': (j) => ((j.accessors[0].componentType = 9999), j),
    'a sparse accessor': (j) => ((j.accessors[0].sparse = { count: 1 }), j),
    'a buffer in another file': (j) => ((j.buffers[0].uri = 'https://example.com/x.bin'), j),
    'a scene that is not there': (j) => ((j.scene = 5), j),
    'nodes that are not a list': (j) => ((j.nodes = { 0: { mesh: 0 } }), (j.scenes = [{ nodes: [0] }]), j),
    'a rotation of one number': (j) => ((j.nodes[0].rotation = 1), j),
    'a matrix of text': (j) => ((j.nodes[0].matrix = 'identity'), j),
    'a texture transform of one number': (j) => {
      j.meshes[0].primitives[0].attributes.TEXCOORD_0 = 0;
      j.meshes[0].primitives[0].material = 0;
      j.materials = [{ normalTexture: { index: 0, extensions: { KHR_texture_transform: { offset: 1 } } } }];
      return j;
    },
  };
  for (const [name, change] of Object.entries(cases)) {
    const t = Date.now();
    assert.throws(
      () => readModel(triangle((j) => change(structuredClone(j)))),
      (e) => plain(e, /^lk3d model: \S/),
      name,
    );
    assert.ok(Date.now() - t < 200, `${name}: ${Date.now() - t} ms`);
  }
  // indices out of range (a byte the file says is index 9 of 3 vertices)
  const far = Buffer.from(TRI);
  far.writeUInt16LE(9, 38);
  assert.throws(() => readModel(triangle(), far), /its indices are past its 3 vertices/);
  // positions that are not finite numbers
  const nan = Buffer.from(TRI);
  nan.writeFloatLE(NaN, 4);
  assert.throws(() => readModel(triangle(), nan), /not finite/);
  // a chain of nodes 200 000 deep: read without recursion
  const chain = triangle((j) => ({
    ...j,
    nodes: Array.from({ length: 2e5 }, (_, k) => (k < 2e5 - 1 ? { children: [k + 1] } : { mesh: 0 })),
  }));
  assert.equal(readModel(chain).count, 3);
  // the file itself: cut short, a chunk longer than the file, no JSON, garbage JSON, not base64, not text
  const file = Buffer.from(glb(triangle(), TRI), 'base64');
  const header = (at, v) => {
    const b = Buffer.from(file);
    b.writeUInt32LE(v, at);
    return b.toString('base64');
  };
  for (const data of [
    file.subarray(0, 40).toString('base64'),
    header(8, file.length + 1000),
    header(12, 2 ** 32 - 1),
    header(16, 0x12345678),
    glb({}).replace(/^.{40}/, (s) => s), // (JSON of no glTF: it has no nodes; read as empty)
    Buffer.concat([file.subarray(0, 20), Buffer.from('{not json'), file.subarray(29)]).toString('base64'),
    '%%%% not base64 %%%%',
  ])
    try {
      load(Geo, data);
    } catch (e) {
      plain(e, /^lk3d model: \S/);
    }
  assert.throws(() => load(Geo, '%%%% not base64 %%%%'), /lk3d model: its data should be the .glb as base64/);
  // (a scene's model data that is not text: said at its shape)
  assert.throws(
    () => LK3D.build({ models: { m: { data: 42 } }, parts: [{ id: 'p', shapes: [{ model: 'm' }] }] }),
    /^Error: lk3d: parts\[0\]\.shapes\[0\]: model: its data should be the .glb as base64$/,
  );
});

test('embedded images: PNG, JPEG or WebP only, and no bigger than the page can decode', () => {
  // the sizes the image headers say (only the first bytes are read)
  const png = (w, h) => {
    const b = Buffer.alloc(33);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b);
    b.write('IHDR', 12);
    b.writeUInt32BE(w, 16);
    b.writeUInt32BE(h, 20);
    return b;
  };
  const jpeg = (w, h) =>
    Buffer.from([
      0xff,
      0xd8,
      0xff,
      0xe0,
      0,
      4,
      0,
      0,
      0xff,
      0xc0,
      0,
      17,
      8,
      h >> 8,
      h & 255,
      w >> 8,
      w & 255,
      ...Array(20).fill(0),
    ]);
  const webp = (w, h) => {
    const b = Buffer.alloc(40);
    b.write('RIFF', 0);
    b.write('WEBPVP8X', 8);
    b.writeUIntLE(w - 1, 24, 3);
    b.writeUIntLE(h - 1, 27, 3);
    return b;
  };
  assert.deepEqual(dims(png(640, 480)), [640, 480]);
  assert.deepEqual(dims(jpeg(1024, 768)), [1024, 768]);
  assert.deepEqual(dims(webp(2048, 1024)), [2048, 1024]);
  assert.equal(dims(Buffer.from('\x89PNG stand-in')), null);
  // a textured triangle whose image is given
  const textured = (img, mimeType = 'image/png') => {
    const bin = Buffer.concat([TRI, Buffer.from(new Float32Array([0, 0, 1, 0, 0, 1]).buffer), img]);
    return readModel(
      triangle((j) => {
        j.meshes[0].primitives[0].attributes.TEXCOORD_0 = 2;
        j.meshes[0].primitives[0].material = 0;
        j.accessors.push({ bufferView: 2, componentType: 5126, count: 3, type: 'VEC2' });
        j.bufferViews.push(
          { buffer: 0, byteOffset: 44, byteLength: 24 },
          { buffer: 0, byteOffset: 68, byteLength: img.length },
        );
        j.materials = [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }];
        j.textures = [{ source: 0 }];
        j.images = [{ bufferView: 3, mimeType }];
        return j;
      }),
      bin,
    );
  };
  assert.equal(textured(png(1024, 1024)).tex.base.mime, 'image/png');
  for (const [img, mime] of [
    [png(100000, 100000), 'image/png'],
    [jpeg(9000, 100), 'image/jpeg'],
    [webp(16000, 16000), 'image/webp'],
    [png(64, 64), 'image/svg+xml'],
    [png(64, 64), 'text/html'],
  ])
    assert.throws(
      () => textured(img, mime),
      (e) => plain(e, /^lk3d model: its images are PNG, JPEG or WebP/),
    );
  // an image elsewhere (a uri: a data: URI or a web address): refused, never fetched
  assert.throws(
    () =>
      readModel(
        triangle((j) => {
          j.meshes[0].primitives[0].attributes.TEXCOORD_0 = 0;
          j.meshes[0].primitives[0].material = 0;
          j.materials = [{ normalTexture: { index: 0 } }];
          j.textures = [{ source: 0 }];
          j.images = [{ uri: 'https://example.com/skin.png' }];
          return j;
        }),
      ),
    /must be inside the .glb/,
  );
});

// ---- the fuzz: every reference scene and model, changed at random (seeded, so a failure can be run again)
const SEED = +(process.env.SEED || 20261107),
  TIMES = +(process.env.FUZZ || 1);
function random(seed) {
  let s = seed >>> 0;
  const R = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
  return { R, pick: (a) => a[Math.floor(R() * a.length)] };
}
const WILD = [
  null,
  true,
  'x',
  '',
  0,
  -1,
  0.5,
  3,
  1e9,
  -1e9,
  1e308,
  NaN,
  Infinity,
  -Infinity,
  [],
  {},
  [1],
  [1, 2],
  [1, 2, 3],
  [[1, 2]],
  { n: 1e9 },
  '1e9',
  2 ** 31,
  2 ** 32 + 1,
  -(2 ** 31),
];
const nodes = (v, out = [], depth = 0) => {
  if (v && typeof v === 'object' && depth < 16) {
    out.push(v);
    for (const k of Object.keys(v)) nodes(v[k], out, depth + 1);
  }
  return out;
};
// one change somewhere in a JSON-like value: a wild value, a key gone, a loop, a number scaled past reason, a list
// repeated, cut or nested deeper
function mutate(v, { R, pick }, loops = true) {
  const all = nodes(v),
    o = pick(all),
    keys = Object.keys(o);
  if (!keys.length) return;
  const k = pick(keys),
    r = R();
  if (r < 0.45) o[k] = structuredClone(pick(WILD));
  else if (r < 0.55) delete o[k];
  else if (r < 0.6 && loops)
    o[k] = pick(all); // (a loop, or a value shared; a file's JSON cannot hold one)
  else if (r < 0.7 && typeof o[k] === 'number') o[k] = o[k] * pick([1e6, -1, 1e12, 0.5]) + pick([0, 1, -1]);
  else if (r < 0.78 && Array.isArray(o[k])) o[k] = o[k].concat(o[k], o[k], o[k]);
  else if (r < 0.84 && Array.isArray(o[k])) o[k].length = Math.floor(o[k].length * R());
  else if (r < 0.9) {
    let x = o[k];
    for (let d = 0; d < 40; d++) x = [x];
    o[k] = x;
  } else o[k] = pick(WILD);
}
const outcome = (f) => {
  const t = Date.now();
  try {
    f();
    return { ok: true, ms: Date.now() - t };
  } catch (e) {
    return { e, ms: Date.now() - t };
  }
};

test('fuzz: every reference scene, changed at random, builds or is refused plainly', () => {
  const rnd = random(SEED),
    scenes = [];
  for (const d of ['test/visual/scenes', 'examples/scenes'])
    for (const f of fs.readdirSync(path.join(HERE, d))) {
      const s = JSON.parse(fs.readFileSync(path.join(HERE, d, f), 'utf8'));
      for (const m of Object.values(s.models || {})) if (m.file) m.data = CARD;
      scenes.push([`${d}/${f}`, s]);
    }
  const kinds = new Map(),
    heap0 = process.memoryUsage().heapUsed;
  let built = 0,
    slowest = 0,
    heap = 0;
  const N = 500 * TIMES;
  for (let i = 0; i < N; i++) {
    const [name, s0] = rnd.pick(scenes),
      s = structuredClone(s0);
    for (let m = 1 + Math.floor(rnd.R() * 3); m--;) mutate(s, rnd);
    // (a phone's limit, at a quarter of the detail: the fuzz is about forms, not drawing)
    const r = outcome(() => LK3D.build(s, 0.25, 1e6));
    slowest = Math.max(slowest, r.ms);
    if (r.ok) built++;
    else {
      assert.equal(r.e.constructor, Error, `case ${i} (${name}): ${r.e.stack}`);
      assert.match(r.e.message, /^lk3d: \S/, `case ${i} (${name})`);
      const kind = /cannot be built/.test(r.e.message) ? 'said by JavaScript, at its place' : 'said by lk3d';
      kinds.set(kind, (kinds.get(kind) || 0) + 1);
    }
    if (i % 50 === 0) heap = Math.max(heap, process.memoryUsage().heapUsed - heap0);
  }
  test.diagnostic?.(`(${N} scenes: ${built} built; refused: ${[...kinds].map(([k, n]) => `${n} ${k}`).join(', ')})`);
  console.log(
    `# ${N} scenes: ${built} built; refused: ${[...kinds].map(([k, n]) => `${n} ${k}`).join(', ')}; slowest ${slowest} ms; heap +${(heap / 1e6) | 0} MB`,
  );
  assert.ok(built > N / 5 && built < N, 'the fuzz both builds and refuses');
  assert.ok(slowest < 3000, `no case holds the page: the slowest took ${slowest} ms`);
  assert.ok(heap < 1.5e9, `bounded memory: +${(heap / 1e6) | 0} MB`);
});

test('fuzz: every reference model, its JSON and its bytes changed at random, is read or refused plainly', () => {
  const rnd = random(SEED + 1),
    files = [CARD, BALL, ...(SKULL ? [fs.readFileSync(SKULL).toString('base64')] : [])].map((d) =>
      parseGLB(Buffer.from(d, 'base64')),
    );
  const raw = files.map(({ json, bin }) => Buffer.from(glb(json, bin), 'base64'));
  let read = 0,
    slowest = 0;
  const N = 800 * TIMES;
  for (let i = 0; i < N; i++) {
    const k = i % 10 === 9 && SKULL ? 2 : Math.floor(rnd.R() * 2), // (the large scan one time in ten)
      { json, bin } = files[k];
    let data;
    if (rnd.R() < 0.7) {
      const j = structuredClone(json);
      for (let m = 1 + Math.floor(rnd.R() * 3); m--;) mutate(j, rnd, false);
      data = glb(j, bin);
    } else {
      // the bytes: cut short, bytes changed, the header's or a chunk's length changed
      const b = Buffer.from(raw[k]),
        r = rnd.R();
      if (r < 0.3) data = b.subarray(0, Math.floor(rnd.R() * b.length)).toString('base64');
      else {
        if (r < 0.65) for (let n = 0; n < 1 + rnd.R() * 20; n++) b[Math.floor(rnd.R() * b.length)] = rnd.R() * 256;
        else
          b.writeUInt32LE(
            rnd.pick([0, 2 ** 32 - 1, b.length + 100, 7, 2 ** 31]),
            rnd.pick([8, 12, 20 + b.readUInt32LE(12)]),
          );
        data = b.toString('base64');
      }
    }
    const r = outcome(() => load(Geo, data));
    slowest = Math.max(slowest, r.ms);
    if (r.ok) read++;
    else plain(r.e, /^lk3d model: \S/);
  }
  console.log(`# ${N} models: ${read} read, the rest refused; slowest ${slowest} ms`);
  assert.ok(read > 0 && read < N);
  assert.ok(slowest < 1000, `the slowest took ${slowest} ms`);
});
