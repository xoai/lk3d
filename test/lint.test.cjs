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
  ).geo;
  assert.ok(isClosed(co2), 'ball-and-stick: closed');
  const open = buildShape(
    {
      lathe: [
        [0, 0.5],
        [1, 0.5],
      ],
    },
    1,
  ).geo; // (a tube with no ends)
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
