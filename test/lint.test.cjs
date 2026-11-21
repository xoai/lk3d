// The geometry check (lk3d/lint), shown each mistake it must catch: a part that runs through others as the model is
// taken apart, a part hanging in the air, a label pointing inside another part. Each is caught, each is excused only by
// name, and a right scene passes with its size reported.          npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const { lint } = require('../src/lint.js');

const base = { id: 'base', name: 'Base', shapes: [{ box: [2, 0.2, 2] }] },
  post = { id: 'post', name: 'Post', shapes: [{ box: [0.2, 1, 0.2], at: [0, 0.6, 0] }] },
  says = (r, words) => r.problems.some((p) => p.message.includes(words));

test('a right scene passes, with its size', () => {
  const r = lint({ parts: [base, post] });
  assert.deepEqual(r.problems, []);
  assert.equal(r.summary.parts, 2);
  assert.equal(r.summary.named, 2);
  assert.ok(r.summary.triangles > 0);
});

test('a part that runs through others when taken apart is caught, and excused only by name', () => {
  // a lid taken off straight down: through the post on the way, into the base at the end
  const lid = { id: 'lid', name: 'Lid', shapes: [{ box: [1, 0.1, 1], at: [0, 1.15, 0] }], explode: [0, -1.1, 0] };
  const r = lint({ parts: [base, post, lid] });
  assert.ok(
    says(r, 'lid and post run into each other') || says(r, 'post and lid run into each other'),
    JSON.stringify(r),
  );
  assert.ok(says(r, 'when taken apart'));
  // lifted off upwards instead: clear
  assert.deepEqual(lint({ parts: [base, post, { ...lid, explode: [0, 1, 0] }] }).problems, []);
  // excused: only the pairs named
  const one = lint({ parts: [base, post, lid], check: { allow: [['lid', 'post']] } });
  assert.ok(one.problems.length > 0 && one.problems.every((p) => !p.message.includes('post')));
  assert.deepEqual(
    lint({
      parts: [base, post, lid],
      check: {
        allow: [
          ['lid', 'post'],
          ['base', 'lid'],
        ],
      },
    }).problems,
    [],
  );
  // a part inside another from the start (a filament in a bulb) is not a mistake
  const bulb = { id: 'bulb', shapes: [{ sphere: 0.5, at: [0, 0.6, 0] }] },
    filament = { id: 'filament', shapes: [{ sphere: 0.1, at: [0, 0.6, 0] }] };
  assert.deepEqual(lint({ parts: [base, bulb, filament] }).problems, []);
});

test('a part hanging in the air is caught, unless the scene says it floats', () => {
  const ball = { id: 'ball', shapes: [{ sphere: 0.2, at: [0, 3, 0] }] };
  assert.ok(says(lint({ parts: [base, post, ball] }), 'ball touches no other part'));
  assert.deepEqual(lint({ parts: [base, post, ball], check: { float: ['ball'] } }).problems, []);
  assert.deepEqual(
    lint({ parts: [base, post, { ...ball, group: 'planets' }], check: { float: ['planets'] } }).problems,
    [],
  );
  assert.deepEqual(lint({ parts: [base, post, ball], check: { float: true } }).problems, []);
  // within another part's box is not resting on it: a ball hung in the middle of a cage of bars (its surface must meet
  // another's), while one sitting on the base inside the cage rests
  const caged = (y) => ({ id: 'ball', shapes: [{ sphere: 0.2, at: [0, y, 0] }] });
  assert.ok(says(lint({ parts: [base, cage, caged(1.5)] }), 'ball touches no other part'));
  assert.deepEqual(lint({ parts: [base, cage, caged(0.3)] }).problems, []);
});

test('a label pointing inside another part is caught; see-through parts do not hide it', () => {
  const hidden = { ...post, label: [0, 0, 0] }; // a point inside the base
  assert.ok(says(lint({ parts: [base, hidden] }), 'the label of post points inside base'));
  assert.deepEqual(lint({ parts: [{ ...base, xray: true }, hidden] }).problems, []);
  assert.deepEqual(lint({ parts: [{ ...base, opacity: 0.4 }, hidden] }).problems, []);
  assert.deepEqual(lint({ parts: [base, hidden], check: { allow: [['post', 'base']] } }).problems, []);
});

test('a part made of solids meeting edge to edge is still solid to the check (two shafts, a molecule)', () => {
  // a block sent sideways through a shaft of two cylinders end to end: each edge where they meet has four faces
  const shaft = {
      id: 'shaft',
      shapes: [{ cylinder: { r: 0.3, x0: -1, x1: 0 } }, { cylinder: { r: 0.3, x0: 0, x1: 1 } }],
    },
    block = { id: 'block', shapes: [{ box: [0.2, 0.2, 0.2], at: [0, 0, 1] }], explode: [0, 0, -2] };
  assert.ok(says(lint({ parts: [shaft, block], check: { float: true } }), 'run into each other'));
  const { isClosed } = require('../src/geometry.js');
  const { buildShape } = require('../src/geometry.js');
  const co2 = buildShape(
    {
      molecule: {
        atoms: [
          { el: 'O', at: [-1.2, 0, 0] },
          { el: 'C', at: [0, 0, 0] },
          { el: 'O', at: [1.2, 0, 0] },
        ],
        bonds: [
          [0, 1, 2],
          [1, 2, 2],
        ],
      },
    },
    1,
  ).mesh;
  assert.ok(isClosed(co2), 'ball-and-stick: closed');
  const open = buildShape(
    {
      lathe: [
        [0, 0.5],
        [1, 0.5],
      ],
    },
    1,
  ).mesh; // (a tube with no ends)
  assert.ok(!isClosed(open), 'an open surface is not');
});

test('a pin sent through a thin plate is caught, wherever on its way it passes', () => {
  // the plate is 0.05 thick; the pin goes 4 units, so a check at a quarter, a half, … of the way would miss it
  const plate = { id: 'plate', shapes: [{ box: [2, 0.05, 2], at: [0, 1, 0] }] },
    pin = { id: 'pin', shapes: [{ box: [0.1, 0.4, 0.1], at: [0, 0.4, 0] }], explode: [0, 4, 0] };
  assert.ok(says(lint({ parts: [plate, pin], check: { float: true } }), 'run into each other'));
});

test('a part that makes nothing, or makes NaN, is reported', () => {
  const r = lint({
    parts: [
      { id: 'a', shapes: [{ box: [1, 1, 1] }] },
      {
        id: 'flat',
        shapes: [
          {
            lathe: [
              [0, 0],
              [0, 0],
            ],
          },
        ],
        at: [0, 1, 0],
      },
    ],
    check: { float: true },
  });
  assert.ok(says(r, 'flat makes no triangles'), JSON.stringify(r.problems));
});

// expect: what a scene says must be true, each predicate planted wrong and caught at its item, and right when it holds
const cage = {
    id: 'cage',
    name: 'Cage',
    shapes: [
      [0.9, 0.9],
      [0.9, -0.9],
      [-0.9, 0.9],
      [-0.9, -0.9],
    ].map(([x, z]) => ({ box: [0.1, 2, 0.1], at: [x, 1.1, z] })),
  },
  expecting = (expect, extra = {}) => lint({ parts: [base, cage, post], expect, ...extra }),
  at = (r, k) => r.problems.filter((p) => p.path === `expect[${k}]`).map((p) => p.message);

test('expect: each predicate holds, or is reported at its item with what was found', () => {
  // right: the post inside the cage, on the base, the base 0.2 tall, the post above nothing it should not be
  assert.deepEqual(
    expecting([
      { inside: 'post', of: 'cage' },
      { touches: 'post', with: 'base' },
      { size: 'base', axis: 'y', is: [0.19, 0.21] },
      { above: 'post', of: 'base', by: [0, 0.01] },
    ]).problems,
    [],
  );
  const lift = {
    id: 'lift',
    range: [0, 1],
    tracks: [
      {
        parts: ['post'],
        move: [
          [0, [0, 0, 0]],
          [1, [0, 3, 0]],
        ],
      },
    ],
  };
  const lamp = { id: 'lamp', name: 'Lamp', shapes: [{ sphere: 0.1, at: [0, 3, 0] }] };
  const lid = { id: 'lid', name: 'Lid', shapes: [{ box: [0.4, 0.1, 0.4], at: [0, 1.15, 0] }], explode: [0, -2, 0] };
  for (const [what, r, words] of [
    ['inside, at rest', expecting([{ inside: 'base', of: 'post' }]), /base is not inside post .* along x at rest/],
    ['inside, as a motion moves', expecting([{ inside: 'post', of: 'cage' }], { motions: [lift] }), /as lift moves/],
    [
      'touches, with a gap',
      lint({
        parts: [base, cage, post, lamp],
        check: { float: ['lamp'] },
        expect: [{ touches: 'lamp', with: 'base' }],
      }),
      /lamp does not touch base \(a gap of 2\.8\d* along y\)/,
    ],
    [
      'clear, on the way apart',
      lint({
        parts: [base, cage, post, lid],
        check: {
          allow: [
            ['lid', 'post'],
            ['lid', 'base'],
          ],
        },
        expect: [{ clear: 'lid', of: 'post' }],
      }),
      /lid is not clear of post: it runs into it as the model is taken apart/,
    ],
    [
      'above, out of its range',
      expecting([{ above: 'post', of: 'base', by: [2, 3] }]),
      /post is above base by 0, not by 2 to 3/,
    ],
    ['size, off', expecting([{ size: 'base', axis: 'y', is: [1, 2] }]), /base is 0\.2 along y, not 1 to 2/],
  ]) {
    const found = at(r, 0);
    assert.equal(found.length, 1, `${what}: ${JSON.stringify(r.problems)}`);
    assert.match(found[0], words, what);
  }
});

test("expect: seen, by a step's id or number: hidden, cut away, or not among its labels", () => {
  const steps = (step) => [{ id: 's', title: 'S', text: 'x', ...step }];
  assert.deepEqual(expecting([{ seen: 'post', step: 's' }], { steps: steps({ labels: ['post'] }) }).problems, []);
  for (const [what, step, extra, words] of [
    ['hidden', { hide: ['post'] }, {}, /post is hidden in step "s"/],
    ['cut away', { cut: true }, { section: { normal: [0, 1, 0], offset: 0.05 } }, /post is cut away in step "s"/],
    ['not labelled', { labels: ['base'] }, {}, /post is not among the labels in step "s"/],
  ])
    assert.match(
      at(expecting([{ seen: 'post', step: 's' }], { steps: steps(step), ...extra }), 0)[0] || '',
      words,
      what,
    );
  // by number, from 1
  assert.match(
    at(expecting([{ seen: 'post', step: 1 }], { steps: steps({ hide: ['post'] }) }), 0)[0] || '',
    /in step 1/,
  );
  // a cut that does not reach the part leaves it seen
  assert.deepEqual(
    expecting([{ seen: 'post', step: 's' }], {
      steps: steps({ cut: true }),
      section: { normal: [0, 1, 0], offset: 1.5 },
    }).problems,
    [],
  );
});

test('expect: groups (each part as the first, the box round all as the second); clear needs a closed part', () => {
  const far = { id: 'far', name: 'Far', group: 'posts', shapes: [{ box: [0.2, 1, 0.2], at: [3, 0.6, 0] }] };
  const r = lint({
    parts: [base, cage, { ...post, group: 'posts' }, far],
    check: { float: ['far'] },
    expect: [{ inside: 'posts', of: 'cage' }],
  });
  assert.match(at(r, 0)[0], /^far is not inside cage/);
  const rod = { id: 'rod', name: 'Rod', group: 'frame', shapes: [{ box: [0.1, 0.1, 3], at: [0.9, 2.15, 0] }] }; // (on two bars)
  assert.deepEqual(
    lint({ parts: [base, { ...cage, group: 'frame' }, post, rod], expect: [{ inside: 'post', of: 'frame' }] }).problems,
    [],
  );
  const open = (id, y) => ({
    id,
    name: id,
    shapes: [
      {
        lathe: [
          [y, 0.5],
          [y + 0.5, 0.5],
        ],
      },
    ],
  });
  assert.match(
    at(
      lint({
        parts: [base, open('o1', 0.1), open('o2', 0.2)],
        check: { float: ['o1', 'o2'] },
        expect: [{ clear: 'o1', of: 'o2' }],
      }),
      0,
    )[0],
    /clear needs a closed part/,
  );
});

test('the check says which parts each touches at rest (contacts), for what is built on it', () => {
  assert.deepEqual(lint({ parts: [base, post] }).contacts, { base: ['post'], post: ['base'] });
});

test('touches and contacts go by surfaces: a post inside a cage of bars touches none of them; a ball meets a floor', () => {
  // (the post is within the cage's box, so a test of boxes would say they touch)
  assert.deepEqual(lint({ parts: [base, cage, post] }).contacts, {
    base: ['cage', 'post'],
    cage: ['base'],
    post: ['base'],
  });
  assert.match(
    at(expecting([{ touches: 'post', with: 'cage' }]), 0).join(),
    /post does not touch cage \(within its bounds, but their surfaces do not meet\)/,
  );
  assert.deepEqual(at(expecting([{ touches: 'post', with: 'base' }]), 0), []);
  // a ball on a floor meets it at one point; a ball a little above it does not
  const ball = (y) => ({ id: 'ball', name: 'Ball', shapes: [{ sphere: 0.3, at: [0, y, 0] }] }),
    floor = { ...base, shapes: [{ box: [2, 0.2, 2], at: [0, -0.1, 0] }] };
  assert.deepEqual(lint({ parts: [floor, ball(0.3)] }).contacts.ball, ['base']);
  assert.deepEqual(lint({ parts: [floor, ball(0.4)], check: { float: ['ball'] } }).contacts.ball, []);
  // a part sunk into a closed one touches it, though its surface is far from the other's
  const sunk = { id: 'pin', name: 'Pin', shapes: [{ box: [0.05, 0.05, 0.05], at: [0, -0.1, 0] }] };
  assert.deepEqual(lint({ parts: [floor, sunk], check: { float: true } }).contacts.pin, ['base']);
  // a group as the second: touching one of its parts is enough
  const bars = { ...cage, group: 'frame' },
    rail = { id: 'rail', name: 'Rail', group: 'frame', shapes: [{ box: [0.1, 0.1, 2], at: [0.9, 2.15, 0] }] };
  assert.deepEqual(at(lint({ parts: [base, bars, post, rail], expect: [{ touches: 'rail', with: 'cage' }] }), 0), []);
});

test('expect is validated: names that exist and are not both a part and a group, ranges in order, steps that exist', () => {
  const { validate } = require('../src/validate.js'),
    problems = (expect, extra = {}) =>
      validate({ parts: [base, post], expect, ...extra }).map((p) => `${p.path}: ${p.message}`);
  assert.deepEqual(problems([{ inside: 'post', of: 'base' }]), []);
  assert.match(
    problems([{ inside: 'nothing', of: 'base' }]).join(),
    /expect\[0\]\.inside: "nothing" is no part or group/,
  );
  assert.match(
    validate({ parts: [{ ...base, group: 'base' }, post], expect: [{ touches: 'post', with: 'base' }] })
      .map((p) => p.message)
      .join(),
    /"base" is both a part and a group/,
  );
  // (a name both a part and a group is fine where expect does not use it)
  assert.deepEqual(validate({ parts: [{ ...base, group: 'base' }, post] }), []);
  assert.match(
    problems([{ size: 'post', axis: 'y', is: [2, 1] }]).join(),
    /least \(2\) is more than its greatest \(1\)/,
  );
  assert.match(problems([{ seen: 'post', step: 3 }], { steps: [{ title: 'S', text: 'x' }] }).join(), /3 is no step/);
  assert.match(problems([{ inside: 'post' }]).join(), /expect\[0\]/, 'a form missing its second name');
  // a key whose value is undefined is absent, as JSON leaves it out ({ ...scene, expect: undefined })
  assert.deepEqual(validate({ parts: [base, post], expect: undefined, title: undefined }), []);
  assert.match(
    validate({ parts: [{ ...base, name: undefined, shapes: undefined }, post] })
      .map((p) => `${p.path}: ${p.message}`)
      .join(),
    /parts\[0\].*shapes/,
    'a required key that is undefined is missing',
  );
});

test('a turned copy where a mirror image may be meant is warned of (a warning, not a problem); a symmetric pair, or one excused, is not', () => {
  const L = [
      { box: [0.6, 0.2, 0.2], at: [0.2, 0.2, 0] },
      { box: [0.2, 0.2, 0.6], at: [0.4, 0.2, 0.3] },
    ],
    pair = (shapes, check) =>
      lint({
        parts: [
          base,
          { id: 'l', name: 'L', shapes, at: [-0.5, 0, 0] },
          { id: 'r', name: 'R', shapes, at: [0.5, 0, 0], rot: [0, 180, 0] },
        ],
        check,
      }).problems;
  const warned = pair(L);
  assert.equal(warned.length, 1);
  assert.equal(warned[0].level, 'warning');
  assert.match(warned[0].message, /l and r are the same shapes turned 180° about y.*"mirrorOf": "l", "plane": "x"/);
  assert.deepEqual(
    pair([{ cylinder: { r: 0.1, x0: 0, x1: 0.5 }, at: [0, 0.2, 0] }]),
    [],
    'symmetric: the turn is a mirror',
  );
  assert.deepEqual(pair(L, { mirror: [{ pair: ['r', 'l'], reason: 'the same hand on purpose' }] }), []);
  // already mirrored (a negative scale), it is a reflection, not a turned copy
  assert.deepEqual(
    lint({
      parts: [
        base,
        { id: 'l', name: 'L', shapes: L, at: [-0.5, 0, 0] },
        { id: 'r', name: 'R', shapes: L, at: [0.5, 0, 0], rot: [0, 180, 0], scale: [-1, 1, 1] },
      ],
    }).problems.filter((p) => p.level === 'warning'),
    [],
  );
});

test('expect size with a group: each of its parts', () => {
  const tall = { id: 'tall', name: 'Tall', group: 'posts', shapes: [{ box: [0.2, 2, 0.2], at: [0.5, 1.1, 0] }] };
  const r = lint({
    parts: [base, { ...post, group: 'posts' }, tall],
    expect: [{ size: 'posts', axis: 'y', is: [0.9, 1.1] }],
  });
  assert.match(at(r, 0)[0], /^tall is 2 along y, not 0\.9 to 1\.1/);
});

test('place: each relation puts the part where it says; drift, a missing at, a cycle and an axis fixed twice are refused', () => {
  const { resolvePlace, placements } = require('../src/place.js'),
    stick = { id: 'post', name: 'Post', shapes: [{ box: [0.2, 1, 0.2] }] }, // (a post whose shape is at its own origin)
    posted = (place, extra = {}) => ({ parts: [base, { ...stick, place, ...extra }] }),
    at = (place, extra) => resolvePlace(posted(place, extra)).parts[1].at;
  assert.deepEqual(at({ on: 'base' }), [0, 0.6, 0]); // (the post's lowest point on the base's top, 0.1; centred)
  assert.deepEqual(at({ under: 'base' }), [0, -0.6, 0]);
  assert.deepEqual(at({ in: 'base' }), [0, 0, 0]);
  assert.deepEqual(at({ against: 'base', side: '+x', gap: 0.1 }), [1.2, 0, 0]);
  assert.deepEqual(at({ on: 'base', against: 'base', side: '-z' }), [0, 0.6, -1.1]); // (on's centring gives way along z)
  assert.deepEqual(at({ alignedWith: 'base', axes: ['x'] }, { at: [5, 5, 5] }), [0, 5, 5]); // (the rest kept)
  assert.deepEqual(at({ on: 'base', offset: [0.3, 0, 0] }), [0.3, 0.6, 0]);
  // a part placed on a placed part, and on a mirror of one
  const cap = { id: 'cap', shapes: [{ box: [0.2, 0.2, 0.2] }], place: { on: 'post' } };
  assert.deepEqual(resolvePlace({ parts: [base, { ...stick, place: { on: 'base' } }, cap] }).parts[2].at, [0, 1.2, 0]);
  const pin = { id: 'pin', shapes: [{ box: [0.2, 0.2, 0.2] }], place: { on: 'arm-r' } },
    arm = { id: 'arm', shapes: [{ box: [0.2, 0.2, 0.2] }], place: { on: 'base', offset: [0.5, 0, 0] } };
  assert.deepEqual(
    resolvePlace({ parts: [base, arm, { id: 'arm-r', mirrorOf: 'arm', plane: 'x' }, pin] }).parts[3].at,
    [-0.5, 0.4, 0],
  );
  const refused = (scene) =>
    placements(scene)
      .problems.map((p) => p.message)
      .join('\n');
  assert.match(
    refused(posted({ on: 'base', against: 'base', side: '-y' })),
    /fixes post along y twice \(on base, against base \(-y\)\)/,
  );
  assert.match(refused(posted({ on: 'nothing' })), /"nothing", which is no part/);
  assert.match(
    refused({ parts: [base, { ...cap, id: 'a', place: { on: 'b' } }, { ...cap, id: 'b', place: { on: 'a' } }] }),
    /a, b place each other in a cycle/,
  );
  // the check: an at that drifted, a place with no at; a handle place has left behind is warned of
  assert.match(
    says(
      lint(posted({ on: 'base' }, { at: [0, 0.7, 0] })),
      "post's at [0, 0.7, 0] is not where place puts it ([0, 0.6, 0]): run lk3d place",
    )
      ? 'ok'
      : '',
    /ok/,
  );
  assert.ok(says(lint(posted({ on: 'base' })), 'post has place but no at'));
  assert.deepEqual(lint(posted({ on: 'base' }, { at: [0, 0.6, 0] })).problems, []);
  const handled = lint(
    posted({ on: 'base' }, { at: [0, 0.6, 0], handle: { turn: { axis: [0, 1, 0], center: [0, 0, 0] } } }),
  );
  assert.equal(handled.problems.length, 1);
  assert.equal(handled.problems[0].level, 'warning');
  assert.match(handled.problems[0].message, /post's handle turns about \[0, 0, 0\], outside the part/);
});
