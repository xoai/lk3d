// The 3D engine's geometry, checked without a browser: every shape is a closed solid whose faces point outwards
// (positive signed volume, normals agreeing with winding), volumes match the formulas, repeats and placement land
// where they should, and a bad scene is refused.          ./lk test
const test = require('node:test');
const assert = require('node:assert/strict');
const LK3D = require('../src/index.js');

const part = (shapes) => LK3D.build({ parts: [{ id: 'p', shapes }] }, 1).parts[0];
function volume(g) {
  let v = 0;
  for (let t = 0; t < g.i.length; t += 3) {
    const P = (k) => [g.p[3 * g.i[t + k]], g.p[3 * g.i[t + k] + 1], g.p[3 * g.i[t + k] + 2]],
      [a, b, c] = [P(0), P(1), P(2)];
    v +=
      (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) /
      6;
  }
  return v;
}
function windingAgrees(g) {
  for (let t = 0; t < g.i.length; t += 3) {
    const [a, b, c] = [g.i[t], g.i[t + 1], g.i[t + 2]],
      P = (k) => [g.p[3 * k], g.p[3 * k + 1], g.p[3 * k + 2]];
    const A = P(a),
      B = P(b),
      C = P(c),
      u = [B[0] - A[0], B[1] - A[1], B[2] - A[2]],
      w = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
    const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    const vn = [
      g.n[3 * a] + g.n[3 * b] + g.n[3 * c],
      g.n[3 * a + 1] + g.n[3 * b + 1] + g.n[3 * c + 1],
      g.n[3 * a + 2] + g.n[3 * b + 2] + g.n[3 * c + 2],
    ];
    if (Math.hypot(...n) > 1e-12 && n[0] * vn[0] + n[1] * vn[1] + n[2] * vn[2] < 0) return false;
  }
  return true;
}
const near = (a, b, rel, msg) => assert.ok(Math.abs(a - b) <= rel * Math.abs(b), `${msg}: ${a} vs ${b}`);

test('every kind of shape is a solid with outward faces', () => {
  const shapes = {
    box: [{ box: [1, 2, 3] }],
    cylinder: [{ cylinder: { r: 0.5, x0: -1, x1: 1 } }],
    tube: [{ cylinder: { r: 0.5, ri: 0.3, x0: -1, x1: 1 } }],
    sphere: [{ sphere: 0.7 }],
    torus: [{ torus: [1, 0.2] }],
    sector: [
      {
        lathe: [
          [-0.5, 0.3],
          [0.5, 0.3],
          [0.5, 0.4],
          [-0.5, 0.4],
        ],
        from: -30,
        to: 30,
      },
    ],
    'lathe drawn either way round': [
      {
        lathe: [
          [-0.5, 0.4],
          [0.5, 0.4],
          [0.5, 0.3],
          [-0.5, 0.3],
        ],
        closed: true,
      },
    ],
    'mirrored lathe': [
      {
        lathe: [
          [-0.6, 0.5],
          [-0.7, 0.3],
          [-0.7, 0.1],
          [-0.62, 0.1],
          [-0.6, 0.45],
        ],
        closed: true,
        mirror: true,
      },
    ],
    'round wire': [
      {
        tube: [
          [0, 0, 0],
          [1, 0.5, 0],
          [2, 0.5, 1],
        ],
        r: 0.05,
      },
    ],
    helix: [{ helix: { r: 0.3, turns: 5, wire: 0.03 } }],
    loop: [{ loop: { a: 1, b: 0.2, R: 0.5, wire: 0.03, turns: 2, gap: 0.07 } }],
  };
  for (const [name, s] of Object.entries(shapes)) {
    const g = part(s).g;
    assert.ok(windingAgrees(g), `${name}: triangles face the way their normals point`);
    assert.ok(volume(g) > 0, `${name}: positive volume (faces point outwards)`);
  }
});

test('volumes match the formulas (to within the faceting)', () => {
  near(volume(part([{ box: [1, 2, 3] }]).g), 6, 1e-9, 'box');
  near(volume(part([{ cylinder: { r: 0.5, x0: -1, x1: 1 } }]).g), Math.PI * 0.25 * 2, 0.01, 'cylinder');
  near(
    volume(part([{ cylinder: { r: 0.5, ri: 0.3, x0: -1, x1: 1 } }]).g),
    Math.PI * (0.25 - 0.09) * 2,
    0.01,
    'hollow cylinder',
  );
  near(volume(part([{ sphere: 0.7 }]).g), (4 / 3) * Math.PI * 0.343, 0.03, 'sphere');
  near(volume(part([{ torus: [1, 0.2] }]).g), 2 * Math.PI * Math.PI * 1 * 0.04, 0.05, 'torus');
  near(
    volume(
      part([
        {
          lathe: [
            [-0.5, 0.3],
            [0.5, 0.3],
            [0.5, 0.4],
            [-0.5, 0.4],
          ],
          from: 0,
          to: 90,
        },
      ]).g,
    ),
    (Math.PI * (0.16 - 0.09)) / 4,
    0.01,
    'quarter ring',
  );
});

test('repeats and placement put copies where they should be', () => {
  const g = part([{ box: [0.1, 0.1, 0.1], at: [0, 1, 0], repeat: 4 }]).g;
  assert.equal(g.count, 4 * 24);
  near(volume(g), 4 * 0.001, 1e-9, 'four boxes');
  const ys = new Set(),
    zs = new Set();
  for (let k = 0; k < g.count; k++) {
    ys.add(Math.round(g.p[3 * k + 1]));
    zs.add(Math.round(g.p[3 * k + 2]));
  }
  assert.deepEqual([...ys].sort(), [-1, 0, 1], 'copies at 0°, 90°, 180°, 270° around x');
  const moved = LK3D.build({
    parts: [{ id: 'm', at: [2, 0, 0], rot: [0, 0, 90], shapes: [{ cylinder: { r: 0.1, x0: 0, x1: 1 } }] }],
  }).parts[0];
  near(moved.hi[1], 1, 1e-6, 'a cylinder along x, turned 90° about z, points along y');
  near(moved.lo[0], 1.9, 1e-6, 'and moved to x = 2');
});

test('a bad scene is refused', () => {
  assert.throws(() => part([{ wobble: 1 }]), /needs one of/);
});

test('a repeated shape is one geometry drawn at each placement (instancing), and costs the same triangles', () => {
  const p = LK3D.build({
    parts: [
      { id: 'p', shapes: [{ box: [0.1, 0.1, 0.1], at: [0, 1, 0], repeat: 28 }, { cylinder: { r: 0.5, ri: 0.4 } }] },
    ],
  }).parts[0];
  assert.equal(p.batches.length, 2, 'the plain shapes merged into one batch, the repeated one its own');
  const fins = p.batches.find((b) => b.mats.length === 28);
  assert.ok(fins && fins.geo.count === 24, 'one box of geometry, 28 placements');
  assert.equal(p.tris, p.g.i.length / 3, 'the triangles drawn equal those of the expanded model');
});

test('the intersection tree finds the same nearest hit as testing every triangle', () => {
  const { buildBVH, intersect } = require('../src/bvh.js');
  const g = LK3D.build({
    parts: [
      {
        id: 'p',
        shapes: [
          { cylinder: { r: 0.56, ri: 0.5, x0: -0.55, x1: 0.55 } },
          { torus: [0.3, 0.08] },
          { helix: { r: 0.2, turns: 6, wire: 0.02 } },
        ],
      },
    ],
  }).parts[0].g;
  const bvh = buildBVH(g),
    one = (t) => ({
      tri: new Uint32Array([t]),
      box: new Float32Array([-1e9, -1e9, -1e9, 1e9, 1e9, 1e9]),
      kids: new Int32Array([-1, -1]),
      range: new Uint32Array([0, 1]),
    });
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let k = 0; k < 200; k++) {
    const o = [rnd() * 4 - 2, rnd() * 4 - 2, 3],
      d = [rnd() * 0.6 - 0.3, rnd() * 0.6 - 0.3, -1];
    let best = Infinity;
    for (let t = 0; t < g.i.length / 3; t++) {
      const h = intersect(g, one(t), o, d);
      if (h && h.t < best) best = h.t;
    }
    const h = intersect(g, bvh, o, d);
    assert.ok(h ? Math.abs(h.t - best) < 1e-9 : best === Infinity, `ray ${k}`);
  }
});

test('ambient occlusion darkens the inside of a tube more than its outside', () => {
  const { buildBVH, aoJob } = require('../src/bvh.js');
  const g = LK3D.build({ parts: [{ id: 'p', shapes: [{ cylinder: { r: 0.3, ri: 0.25, x0: -1, x1: 1 } }] }] }).parts[0]
    .g;
  const job = aoJob(g, buildBVH(g), 0.6);
  while (!job.step(1000)); // rays reach across the tube (diameter 0.5)
  let inside = 0,
    ni = 0,
    outside = 0,
    no = 0;
  for (let v = 0; v < g.count; v++) {
    const y = g.p[3 * v + 1],
      z = g.p[3 * v + 2],
      r = Math.hypot(y, z),
      radial = (g.n[3 * v + 1] * y + g.n[3 * v + 2] * z) / r;
    if (radial < -0.9) {
      inside += job.out[v];
      ni++;
    } else if (radial > 0.9) {
      outside += job.out[v];
      no++;
    } // the inner and outer walls
  }
  assert.ok(
    ni && no && inside / ni < outside / no - 100,
    `inside ${(inside / ni).toFixed(0)} vs outside ${(outside / no).toFixed(0)}`,
  );
});

test('the refresh estimate survives jittery frame timestamps (patterns measured on an iPhone)', () => {
  let seed = 3;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  // around a true interval, with jitter, a few late frames, and a few early ones right after them
  const run = (period, n = 20) => {
    const g = [];
    for (let k = 0; k < n; k++) {
      const r = rnd();
      g.push(r < 0.12 ? period * 1.6 : r < 0.24 ? period * 0.35 : period * (0.93 + 0.14 * rnd()));
    }
    return g;
  };
  const near = (a, b) => assert.ok(Math.abs(a - b) < 0.05, `${a} vs ${b}`);
  for (let k = 0; k < 20; k++) {
    near(LK3D.refreshFrom(run(1000 / 60)), 1000 / 60); // Safari, 60 Hz
    near(LK3D.refreshFrom(run(1000 / 30)), 1000 / 30); // Chrome on iOS, 30 Hz
    near(LK3D.refreshFrom(run(1000 / 120)), 1000 / 120); // a 120 Hz laptop
  }
  // the pattern that broke the shortest-interval rule: 60 Hz with a 5 ms outlier
  near(LK3D.refreshFrom([16.7, 16.6, 5.1, 16.8, 28.2, 16.7, 16.5, 16.7, 8.9, 16.8, 16.6, 16.7]), 1000 / 60);
});

test('a mirrored or stretched shape still faces outwards, with normals perpendicular to its surface', () => {
  for (const [name, s] of [
    ['mirrored', { cylinder: { r: 0.5, x0: -1, x1: 1 }, scale: [-1, 1, 1] }],
    ['stretched', { sphere: 0.5, scale: [3, 1, 1] }],
    ['mirrored copies', { box: [0.2, 0.2, 0.2], at: [0, 1, 0], scale: [1, -1, 1], repeat: 4 }],
  ]) {
    const g = part([s]).g;
    assert.ok(windingAgrees(g), `${name}: triangles face the way their normals point`);
    assert.ok(volume(g) > 0, `${name}: positive volume`);
  }
  // a sphere stretched 3 times along x is an ellipsoid; its normals must follow the surface's gradient. The mesh's
  // own facets put a sphere's normals off by a fraction of a degree on average, and stretching may multiply that by
  // up to 3; turning normals by the matrix itself (the old mistake) is off by about 20° on average
  const err = (sc) => {
    const g = part([{ sphere: 0.5, scale: sc }]).g,
      a = 0.5 * sc[0];
    let sum = 0;
    for (let k = 0; k < g.count; k++) {
      const gr = [g.p[3 * k] / (a * a), g.p[3 * k + 1] / 0.25, g.p[3 * k + 2] / 0.25],
        l = Math.hypot(...gr);
      sum +=
        (Math.acos(Math.min(1, (g.n[3 * k] * gr[0] + g.n[3 * k + 1] * gr[1] + g.n[3 * k + 2] * gr[2]) / l)) * 180) /
        Math.PI;
    }
    return sum / g.count;
  };
  const base = err([1, 1, 1]),
    stretched = err([3, 1, 1]);
  assert.ok(
    stretched <= 3 * base + 0.1,
    `normals off by ${stretched.toFixed(2)}° on average (the sphere itself: ${base.toFixed(2)}°)`,
  );
});

test('the shapes for the sciences are solids with outward faces and the volumes of their formulas', () => {
  const P = Math.PI;
  const solid = (name, s) => {
    const g = part([s]).g;
    assert.ok(windingAgrees(g), `${name}: faces agree with normals`);
    assert.ok(volume(g) > 0, `${name}: outward`);
    return volume(g);
  };
  near(solid('ellipsoid', { ellipsoid: [1, 0.5, 0.3] }), (4 / 3) * P * 1 * 0.5 * 0.3, 0.03, 'ellipsoid');
  near(
    solid('capsule', { capsule: { r: 0.2, x0: -0.5, x1: 0.5 } }),
    P * 0.04 * 1 + (4 / 3) * P * 0.008,
    0.02,
    'capsule',
  );
  near(
    solid('shell', { shell: { r: 1, ri: 0.6, from: 0, to: 270 } }),
    ((0.75 * 4) / 3) * P * (1 - 0.216),
    0.03,
    'shell with a wedge cut out',
  );
  near(
    solid('core', { shell: { r: 0.5, from: 0, to: 270 } }),
    ((0.75 * 4) / 3) * P * 0.125,
    0.03,
    'solid core with a wedge cut out',
  );
  const outline = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0.5, 0.4],
    [0, 1],
  ]; // not convex
  near(solid('extrude', { extrude: { outline, depth: 0.3 } }), 0.7 * 0.3, 1e-9, 'extrusion: area × depth');
  near(
    solid('flat terrain', {
      terrain: {
        size: [2, 1],
        base: 0.5,
        height: { amp: 0 },
        layers: [
          { thick: 0.2, color: '#c9a66b' },
          { thick: 0.3, color: '#5d5d5d' },
        ],
      },
    }),
    1,
    1e-6,
    'terrain block',
  );
  solid('blob', { blob: { r: 0.5, amp: 0.1 } });
  solid('blade', { blade: { twist: 40, camber: 0.05 } });
  solid('tree', { tree: { levels: 3 } });
  solid('molecule', {
    molecule: {
      atoms: [
        { el: 'O', at: [0, 0, 0] },
        { el: 'H', at: [0.96, 0, 0] },
      ],
      bonds: [[0, 1]],
    },
  });
  // the same seed gives the same shape, another seed another one
  const pts = (seed) =>
    part([{ blob: { r: 0.5, seed } }])
      .g.p.slice(0, 30)
      .join();
  assert.equal(pts(4), pts(4));
  assert.notEqual(pts(4), pts(5));
});

test('vertex colours: a coloured shape keeps its colour beside an uncoloured one, and terrain shows each layer', () => {
  const g = part([
    { sphere: 0.2, color: '#ff0000' },
    { box: [0.1, 0.1, 0.1], at: [1, 0, 0] },
  ]).g;
  assert.equal(g.c.length, 4 * g.count);
  const own = [],
    plain = [];
  for (let k = 0; k < g.count; k++) (g.c[4 * k + 3] === 255 ? own : plain).push(k);
  assert.ok(own.length && plain.length && own.every((k) => g.c[4 * k] === 255 && g.c[4 * k + 1] === 0));
  const t = part([
    {
      terrain: {
        layers: [
          { thick: 0.2, color: '#c9a66b' },
          { thick: 0.2, color: '#8a6f4e' },
          { thick: 0.2, color: '#5d5d5d' },
        ],
        top: '#7a9a55',
      },
    },
  ]).g;
  const colours = new Set();
  for (let k = 0; k < t.count; k++) colours.add(t.c.slice(4 * k, 4 * k + 3).join());
  assert.equal(colours.size, 4, 'the surface and three layers');
});

test('an orbit has the Sun at a focus, and scattered copies stay in their region', () => {
  const o = part([{ orbit: { a: 1, e: 0.2, wire: 0.001 } }]).g;
  let rmin = 9,
    rmax = 0;
  for (let k = 0; k < o.count; k++) {
    const r = Math.hypot(o.p[3 * k], o.p[3 * k + 2]);
    rmin = Math.min(rmin, r);
    rmax = Math.max(rmax, r);
  }
  near(rmax, 1.2, 0.01, 'aphelion a(1 + e)');
  near(rmin, 0.8, 0.01, 'perihelion a(1 − e)');
  const s = LK3D.build({
    parts: [
      {
        id: 'p',
        shapes: [
          { scatter: { shape: { sphere: 0.02 }, n: 120, within: { sphere: 1 }, avoid: [{ sphere: 0.4 }], seed: 3 } },
        ],
      },
    ],
  }).parts[0];
  const b = s.batches.find((x) => x.mats.length > 1);
  assert.equal(b.mats.length, 120, 'drawn by instancing');
  for (const m of b.mats) {
    const r = Math.hypot(m[12], m[13], m[14]);
    assert.ok(r <= 1 && r >= 0.4, `copy at ${r}`);
  }
});

// a tiny .glb written here (no licensed asset): a float cube under a moved node, and a quantized one (int16,
// normalized, scaled by its node: KHR_mesh_quantization) with vertex colours
function glb() {
  const C = [
    [-1, -1, -1],
    [1, -1, -1],
    [1, 1, -1],
    [-1, 1, -1],
    [-1, -1, 1],
    [1, -1, 1],
    [1, 1, 1],
    [-1, 1, 1],
  ];
  const I = [
    0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 2, 3, 7, 2, 7, 6, 1, 2, 6, 1, 6, 5, 3, 0, 4, 3, 4, 7,
  ];
  const f32 = Buffer.from(new Float32Array(C.flat()).buffer),
    q16 = Buffer.from(
      new Int16Array(
        C.flat()
          .map((v) => v * 32767)
          .concat([0, 0, 0, 0]),
      ).buffer.slice(0, 48),
    );
  const idx = Buffer.from(new Uint16Array(I).buffer),
    col = Buffer.from(new Float32Array(C.flatMap(() => [0.5, 0.2, 0.1, 1])).buffer);
  const parts = [f32, q16, idx, col],
    views = [];
  let off = 0;
  for (const p of parts) {
    views.push({ buffer: 0, byteOffset: off, byteLength: p.length });
    off += p.length;
  }
  const bin = Buffer.concat(parts),
    pad = (b, c) => Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4, c)]);
  const json = {
    asset: { version: '2.0' },
    extensionsUsed: ['KHR_mesh_quantization'],
    extensionsRequired: ['KHR_mesh_quantization'],
    scene: 0,
    scenes: [{ nodes: [0, 1] }],
    nodes: [
      { name: 'Moved', mesh: 0, translation: [3, 0, 0] },
      { name: 'Small', mesh: 1, scale: [0.5, 0.5, 0.5] },
    ],
    meshes: [
      { name: 'cube', primitives: [{ attributes: { POSITION: 0 }, indices: 2 }] },
      { name: 'qcube', primitives: [{ attributes: { POSITION: 1, COLOR_0: 3 }, indices: 2 }] },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 8, type: 'VEC3' },
      { bufferView: 1, componentType: 5122, normalized: true, count: 8, type: 'VEC3' },
      { bufferView: 2, componentType: 5123, count: 36, type: 'SCALAR' },
      { bufferView: 3, componentType: 5126, count: 8, type: 'VEC4' },
    ],
    bufferViews: views,
    buffers: [{ byteLength: bin.length }],
  };
  const J = pad(Buffer.from(JSON.stringify(json)), 0x20),
    B = pad(bin, 0);
  const head = Buffer.alloc(12);
  head.writeUInt32LE(0x46546c67, 0);
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(12 + 8 + J.length + 8 + B.length, 8);
  const ch = (b, t) => {
    const h = Buffer.alloc(8);
    h.writeUInt32LE(b.length, 0);
    h.writeUInt32LE(t, 4);
    return Buffer.concat([h, b]);
  };
  return Buffer.concat([head, ch(J, 0x4e4f534a), ch(B, 0x004e4942)]).toString('base64');
}

test('a glTF model is read with its node transforms, quantized positions and colours, whole or one node at a time', () => {
  const models = { m: { data: glb(), license: 'CC0', author: 'test' } };
  const whole = LK3D.build({ models, parts: [{ id: 'p', shapes: [{ model: 'm' }] }] }).parts[0].g;
  near(volume(whole), 8 + 1, 1e-4, 'a 2-unit cube and a cube scaled to 1 unit');
  const moved = LK3D.build({ models, parts: [{ id: 'p', shapes: [{ model: 'm', node: 'Moved' }] }] }).parts[0];
  assert.deepEqual(
    moved.lo.map((v) => +v.toFixed(4)),
    [2, -1, -1],
  );
  assert.deepEqual(
    moved.hi.map((v) => +v.toFixed(4)),
    [4, 1, 1],
  );
  const small = LK3D.build({ models, parts: [{ id: 'p', shapes: [{ model: 'm', node: 'Small' }] }] }).parts[0].g;
  near(volume(small), 1, 1e-3, 'quantized, normalized and scaled by its node');
  assert.ok(windingAgrees(small) && small.c && small.c[3] === 255, 'outward, with its colour');
  assert.throws(
    () => LK3D.build({ models, parts: [{ id: 'p', shapes: [{ model: 'm', node: 'Nope' }] }] }),
    /no node or mesh called "Nope"/,
  );
});

// a textured .glb written here: a square with quantized texture coordinates (uint16, normalized), a material with a
// base colour map moved by KHR_texture_transform and a normal map (stand-in image bytes: node does not decode them),
// and an untextured triangle beside it
function texturedGlb({ second = false, required = [] } = {}) {
  const P = [
      [0, 0, 0],
      [1, 0, 0],
      [1, 1, 0],
      [0, 1, 0],
    ],
    UV = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ];
  const pos = Buffer.from(new Float32Array(P.flat()).buffer),
    uv = Buffer.from(new Uint16Array(UV.flat().map((v) => v * 65535)).buffer);
  const idx = Buffer.from(new Uint16Array([0, 1, 2, 0, 2, 3]).buffer),
    png = Buffer.from('\x89PNG stand-in', 'latin1'),
    nrm = Buffer.from('\x89PNG normal', 'latin1');
  const parts = [pos, uv, idx, png, nrm],
    views = [];
  let off = 0;
  const bin = Buffer.concat(
    parts.map((b) => {
      const q = Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4)]);
      views.push({ buffer: 0, byteOffset: off, byteLength: b.length });
      off += q.length;
      return q;
    }),
  );
  const tt = { KHR_texture_transform: { offset: [0.5, 0], scale: [0.5, 1] } };
  const json = {
    asset: { version: '2.0' },
    extensionsUsed: ['KHR_mesh_quantization', 'KHR_texture_transform', ...required],
    extensionsRequired: ['KHR_mesh_quantization', ...required],
    scene: 0,
    scenes: [{ nodes: [0, 1] }],
    nodes: [
      { name: 'Square', mesh: 0 },
      { name: 'Plain', mesh: 1, translation: [0, 0, 1] },
    ],
    meshes: [
      { primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 1 }, indices: 2, material: 0 }] },
      {
        primitives: [
          { attributes: { POSITION: 0, ...(second ? { TEXCOORD_0: 1 } : {}) }, indices: 2, material: second ? 2 : 1 },
        ],
      },
    ],
    materials: [
      {
        pbrMetallicRoughness: { baseColorTexture: { index: 0, extensions: tt } },
        normalTexture: { index: 1, extensions: tt },
      },
      { pbrMetallicRoughness: { baseColorFactor: [0.2, 0.4, 0.8, 1] } },
      { pbrMetallicRoughness: { baseColorTexture: { index: 1 } } },
    ],
    textures: [{ source: 0 }, { source: 1 }],
    images: [
      { bufferView: 3, mimeType: 'image/png' },
      { bufferView: 4, mimeType: 'image/png' },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 4, type: 'VEC3' },
      { bufferView: 1, componentType: 5123, normalized: true, count: 4, type: 'VEC2' },
      { bufferView: 2, componentType: 5123, count: 6, type: 'SCALAR' },
    ],
    bufferViews: views,
    buffers: [{ byteLength: bin.length }],
  };
  const pad = (b, c) => Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4, c)]),
    J = pad(Buffer.from(JSON.stringify(json)), 0x20);
  const head = Buffer.alloc(12);
  head.writeUInt32LE(0x46546c67, 0);
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(12 + 8 + J.length + 8 + bin.length, 8);
  const ch = (b, t) => {
    const h = Buffer.alloc(8);
    h.writeUInt32LE(b.length, 0);
    h.writeUInt32LE(t, 4);
    return Buffer.concat([h, b]);
  };
  return Buffer.concat([head, ch(J, 0x4e4f534a), ch(bin, 0x004e4942)]).toString('base64');
}

test('a textured glTF model: its texture coordinates (transformed) and maps, in a batch of its own', () => {
  const models = { m: { data: texturedGlb(), license: 'CC0', author: 'test' } };
  const part = LK3D.build({
    models,
    parts: [
      {
        id: 'p',
        shapes: [
          { sphere: 0.2, at: [5, 0, 0] },
          { model: 'm', at: [0, 2, 0] },
        ],
      },
    ],
  }).parts[0];
  assert.equal(part.batches.length, 2, 'the plain shapes, and the textured model');
  const [plain, tex] = part.batches;
  assert.ok(!plain.geo.uv && !plain.geo.tex, 'the sphere has no texture');
  const g = tex.geo;
  assert.equal(g.tex.base.mime, 'image/png');
  assert.equal(Buffer.from(g.tex.base.bytes).toString('latin1'), '\x89PNG stand-in');
  assert.equal(Buffer.from(g.tex.normal.bytes).toString('latin1'), '\x89PNG normal');
  assert.equal(g.tex.mr, null);
  assert.equal(g.uv.length, 2 * g.count, 'a UV for every vertex');
  // the square's UVs (0..1) went through offset [0.5, 0] and scale [0.5, 1]; the untextured triangle has 0, 0
  const sq = [];
  for (let k = 0; k < 4; k++) sq.push([+g.uv[2 * k].toFixed(4), +g.uv[2 * k + 1].toFixed(4)]);
  assert.deepEqual(sq, [
    [0.5, 0],
    [1, 0],
    [1, 1],
    [0.5, 1],
  ]);
  assert.deepEqual(g.uv.slice(8, 16), [0, 0, 0, 0, 0, 0, 0, 0]);
  near(Math.min(...g.p.filter((_, i) => i % 3 === 1)), 2, 1e-9, 'placed by the shape');
  // a second textured material in the same model shape is refused (each would need its own maps), and so is KTX2
  assert.throws(
    () =>
      LK3D.build({
        models: { m: { data: texturedGlb({ second: true }) } },
        parts: [{ id: 'p', shapes: [{ model: 'm' }] }],
      }),
    /one material/,
  );
  assert.throws(
    () =>
      LK3D.build({
        models: { m: { data: texturedGlb({ required: ['KHR_texture_basisu'] }) } },
        parts: [{ id: 'p', shapes: [{ model: 'm' }] }],
      }),
    /KHR_texture_basisu is not supported/,
  );
});

test('every shape for the sciences follows the quality setting (coarser on phones and in 2D)', () => {
  const shapes = {
    ellipsoid: [1, 0.5, 0.3],
    capsule: { r: 0.2 },
    blob: { r: 0.5 },
    shell: { r: 1, ri: 0.5, to: 270 },
    tree: { levels: 2 },
    orbit: { a: 1 },
    blade: {},
    terrain: {},
    molecule: {
      atoms: [
        { el: 'O', at: [0, 0, 0] },
        { el: 'H', at: [0.96, 0, 0] },
      ],
      bonds: [[0, 1]],
    },
    dna: { pairs: 6 },
  };
  for (const [k, v] of Object.entries(shapes)) {
    const t = (q) => LK3D.build({ parts: [{ id: 'p', shapes: [{ [k]: v }] }] }, q).parts[0].tris;
    assert.ok(t(0.5) < t(1), `${k}: ${t(0.5)} triangles at half quality, ${t(1)} at full`);
  }
});

test('handles: the pointer ray gives the angle of a turn, the distance of a slide and the place along a path', () => {
  const HD = require('../src/handles.js'),
    close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} vs ${b}`);
  // a ring turning about z through (1, 0, 0), looked at from +z: a ray down onto (1, 1, 0) is at 90° from the ring's
  // first direction, onto (0, 0, 0) at 180°
  const ring = { turn: { axis: [0, 0, 1], center: [1, 0, 0] } },
    down = [0, 0, -1];
  const a90 = HD.turnAngle([1, 1, 5], down, ring),
    a180 = HD.turnAngle([0, 0, 5], down, ring);
  close(Math.abs(HD.unwrap(a180 - a90)), 90, 'a quarter turn between them');
  close(HD.unwrap(179 - -179), -2, 'turning past ±180 keeps counting');
  // a piston sliding along y from (0, 1, 0): a ray across the axis at height 0.6 reads −0.4
  close(HD.slideAt([0, 0.6, 5], [0, 0, -1], { slide: { axis: [0, 1, 0] } }, [0, 1, 0]), -0.4, 'slide');
  // a square path of side 1: half way round is the opposite corner
  const m = HD.measure(
    [
      [0, 0, 0],
      [1, 0, 0],
      [1, 1, 0],
      [0, 1, 0],
    ],
    true,
  );
  assert.deepEqual(HD.pointAt(m, 0.5), [1, 1, 0]);
  close(
    HD.nearestAlong(
      m,
      m.P.map(([x, y]) => [x * 100, y * 100]),
      100,
      50,
    ),
    0.375,
    'nearest place, on screen',
  );
  // held to the range, snapped, and wrapped on a closed path
  close(HD.hold({ min: 0, max: 10, snap: 2.5 }, 6.4), 7.5, 'snap');
  close(HD.hold({ min: 0, max: 10 }, 12), 10, 'max');
  close(HD.hold({ along: { closed: true } }, 1.25), 0.25, 'wraps round a closed path');
  // what a handle does to its parts
  const turned = LK3D.M.pt(HD.matrix(ring, 90), [2, 0, 0]);
  assert.ok(
    Math.hypot(turned[0] - 1, turned[1] - 1, turned[2]) < 1e-9,
    `a quarter turn about (1, 0, 0) takes (2, 0, 0) to (1, 1, 0): ${turned}`,
  );
  const near3 = (p, q, msg) => assert.ok(Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) < 1e-6, `${msg}: ${p}`); // (32-bit matrices)
  near3(
    LK3D.M.pt(HD.matrix({ slide: { axis: [0, 2, 0] }, value: 0 }, -0.4), [0, 1, 0]),
    [0, 0.6, 0],
    'slide moves the part',
  );
  near3(
    LK3D.M.pt(
      HD.matrix(
        {
          along: {
            path: [
              [0, 0, 0],
              [2, 0, 0],
            ],
          },
          value: 0,
        },
        0.5,
        HD.measure([
          [0, 0, 0],
          [2, 0, 0],
        ]),
      ),
      [0, 0, 0],
    ),
    [1, 0, 0],
    'along moves the part',
  );
  // a part keeps its handle through the scene builder
  assert.deepEqual(
    LK3D.build({ parts: [{ id: 'p', handle: ring, shapes: [{ box: [1, 1, 1] }] }] }).parts[0].handle,
    ring,
  );
});

test('locales: English by default and Vietnamese bundled, with the same words and their own decimal mark', () => {
  const { en, vi } = LK3D.locales;
  assert.deepEqual(Object.keys(vi).sort(), Object.keys(en).sort(), 'every word in both');
  for (const L of [en, vi])
    for (const [k, v] of Object.entries(L)) assert.ok(typeof v === 'string' && v.length, `${k} written`);
  assert.equal(en.decimal, '.');
  assert.equal(vi.decimal, ',');
  assert.equal(LK3D.defaults.locale, 'en', 'a page that says nothing gets English');
  assert.deepEqual(LK3D.defaults.strings, {});
  assert.equal(LK3D.defaults.buttonClass, '');
});

test('the scene schema names exactly what the engine draws: shapes, materials, surfaces, environments', () => {
  const { schema } = require('../src/validate.js'),
    G = require('../src/geometry.js'),
    { ENVS } = require('../src/renderer-gl.js');
  const d = schema.$defs,
    kinds = d.shape.oneOf.map((o) => o.required[0]);
  assert.deepEqual(kinds.sort(), [...Object.keys(G.SHAPES), 'scatter', 'model'].sort());
  assert.deepEqual(d.part.properties.material.enum.slice().sort(), Object.keys(G.MATERIALS).sort());
  assert.deepEqual(d.part.properties.surface.properties.kind.enum.slice().sort(), Object.keys(G.SURFACES).sort());
  assert.deepEqual(schema.properties.env.enum.slice().sort(), Object.keys(ENVS).sort());
  assert.deepEqual(schema.properties.theme.enum.slice().sort(), [...Object.keys(LK3D.themes), 'auto'].sort());
});

test('every theme has every colour, and says whether it is dark', () => {
  const keys = Object.keys(LK3D.themes.light).sort();
  assert.deepEqual(Object.keys(LK3D.themes).sort(), ['blueprint', 'dark', 'light', 'sepia']);
  for (const [name, t] of Object.entries(LK3D.themes)) {
    assert.deepEqual(Object.keys(t).sort(), keys, `${name}: the same tokens as light`);
    for (const k of keys)
      if (k === 'dark') assert.equal(typeof t.dark, 'boolean', name);
      else assert.match(t[k], /^#[0-9a-f]{6}$/, `${name}.${k}`);
  }
  // the words on the stage stand out from the page behind them (WCAG contrast at least 4.5 : 1)
  const lum = (h) =>
    [1, 3, 5]
      .map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
      .reduce((a, c, i) => a + c * [0.2126, 0.7152, 0.0722][i], 0);
  const contrast = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
  for (const [name, t] of Object.entries(LK3D.themes)) {
    assert.ok(contrast(t.ink, t.paper) >= 4.5, `${name}: words on labels`);
    assert.ok(contrast(t.warn, t.bg) >= 4.5, `${name}: the note on the page`);
    assert.equal(t.dark, lum(t.bg) < 0.2, `${name}: dark says how the page is`);
  }
});

test('flow streaks: along their paths, as many as the amount says, coloured by the ramp, the same every time', () => {
  const F = require('../src/flow.js');
  const line = F.pathOf([
    [0, 0, 0],
    [2, 0, 0],
    [2, 1, 0],
  ]);
  assert.equal(line.total, 3);
  assert.deepEqual(line.at(1), [1, 0, 0]);
  assert.deepEqual(line.at(2.5), [2, 0.5, 0]);
  const pt = (f, i, k) =>
    Array.from(f.verts.subarray((i * F.PTS + k) * 2 * F.STRIDE, (i * F.PTS + k) * 2 * F.STRIDE + 9));
  const f = F.makeFlow({
    path: [
      [0, 0, 0],
      [10, 0, 0],
    ],
    count: 50,
    length: 0.1,
  });
  f.update(null);
  assert.equal(f.n, 50);
  for (let i = 0; i < f.n; i++) {
    const head = pt(f, i, 0),
      tail = pt(f, i, F.PTS - 1);
    assert.ok(head[1] === 0 && head[2] === 0 && head[0] >= 0 && head[0] <= 10, 'on the path (no spread)');
    assert.ok(head[0] - tail[0] <= 1 + 1e-6 && head[0] >= tail[0], 'the tail a tenth of the path behind the head');
    assert.ok(Math.abs(head[7] - head[0] / 10) < 1e-6, 'ramp position: how far along the path');
    assert.ok(head[8] >= tail[8] && tail[8] === 0, 'fading towards the tail');
    assert.equal(head[3], -1);
    assert.equal(pt(f, i, 0)[3] + Array.from(f.verts.subarray((i * F.PTS * 2 + 1) * F.STRIDE))[3], 0, 'two sides');
  }
  f.amount = 0.3;
  f.update(null);
  assert.equal(f.n, 15, 'amount: the share of streaks drawn');
  const g = F.makeFlow({
    path: [
      [0, 0, 0],
      [10, 0, 0],
    ],
    count: 50,
    length: 0.1,
  });
  g.amount = 0.3;
  g.update(null);
  const drawn = (x) => Array.from(x.verts.subarray(0, x.n * F.PTS * 2 * F.STRIDE));
  assert.deepEqual(drawn(g), drawn(f), 'the same streaks every time');
  const x0 = pt(f, 3, 0)[0];
  f.speed = 2;
  f.step(0.25);
  f.update(null);
  const moved = pt(f, 3, 0)[0] - x0;
  assert.ok(
    (moved > 0.39 && moved < 0.61) || moved < -8,
    `moved on by about speed × time (or round to the start): ${moved}`,
  );
  // spread: off the path, but no further than spread × 1.5
  const s = F.makeFlow({
    path: [
      [0, 0, 0],
      [10, 0, 0],
    ],
    count: 40,
    spread: 0.2,
  });
  s.update(null);
  let off = 0;
  for (let i = 0; i < 40; i++) off = Math.max(off, Math.hypot(pt(s, i, 0)[1], pt(s, i, 0)[2]));
  assert.ok(off > 0.05 && off <= 0.3 + 1e-9, `spread ${off}`);
  // several paths: shared out in turn
  const two = F.makeFlow({
    paths: [
      [
        [0, 0, 0],
        [1, 0, 0],
      ],
      [
        [0, 5, 0],
        [1, 5, 0],
      ],
    ],
    count: 10,
  });
  two.update(null);
  assert.equal(pt(two, 0, 0)[1], 0);
  assert.equal(pt(two, 1, 0)[1], 5);
  // ramps: presets for a light and a dark page, a list resampled to four stops
  const r = F.ramp(['#000000', '#ffffff'], false);
  assert.equal(r.length, 4);
  assert.deepEqual(F.rampAt(r, 0), [0, 0, 0]);
  assert.deepEqual(F.rampAt(r, 1), [1, 1, 1]);
  near(F.rampAt(r, 0.5)[0], 0.5, 1e-9, 'halfway');
  assert.deepEqual(F.ramp('#336699', true)[3], F.ramp('#336699', true)[0], 'one colour all along');
  const lightHeat = F.ramp('heat', false)[3],
    darkHeat = F.ramp('heat', true)[3];
  assert.ok(Math.min(...lightHeat) < 0.3, 'on paper heat ends in a strong colour, not white');
  assert.ok(Math.min(...darkHeat) > 0.7, 'on a dark page it ends near white');
  assert.throws(() => F.makeFlow({}), /path/);
  assert.equal(F.flowIndices(2).length, 2 * (F.PTS - 1) * 6);
});

test('the validator finds each planted mistake where it is, and passes a right scene', () => {
  const { validate } = require('../src/validate.js');
  const part = (o = {}) => ({ id: 'a', shapes: [{ sphere: 1 }], ...o });
  const good = {
    parts: [
      part({ group: 'g', handle: { slide: { axis: [1, 0, 0] }, min: 0, max: 1, moves: ['b', 'g'] } }),
      part({ id: 'b', material: 'glass', refract: 1, surface: { kind: 'knurl', scale: 40 } }),
    ],
    scale: { bar: { length: 1, label: '1 cm' }, note: 'not to scale' },
    env: 'night',
    models: { m: { data: '', source: 'scan' } },
    style: 'pen',
    theme: 'blueprint',
    lk3d: 1,
    view: { projection: 'ortho' },
    edges: true,
    extra: "a page's own field",
  };
  assert.deepEqual(validate(good), []);
  const at = (scene) => validate(scene).map((e) => e.path);
  const cases = [
    [{ parts: [] }, 'parts'], // no parts
    [{ parts: [{ id: 'a' }] }, 'parts[0]'], // no shapes
    [{ parts: [part(), part()] }, 'parts[1].id'], // two parts, one id
    [{ parts: [part({ shapes: [{ sphere: 1, box: [1, 1, 1] }] })] }, 'parts[0].shapes[0]'], // two kinds in one shape
    [{ parts: [part({ shapes: [{ cube: 1 }] })] }, 'parts[0].shapes[0]'], // an unknown kind
    [{ parts: [part({ shapes: [{ box: [1, 1] }] })] }, 'parts[0].shapes[0].box'], // a box of two sizes
    [{ parts: [part({ shapes: [{ model: 'heart' }] })] }, 'parts[0].shapes[0]'], // a model not listed
    [
      { parts: [part({ handle: { turn: { axis: [1, 0, 0] }, slide: { axis: [0, 1, 0] }, min: 0, max: 1 } })] },
      'parts[0].handle',
    ], // two rules
    [{ parts: [part({ handle: { slide: { axis: [1, 0, 0] }, max: 1 } })] }, 'parts[0].handle'], // a slide without its range
    [{ parts: [part({ handle: { along: { path: [[0, 0, 0]] } } })] }, 'parts[0].handle.along.path'], // a path of one point
    [{ parts: [part({ handle: { turn: { axis: [1, 0, 0] }, moves: ['nope'] } })] }, 'parts[0].handle.moves'], // moves nothing that exists
    [{ parts: [part({ surface: { kind: 'velvet' } })] }, 'parts[0].surface.kind'],
    [{ parts: [part({ surface: { kind: 'grain', scale: -2 } })] }, 'parts[0].surface.scale'],
    [{ parts: [part({ refract: 1 })] }, 'parts[0]'], // glass only
    [{ parts: [part({ material: 'glass', refract: 5 })] }, 'parts[0].refract'],
    [{ parts: [part({ color: 'red' })] }, 'parts[0].color'],
    [{ parts: [part()], scale: {} }, 'scale'],
    [{ parts: [part()], scale: { bar: { length: 1 } } }, 'scale.bar'],
    [{ parts: [part()], scale: 'log' }, 'scale'],
    [{ parts: [part()], env: 'sunset' }, 'env'],
    [{ parts: [part()], style: 'photo' }, 'style'],
    [{ parts: [part()], theme: 'neon' }, 'theme'],
    [{ parts: [part({ accent: 'yes' })] }, 'parts[0].accent'],
    [{ parts: [part()], lk3d: 2 }, 'lk3d'], // a format this engine does not read
    [{ parts: [part()], view: { projection: 'fisheye' } }, 'view.projection'],
    [{ parts: [part()], edges: 'yes' }, 'edges'],
    [{ parts: [part({ edges: 1 })] }, 'parts[0].edges'],
    [{ parts: [part()], models: { m: { source: 'web' } } }, 'models.m.source'],
  ];
  for (const [scene, path] of cases)
    assert.ok(at(scene).includes(path), `${JSON.stringify(scene).slice(0, 90)} → ${JSON.stringify(validate(scene))}`);
});

test("a part's words keep only simple formatting: nothing from a scene can run on the page", () => {
  const { safeHTML } = require('../src/index.js');
  assert.equal(safeHTML('H<sub>2</sub>O, <i>a</i> &gt; 0, m&#775;'), 'H<sub>2</sub>O, <i>a</i> &gt; 0, m&#775;');
  assert.equal(safeHTML('a<br/>b <B>c</B>'), 'a<br>b <B>c</B>');
  for (const bad of [
    '<img src=x onerror=alert(1)>',
    '<script>alert(1)</script>',
    '<b onclick="alert(1)">x</b>',
    '<a href="javascript:alert(1)">x</a>',
    '<svg onload=alert(1)>',
  ]) {
    const out = safeHTML(bad);
    assert.ok(!/<(?!\/?(b|i|em|strong|sub|sup|br)>)/i.test(out), `${bad} → ${out}`);
  }
  assert.equal(safeHTML('fish & chips'), 'fish &amp; chips');
  assert.equal(safeHTML(undefined), '');
});

test('the clock: animation time can be slowed, stopped and stepped', () => {
  const { clock } = require('../src/index.js');
  const t0 = clock.now();
  clock.speed = 0;
  const t1 = clock.now();
  clock.step(250);
  assert.equal(clock.now(), t1 + 250);
  for (let k = 0; k < 1e5; k++); // (wall time passes; the stopped clock does not)
  assert.equal(clock.now(), t1 + 250);
  clock.speed = 1;
  assert.ok(clock.now() >= t1 + 250 && t1 >= t0);
  clock.speed = -3;
  assert.equal(clock.speed, 0); // never backwards
  clock.speed = 1;
});

test('edges: where faces meet at an angle and where a surface ends, never across a smooth surface or a soft shape', () => {
  const { edgesOf } = require('../src/geometry.js');
  const one = (shape, o = {}) => {
    const b = LK3D.build({ parts: [{ id: 'p', shapes: [shape], ...o }] }, 1).parts[0].batches[0];
    return b.edgy ? edgesOf(b.geo, 40, b.soft).length / 9 : 0;
  };
  assert.equal(one({ box: [1, 2, 3] }), 12); // a box: its twelve edges
  assert.equal(one({ sphere: 1 }), 0); // a sphere: none
  assert.equal(one({ torus: [1, 0.2] }), 0);
  const n = one({ cylinder: { r: 0.5, x0: 0, x1: 1 } });
  assert.ok(n > 0 && n % 2 === 0, `a cylinder: its two rims (${n} segments)`);
  // a lathe with a step: four rings (both ends and the step's two corners), each as many segments as a rim
  assert.equal(
    one({
      lathe: [
        [0, 0.2],
        [0.5, 0.2],
        [0.5, 0.4],
        [1, 0.4],
      ],
    }),
    2 * n,
  );
  // every edge of the box lies on the box's edges: two of its coordinates at a corner value
  const b = LK3D.build({ parts: [{ id: 'p', shapes: [{ box: [1, 2, 3] }] }] }, 1).parts[0].batches[0];
  const E = edgesOf(b.geo); // (each segment: two ends, then the mean normal of its two faces)
  for (let k = 0; k < E.length; k += 9) {
    for (const o of [k, k + 3]) {
      const atCorner = [0.5, 1, 1.5].filter((h, a) => Math.abs(Math.abs(E[o + a]) - h) < 1e-6).length;
      assert.ok(atCorner >= 2, `${[...E.slice(o, o + 3)]} is on an edge`);
    }
    // the normal points out between the two faces: along the two axes the edge is not on, 45° to each
    const n = [...E.slice(k + 6, k + 9)];
    assert.ok(
      Math.abs(Math.hypot(...n) - 1) < 1e-6 &&
        n.filter((v) => Math.abs(Math.abs(v) - Math.SQRT1_2) < 1e-6).length === 2,
      `${n}`,
    );
  }
  // soft shapes have none, unless the part asks; a part may also refuse them
  assert.equal(one({ molecule: { atoms: [['O', [0, 0, 0]]] } }), 0);
  assert.equal(one({ box: [1, 1, 1] }, { edges: false }), 0);
  // a soft shape merged with a hard one: only the hard one's edges
  const m = LK3D.build({ parts: [{ id: 'p', shapes: [{ box: [1, 1, 1] }, { blob: { r: 0.4 }, at: [2, 0, 0] }] }] }, 1)
    .parts[0].batches[0];
  assert.equal(edgesOf(m.geo, 40, m.soft).length / 9, 12);
});

test('a sector of a lathe with a concave profile (half a cowl) is a closed solid, half the whole', () => {
  // a thin curved wall: concave in the profile plane, which a fan of triangles from one corner would fill wrongly
  const wall = [
    [-1, 0.8],
    [-0.5, 0.95],
    [0, 1],
    [0.5, 0.95],
    [1, 0.8],
    [1, 0.77],
    [0.5, 0.92],
    [0, 0.97],
    [-0.5, 0.92],
    [-1, 0.77],
  ];
  const whole = volume(part([{ lathe: wall, closed: true }]).g),
    half = part([{ lathe: wall, closed: true, from: 0, to: 180 }]);
  assert.ok(windingAgrees(half.g), 'faces point outwards');
  assert.ok(Math.abs(volume(half.g) - whole / 2) < whole * 0.01, `half: ${volume(half.g)} of ${whole}`);
  const { edgesOf } = require('../src/geometry.js');
  assert.equal(edgesOf(half.g, 180).length, 0, 'closed: no surface ends anywhere');
});

test('streams: the radius profile along the path, and a hull that encloses the stream', () => {
  const { makeStream, radiusAt } = require('../src/stream.js');
  // (a gentle bend, as a jet or a duct has: a tube wider than its bend must fold on the inside)
  const T = makeStream({
    path: [
      [0, 0, 0],
      [1, 0, 0],
      [2, 0.25, 0],
    ],
    radius: [
      [0, 0.1, 0.25],
      [1, 0.15, 0.45],
    ],
  });
  // the distance along the path at each point, for the shader; the total
  assert.equal(T.n, 3);
  assert.ok(
    Math.abs(T.pts[7] - 1) < 1e-6 &&
      Math.abs(T.pts[11] - (1 + Math.hypot(1, 0.25))) < 1e-6 &&
      Math.abs(T.total - (1 + Math.hypot(1, 0.25))) < 1e-6,
  );
  // the radius: inner and outer, interpolated between the stops
  assert.deepEqual(radiusAt(T.rad, 0), [0.1, 0.25]);
  assert.deepEqual(
    radiusAt(T.rad, 0.5).map((v) => +v.toFixed(6)),
    [0.125, 0.35],
  );
  assert.deepEqual(radiusAt(T.rad, 1), [0.15, 0.45]);
  // the hull: every vertex at least the outer radius from the path (a quarter more), its faces pointing out
  const P = T.hull.p,
    I = T.hull.i;
  const toPath = (q) => {
    let best = Infinity;
    for (let k = 0; k + 1 < T.n; k++) {
      const a = [T.pts[4 * k], T.pts[4 * k + 1], T.pts[4 * k + 2]],
        b = [T.pts[4 * k + 4], T.pts[4 * k + 5], T.pts[4 * k + 6]],
        ab = b.map((v, i) => v - a[i]),
        t = Math.max(
          0,
          Math.min(1, ab.reduce((s, v, i) => s + v * (q[i] - a[i]), 0) / ab.reduce((s, v) => s + v * v, 0)),
        );
      best = Math.min(best, Math.hypot(...q.map((v, i) => v - a[i] - ab[i] * t)));
    }
    return best;
  };
  let outward = 0;
  for (let t = 0; t < I.length; t += 3) {
    const v = [0, 1, 2].map((j) => [P[3 * I[t + j]], P[3 * I[t + j] + 1], P[3 * I[t + j] + 2]]),
      c = [0, 1, 2].map((i) => (v[0][i] + v[1][i] + v[2][i]) / 3),
      u = v[1].map((x, i) => x - v[0][i]),
      w = v[2].map((x, i) => x - v[0][i]),
      n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]],
      // outward: the normal points away from the nearest point of the path (the end caps: along it)
      probe = c.map((x, i) => x + n[i] * 1e-3);
    if (toPath(probe) >= toPath(c) - 1e-9) outward++;
  }
  assert.equal(outward, I.length / 3, `${outward} of ${I.length / 3} faces point out`);
  for (let k = 0; k < P.length; k += 3) {
    const d = toPath([P[k], P[k + 1], P[k + 2]]);
    assert.ok(d < 1e-6 || d >= 0.25 * 1.25 - 1e-3, `a hull vertex ${d.toFixed(3)} from the path`);
  }
  assert.throws(() => makeStream({ path: [[0, 0, 0]] }), /two points/);
});

test('streams: the air moves by travel time, faster where the stream narrows, never backwards', () => {
  const { makeStream, NT } = require('../src/stream.js');
  const tau = (T) => Array.from({ length: NT }, (_, k) => T.tab[3 * k + 2]),
    rate = (t, k) => (t[k + 1] - t[k]) / (1 / (NT - 1)); // the travel time per unit of f: the length / the speed there
  // an intake narrowing to half its radius: a quarter of the area, so by continuity four times as fast at its end
  const T = makeStream({
    path: [
      [0, 0, 0],
      [2, 0, 0],
    ],
    radius: [
      [0, 0.2],
      [1, 0.1],
    ],
  });
  const t = tau(T);
  assert.equal(t[0], 0);
  for (let k = 0; k + 1 < NT; k++)
    assert.ok(t[k + 1] > t[k], 'travel time grows along the path: the air never runs back');
  assert.ok(
    Math.abs(rate(t, 0) / rate(t, NT - 2) - 4) < 0.3,
    `speed ratio ${(rate(t, 0) / rate(t, NT - 2)).toFixed(2)}`,
  );
  // the table carries the radii too, and any number of stops
  const M = makeStream({
    path: [
      [0, 0, 0],
      [5, 0, 0],
    ],
    radius: [
      [0, 0.1, 0.4],
      [0.2, 0.1, 0.3],
      [0.4, 0.2, 0.3],
      [0.6, 0.2, 0.5],
      [0.8, 0.1, 0.5],
      [1, 0.1, 0.6],
    ],
  });
  const mid = Math.round(0.4 * (NT - 1));
  assert.ok(
    Math.abs(M.tab[3 * mid] - 0.2) < 0.02 && Math.abs(M.tab[3 * mid + 1] - 0.3) < 0.02,
    'the fourth stop of six',
  );
  // a stream that says its own speeds (gas heated in a combustor, a jet slowing as it mixes): they win over continuity
  const S = makeStream({
    path: [
      [0, 0, 0],
      [2, 0, 0],
    ],
    radius: [
      [0, 0.2],
      [1, 0.1],
    ],
    speeds: [
      [0, 1],
      [1, 2],
    ],
  });
  const s = tau(S);
  assert.ok(Math.abs(rate(s, 0) / rate(s, NT - 2) - 2) < 0.15);
  // the pattern's position is tau - phase: as phase grows, every point of the pattern moves downstream
  S.speed = 1;
  S.step(0.5);
  assert.ok(Math.abs(S.phase - 0.5) < 1e-9);
});
