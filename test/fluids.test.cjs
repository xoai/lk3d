// The laws of liquids and gases (fluids.js), each against its closed form: a vessel's volume and level by its shape,
// liquids stacking by density, Torricelli's draining, a falling stream, the ideal gas under a piston, a buoyant
// plume.          npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../src/fluids.js');

const near = (a, b, rel = 1e-9) => Math.abs(a - b) <= rel * Math.max(1, Math.abs(b));
const cylinder = (r, h) => [
  [0, r],
  [h, r],
];

test('volume and level follow the vessel: a cylinder, a cone, and back again', () => {
  assert.ok(near(F.volumeBelow(cylinder(2, 10), 5), Math.PI * 4 * 5));
  // a cone, point down (a funnel): a third of its cylinder, and its level grows as the cube root of its volume
  const cone = [
    [0, 0],
    [3, 1.5],
  ];
  assert.ok(near(F.volumeBelow(cone, 3), (Math.PI * 1.5 ** 2 * 3) / 3));
  assert.ok(near(F.volumeBelow(cone, 1.5), F.volumeBelow(cone, 3) / 8));
  for (const v of [0.1, 1, 5, 7])
    assert.ok(near(F.volumeBelow(cone, F.heightOf(cone, v)), v, 1e-9), 'heightOf inverts volumeBelow');
  assert.equal(F.heightOf(cone, 1e9), 3); // (full: at the brim)
  assert.equal(F.heightOf(cone, -1), 0);
});

test('liquids in one vessel settle with the densest at the bottom', () => {
  const s = F.stack(cylinder(1, 10), [
    { id: 'oil', volume: Math.PI * 2, density: 0.9 },
    { id: 'water', volume: Math.PI * 3, density: 1 },
  ]);
  assert.deepEqual(
    s.map((x) => [x.liquid.id, +x.bottom.toFixed(9), +x.top.toFixed(9)]),
    [
      ['water', 0, 3],
      ['oil', 3, 5],
    ],
  );
});

test('Torricelli: a cylinder drains in (R/a)² · √(2H/g) / cd, its level falling ever slower', () => {
  const R = 0.05, // m
    a = 0.002,
    H = 0.3,
    cd = 0.6,
    inside = cylinder(R, 1);
  let v = F.volumeBelow(inside, H),
    t = 0;
  const dt = 1e-3,
    levels = [];
  while (v > 1e-12) {
    // (midpoint steps)
    const h = F.heightOf(inside, v),
      k1 = F.outflow(a, h, F.G, cd),
      k2 = F.outflow(a, F.heightOf(inside, v - (k1 * dt) / 2), F.G, cd);
    v -= k2 * dt;
    t += dt;
    if (Math.abs(t - Math.round(t)) < dt / 2) levels.push(h);
  }
  const exact = ((R / a) ** 2 * Math.sqrt((2 * H) / F.G)) / cd;
  assert.ok(Math.abs(t - exact) / exact < 0.01, `drained in ${t.toFixed(2)} s, the law says ${exact.toFixed(2)} s`);
  // the level falls by less each second than the second before (the flow slows with the head)
  for (let k = 2; k < levels.length; k++) assert.ok(levels[k - 2] - levels[k - 1] > levels[k - 1] - levels[k]);
});

test('a falling stream: it ends where it lands, and narrows as it speeds up (r² × speed stays the same)', () => {
  const p = [0, 1, 0],
    v = [0, -0.5, 0],
    pts = F.jet(p, v, 0.002, F.G, 0.2);
  const last = pts[pts.length - 1];
  assert.ok(near(last[1], 0.2, 1e-9));
  for (const q of pts) {
    const speed = Math.sqrt(0.25 + 2 * F.G * (1 - q[1])); // (energy: v² = v0² + 2g·drop)
    assert.ok(near(q[3] ** 2 * speed, 0.002 ** 2 * 0.5, 1e-9));
  }
  // thrown sideways (a hole in a tank's side): a parabola
  const side = F.jet([0, 1, 0], [1, 0, 0], 0.002, F.G, 0);
  const tEnd = Math.sqrt(2 / F.G);
  assert.ok(near(side[side.length - 1][0], tEnd, 1e-9));
});

test("the ideal gas under a piston: pV = nRT, the piston's weight adding to the pressure", () => {
  // one mole at 273.15 K and 101 325 Pa: 22.4 litres, in a cylinder of radius 10 cm (scene units: cm)
  const inside = cylinder(10, 200),
    h = F.pistonHeight(inside, 1, 273.15, 101325, 0, 100),
    V = (F.RGAS * 273.15) / 101325; // m³
  assert.ok(near(h, (V * 1e6) / (Math.PI * 100), 1e-9), `${h} cm`);
  // a 10 kg piston on 0.0314 m²: about 3 kPa more, so about 3 % lower
  const hw = F.pistonHeight(inside, 1, 273.15, 101325, 10, 100),
    p = 101325 + (10 * F.G) / (Math.PI * 0.1 ** 2);
  assert.ok(near(hw, (((F.RGAS * 273.15) / p) * 1e6) / (Math.PI * 100), 1e-6));
  // twice as hot, twice as high
  assert.ok(near(F.pistonHeight(inside, 1, 546.3, 101325, 0, 100), 2 * h, 1e-9));
});

test('a buoyant plume widens at 0.12 a unit of height and slows as height^(−1/3)', () => {
  const s = F.plume([0, 0, 0], 2, 0.1);
  assert.deepEqual(s.path, [
    [0, 0, 0],
    [0, 2, 0],
  ]);
  assert.ok(near(s.radius[3][1], 0.1 + 0.24));
  const z0 = 0.1 / 0.12;
  assert.ok(near(s.speeds[3][1], Math.cbrt(z0 / (z0 + 2))));
});

test('the check catches liquids and gases that cannot be: too full, overflowing, through the glass, a piston out', async () => {
  const { lint } = require('../src/lint.js');
  const { validate } = await import('../src/validate.js');
  const cup = (id, at, r = 2) => ({
    id,
    shapes: [
      { cylinder: { r: r + 0.2, ri: r, x0: 0.2, x1: 6 }, rot: [0, 0, 90], at },
      { cylinder: { r: r + 0.2, x0: 0, x1: 0.2 }, rot: [0, 0, 90], at },
    ],
  });
  const scene = (o = {}) => ({
    unit: 'cm',
    check: { float: true },
    parts: [cup('top', [0, 10, 0]), cup('low', [0, 0, 0]), { id: 'w' }, { id: 'w2' }],
    vessels: [
      {
        id: 'T',
        part: 'top',
        at: [0, 10, 0],
        inside: [
          [0.2, 2],
          [6, 2],
        ],
        outlet: { radius: 0.2, tip: [0, 10, 0] },
      },
      {
        id: 'L',
        part: 'low',
        inside: o.inside || [
          [0.2, 2],
          [6, 2],
        ],
      },
    ],
    liquids: [
      { part: 'w', in: 'T', volume: o.top ?? 30, into: 'w2' },
      { part: 'w2', in: 'L', volume: o.low ?? 10 },
    ],
  });
  const says = (s, words) => lint(s).problems.some((p) => p.message.includes(words));
  assert.deepEqual(validate(scene()), []);
  assert.deepEqual(lint(scene()).problems, []);
  assert.ok(says(scene({ top: 100 }), 'T holds 100 but its inside takes')); // (π·2²·5.8 ≈ 72.9)
  assert.ok(says(scene({ top: 50, low: 40 }), 'L would overflow'));
  assert.ok(
    says(
      scene({
        inside: [
          [0.2, 2.5],
          [6, 2.5],
        ],
      }),
      'goes through the walls of low',
    ),
  );
  const gas = {
    unit: 'cm',
    parts: [cup('c', [0, 0, 0]), { id: 'air' }],
    vessels: [
      {
        id: 'C',
        part: 'c',
        inside: [
          [0.2, 2],
          [6, 2],
        ],
      },
    ],
    gases: [{ part: 'air', in: 'C', n: 1, T: 293 }], // (a mole is 24 litres; the vessel takes 73 cm³)
  };
  assert.ok(lint(gas).problems.some((p) => p.message.includes('would push its piston out')));
  // the validator: names that exist, and a part without shapes only as a liquid or gas
  const bad = scene();
  bad.liquids[0].into = 'nope';
  bad.vessels[0].outlet.valve = 'tap';
  bad.parts.push({ id: 'empty' });
  assert.deepEqual(
    validate(bad).map((e) => e.path),
    ['parts[4]', 'vessels[0].outlet.valve', 'liquids[0].into'],
  );
});
