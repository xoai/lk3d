// lk3d/measure: quantities measured on a scene's built geometry, each with its error. On lk3d's own scenes (the five
// molecules, the Solar System's orbits, the Earth's layers) and on planted ones: every round kind within its reported
// error of its exact size, at several turns and details; a gap between two parts at a known distance; a part posed by a
// motion at rest and at a step; what does not exist reported at the measure's name.
//   node --test test/measure.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { measure } = require('../src/measure.js');

const scene = (name) => require(path.join(__dirname, 'visual/scenes', name));
const within = (r, k, want, why = k) =>
  assert.ok(
    Math.abs(r.values[k] - want) <= r.error[k] + 1e-9,
    `${why}: ${r.values[k]} against ${want} (error ${r.error[k]})`,
  );
const ok = (r) => assert.deepEqual(r.problems, []);
const sub = (a, b) => a.map((v, k) => v - b[k]);
const angleAt = (a, v, b) => {
  const u = sub(a, v),
    w = sub(b, v),
    c = (u[0] * w[0] + u[1] * w[1] + u[2] * w[2]) / (Math.hypot(...u) * Math.hypot(...w));
  return (Math.acos(c) * 180) / Math.PI;
};

test('the five molecules: angles and bond lengths as their atoms give them, exactly', () => {
  const s = scene('molecules.json'),
    ids = ['co2', 'bf3', 'ch4', 'nh3', 'h2o'];
  const r = measure(
    s,
    Object.fromEntries(
      ids.flatMap((id) => [
        [`${id}.angle`, { angle: [`${id}.atom[1]`, `${id}.atom[0]`, `${id}.atom[2]`] }],
        [`${id}.bond`, { distance: [`${id}.atom[0]`, `${id}.atom[1]`] }],
      ]),
    ),
  );
  ok(r);
  for (const id of ids) {
    const atoms = s.parts.find((part) => part.id === id).shapes[0].molecule.atoms.map((atom) => atom.at),
      [angle, bond] = [r.values[`${id}.angle`], r.values[`${id}.bond`]];
    assert.ok(Math.abs(angle - angleAt(atoms[1], atoms[0], atoms[2])) < 1e-3, `${id}: angle ${angle}`);
    assert.ok(Math.abs(bond - Math.hypot(...sub(atoms[1], atoms[0]))) < 1e-4, `${id}: bond ${bond}`);
    assert.equal(r.error[`${id}.angle`], 0);
    assert.equal(r.error[`${id}.bond`], 0);
  }
});

test("the Solar System: each orbit's semi-major axis and eccentricity read as drawn", () => {
  const s = scene('solar.json'),
    orbits = s.parts.filter((part) => part.shapes[0].orbit);
  const r = measure(
    s,
    Object.fromEntries(
      orbits.flatMap((part) => [
        [`${part.id}.a`, { read: [part.id, 'shapes', 0, 'orbit', 'a'] }],
        [`${part.id}.e`, { read: [part.id, 'shapes', 0, 'orbit', 'e'] }],
      ]),
    ),
  );
  ok(r);
  for (const part of orbits) {
    assert.equal(r.values[`${part.id}.a`], part.shapes[0].orbit.a);
    assert.equal(r.values[`${part.id}.e`], part.shapes[0].orbit.e);
  }
});

test("the Earth: each layer's thickness read from its shells, and the inner core's radius measured within its error", () => {
  const s = scene('earth.json'),
    shell = (id) => s.parts.find((part) => part.id === id).shapes[0].shell;
  const r = measure(s, {
    outer: { read: ['man-ti', 'shapes', 0, 'shell', 'r'] },
    inner: { read: ['man-ti', 'shapes', 0, 'shell', 'ri'] },
    mantle: { sum: ['outer', '-inner'] },
    core: { size: 'nhan-trong', axis: 'y', half: true }, // (turned 90° about z: its polar axis along y)
  });
  ok(r);
  assert.ok(Math.abs(r.values.mantle - (shell('man-ti').r - shell('man-ti').ri)) < 1e-12);
  within(r, 'core', shell('nhan-trong').r);
  assert.ok(r.error.core > 0 && r.error.core < 0.01 * shell('nhan-trong').r, `a small error: ${r.error.core}`);
});

test('every round kind is within its reported error of its exact size, at several turns and details', () => {
  // each shape's exact extent across its axis of symmetry (x), whatever it is turned by about that axis
  const kinds = [
    ['sphere', { sphere: 1 }, 2],
    ['cylinder', { cylinder: { r: 0.5, x0: -1, x1: 1 } }, 1],
    ['cylinder with seg', { cylinder: { r: 0.5, x0: -1, x1: 1 }, seg: 12 }, 1],
    [
      'lathe',
      {
        lathe: [
          [-1, 0],
          [-1, 0.8],
          [1, 0.4],
          [1, 0],
        ],
      },
      1.6,
    ],
    ['torus', { torus: [1, 0.25] }, 2.5],
    [
      'tube',
      {
        tube: [
          [-1, 0, 0],
          [1, 0, 0],
        ],
        r: 0.3,
      },
      0.6,
    ],
    ['shell', { shell: { r: 1.5, ri: 1 } }, 3],
  ];
  for (const [name, shape, across] of kinds)
    for (const detail of [0.25, 1, 2])
      for (const turn of [0, 7, 17, 45]) {
        const s = {
          title: 't',
          scale: { note: 'n' },
          check: { float: true },
          parts: [{ id: 'p', name: 'p', rot: [turn, 0, 0], shapes: [{ ...shape, detail }] }],
        };
        const r = measure(s, { y: { size: 'p', axis: 'y' }, z: { size: 'p', axis: 'z' } });
        ok(r);
        within(r, 'y', across, `${name}, detail ${detail}, turned ${turn}°: y`);
        within(r, 'z', across, `${name}, detail ${detail}, turned ${turn}°: z`);
        assert.ok(r.error.y < 0.2 * across, `${name}: an error that says something (${r.error.y})`);
      }
});

test('a gap between two spheres, and between two boxes, at a known distance', () => {
  const s = {
    title: 't',
    scale: { note: 'n' },
    check: { float: true },
    parts: [
      { id: 'a', name: 'a', shapes: [{ sphere: 1 }] },
      { id: 'b', name: 'b', at: [3, 0, 0], shapes: [{ sphere: 1 }] },
      { id: 'c', name: 'c', at: [0, 5, 0], rot: [0, 30, 0], shapes: [{ box: [1, 1, 1] }] },
      { id: 'd', name: 'd', at: [0, 6.25, 0], rot: [0, 30, 0], shapes: [{ box: [1, 0.5, 1] }] }, // (faces at 5.5 and 6)
    ],
  };
  const r = measure(s, { spheres: { gap: ['a', 'b'] }, boxes: { gap: ['c', 'd'] } });
  ok(r);
  within(r, 'spheres', 1);
  within(r, 'boxes', 0.5);
  assert.ok(r.error.spheres > 0 && r.error.spheres < 0.01, `spheres: ${r.error.spheres}`);
});

test('a part posed by a motion: at rest (its start) and at a step that takes the model apart', () => {
  const s = {
    title: 't',
    scale: { note: 'n' },
    check: { float: true },
    parts: [
      { id: 'a', name: 'a', shapes: [{ box: [1, 1, 1] }], explode: [0, 3, 0] },
      { id: 'b', name: 'b', at: [4, 0, 0], shapes: [{ box: [1, 1, 1] }] },
    ],
    motions: [
      {
        id: 'slide',
        range: [0, 1],
        value: 1,
        tracks: [
          {
            parts: ['a'],
            move: [
              [0, [0, 0, 0]],
              [1, [-2, 0, 0]],
            ],
          },
        ],
      },
    ],
    steps: [
      { id: 'rest', text: 'at rest' },
      { id: 'apart', text: 'apart', explode: 1, motion: { slide: 0 } },
    ],
  };
  const r = measure(s, {
    rest: { distance: ['a', 'b'] },
    apart: { distance: ['a', 'b'], step: 'apart' },
    second: { distance: ['a', 'b'], step: 2 },
  });
  ok(r);
  within(r, 'rest', 6); // (the motion starts at its value, 1: a slid 2 away from b)
  within(r, 'apart', 5); // (the step: the motion at 0, a 3 up: √(4² + 3²))
  assert.equal(r.values.second, r.values.apart);
});

test("a distance along an axis is the points' distance projected on it, with the same error", () => {
  const s = scene('molecules.json'),
    [o, h] = s.parts.find((part) => part.id === 'h2o').shapes[0].molecule.atoms.map((atom) => atom.at),
    bond = ['h2o.atom[0]', 'h2o.atom[1]'];
  const r = measure(s, {
    straight: { distance: bond },
    x: { distance: bond, along: 'x' },
    y: { distance: bond, along: 'y' },
    z: { distance: bond, along: 'z' },
    box: { distance: ['h2o', 'co2'] },
    boxX: { distance: ['h2o', 'co2'], along: 'x' },
  });
  ok(r);
  for (const [k, axis] of [
    ['x', 0],
    ['y', 1],
    ['z', 2],
  ]) {
    within(r, k, Math.abs(o[axis] - h[axis]));
    assert.equal(r.error[k], r.error.straight);
  }
  assert.ok(Math.abs(Math.hypot(r.values.x, r.values.y, r.values.z) - r.values.straight) < 1e-9);
  assert.ok(r.values.boxX <= r.values.box + 1e-9);
  assert.equal(r.error.boxX, r.error.box);
});

test('a distance along anything but x, y or z is refused at its name', () => {
  const s = scene('molecules.json'),
    bond = ['h2o.atom[0]', 'h2o.atom[1]'];
  const r = measure(s, {
    good: { distance: bond, along: 'y' },
    w: { distance: bond, along: 'w' },
    xy: { distance: bond, along: 'xy' },
    empty: { distance: bond, along: '' },
    number: { distance: bond, along: 0 },
    none: { distance: bond, along: null },
  });
  assert.ok(Number.isFinite(r.values.good));
  const said = Object.fromEntries(r.problems.map((p) => [p.path, p.message]));
  for (const name of ['w', 'xy', 'empty', 'number', 'none'])
    assert.equal(said[name], 'distance.along: x, y or z', name);
});

test('what does not exist, or is not a measure, is reported at its name; the others are still measured', () => {
  const s = scene('molecules.json');
  const r = measure(s, {
    good: { distance: ['h2o.atom[0]', 'h2o.atom[1]'] },
    atom: { distance: ['h2o.atom[0]', 'h2o.atom[3]'] },
    group: { size: 'nothing', axis: 'x' },
    axis: { size: 'h2o', axis: 'w' },
    shape: { angle: ['bf3.shapes[9].atom[0]', 'h2o.atom[0]', 'h2o.atom[1]'] },
    loop: { sum: ['loop'] },
    mixed: { sum: ['good', 'n'] },
    n: { count: 'h2o' },
    step: { distance: ['h2o', 'co2'], step: 'nowhere' },
    kind: { volume: 'h2o' },
  });
  assert.ok(Math.abs(r.values.good - 0.96) < 1e-3, `O–H ${r.values.good}`); // (H at [0.7591, -0.5877, 0])
  assert.equal(r.values.n, 1);
  const said = Object.fromEntries(r.problems.map((p) => [p.path, p.message]));
  for (const name of ['atom', 'group', 'axis', 'shape', 'loop', 'mixed', 'step', 'kind'])
    assert.ok(said[name], `${name} reported: ${JSON.stringify(r.problems)}`);
  assert.match(said.atom, /atom 3/);
  assert.match(said.mixed, /length|count/);
});

test('a gap is not lost to an edge tested after a nearer vertex elsewhere (crossed beams 0.1 apart, two decoys)', () => {
  // two beams turned 45° about their length, so their nearest features are two edges crossing 0.1 apart; a small box on
  // each, listed first and about 2.5 from the other beam, is tested first and must not hide the edges' 0.1
  const h = 0.5 / Math.SQRT2; // (half the diagonal of the beams' 0.5 square)
  const r = measure(
    {
      parts: [
        {
          id: 'a',
          at: [0, h + 0.1, 0],
          shapes: [
            { box: [0.3, 0.3, 0.3], at: [3, -h - 0.5, 2.5] },
            { box: [10, 0.5, 0.5], rot: [45, 0, 0] },
          ],
        },
        {
          id: 'b',
          at: [0, -h, 0],
          shapes: [
            { box: [0.3, 0.3, 0.3], at: [-2.5, 2 * h + 0.5, -3] },
            { box: [0.5, 0.5, 10], rot: [0, 0, 45] },
          ],
        },
      ],
    },
    { gap: { gap: ['a', 'b'] } },
  );
  ok(r);
  within(r, 'gap', 0.1);
});

test('a measure may be called constructor or toString', () => {
  const r = measure(scene('molecules.json'), { constructor: { count: 'h2o' }, toString: { count: 'co2' } });
  ok(r);
  assert.equal(r.values.constructor, 1);
  assert.equal(r.values.toString, 1);
});

test('expect size is measured as measure measures it: a ten-sided cylinder is 2 across, as its error allows', () => {
  const { lint } = require('../src/lint.js');
  const s = {
    title: 't',
    scale: { note: 'n' },
    check: { float: true },
    parts: [{ id: 'c', name: 'c', shapes: [{ cylinder: { r: 1 }, seg: 10 }] }],
    expect: [{ size: 'c', axis: 'z', is: [1.95, 2.05] }],
  };
  assert.deepEqual(lint(s).problems, []);
  s.expect[0].is = [2.5, 3];
  assert.match(
    lint(s)
      .problems.map((p) => p.message)
      .join('\n'),
    /c is 2 along z, not 2\.5 to 3/,
  );
});
