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
