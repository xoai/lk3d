// Sequences (sequence.js): a teardown or a build expanded into a motion over [0, N], read through the same maths as any
// motion (motion.js); its pacing; and what the validator refuses of one.          npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const { expand, pacing } = require('../src/sequence.js');
const { tracksOf, motionMatrix, fadeOf } = require('../src/motion.js');
const { validate } = require('../src/validate.js');

// three boxes on a floor: a lid, a body (its explode vector up), a pin with none
const scene = (sequence, more = {}) => ({
  lk3d: 1,
  title: 'Boxes',
  parts: [
    { id: 'floor', name: 'Floor', shapes: [{ box: [4, 0.1, 4] }] },
    { id: 'body', name: 'Body', group: 'box', explode: [0, 2, 0], shapes: [{ box: [1, 1, 1] }] },
    { id: 'lid', name: 'Lid', group: 'box', explode: [0, 3, 0], shapes: [{ box: [1, 0.1, 1] }] },
    { id: 'pin', name: 'Pin', explode: [0, 0, 0], shapes: [{ box: [0.1, 0.1, 0.1] }] },
  ],
  sequences: [sequence],
  ...more,
});
// where a part is moved to (its matrix's translation) and how opaque it is, at the sequence's value v
const at = (s, motion, id, v) => {
  const part = s.parts.find((p) => p.id === id),
    tracks = tracksOf([motion], part),
    m = motionMatrix(tracks, { [motion.id]: v });
  return {
    move: [m[12], m[13], m[14]].map((x) => Math.round(x * 1e6) / 1e6 + 0),
    alpha: fadeOf(tracks, { [motion.id]: v }),
  };
};

test('a teardown: a motion over [0, N] from 0; each stage moves its parts over [k − 1, k] only, and they stay out', () => {
  const s = scene({ id: 't', stages: [{ parts: ['lid'] }, { parts: ['pin'], by: [1, 0, 0] }] }),
    motion = expand(s.sequences[0], s);
  assert.deepEqual([motion.id, motion.range, motion.value], ['t', [0, 2], 0]);
  assert.deepEqual(at(s, motion, 'lid', 0).move, [0, 0, 0], 'at rest at 0');
  assert.deepEqual(at(s, motion, 'lid', 1).move, [0, 3, 0], 'out by its explode vector at 1');
  assert.deepEqual(at(s, motion, 'lid', 2).move, [0, 3, 0], 'and stays out');
  assert.deepEqual(at(s, motion, 'pin', 1).move, [0, 0, 0], 'the pin waits for its stage');
  assert.deepEqual(at(s, motion, 'pin', 2).move, [1, 0, 0], 'and leaves by `by`');
  assert.deepEqual(at(s, motion, 'body', 2).move, [0, 0, 0], 'a part never named stays');
  assert.equal(at(s, motion, 'lid', 2).alpha, 1, 'no fade unless asked');
});

test('a stage of a group: one track per distinct non-zero explode vector', () => {
  const s = scene({ id: 't', stages: [{ parts: ['box', 'pin'] }] }),
    motion = expand(s.sequences[0], s);
  assert.equal(motion.tracks.length, 2, "the body and the lid (the pin's zero vector counts as none)");
  assert.deepEqual(at(s, motion, 'body', 1).move, [0, 2, 0]);
  assert.deepEqual(at(s, motion, 'lid', 1).move, [0, 3, 0]);
  assert.deepEqual(at(s, motion, 'pin', 1).move, [0, 0, 0]);
});

test('a build: starts at N (built); below its stage a part is away and faded to 0, it comes in, faded in over 20 %', () => {
  const s = scene({ id: 'b', build: true, stages: [{ parts: ['body'] }, { parts: ['lid'], by: [0, 2, 0] }] }),
    motion = expand(s.sequences[0], s);
  assert.equal(motion.value, 2, 'built at the start');
  assert.deepEqual(at(s, motion, 'lid', 0), { move: [0, 2, 0], alpha: 0 }, 'at 0 the lid is away and unseen');
  assert.deepEqual(at(s, motion, 'lid', 1), { move: [0, 2, 0], alpha: 0 }, 'still away at the start of its stage');
  assert.equal(at(s, motion, 'lid', 1.2).alpha, 1, 'faded in by 20 % of its stage');
  assert.ok(at(s, motion, 'lid', 1.5).move[1] < 2 && at(s, motion, 'lid', 1.5).move[1] > 0, 'on its way in');
  assert.deepEqual(at(s, motion, 'lid', 2), { move: [0, 0, 0], alpha: 1 }, 'in place at N');
  assert.deepEqual(at(s, motion, 'body', 1), { move: [0, 0, 0], alpha: 1 }, 'the body, stage 1, in place from 1');
});

test("after: 'fade': a teardown's part fades to 0.15 over the last 30 % of its stage", () => {
  const s = scene({ id: 't', after: 'fade', stages: [{ parts: ['lid'] }] }),
    motion = expand(s.sequences[0], s);
  assert.equal(at(s, motion, 'lid', 0.7).alpha, 1);
  assert.ok(Math.abs(at(s, motion, 'lid', 1).alpha - 0.15) < 1e-9);
});

test('a path is resampled at 12 keys a stage, eased once and read straight: no stop at its middle key', () => {
  const path = [
      [0, [0, 0, 0]],
      [0.6, [0, 3, 0]],
      [1, [3, 3, 0]],
    ],
    s = scene({ id: 't', stages: [{ parts: ['lid'], path }] }),
    motion = expand(s.sequences[0], s),
    y = (v) => at(s, motion, 'lid', v).move;
  assert.equal(motion.tracks[0].move.length, 13, '12 spans');
  assert.deepEqual(y(1), [3, 3, 0], 'its end');
  const step = (a, b) => Math.hypot(...y(b).map((v, i) => v - y(a)[i]));
  // the eased fraction passes 0.6 a little after the stage's middle; it moves on either side of that key
  const middle = 0.58;
  assert.ok(step(middle - 0.04, middle) > 0.05 && step(middle, middle + 0.04) > 0.05, 'it moves through the key');
  assert.ok(step(0, 0.02) < step(0.48, 0.5), 'and starts gently');
});

test('a turn: by its angle over the stage (eased), about its axis through its center', () => {
  // (the pin: no explode vector, so the turn is its only way; a part with one leaves by it as it turns)
  const s = scene({ id: 't', stages: [{ parts: ['pin'], turn: { axis: [0, 0, 1], center: [1, 0, 0], angle: 180 } }] }),
    motion = expand(s.sequences[0], s);
  assert.deepEqual(at(s, motion, 'pin', 1).move, [2, 0, 0], 'the origin turned half round about x = 1');
  assert.deepEqual(at(s, motion, 'pin', 0).move, [0, 0, 0]);
});

test("pacing: each stage its ms, then its hold; at least 8 samples a stage; the speed is N over the stages' time", () => {
  const sequence = {
      id: 't',
      ms: 1000,
      hold: 400,
      stages: [{ parts: ['lid'] }, { parts: ['pin'], by: [1, 0, 0], ms: 500 }],
    },
    times = pacing(sequence),
    motion = expand(sequence, scene(sequence));
  assert.deepEqual(times.at(-1), [2, 2.3], 'two stages (1 s and 0.5 s) and two holds');
  assert.ok(times.filter(([v]) => v > 0 && v <= 1).length >= 8, 'at least 8 samples in stage 1');
  assert.deepEqual(
    times.filter(([v]) => v === 1).map(([, s]) => s),
    [1, 1.4],
    'the hold: the value held from 1 s to 1.4 s',
  );
  assert.ok(Math.abs(motion.speed - 2 / 1.5) < 1e-9);
  assert.deepEqual(motion.holds, [
    { ms: 1000, hold: 400 },
    { ms: 500, hold: 400 },
  ]);
});

// the validator: what a sequence may not be (each problem's path)
const problems = (s) => validate(s).map((p) => p.path);

test('validate: a sequence is checked as the scene format says, and what a schema cannot say', () => {
  const ok = scene({ id: 't', stages: [{ parts: ['lid'] }, { parts: ['body'] }] });
  assert.deepEqual(validate(ok), []);
  const cases = [
    [{ id: 't', stages: [{ parts: ['nope'] }] }, 'sequences[0].stages[0].parts'],
    [{ id: 't', stages: [{ parts: ['lid'] }, { parts: ['box'] }] }, 'sequences[0].stages[1].parts'],
    [{ id: 't', stages: [{ parts: ['pin'] }] }, 'sequences[0].stages[0]'],
    [{ id: 't', stages: [] }, 'sequences[0].stages'],
    [{ id: 't', stages: [{ parts: ['lid'], colour: 'red' }] }, 'sequences[0].stages[0].colour'],
    [{ id: 't', speed: 2, stages: [{ parts: ['lid'] }] }, 'sequences[0].speed'],
    [{ id: 't', ms: -1, stages: [{ parts: ['lid'] }] }, 'sequences[0].ms'],
  ];
  for (const [sequence, path] of cases)
    assert.ok(
      problems(scene(sequence)).some((p) => p.startsWith(path)),
      `${JSON.stringify(sequence)}: ${problems(scene(sequence))}`,
    );
  const clash = scene({ id: 'm', stages: [{ parts: ['lid'] }] }, { motions: [{ id: 'm', range: [0, 1] }] });
  assert.ok(problems(clash).includes('sequences[0].id'), 'an id a motion has');
});

test('validate: steps with a sequence away, groups and clips', () => {
  const joined = {
    joints: [{ id: 'hinge', parts: ['lid'], turn: { axis: [1, 0, 0] }, drive: 'open' }],
    motions: [
      { id: 'open', name: 'Open', range: [0, 90], group: 'g' },
      {
        id: 'spin',
        name: 'Spin',
        range: [0, 360],
        loop: true,
        group: 'g',
        tracks: [
          {
            parts: ['pin'],
            turn: {
              axis: [0, 1, 0],
              keys: [
                [0, 0],
                [360, 360],
              ],
            },
          },
        ],
      },
    ],
  };
  const s = (steps, more = {}) =>
    scene(
      { id: 't', stages: [{ parts: ['lid'] }] },
      { ...joined, ...more, steps: steps.length ? steps.map((st) => ({ title: st.id, ...st })) : undefined },
    );
  assert.deepEqual(
    validate(
      s([
        { id: 'a', play: ['t'] },
        { id: 'b', play: ['open'] },
      ]),
    ),
    [],
  );
  assert.ok(
    problems(s([{ id: 'a', motion: { t: 1 }, play: ['open'] }])).includes('steps[0].play'),
    'open is held while t is away',
  );
  assert.ok(
    problems(s([{ id: 'a', explode: 1, play: ['t'] }])).includes('steps[0].explode'),
    'one way apart at a time',
  );
  assert.ok(problems(s([{ id: 'a', play: ['open', 'spin'] }])).includes('steps[0].play'), 'two of one group');
  const lone = s([], { motions: [{ ...joined.motions[0] }, { ...joined.motions[1], group: undefined }] });
  assert.ok(problems(lone).includes('motions[0].group'), 'a group of one');
  const clip = s([], { motions: [joined.motions[0], { ...joined.motions[1], then: 'start' }] });
  assert.ok(problems(clip).includes('motions[1].then'), 'a loop is no clip');
  const sharing = s([], {
    joints: [
      { id: 'hinge', parts: ['lid'], turn: { axis: [1, 0, 0] }, drive: 'open' },
      { id: 'twin', parts: ['body'], turn: { axis: [1, 0, 0] }, follow: { joint: 'hinge' } },
    ],
  });
  assert.deepEqual(problems(sharing), [], 'a joint that follows another is set by the same motion: no clash');
});

test("validate: expect seen at a sequence's stage", () => {
  const s = (expect) => scene({ id: 't', stages: [{ parts: ['lid'] }] }, { expect: [expect] });
  assert.deepEqual(validate(s({ seen: 'body', sequence: 't', stage: 1 })), []);
  assert.ok(problems(s({ seen: 'body', sequence: 'x', stage: 1 })).includes('expect[0].sequence'));
  assert.ok(problems(s({ seen: 'body', sequence: 't', stage: 2 })).includes('expect[0].stage'));
  assert.ok(problems(s({ seen: 'body' })).includes('expect[0].step'), 'seen needs a step or a stage');
});

// the story add-on as a page loads it (dist/lk3d-story.min.js, bundled here as build.mjs does): in the crease-shading
// worker (lk3dAO set, no LK3D) it does nothing; on a core without LK3D.use (0.7.0) it says which lk3d it needs
test('the built story add-on: nothing in the shading worker; refused by an older core; joins through LK3D.use once', async () => {
  const vm = require('node:vm'),
    { bundle, STORY_ENTRY } = await import('../build.mjs'),
    code = await bundle('iife', STORY_ENTRY);
  const run = (globals, context = vm.createContext({ ...globals })) => {
    context.globalThis = context;
    vm.runInContext(code, context);
    return context;
  };
  assert.doesNotThrow(() => run({ lk3dAO: true }));
  assert.throws(() => run({ LK3D: { version: 3, hostVersion: 1, M: {} } }), /lk3d-story: needs lk3d 0\.8\.0 or later/);
  const joined = [],
    LK3D = { version: 3, M: {}, use: (name, api, needs) => (joined.push(needs), (LK3D[name] = api)) },
    context = run({ LK3D });
  vm.runInContext(code, context);
  assert.equal(joined.length, 1, 'a second load does nothing');
  assert.equal(typeof LK3D.story.expand, 'function');
});
