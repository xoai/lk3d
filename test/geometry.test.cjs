// Shapes at their awkward inputs: each makes a closed solid with no NaN, or nothing at all, never garbage. Frames carried
// round right-angle bends, sectors given backwards, atoms on top of each other, repeated points.          npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildShape, isClosed } = require('../src/geometry.js');
const { makeStream } = require('../src/stream.js');
const { pathOf } = require('../src/flow.js');

const finite = (g) => Array.from(g.positions).every(Number.isFinite);

test('shapes at awkward inputs: closed, no NaN', () => {
  const cases = {
    'terrain with layers': { terrain: { res: 8, layers: [{ thick: 0.2, color: '#a00' }, { color: '#0a0' }], tilt: 4 } },
    'a sector given backwards': {
      lathe: [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ],
      from: 90,
      to: -90,
    },
    'two atoms at one place': {
      molecule: {
        atoms: [
          { el: 'C', at: [0, 0, 0] },
          { el: 'O', at: [0, 0, 0] },
        ],
        bonds: [[0, 1]],
      },
    },
  };
  for (const [name, s] of Object.entries(cases)) {
    const g = buildShape(s, 1).mesh;
    assert.ok(finite(g), name + ': no NaN');
    assert.ok(isClosed(g), name + ': closed');
  }
});

test('a tube round a hairpin and over repeated points keeps its width', () => {
  for (const path of [
    [
      [0, 0, 0],
      [0, 1, 0],
      [0, 0, 0.01],
    ],
    [
      [0, 0, 0],
      [0, 0, 0],
      [1, 0, 0],
      [1, 1, 0],
    ],
  ]) {
    const g = buildShape({ tube: path, r: 0.05 }, 1).mesh;
    assert.ok(finite(g), JSON.stringify(path));
    // every normal is a unit vector: no ring collapsed to a point
    for (let k = 0; k < g.normals.length; k += 3)
      assert.ok(Math.abs(Math.hypot(g.normals[k], g.normals[k + 1], g.normals[k + 2]) - 1) < 1e-3);
  }
});

test('a stream keeps its width round right-angle bends, U-turns and a path doubling back', () => {
  const r = 0.1;
  for (const path of [
    [
      [0, 0, 0],
      [1, 0, 0],
      [1, 0, 1],
    ],
    [
      [0, 0, 0],
      [1, 0, 0],
      [1, 0, 1],
      [0, 0, 1],
    ],
    [
      [0, 0, 0],
      [0, 1, 0],
      [0, 1, 1],
    ],
    [
      [0, 0, 0],
      [1, 0, 0],
      [0, 0, 0],
    ],
  ]) {
    const T = makeStream({ path, radius: r }),
      P = T.hull.positions;
    assert.ok(Array.from(P).every(Number.isFinite), JSON.stringify(path));
    // each ring's points: as far from the ring's middle as the hull is wide (none collapsed onto the path)
    const ring = 14;
    for (let s = 0; s + ring <= P.length / 3 - 2; s += ring) {
      const c = [0, 1, 2].map((a) => {
        let v = 0;
        for (let j = 0; j < ring; j++) v += P[3 * (s + j) + a];
        return v / ring;
      });
      for (let j = 0; j < ring; j++) {
        const d = Math.hypot(...[0, 1, 2].map((a) => P[3 * (s + j) + a] - c[a]));
        assert.ok(d > r, `${JSON.stringify(path)}: a ring of radius ${d.toFixed(3)}`);
      }
    }
  }
  assert.throws(() => makeStream({ path: Array.from({ length: 17 }, (_, k) => [k, 0, 0]) }), /at most 16/);
});

test('a point along a long path is found by halving, as by walking', () => {
  const pts = Array.from({ length: 300 }, (_, k) => [k * 0.1, Math.sin(k * 0.3), 0]),
    P = pathOf(pts);
  const walk = (s) => {
    let t = 0;
    for (let k = 0; k + 1 < pts.length; k++) {
      const a = pts[k],
        b = pts[k + 1],
        l = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      if (s <= t + l || k + 2 === pts.length) {
        const u = Math.max(0, Math.min(1, (s - t) / l));
        return a.map((v, i) => v + (b[i] - v) * u);
      }
      t += l;
    }
  };
  for (let s = -1; s < P.total + 1; s += P.total / 97) {
    const a = P.at(s),
      b = walk(s);
    assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 1e-9, `s = ${s}`);
  }
});

test('a tree is the same tree at every detail: a phone or the 2D fallback (built coarser) shows the dendrites a laptop does', () => {
  const { bounds } = require('../src/geometry.js');
  const s = {
    tree: { at: [0, 0, 0], dir: [1, 0.2, 0], length: 1, r: 0.05, levels: 4, branches: 2, spread: 40, seed: 7 },
  };
  const box = (q) => bounds(buildShape(s, q).mesh);
  const fine = box(1);
  for (const q of [0.6, 0.5]) {
    const b = box(q);
    // (coarser: fewer points along the same branches, and fewer round each, so a little inside; not another tree)
    for (let i = 0; i < 3; i++) {
      assert.ok(Math.abs(b.min[i] - fine.min[i]) < 0.03, `detail ${q}: low end along axis ${i}`);
      assert.ok(Math.abs(b.max[i] - fine.max[i]) < 0.03, `detail ${q}: high end along axis ${i}`);
    }
  }
  assert.ok(buildShape(s, 0.5).mesh.count < buildShape(s, 1).mesh.count, 'and coarser it costs less');
});

test("flow streaks placed on the GPU are where flow.js places them: the shader's arithmetic, from gpuData's numbers", () => {
  const { makeFlow, gpuData, STRIDE, STREAK_POINTS } = require('../src/flow.js');
  // the vertex shader's point() (shaders.js FLOW_VS, GPU), step for step, reading the texture and the instance numbers
  const fetch = (data, column, row) =>
    data.table.subarray((row * data.width + column) * 4, (row * data.width + column) * 4 + 4);
  const mod = (x, y) => x - y * Math.floor(x / y);
  const at = (data, row, n, d) => {
    let lo = 1,
      hi = n;
    while (lo < hi) {
      const m = (lo + hi + 1) >> 1;
      if (fetch(data, m, row)[3] <= d) lo = m;
      else hi = m - 1;
    }
    const a = fetch(data, lo, row),
      b = fetch(data, Math.min(lo + 1, n), row),
      t = b[3] > a[3] ? Math.max(0, Math.min(1, (d - a[3]) / (b[3] - a[3]))) : 0;
    return [0, 1, 2].map((j) => a[j] + (b[j] - a[j]) * t);
  };
  const point = (data, flow, i, k, m) => {
    const seed = data.seeds.subarray(i * 12, i * 12 + 12),
      row = seed[0],
      info = fetch(data, 0, row),
      L = info[1];
    let d = mod(seed[1] * L + flow.travelled * seed[2], Math.max(L, 1e-9)) - (flow.length * L * k) / 3;
    d = flow.closed ? mod(d, Math.max(L, 1e-9)) : Math.max(d, 0);
    const along = L > 0 ? d / L : 0,
      wave = Math.sin(seed[3] + 6.2832 * seed[7] * along),
      p = at(data, row, info[0], d).map((value, j) => value + (seed[4 + j] + seed[8 + j] * wave) * flow.spread);
    return [0, 1, 2].map((j) => m[j] * p[0] + m[4 + j] * p[1] + m[8 + j] * p[2] + m[12 + j]).concat(along);
  };
  const m = [0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0.5, 0.2, -0.3, 1]; // (turned and moved: a part carrying the flow)
  for (const closed of [false, true]) {
    const flow = makeFlow({
      paths: [
        [
          [-2, 0.5, 0.2],
          [-1, 0.5, 0.2],
          [0.3, 0.45, 0.25],
          [1.6, 0.4, 0.2],
        ],
        [
          [-2, -0.4, 0],
          [0, -0.6, 0.1],
          [2, -0.3, 0],
        ],
      ],
      closed,
      count: 60,
      spread: 0.08,
      length: 0.15,
    });
    flow.travelled = 3.7;
    flow.update(m);
    const data = gpuData(flow);
    let worst = 0;
    for (let i = 0; i < flow.drawnCount; i++)
      for (let k = 0; k < STREAK_POINTS; k++) {
        const here = point(data, flow, i, k, m),
          behind = point(data, flow, i, Math.max(0, k - 1), m),
          ahead = point(data, flow, i, Math.min(3, k + 1), m),
          ends = closed ? 1 : Math.max(0, Math.min(1, Math.min(here[3], 1 - here[3]) / 0.06)),
          vertex = (i * STREAK_POINTS + k) * 2 * STRIDE,
          cpu = flow.vertices.subarray(vertex, vertex + STRIDE),
          gpu = [...here.slice(0, 3), -1, ...[0, 1, 2].map((j) => behind[j] - ahead[j]), here[3], (1 - k / 3) * ends];
        for (let j = 0; j < STRIDE; j++) worst = Math.max(worst, Math.abs(cpu[j] - gpu[j]));
      }
    assert.ok(worst < 1e-4, `closed ${closed}: the GPU's placing is off by ${worst}`);
  }
});
