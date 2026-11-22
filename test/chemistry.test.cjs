// The geometry check's chemistry (src/chemistry.js, run by lk3d/lint): molecules at their experimental geometries pass,
// and each mistake it must catch is caught at its place in the data: a stretched bond, a carbon with five bonds, an
// atom with no bond, a stale excuse; a charge changes what an atom may bond; check.molecule excuses only what it names.
//   npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const { lint } = require('../src/lint.js');
const { RADII, VALENCES, TOLERANCE } = require('../src/chemistry.js');

const rad = (d) => (d * Math.PI) / 180,
  round = (v) => v.map((x) => +x.toFixed(5)),
  TETRA = [
    [1, 1, 1],
    [1, -1, -1],
    [-1, 1, -1],
    [-1, -1, 1],
  ].map((v) => v.map((x) => x / Math.sqrt(3)));
function star(centre, ligand, dirs, d, order = 1) {
  return {
    atoms: [{ el: centre, at: [0, 0, 0] }, ...dirs.map((u) => ({ el: ligand, at: round(u.map((x) => x * d)) }))],
    bonds: dirs.map((_, k) => [0, k + 1, order]),
  };
}
const bent = (c, l, d, angle) =>
  star(
    c,
    l,
    [-1, 1].map((s) => [s * Math.sin(rad(angle / 2)), -Math.cos(rad(angle / 2)), 0]),
    d,
  );
const pair = (a, b, d, order = 1) => ({
  atoms: [
    { el: a, at: [0, 0, 0] },
    { el: b, at: [d, 0, 0] },
  ],
  bonds: [[0, 1, order]],
});
function scene(molecules, check = {}) {
  return {
    scale: { note: 'n' },
    check: { float: true, ...check },
    parts: molecules.map(([id, m], k) => ({ id, name: id, at: [k * 6, 0, 0], shapes: [{ molecule: m }] })),
  };
}
const findings = (s) => lint(s).problems.map((p) => `${p.path}: ${p.message}`);

test("the radii are Pyykkö's: a sample, as the papers give them (pm)", () => {
  // single and double: Pyykkö and Atsumi 2009; triple: Pyykkö, Riedel and Patzschke 2005
  assert.deepEqual(RADII.H, [32, null, null]);
  assert.deepEqual(RADII.C, [75, 67, 60]);
  assert.deepEqual(RADII.N, [71, 60, 54]);
  assert.deepEqual(RADII.O, [63, 57, 53]);
  assert.deepEqual(RADII.F, [64, 59, 53]);
  assert.deepEqual(RADII.B, [85, 78, 73]);
  assert.deepEqual(RADII.Si, [116, 107, 102]);
  assert.deepEqual(RADII.P, [111, 102, 94]);
  assert.deepEqual(RADII.Cl, [99, 95, 93]);
  assert.equal(TOLERANCE, 0.2);
  assert.deepEqual(VALENCES.C, [4]);
});

test('molecules at their experimental geometries pass, the bonds that stray most from their radii included', () => {
  const tetra = (c, l, d) => star(c, l, TETRA, d);
  const molecules = [
    [
      'co2',
      star(
        'C',
        'O',
        [
          [1, 0, 0],
          [-1, 0, 0],
        ],
        1.16,
        2,
      ),
    ],
    [
      'bf3',
      star(
        'B',
        'F',
        [0, 120, 240].map((a) => [Math.cos(rad(a)), Math.sin(rad(a)), 0]),
        1.307,
      ),
    ], // −12 %
    ['ch4', tetra('C', 'H', 1.087)],
    ['h2o', bent('O', 'H', 0.958, 104.48)],
    ['h2', pair('H', 'H', 0.741)], // +16 %
    ['n2', pair('N', 'N', 1.098, 3)],
    ['sif4', tetra('Si', 'F', 1.554)], // −14 %
    [
      'oo',
      {
        atoms: [
          { el: 'O', at: [0, 0, 0] },
          { el: 'O', at: [1.475, 0, 0] },
          { el: 'H', at: [-0.08, 0.947, 0] },
          { el: 'H', at: [1.555, -0.35, 0.88] },
        ],
        bonds: [
          [0, 1],
          [0, 2],
          [1, 3],
        ],
      },
    ], // H2O2's O–O, +17 %
  ];
  assert.deepEqual(findings(scene(molecules)), []);
});

test('a stretched bond is refused at its place in the data, saying how long it should be', () => {
  const water = bent('O', 'H', 0.958, 104.48);
  water.atoms[1].at = round(water.atoms[1].at.map((x) => (x * 1.62) / 0.958));
  const all = findings(
    scene([
      ['ch4', star('C', 'H', TETRA, 1.087)],
      ['h2o', water],
    ]),
  );
  assert.equal(all.length, 1, all.join('\n'));
  assert.match(
    all[0],
    /^parts\[1\]\.shapes\[0\]\.molecule\.bonds\[0\]: h2o: the bond from atoms\[0\] \(O\) to atoms\[1\] \(H\) is 1\.62 Å, but an O–H single bond is about 0\.95 Å/,
  );
});

test('a bond far from its radii is caught whatever its elements (Si–C at 1.339 Å, 30 % short of 1.91)', () => {
  assert.match(findings(scene([['x', pair('Si', 'C', 1.339)]])).join('\n'), /Si–C single bond is about 1\.91 Å/);
});

test('a carbon with five bonds, and an atom with no bond, are refused at the atom', () => {
  const ch5 = star('C', 'H', [...TETRA, [0, 0, 1]], 1.087);
  const lonely = bent('O', 'H', 0.958, 104.48);
  lonely.atoms.push({ el: 'H', at: [0, 1, 0] });
  const all = findings(
    scene([
      ['ch5', ch5],
      ['h2o', lonely],
    ]),
  );
  assert.ok(
    all.some((f) =>
      /^parts\[0\]\.shapes\[0\]\.molecule\.atoms\[0\]: ch5: atoms\[0\] \(C\) has bonds adding to 5, but C makes 4/.test(
        f,
      ),
    ),
    all.join('\n'),
  );
  assert.ok(
    all.some((f) => /^parts\[1\]\.shapes\[0\]\.molecule\.atoms\[3\]: h2o: atoms\[3\] \(H\) has no bond/.test(f)),
    all.join('\n'),
  );
});

test('a charge counts an atom as the element with as many electrons: NH4+, BF4−, H3O+', () => {
  const ammonium = star('N', 'H', TETRA, 1.03),
    borate = star('B', 'F', TETRA, 1.4),
    hydronium = {
      atoms: [
        { el: 'O', at: [0, 0, 0], charge: 1 },
        ...[0, 120, 240].map((a) => ({ el: 'H', at: round([0.97 * Math.cos(rad(a)), -0.3, 0.97 * Math.sin(rad(a))]) })),
      ],
      bonds: [
        [0, 1],
        [0, 2],
        [0, 3],
      ],
    };
  ammonium.atoms[0].charge = 1;
  borate.atoms[0].charge = -1;
  assert.deepEqual(
    findings(
      scene([
        ['nh4', ammonium],
        ['bf4', borate],
        ['h3o', hydronium],
      ]),
    ),
    [],
  );
  delete ammonium.atoms[0].charge;
  assert.match(findings(scene([['nh4', ammonium]])).join('\n'), /N makes 3/);
});

test('check.molecule excuses the shape it names and nothing wider; a name that is not a molecule shape is refused', () => {
  const bad = pair('O', 'H', 2);
  const s = {
    scale: { note: 'n' },
    check: { float: true, molecule: ['p.shapes[1]'] },
    parts: [{ id: 'p', name: 'p', shapes: [{ molecule: pair('O', 'H', 0.96) }, { molecule: bad, at: [4, 0, 0] }] }],
  };
  // (an O–H pair has O's valence wrong: one bond of two; the excuse here is for the stretched shape only)
  const shape0 = findings(s).filter((f) => f.startsWith('parts[0].shapes[0]'));
  assert.ok(
    shape0.every((f) => /atoms\[0\] \(O\) has bonds adding to 1/.test(f)),
    shape0.join('\n'),
  );
  assert.ok(!findings(s).some((f) => f.startsWith('parts[0].shapes[1]')), 'shape 1 excused by name');
  s.check.molecule = ['p'];
  assert.ok(!findings(s).some((f) => f.startsWith('parts[0]')), 'the whole part excused by its id');
  s.check.molecule = ['p', 'nothing', 'p.shapes[7]'];
  const stale = findings(s);
  assert.ok(
    stale.some((f) => /^check\.molecule\[1\]: nothing is not a molecule shape/.test(f)),
    stale.join('\n'),
  );
  assert.ok(
    stale.some((f) => /^check\.molecule\[2\]: p\.shapes\[7\] is not a molecule shape/.test(f)),
    stale.join('\n'),
  );
});

test("lk3d's own molecules pass, and an element without radii is named as not checked", () => {
  for (const file of ['../examples/scenes/molecules.json', './visual/scenes/molecules.json']) {
    const r = lint(require(file));
    assert.deepEqual(r.problems, [], file);
  }
  const r = lint(scene([['ch', pair('C', 'H', 1, 2)]])); // (hydrogen has no double-bond radius)
  assert.deepEqual(r.summary.unchecked, ['H']);
});
