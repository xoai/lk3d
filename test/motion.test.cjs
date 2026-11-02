// Motions (motion.js): keys interpolated as written, matrices that move and turn parts as the scene says, the check
// that runs each motion through its range, and the validator's cross-checks.          npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const { between, tracksOf, motionMatrix } = require('../src/motion.js');
const { M } = require('../src/math.js');
const { lint } = require('../src/lint.js');

const close = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1e-9);

test('keys: straight from key to key, eased if asked, held past the ends', () => {
  const keys = [
    [0, 0],
    [1, 10],
    [3, 30],
  ];
  assert.equal(between(keys, 0.5), 5);
  assert.equal(between(keys, 2), 20);
  assert.equal(between(keys, -1), 0);
  assert.equal(between(keys, 9), 30);
  assert.equal(between(keys, 0.25, true), 10 * (0.25 * 0.25 * (3 - 0.5)));
  assert.ok(
    close(
      between(
        [
          [0, [0, 0, 0]],
          [2, [2, 4, 6]],
        ],
        1,
      ),
      [1, 2, 3],
    ),
  );
});

test('a part is moved and turned by the motions that name it or its group, the others at their start', () => {
  const motions = [
    {
      id: 'slide',
      range: [0, 1],
      tracks: [
        {
          parts: ['g'],
          move: [
            [0, [0, 0, 0]],
            [1, [2, 0, 0]],
          ],
        },
      ],
    },
    {
      id: 'crank',
      range: [0, 360],
      value: 90,
      tracks: [
        {
          parts: ['arm'],
          turn: {
            axis: [0, 0, 1],
            center: [1, 0, 0],
            keys: [
              [0, 0],
              [360, 360],
            ],
          },
        },
      ],
    },
  ];
  const arm = { id: 'arm', group: 'g' };
  const T = tracksOf(motions, arm);
  assert.equal(T.length, 2);
  // the crank starts at 90°: a point one unit right of its centre is one unit above it
  assert.ok(close(M.pt(motionMatrix(T, {}), [2, 0, 0]), [1, 1, 0]));
  // the slide halfway: moved one along x, then turned
  assert.ok(close(M.pt(motionMatrix(T, { slide: 0.5, crank: 0 }), [2, 0, 0]), [3, 0, 0]));
  assert.equal(tracksOf(motions, { id: 'other' }).length, 0);
});

test('a part that runs into another as a motion moves is caught; a clear motion passes', () => {
  const base = { id: 'base', shapes: [{ box: [2, 0.2, 2] }] },
    post = { id: 'post', shapes: [{ box: [0.2, 1, 0.2], at: [0, 0.6, 0] }] },
    slider = { id: 'slider', shapes: [{ box: [0.3, 0.2, 0.3], at: [-0.7, 0.2, 0] }] };
  const scene = (to) => ({
    parts: [base, post, slider],
    motions: [
      {
        id: 'push',
        range: [0, 1],
        tracks: [
          {
            parts: ['slider'],
            move: [
              [0, [0, 0, 0]],
              [1, to],
            ],
          },
        ],
      },
    ],
  });
  assert.deepEqual(lint(scene([0, 0, 0.6])).problems, []);
  const r = lint(scene([1.4, 0, 0]));
  assert.ok(r.problems.some((p) => /slider and post run into each other as push moves/.test(p.message)));
  // excused only by name
  assert.deepEqual(lint({ ...scene([1.4, 0, 0]), check: { allow: [['slider', 'post']] } }).problems, []);
});

test('a motion is validated: its parts exist, its id is its own, its keys are in order within its range', async () => {
  const { validate } = await import('../src/validate.js');
  const parts = [{ id: 'a', shapes: [{ box: [1, 1, 1] }] }];
  const good = {
    id: 'm',
    range: [0, 1],
    tracks: [
      {
        parts: ['a'],
        move: [
          [0, [0, 0, 0]],
          [1, [1, 0, 0]],
        ],
      },
    ],
  };
  assert.deepEqual(validate({ parts, motions: [good] }), []);
  const paths = (motions) => validate({ parts, motions }).map((e) => e.path);
  assert.deepEqual(paths([{ ...good, tracks: [{ parts: ['zz'], move: [[0, [0, 0, 0]]] }] }]), [
    'motions[0].tracks[0].parts',
  ]);
  assert.deepEqual(
    paths([
      {
        ...good,
        tracks: [
          {
            parts: ['a'],
            move: [
              [1, [0, 0, 0]],
              [0.5, [1, 0, 0]],
            ],
          },
        ],
      },
    ]),
    ['motions[0].tracks[0].move'],
  );
  assert.deepEqual(paths([good, good]), ['motions[1].id']);
  assert.deepEqual(
    paths([{ ...good, range: [1, 1], tracks: [{ parts: ['a'], turn: { axis: [0, 0, 1], keys: [[1, 0]] } }] }]),
    ['motions[0].range'],
  );
  assert.deepEqual(paths([{ ...good, tracks: [{ parts: ['a'] }] }]), ['motions[0].tracks[0]']);
});
