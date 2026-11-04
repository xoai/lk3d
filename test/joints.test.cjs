// Joints (joints.js): parts posed by how they are joined. A slider-crank solved exactly (against its closed form),
// a rod that stays on its pin, gears and cams that follow, joints carried by their parent, the order and its loops,
// the page's values, the engine and the geometry check using them, and the validator's cross-checks.     npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const { jointsOf, solve, jointOf, motionsOf, transformPoint: pt } = require('../src/joints.js');
const { M } = require('../src/math.js');

const near = (a, b, e = 1e-5) => Math.abs(a - b) < e;
const nearV = (a, b, e = 1e-5) => a.every((v, i) => Math.abs(v - b[i]) < e);
// a crank of radius r about x through the origin, its pin at (0, r, 0) at top dead centre; a rod of length L up to the
// piston's pin at (0, r + L, 0); the piston slides along y
const r = 0.4,
  L = 1.3;
const ENGINE = {
  motions: [{ id: 'cycle', range: [0, 720], loop: true }],
  joints: [
    { id: 'crank', parts: ['crank'], turn: { axis: [1, 0, 0], center: [0, 0, 0] }, drive: 'cycle' },
    {
      id: 'piston',
      parts: ['piston'],
      slide: { axis: [0, 1, 0] },
      rod: { joint: 'crank', at: [0, r, 0], pin: [0, r + L, 0] },
    },
    {
      id: 'rod',
      parent: 'piston',
      parts: ['rod'],
      turn: { axis: [1, 0, 0], center: [0, r + L, 0] },
      aim: { joint: 'crank', at: [0, r, 0] },
    },
    { id: 'cam', parts: ['cam'], turn: { axis: [1, 0, 0], center: [0, 2, 0] }, follow: { joint: 'crank', ratio: 0.5 } },
    {
      id: 'valve',
      parts: ['valve'],
      slide: { axis: [0, -1, 0] },
      follow: {
        joint: 'cam',
        keys: [
          [0, 0],
          [90, 0.1],
          [180, 0],
        ],
      },
    },
  ],
};

test('a slider-crank, exactly: the piston where the closed form puts it, the rod on both pins', () => {
  const J = jointsOf(ENGINE);
  for (let th = 0; th <= 720; th += 15) {
    const { value, matrix } = solve(J, ENGINE.motions, { cycle: th });
    const a = (th * Math.PI) / 180;
    // the crank pin turned about +x: (0, r cos a, r sin a); the piston pin's height from the crank centre
    const pin = [0, r * Math.cos(a), r * Math.sin(a)],
      y = r * Math.cos(a) + Math.sqrt(L * L - (r * Math.sin(a)) ** 2);
    assert.ok(nearV(pt(matrix.get('crank'), [0, r, 0]), pin), `crank pin at ${th}°`);
    assert.ok(near(value.get('piston'), y - (r + L)), `piston at ${th}°: ${value.get('piston')} vs ${y - (r + L)}`);
    // the rod's two ends: on the piston pin (it rides with the piston) and on the crank pin (it is aimed there)
    const R = matrix.get('rod');
    assert.ok(nearV(pt(R, [0, r + L, 0]), [0, y, 0]), `rod's top end at ${th}°`);
    assert.ok(nearV(pt(R, [0, r, 0]), pin), `rod's bottom end at ${th}°`);
    assert.ok(near(value.get('cam'), th / 2));
  }
});

test('follow: a ratio or keys read off the other joint; a page value over a drive', () => {
  const J = jointsOf(ENGINE);
  assert.ok(near(solve(J, ENGINE.motions, { cycle: 90 }).value.get('valve'), 0.05));
  assert.ok(near(solve(J, ENGINE.motions, { cycle: 180 }).value.get('valve'), 0.1));
  const pg = solve(J, ENGINE.motions, { cycle: 0 }, { crank: 180, piston: 5 });
  assert.ok(near(pg.value.get('crank'), 180));
  assert.ok(near(pg.value.get('piston'), -2 * r), 'a solved joint keeps to its rod, whatever the page says');
  // (the valve slides along -y: its parts move down)
  assert.ok(nearV(pt(solve(J, ENGINE.motions, { cycle: 180 }).matrix.get('valve'), [0, 3, 0]), [0, 2.9, 0]));
  // (no motion value: the motion's start)
  assert.ok(near(solve(J, ENGINE.motions).value.get('crank'), 0));
});

test('order, parts, motions read; loops and missing joints refused', () => {
  const J = jointsOf(ENGINE);
  assert.deepEqual(
    J.order.map((j) => j.id),
    ['crank', 'piston', 'rod', 'cam', 'valve'],
  );
  assert.equal(jointOf(J, { id: 'rod' }).id, 'rod');
  assert.equal(jointOf(J, { id: 'x', group: 'piston' }).id, 'piston');
  assert.equal(jointOf(J, { id: 'block' }), null);
  assert.deepEqual([...motionsOf(J, J.byId.get('valve'))], ['cycle']);
  assert.equal(jointsOf({}), null);
  const loop = {
    joints: [
      { id: 'a', parts: [], turn: { axis: [1, 0, 0] }, follow: { joint: 'b' } },
      { id: 'b', parts: [], turn: { axis: [1, 0, 0] }, follow: { joint: 'a' } },
    ],
  };
  assert.throws(() => jointsOf(loop), /loop/);
  assert.throws(
    () => jointsOf({ joints: [{ id: 'a', parts: [], turn: { axis: [1, 0, 0] }, parent: 'z' }] }),
    /no joint/,
  );
});

test('a joint carried by its parent: an arm on a turntable', () => {
  const J = jointsOf({
    joints: [
      { id: 'base', parts: ['base'], turn: { axis: [0, 1, 0], center: [0, 0, 0] }, value: 90 },
      { id: 'arm', parent: 'base', parts: ['arm'], turn: { axis: [0, 0, 1], center: [1, 0, 0] }, value: 90 },
    ],
  });
  const m = solve(J, []).matrix.get('arm');
  // the arm's tip (2, 0, 0): up about z through (1, 0, 0) → (1, 1, 0); then the base turns 90° about y → (0, 1, -1)
  assert.ok(nearV(pt(m, [2, 0, 0]), [0, 1, -1]));
  assert.ok(nearV(pt(M.id(), [1, 2, 3]), [1, 2, 3]));
});

test('the validator: what joints name must exist, one place for a value, no loops', () => {
  const { validate } = require('../src/validate.js');
  const part = (id) => ({ id, shapes: [{ box: [1, 1, 1] }] });
  const base = { parts: ['crank', 'piston', 'rod', 'cam', 'valve'].map(part), motions: ENGINE.motions };
  assert.deepEqual(validate({ ...base, joints: ENGINE.joints }), []);
  const msgs = (joints) => validate({ ...base, joints }).map((e) => `${e.path}: ${e.message}`);
  assert.deepEqual(
    msgs([
      { id: 'a', parts: ['nope'], turn: { axis: [1, 0, 0] }, drive: 'gone' },
      { id: 'b', parts: ['crank'], turn: { axis: [1, 0, 0] }, rod: { joint: 'a', at: [0, 0, 0], pin: [0, 1, 0] } },
      { id: 'c', parts: ['crank'], slide: { axis: [0, 1, 0] }, follow: { joint: 'zz' }, drive: 'cycle' },
    ]),
    [
      'joints[0].parts: moves "nope", which is no part or group',
      'joints[0].drive: "gone" is no motion',
      'joints[1].rod: a rod holds a slide (a piston): give the joint slide, not turn',
      'joints[2].parts: "crank" is on joint "b" already',
      'joints[2].follow.joint: "zz" is no joint',
      'joints[2].follow: its value comes from one place: drive or follow',
    ],
  );
  assert.ok(
    msgs([{ id: 'a', parts: [], slide: { axis: [0, 1, 0] }, turn: { axis: [1, 0, 0] } }]).some((m) =>
      /turns its parts \(turn\) or slides/.test(m),
    ),
  );
  assert.deepEqual(
    msgs([
      { id: 'a', parts: [], turn: { axis: [1, 0, 0] }, follow: { joint: 'b' } },
      { id: 'b', parts: [], turn: { axis: [1, 0, 0] }, follow: { joint: 'a' } },
    ]),
    ['joints[0]: "a" reads itself through other joints (a loop)'],
  );
});

test('the geometry check runs a joint-driven motion through its range', () => {
  const { lint } = require('../src/lint.js');
  // a block that slides up into a lid as the motion goes: only the joint moves it
  const scene = {
    parts: [
      { id: 'lid', shapes: [{ box: [2, 0.2, 2], at: [0, 2, 0] }] },
      { id: 'block', shapes: [{ box: [1, 1, 1] }] },
    ],
    motions: [{ id: 'lift', range: [0, 1] }],
    joints: [{ id: 'up', parts: ['block'], slide: { axis: [0, 1, 0] }, drive: { motion: 'lift', ratio: 1.8 } }],
  };
  const hit = lint(scene).problems.find((p) => /run into each other as lift moves/.test(p.message));
  assert.ok(hit, JSON.stringify(lint(scene).problems));
  scene.joints[0].drive.ratio = 0.5;
  assert.ok(!lint(scene).problems.some((p) => /as lift moves/.test(p.message)));
});
