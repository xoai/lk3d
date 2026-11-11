// The 3D engine's geometry, checked without a browser: every shape is a closed solid whose faces point outwards
// (positive signed volume, normals agreeing with winding), volumes match the formulas, repeats and placement land
// where they should, and a bad scene is refused.          ./lk test
const test = require('node:test');
const assert = require('node:assert/strict');
const LK3D = require('../src/index.js');

const part = (shapes) => LK3D.build({ parts: [{ id: 'p', shapes }] }, 1).parts[0];
function volume(g) {
  let v = 0;
  for (let t = 0; t < g.indices.length; t += 3) {
    const P = (k) => [
        g.positions[3 * g.indices[t + k]],
        g.positions[3 * g.indices[t + k] + 1],
        g.positions[3 * g.indices[t + k] + 2],
      ],
      [a, b, c] = [P(0), P(1), P(2)];
    v +=
      (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) /
      6;
  }
  return v;
}
function windingAgrees(g) {
  for (let t = 0; t < g.indices.length; t += 3) {
    const [a, b, c] = [g.indices[t], g.indices[t + 1], g.indices[t + 2]],
      P = (k) => [g.positions[3 * k], g.positions[3 * k + 1], g.positions[3 * k + 2]];
    const A = P(a),
      B = P(b),
      C = P(c),
      u = [B[0] - A[0], B[1] - A[1], B[2] - A[2]],
      w = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
    const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    const vn = [
      g.normals[3 * a] + g.normals[3 * b] + g.normals[3 * c],
      g.normals[3 * a + 1] + g.normals[3 * b + 1] + g.normals[3 * c + 1],
      g.normals[3 * a + 2] + g.normals[3 * b + 2] + g.normals[3 * c + 2],
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
    ys.add(Math.round(g.positions[3 * k + 1]));
    zs.add(Math.round(g.positions[3 * k + 2]));
  }
  assert.deepEqual([...ys].sort(), [-1, 0, 1], 'copies at 0°, 90°, 180°, 270° around x');
  const moved = LK3D.build({
    parts: [{ id: 'm', at: [2, 0, 0], rot: [0, 0, 90], shapes: [{ cylinder: { r: 0.1, x0: 0, x1: 1 } }] }],
  }).parts[0];
  near(moved.max[1], 1, 1e-6, 'a cylinder along x, turned 90° about z, points along y');
  near(moved.min[0], 1.9, 1e-6, 'and moved to x = 2');
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
  const fins = p.batches.find((b) => b.placements.length === 28);
  assert.ok(fins && fins.mesh.count === 24, 'one box of geometry, 28 placements');
  assert.equal(p.triangleCount, p.g.indices.length / 3, 'the triangles drawn equal those of the expanded model');
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
      triangles: new Uint32Array([t]),
      boxes: new Float32Array([-1e9, -1e9, -1e9, 1e9, 1e9, 1e9]),
      children: new Int32Array([-1, -1]),
      ranges: new Uint32Array([0, 1]),
    });
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let k = 0; k < 200; k++) {
    const o = [rnd() * 4 - 2, rnd() * 4 - 2, 3],
      d = [rnd() * 0.6 - 0.3, rnd() * 0.6 - 0.3, -1];
    let best = Infinity;
    for (let t = 0; t < g.indices.length / 3; t++) {
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
    const y = g.positions[3 * v + 1],
      z = g.positions[3 * v + 2],
      r = Math.hypot(y, z),
      radial = (g.normals[3 * v + 1] * y + g.normals[3 * v + 2] * z) / r;
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
      const gr = [g.positions[3 * k] / (a * a), g.positions[3 * k + 1] / 0.25, g.positions[3 * k + 2] / 0.25],
        l = Math.hypot(...gr);
      sum +=
        (Math.acos(
          Math.min(1, (g.normals[3 * k] * gr[0] + g.normals[3 * k + 1] * gr[1] + g.normals[3 * k + 2] * gr[2]) / l),
        ) *
          180) /
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
      .g.positions.slice(0, 30)
      .join();
  assert.equal(pts(4), pts(4));
  assert.notEqual(pts(4), pts(5));
});

test('vertex colours: a coloured shape keeps its colour beside an uncoloured one, and terrain shows each layer', () => {
  const g = part([
    { sphere: 0.2, color: '#ff0000' },
    { box: [0.1, 0.1, 0.1], at: [1, 0, 0] },
  ]).g;
  assert.equal(g.colors.length, 4 * g.count);
  const own = [],
    plain = [];
  for (let k = 0; k < g.count; k++) (g.colors[4 * k + 3] === 255 ? own : plain).push(k);
  assert.ok(own.length && plain.length && own.every((k) => g.colors[4 * k] === 255 && g.colors[4 * k + 1] === 0));
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
  for (let k = 0; k < t.count; k++) colours.add(t.colors.slice(4 * k, 4 * k + 3).join());
  assert.equal(colours.size, 4, 'the surface and three layers');
});

test('an orbit has the Sun at a focus, and scattered copies stay in their region', () => {
  const o = part([{ orbit: { a: 1, e: 0.2, wire: 0.001 } }]).g;
  let rmin = 9,
    rmax = 0;
  for (let k = 0; k < o.count; k++) {
    const r = Math.hypot(o.positions[3 * k], o.positions[3 * k + 2]);
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
  const b = s.batches.find((x) => x.placements.length > 1);
  assert.equal(b.placements.length, 120, 'drawn by instancing');
  for (const m of b.placements) {
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
    moved.min.map((v) => +v.toFixed(4)),
    [2, -1, -1],
  );
  assert.deepEqual(
    moved.max.map((v) => +v.toFixed(4)),
    [4, 1, 1],
  );
  const small = LK3D.build({ models, parts: [{ id: 'p', shapes: [{ model: 'm', node: 'Small' }] }] }).parts[0].g;
  near(volume(small), 1, 1e-3, 'quantized, normalized and scaled by its node');
  assert.ok(windingAgrees(small) && small.colors && small.colors[3] === 255, 'outward, with its colour');
  assert.throws(
    () => LK3D.build({ models, parts: [{ id: 'p', shapes: [{ model: 'm', node: 'Nope' }] }] }),
    /no node or mesh called "Nope"/,
  );
});

// a textured .glb written here: a square with quantized texture coordinates (uint16, normalized), a material with a
// base colour map moved by KHR_texture_transform and a normal map (stand-in image bytes: node does not decode them),
// and an untextured triangle beside it; mat: more of the textured material (alphaMode, doubleSided, extensions)
function texturedGlb({ second = false, required = [], mat = {} } = {}) {
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
        ...mat,
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
  assert.ok(!plain.mesh.uv && !plain.mesh.textures, 'the sphere has no texture');
  const g = tex.mesh;
  assert.equal(g.textures.base.mime, 'image/png');
  assert.equal(Buffer.from(g.textures.base.bytes).toString('latin1'), '\x89PNG stand-in');
  assert.equal(Buffer.from(g.textures.normal.bytes).toString('latin1'), '\x89PNG normal');
  assert.equal(g.textures.metalRoughness, null);
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
  near(Math.min(...g.positions.filter((_, i) => i % 3 === 1)), 2, 1e-9, 'placed by the shape');
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

test('a glTF cut-out keeps its alpha cutoff, and a double-sided surface is marked to show from behind', () => {
  const square = (mat) =>
    LK3D.build({
      models: { m: { data: texturedGlb({ mat }) } },
      parts: [{ id: 'p', shapes: [{ model: 'm', node: 'Square' }] }],
    }).parts[0].batches[0].mesh;
  assert.equal(square({}).textures.alphaCutoff, 0, 'opaque by default');
  assert.equal(square({ alphaMode: 'MASK' }).textures.alphaCutoff, 0.5, "MASK's default cutoff");
  assert.equal(square({ alphaMode: 'MASK', alphaCutoff: 0.3 }).textures.alphaCutoff, 0.3);
  assert.equal(square({ alphaMode: 'BLEND' }).textures.alphaCutoff, 0.5, 'BLEND drawn as a cut-out at half');
  // marked, not copied: drawn with both faces (a copy turned inwards would show through a closed body's outline)
  const one = square({}),
    two = square({ doubleSided: true });
  assert.ok(!one.twoSided);
  assert.equal(two.twoSided, true);
  assert.equal(two.count, one.count, 'no copy of its vertices');
  assert.equal(two.indices.length, one.indices.length);
  // and a part that holds it, placed by a part's own matrix, keeps the mark
  const placed = LK3D.build({
    models: { m: { data: texturedGlb({ mat: { doubleSided: true } }) } },
    parts: [
      {
        id: 'p',
        at: [1, 0, 0],
        shapes: [
          { model: 'm', node: 'Square' },
          { model: 'm', node: 'Plain' },
        ],
      },
    ],
  }).parts[0];
  assert.ok(placed.batches.find((b) => b.mesh.textures).mesh.twoSided, 'the textured batch');
  assert.ok(
    !placed.batches.find((b) => !b.mesh.textures).mesh.twoSided,
    'not the plain one (its material is single-sided)',
  );
});

test("a glTF model's glass is see-through glass in its tint, and a shape's colour replaces a texture", () => {
  const glass = {
    extensions: {
      KHR_materials_transmission: { transmissionFactor: 1 },
      KHR_materials_volume: { attenuationColor: [1, 0.5, 0] },
    },
  };
  const build = (part) =>
    LK3D.build({
      models: { m: { data: texturedGlb({ mat: glass }) } },
      parts: [{ id: 'p', shapes: [{ model: 'm', node: 'Square' }], ...part }],
    }).parts[0];
  const p = build({}),
    g = p.batches[0].mesh;
  assert.equal(g.textures.base, null, "no base colour map: a scan's glass is a white film");
  assert.ok(g.textures.normal, 'its relief kept');
  // painted the tint (linear 1, 0.5, 0 as sRGB), as its own colour
  assert.deepEqual(g.colors.slice(0, 4), [255, Math.round(Math.pow(0.5, 1 / 2.2) * 255), 0, 255]);
  assert.equal(p.material, 'glass');
  assert.equal(p.alpha, 0.35, 'see-through');
  assert.equal(build({ opacity: 0.6, material: 'ice' }).alpha, 0.6, 'unless the part says otherwise');
  assert.equal(build({ opacity: 0.6, material: 'ice' }).material, 'ice');
  // a part with anything else in it stays solid
  const mixed = LK3D.build({
    models: { m: { data: texturedGlb({ mat: glass }) } },
    parts: [
      {
        id: 'p',
        shapes: [
          { model: 'm', node: 'Square' },
          { sphere: 0.2, at: [5, 0, 0] },
        ],
      },
    ],
  }).parts[0];
  assert.equal(mixed.alpha, 1);
  assert.equal(mixed.material, 'paint');
  // an opaque textured model painted by its shape: the colour in place of the base colour map, the normal map kept
  const painted = LK3D.build({
    models: { m: { data: texturedGlb() } },
    parts: [{ id: 'p', shapes: [{ model: 'm', node: 'Square', color: '#c8641c' }] }],
  }).parts[0].batches[0].mesh;
  assert.equal(painted.textures.base, null);
  assert.ok(painted.textures.normal);
  assert.deepEqual(painted.colors.slice(0, 4), [0xc8, 0x64, 0x1c, 255]);
  const plain = LK3D.build({
    models: { m: { data: texturedGlb() } },
    parts: [{ id: 'p', shapes: [{ model: 'm', node: 'Square' }] }],
  }).parts[0].batches[0].mesh;
  assert.ok(plain.textures.base, 'the same model unpainted keeps its map (the paint did not reach the cached one)');
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
    const t = (q) => LK3D.build({ parts: [{ id: 'p', shapes: [{ [k]: v }] }] }, q).parts[0].triangleCount;
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
      m.points.map(([x, y]) => [x * 100, y * 100]),
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
    Array.from(
      f.vertices.subarray((i * F.STREAK_POINTS + k) * 2 * F.STRIDE, (i * F.STREAK_POINTS + k) * 2 * F.STRIDE + 9),
    );
  const f = F.makeFlow({
    path: [
      [0, 0, 0],
      [10, 0, 0],
    ],
    count: 50,
    length: 0.1,
  });
  f.update(null);
  assert.equal(f.drawnCount, 50);
  for (let i = 0; i < f.drawnCount; i++) {
    const head = pt(f, i, 0),
      tail = pt(f, i, F.STREAK_POINTS - 1);
    assert.ok(head[1] === 0 && head[2] === 0 && head[0] >= 0 && head[0] <= 10, 'on the path (no spread)');
    assert.ok(head[0] - tail[0] <= 1 + 1e-6 && head[0] >= tail[0], 'the tail a tenth of the path behind the head');
    assert.ok(Math.abs(head[7] - head[0] / 10) < 1e-6, 'ramp position: how far along the path');
    assert.ok(head[8] >= tail[8] && tail[8] === 0, 'fading towards the tail');
    assert.equal(head[3], -1);
    assert.equal(
      pt(f, i, 0)[3] + Array.from(f.vertices.subarray((i * F.STREAK_POINTS * 2 + 1) * F.STRIDE))[3],
      0,
      'two sides',
    );
  }
  f.amount = 0.3;
  f.update(null);
  assert.equal(f.drawnCount, 15, 'amount: the share of streaks drawn');
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
  const drawn = (x) => Array.from(x.vertices.subarray(0, x.drawnCount * F.STREAK_POINTS * 2 * F.STRIDE));
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
  assert.equal(F.flowIndices(2).length, 2 * (F.STREAK_POINTS - 1) * 6);
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
    extras: { note: "a page's own data" },
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
    [{ parts: [part()], models: { m: { data: '', url: 'javascript:alert(1)' } } }, 'models.m.url'], // a link that is not a web address
    [{ parts: [part()], author: 'A', url: 'javascript:alert(1)' }, 'url'], // the figure's own, likewise
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

test('guided steps: what each names exists and can be shown, one id each, a cut only where the scene has one', () => {
  const { validate } = require('../src/validate.js');
  const scene = (steps, o = {}) => ({
    parts: [
      { id: 'case', name: 'Case', group: 'shell', shapes: [{ box: [1, 1, 1] }] },
      { id: 'core', name: 'Core', shapes: [{ sphere: 0.3 }] },
      { id: 'pin', name: 'Pin', label: false, shapes: [{ sphere: 0.1 }], at: [0, 0.6, 0] },
    ],
    motions: [{ id: 'lift', range: [0, 1], tracks: [{ parts: ['core'], move: [[1, [0, 1, 0]]] }] }],
    steps,
    ...o,
  });
  const good = scene([
    { id: 'whole', title: 'The whole', text: 'The <b>case</b> and what it holds.', view: 'home' },
    {
      id: 'inside',
      text: 'Inside.',
      view: { yaw: 30, pitch: 10, zoom: 2 },
      focus: ['core'],
      explode: 1,
      cut: 0.5,
      section: { normal: [1, 0, 0], offset: 0 },
      xray: true,
      labels: ['core'],
      hide: ['shell'],
      select: 'core',
      motion: { lift: 0.5 },
      play: ['lift'],
    },
    { title: 'All', labels: 'all', view: 'iso' },
  ]);
  assert.deepEqual(validate(good), []);
  const at = (steps, o) => validate(scene(steps, o)).map((e) => e.path),
    cases = [
      [[], 'steps'], // none: leave steps out instead
      [[{ view: 'top' }], 'steps[0]'], // no words
      [[{ title: '' }], 'steps[0].title'],
      [[{ title: 'a', zoom: 2 }], 'steps[0].zoom'], // a field steps do not have (zoom goes in view)
      [[{ title: 'a', view: 'back' }], 'steps[0].view'],
      [[{ title: 'a', view: { zoom: 0 } }], 'steps[0].view.zoom'],
      [[{ title: 'a', explode: 2 }], 'steps[0].explode'],
      [[{ title: 'a', cut: 1.5 }], 'steps[0].cut'],
      [[{ title: 'a', labels: 'some' }], 'steps[0].labels'],
      [[{ title: 'a' }, { id: 'x', title: 'b' }, { id: 'x', title: 'c' }], 'steps[2].id'], // one id, two steps
      [[{ title: 'a', focus: ['lid'] }], 'steps[0].focus'], // no such part or group
      [[{ title: 'a', hide: ['lid'] }], 'steps[0].hide'],
      [[{ title: 'a', labels: ['lid'] }], 'steps[0].labels'],
      [[{ title: 'a', labels: ['pin'] }], 'steps[0].labels'], // a part without a label
      [[{ title: 'a', select: 'shell' }], 'steps[0].select'], // a group, not a part
      [[{ title: 'a', select: 'case', hide: ['shell'] }], 'steps[0].select'], // chosen, and hidden by its group
      [[{ title: 'a', labels: ['core'], hide: ['core'] }], 'steps[0].labels'], // labelled, and hidden
      [[{ title: 'a', focus: ['core'], view: 'home' }], 'steps[0].focus'], // home has its own target
      [[{ title: 'a', motion: { spin: 1 } }], 'steps[0].motion.spin'], // no such motion
      [[{ title: 'a', motion: { lift: 2 } }], 'steps[0].motion.lift'], // outside its range
      [[{ title: 'a', play: ['spin'] }], 'steps[0].play'],
    ];
  for (const [steps, path] of cases)
    assert.ok(at(steps).includes(path), `${JSON.stringify(steps).slice(0, 90)} → ${JSON.stringify(at(steps))}`);
  assert.ok(at([{ title: 'a', cut: true }], { section: false }).includes('steps[0].cut')); // no cut offered
  // the scene's TypeScript types know steps (scene.d.ts, generated from the schema)
  const fs = require('node:fs'),
    path = require('node:path');
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'scene.d.ts'), 'utf8'), /steps\?: Step\[\];/);
});

test('a scene too big to draw is refused in plain words, by the validator and before anything is built', () => {
  const { validate } = require('../src/validate.js');
  const part = (o = {}) => ({ id: 'a', shapes: [{ sphere: 1 }], ...o }),
    one = (shape) => ({ parts: [part({ shapes: [shape] })] }),
    says = (scene, path, words) => {
      const e = validate(scene).find((x) => x.path === path);
      assert.ok(e, `${JSON.stringify(scene).slice(0, 100)} → ${JSON.stringify(validate(scene))}`);
      assert.match(e.message, words);
    };
  // each count past its bound (bounds well above anything a scene uses: seg 72, repeat 42, scatter 120 at most)
  says(one({ sphere: 1, seg: 1e8 }), 'parts[0].shapes[0].seg', /at most 512/);
  says(one({ box: [1, 1, 1], repeat: 1e6 }), 'parts[0].shapes[0].repeat', /repeat is a number of copies/);
  says(one({ box: [1, 1, 1], repeat: { n: 1e6 } }), 'parts[0].shapes[0].repeat.n', /at most 1000/);
  says(one({ scatter: { shape: { sphere: 0.1 }, n: 1e7 } }), 'parts[0].shapes[0].scatter.n', /at most 10000/);
  says(one({ helix: { r: 1, turns: 1e6 } }), 'parts[0].shapes[0].helix.turns', /at most 1000/);
  says(one({ loop: { turns: 1e6 } }), 'parts[0].shapes[0].loop.turns', /at most 1000/);
  says(one({ terrain: { res: 1e5 } }), 'parts[0].shapes[0].terrain.res', /at most 512/);
  says(one({ tree: { levels: 30 } }), 'parts[0].shapes[0].tree.levels', /at most 8/);
  says(one({ dna: { pairs: 1e6 } }), 'parts[0].shapes[0].dna.pairs', /at most 2000/);
  says(one({ sphere: 1, detail: 1e4 }), 'parts[0].shapes[0].detail', /at most 8/);
  says({ parts: [part()], view: { fov: 400 } }, 'view.fov', /at most 120/);
  // counts each within its bound that multiply past the limit: refused before building, at once
  const big = one({ scatter: { n: 10000, shape: { sphere: 1, seg: 512, repeat: 1000 }, detail: 8 } });
  assert.deepEqual(validate(big), []);
  const t0 = Date.now();
  assert.throws(
    () => LK3D.build(big, 1),
    /^Error: lk3d: part a would have at least \d+ triangles; the limit is 2 million$/,
  );
  assert.throws(() => LK3D.build(one({ tree: { levels: 8, branches: 8 } }), 1), /the limit is 2 million/);
  // many parts, each within the limit, too many in all
  const many = {
    parts: Array.from({ length: 12 }, (_, k) => part({ id: 'p' + k, shapes: [{ sphere: 1, seg: 512, repeat: 7 }] })),
  };
  assert.throws(() => LK3D.build(many, 1), /the scene would have at least \d+ triangles; .*10 million in all/);
  assert.ok(Date.now() - t0 < 1000, 'refused before building, not after');
  // the estimate is no more than what is built: a scene at its bounds that fits is still drawn
  const fits = one({ sphere: 1, seg: 512 });
  assert.ok(LK3D.build(fits, 1).parts[0].triangleCount > 0);
});

test('an axis has a direction, a handle a range from small to large with its first value inside', () => {
  const { validate } = require('../src/validate.js');
  const part = (o = {}) => ({ id: 'a', shapes: [{ sphere: 1 }], ...o }),
    says = (scene, path, words) => {
      const e = validate(scene).find((x) => x.path === path);
      assert.ok(e, `${JSON.stringify(scene).slice(0, 100)} → ${JSON.stringify(validate(scene))}`);
      assert.match(e.message, words);
    },
    O = [0, 0, 0];
  says({ parts: [part({ handle: { turn: { axis: O } } })] }, 'parts[0].handle.turn.axis', /no direction/);
  says(
    { parts: [part({ handle: { slide: { axis: O }, min: 0, max: 1 } })] },
    'parts[0].handle.slide.axis',
    /no direction/,
  );
  says(
    { parts: [part()], joints: [{ id: 'j', parts: ['a'], turn: { axis: O } }] },
    'joints[0].turn.axis',
    /no direction/,
  );
  says(
    { parts: [part()], joints: [{ id: 'j', parts: ['a'], slide: { axis: O } }] },
    'joints[0].slide.axis',
    /no direction/,
  );
  says({ parts: [part()], section: { normal: O } }, 'section.normal', /no direction/);
  says(
    {
      parts: [part()],
      motions: [
        {
          id: 'm',
          range: [0, 1],
          tracks: [
            {
              parts: ['a'],
              turn: {
                axis: O,
                keys: [
                  [0, 0],
                  [1, 90],
                ],
              },
            },
          ],
        },
      ],
    },
    'motions[0].tracks[0].turn.axis',
    /no direction/,
  );
  says(
    { parts: [part({ handle: { slide: { axis: [1, 0, 0] }, min: 1, max: 0 } })] },
    'parts[0].handle',
    /min \(1\) is more than its max \(0\)/,
  );
  says(
    { parts: [part({ handle: { slide: { axis: [1, 0, 0] }, min: 0, max: 1, value: 2 } })] },
    'parts[0].handle.value',
    /2 is outside its range \[0, 1\]/,
  );
  says(
    { parts: [part({ handle: { turn: { axis: [0, 1, 0] }, min: 0, value: -10 } })] },
    'parts[0].handle.value',
    /outside its range \[0, …\]/,
  );
  // right ones pass: an axis of any length but 0, a value at an end, a turn with no stops
  for (const h of [
    { turn: { axis: [0, 0, 2] } },
    { slide: { axis: [1e-3, 0, 0] }, min: 0, max: 1, value: 1 },
    { turn: { axis: [0, 1, 0] }, value: 720 },
  ])
    assert.deepEqual(validate({ parts: [part({ handle: h })] }), [], JSON.stringify(h));
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

test('the clock: animation time can be slowed, stopped, stepped and set', () => {
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
  clock.set(5000); // (but set to a time, it may go back: a video seeking its timeline)
  assert.equal(clock.now(), 5000);
  clock.set(1200);
  assert.equal(clock.now(), 1200);
  clock.step(-200);
  assert.equal(clock.now(), 1000);
  clock.speed = 1;
});

test('edges: where faces meet at an angle and where a surface ends, never across a smooth surface or a soft shape', () => {
  const { edgesOf } = require('../src/geometry.js');
  const one = (shape, o = {}) => {
    const b = LK3D.build({ parts: [{ id: 'p', shapes: [shape], ...o }] }, 1).parts[0].batches[0];
    return b.drawsEdges ? edgesOf(b.mesh, 40, b.soft).length / 9 : 0;
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
  const E = edgesOf(b.mesh); // (each segment: two ends, then the mean normal of its two faces)
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
  assert.equal(one({ molecule: { atoms: [{ el: 'O', at: [0, 0, 0] }] } }), 0);
  assert.equal(one({ box: [1, 1, 1] }, { edges: false }), 0);
  // a soft shape merged with a hard one: only the hard one's edges
  const m = LK3D.build({ parts: [{ id: 'p', shapes: [{ box: [1, 1, 1] }, { blob: { r: 0.4 }, at: [2, 0, 0] }] }] }, 1)
    .parts[0].batches[0];
  assert.equal(edgesOf(m.mesh, 40, m.soft).length / 9, 12);
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
  assert.equal(T.pointCount, 3);
  assert.ok(
    Math.abs(T.pointTable[7] - 1) < 1e-6 &&
      Math.abs(T.pointTable[11] - (1 + Math.hypot(1, 0.25))) < 1e-6 &&
      Math.abs(T.total - (1 + Math.hypot(1, 0.25))) < 1e-6,
  );
  // the radius: inner and outer, interpolated between the stops
  assert.deepEqual(radiusAt(T.radii, 0), [0.1, 0.25]);
  assert.deepEqual(
    radiusAt(T.radii, 0.5).map((v) => +v.toFixed(6)),
    [0.125, 0.35],
  );
  assert.deepEqual(radiusAt(T.radii, 1), [0.15, 0.45]);
  // the hull: every vertex at least the outer radius from the path (a quarter more), its faces pointing out
  const P = T.hull.positions,
    I = T.hull.indices;
  const toPath = (q) => {
    let best = Infinity;
    for (let k = 0; k + 1 < T.pointCount; k++) {
      const a = [T.pointTable[4 * k], T.pointTable[4 * k + 1], T.pointTable[4 * k + 2]],
        b = [T.pointTable[4 * k + 4], T.pointTable[4 * k + 5], T.pointTable[4 * k + 6]],
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
  const { makeStream, TABLE_SAMPLES } = require('../src/stream.js');
  const tau = (T) => Array.from({ length: TABLE_SAMPLES }, (_, k) => T.table[3 * k + 2]),
    rate = (t, k) => (t[k + 1] - t[k]) / (1 / (TABLE_SAMPLES - 1)); // the travel time per unit of f: the length / the speed there
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
  for (let k = 0; k + 1 < TABLE_SAMPLES; k++)
    assert.ok(t[k + 1] > t[k], 'travel time grows along the path: the air never runs back');
  assert.ok(
    Math.abs(rate(t, 0) / rate(t, TABLE_SAMPLES - 2) - 4) < 0.3,
    `speed ratio ${(rate(t, 0) / rate(t, TABLE_SAMPLES - 2)).toFixed(2)}`,
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
  const mid = Math.round(0.4 * (TABLE_SAMPLES - 1));
  assert.ok(
    Math.abs(M.table[3 * mid] - 0.2) < 0.02 && Math.abs(M.table[3 * mid + 1] - 0.3) < 0.02,
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
  assert.ok(Math.abs(rate(s, 0) / rate(s, TABLE_SAMPLES - 2) - 2) < 0.15);
  // the pattern's position is tau - phase: as phase grows, every point of the pattern moves downstream
  S.speed = 1;
  S.step(0.5);
  assert.ok(Math.abs(S.phase - 0.5) < 1e-9);
});

test('the scene schema describes every kind of shape field by field, and closes each', () => {
  const { schema } = require('../src/validate.js'),
    G = require('../src/geometry.js'),
    d = schema.$defs;
  assert.equal(d.shape.additionalProperties, false, 'a shape takes only the fields listed');
  for (const kind of [...Object.keys(G.SHAPES), 'scatter']) {
    const s = d.shape.properties[kind];
    assert.ok(s, `${kind} has an entry`);
    if (s.type !== 'object') continue; // (a list or a number: lathe, box, sphere, torus, tube, ellipsoid)
    assert.ok(s.properties && Object.keys(s.properties).length, `${kind} lists its fields`);
    assert.equal(s.additionalProperties, false, `${kind} takes only its own fields`);
  }
  assert.equal(d.shape.properties.model.type, 'string');
});

test('the validator refuses a shape with a field it does not have, or a field of the wrong kind', () => {
  const { validate } = require('../src/validate.js');
  const scene = (shape, more = {}) => ({ parts: [{ id: 'a', shapes: [shape] }], ...more });
  const at = (s) => validate(s).map((e) => e.path);
  const cases = [
    [scene({ helix: { r: 'big' } }), 'parts[0].shapes[0].helix.r'],
    [scene({ capsule: {} }), 'parts[0].shapes[0].capsule'], // no radius
    [scene({ helix: { r: 0.1, radius: 1 } }), 'parts[0].shapes[0].helix.radius'],
    [
      scene({
        lathe: [
          [0, 1],
          [1, 1],
        ],
        segments: 24,
      }),
      'parts[0].shapes[0].segments',
    ],
    [scene({ sphere: 1, colour: '#fff' }), 'parts[0].shapes[0].colour'],
    [scene({ box: [1, 1, 1], repeat: { n: 3, axes: 'y' } }), 'parts[0].shapes[0].repeat.axes'],
    [scene({ orbit: { a: 1, e: 1.2 } }), 'parts[0].shapes[0].orbit.e'],
    [
      scene({ molecule: { atoms: [{ el: 'C', at: [0, 0, 0] }], bonds: [[0, 0, 4]] } }),
      'parts[0].shapes[0].molecule.bonds[0][2]',
    ],
    [scene({ molecule: { atoms: [{ el: 'carbon', at: [0, 0, 0] }] } }), 'parts[0].shapes[0].molecule.atoms[0].el'],
    [scene({ dna: { seq: 'ATXG' } }), 'parts[0].shapes[0].dna.seq'],
    [scene({ scatter: { shape: { sphere: 0.1 }, within: { cube: 1 } } }), 'parts[0].shapes[0].scatter.within'],
    [scene({ terrain: { layers: [{ color: '#888888' }] } }), 'parts[0].shapes[0].terrain.layers[0]'],
    [scene({ sphere: 1 }, { models: { m: { title: 'no .glb' } } }), 'models.m'], // neither data nor file
  ];
  for (const [s, path] of cases)
    assert.ok(at(s).includes(path), `${JSON.stringify(s).slice(0, 90)} → ${JSON.stringify(validate(s))}`);
  // what the engine reads passes: a lathe sector, smooth; a model given as a file; every kind with its fields
  const lathe = {
    lathe: [
      [0, 0.3],
      [1, 0.3],
      [1, 0.4],
      [0, 0.4],
    ],
    from: -30,
    to: 30,
    smooth: true,
    closed: true,
    seg: 24,
  };
  assert.deepEqual(validate(scene(lathe)), []);
  assert.deepEqual(validate(scene({ model: 'm', node: 'n' }, { models: { m: { file: 'm.glb' } } })), []);
  const all = [
    { helix: { r: 0.1, x0: 0, x1: 1, turns: 4, wire: 0.01 } },
    { loop: { a: 0.8, b: 0.1, R: 0.4, wire: 0.02, corner: 0.03, turns: 2, gap: 0.05 } },
    { capsule: { r: 0.1, x0: -0.2, x1: 0.2 } },
    { blob: { r: 0.5, amp: 0.2, freq: 2, seed: 3, stretch: [1, 0.8, 1] } },
    { shell: { r: 1, ri: 0.9, from: 0, to: 270 } },
    { tree: { at: [0, 0, 0], dir: [0, 1, 0], length: 1, r: 0.05, levels: 2, branches: 3, spread: 30 } },
    {
      molecule: {
        atoms: [
          { el: 'O', at: [0, 0, 0] },
          { el: 'H', at: [0.96, 0, 0], r: 0.2, color: '#eeeeee' },
        ],
        bonds: [
          [0, 1],
          [0, 1, 2],
        ],
        scale: 0.5,
        style: 'ball',
        bond: 0.1,
      },
    },
    { dna: { pairs: 10, seq: 'ATGC', r: 1, rise: 0.34, twist: 36, groove: 150, wire: 0.1, scale: 0.5 } },
    {
      extrude: {
        outline: [
          [0, 0],
          [1, 0],
          [0, 1],
        ],
        depth: 0.1,
      },
    },
    {
      terrain: {
        size: [2, 1],
        res: 12,
        base: 0.5,
        height: { amp: 0.1, freq: 2, seed: 4 },
        layers: [{ thick: 0.2, color: '#9a8466' }, { thick: 0.3 }],
        top: '#7a9a55',
        tilt: 5,
      },
    },
    { ring: { r: 1, ri: 0.8, thickness: 0.02 } },
    { orbit: { a: 1, e: 0.2, wire: 0.01 } },
    { blade: { root: 0.2, span: 0.5, chord: 0.15, tip: 0.1, twist: 30, thickness: 0.1, camber: 0.04, sweep: 0.1 } },
    {
      scatter: {
        shape: { sphere: 0.02, seg: 8 },
        n: 20,
        within: { shell: [0.5, 1] },
        avoid: [{ sphere: 0.3, at: [0, 0, 0] }],
        size: [0.5, 1],
        seed: 2,
        detail: 0.5,
      },
    },
  ];
  for (const s of all) assert.deepEqual(validate(scene(s)), [], JSON.stringify(s).slice(0, 60));
});

test('a bond that joins an atom the molecule lacks is reported where it is, before anything is built', async () => {
  const { validate } = await import('../src/validate.js');
  const errs = validate({
    parts: [{ id: 'm', shapes: [{ molecule: { atoms: [{ el: 'C', at: [0, 0, 0] }], bonds: [[0, 5]] } }] }],
  });
  assert.deepEqual(
    errs.map((e) => e.path),
    ['parts[0].shapes[0].molecule.bonds[0]'],
  );
});

test('every built file carries the licence notice at its top (and so does every copy of it)', () => {
  const fs = require('node:fs'),
    path = require('node:path'),
    { version } = require('../package.json');
  for (const f of ['lk3d.min.js', 'lk3d.mjs', 'lk3d-export.min.js']) {
    const p = path.join(__dirname, '..', 'dist', f);
    if (!fs.existsSync(p)) continue; // (not built yet)
    assert.ok(
      fs.readFileSync(p, 'utf8').startsWith(`/*! lk3d ${version} | MIT License | Copyright (c) 2026 xoai */`),
      f,
    );
  }
});

test('every field is one of the format’s: a misspelt one is caught and the nearest name offered', () => {
  const { validate } = require('../src/validate.js');
  const part = (o = {}) => ({ id: 'a', shapes: [{ sphere: 1 }], ...o }),
    says = (scene, path, words) => {
      const e = validate(scene).find((x) => x.path === path);
      assert.ok(e, `${JSON.stringify(scene).slice(0, 100)} → ${JSON.stringify(validate(scene))}`);
      assert.match(e.message, words);
    };
  // planted: a misspelling in each object the format had left open (the scene, the view, a part, a handle and its
  // rule, a spin, a surface, a model, the scale, the cut), each refused at the field itself
  says(
    { parts: [part({ handle: { turn: { axis: [0, 0, 1] }, mine: 0, max: 1 } })] },
    'parts[0].handle.mine',
    /\(min\?\)/,
  );
  says({ parts: [part({ colour: '#fff' })] }, 'parts[0].colour', /\(color\?\)/);
  says({ parts: [part({ explod: [0, 1, 0] })] }, 'parts[0].explod', /\(explode\?\)/);
  says({ parts: [part()], veiw: { yaw: 10 } }, 'veiw', /not a field here/);
  says({ parts: [part()], view: { yaw: 10, zom: 2 } }, 'view.zom', /not a field here/);
  says(
    { parts: [part({ handle: { turn: { axis: [0, 0, 1], centre: [0, 0, 0] } } })] },
    'parts[0].handle.turn.centre',
    /\(center\?\)/,
  );
  says({ parts: [part({ spin: { axis: [0, 1, 0], speed: 2 } })] }, 'parts[0].spin.speed', /not a field here/);
  says({ parts: [part({ surface: { kind: 'knurl', scal: 4 } })] }, 'parts[0].surface.scal', /\(scale\?\)/);
  says({ parts: [part()], models: { m: { file: 'm.glb', licence: 'CC0' } } }, 'models.m.licence', /\(license\?\)/);
  says(
    { parts: [part()], scale: { note: 'n', bar: { length: 1, label: '1 m', unit: 'm' } } },
    'scale.bar.unit',
    /not a field/,
  );
  says({ parts: [part()], section: { normal: [0, 0, 1], ofset: 0 } }, 'section.ofset', /\(offset\?\)/);
  // a shape's field written on its part is said to belong on the shape
  says({ parts: [part({ detail: 2 })] }, 'parts[0].detail', /goes on one of its shapes/);
  // a page's own data has its place, on the scene and on a part, and is not looked into
  assert.deepEqual(
    validate({ parts: [part({ extras: { claim: 'c1', x: [1] } })], extras: { planets: [{ R: 1 }] } }),
    [],
  );
});
