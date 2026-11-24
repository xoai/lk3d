// lk3d on the command line (bin/lk3d.mjs): every bundled example scene checks clean; a broken scene, a scene that is not
// one, a look that does not exist are each said plainly, with the exit code a script can act on.          npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..'),
  // (a time limit on each run: a CLI that never exits fails the test rather than holding a CI job for hours)
  LIMIT = { encoding: 'utf8', timeout: 120000, killSignal: 'SIGKILL' },
  run = (...args) => spawnSync(process.execPath, [path.join(ROOT, 'bin/lk3d.mjs'), ...args], LIMIT),
  tmp = (name, text) => {
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lk3d-')), name);
    fs.writeFileSync(f, text);
    return f;
  };

test("every example scene, and the skill's worked example, checks clean", () => {
  const files = [
    ...fs.readdirSync(path.join(ROOT, 'examples/scenes')).map((f) => path.join(ROOT, 'examples/scenes', f)),
    ...fs
      .readdirSync(path.join(ROOT, 'skill/lk3d/references/example'))
      .map((f) => path.join(ROOT, 'skill/lk3d/references/example', f)),
  ].filter((f) => f.endsWith('.json'));
  assert.ok(files.length >= 8);
  for (const f of files) {
    const r = run('check', f);
    assert.equal(r.status, 0, `${path.basename(f)}: ${r.stdout}${r.stderr}`);
    assert.match(r.stdout, /no problems/);
  }
});

test('problems and failures: exit codes, stderr, JSON when asked, flags anywhere', () => {
  const broken = tmp(
    'broken.json',
    JSON.stringify({
      parts: [
        { id: 'a', shapes: [{ box: [1, 1, 1] }] },
        {
          id: 'b',
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
    }),
  );
  let r = run('check', broken);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /makes no triangles/);
  r = run('check', '--json', broken); // (the flag before the file)
  assert.equal(r.status, 1);
  assert.ok(JSON.parse(r.stdout).problems.length >= 1);
  const notScene = tmp('null.json', 'null');
  r = run('check', notScene);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /a scene is a JSON object/);
  r = run('check', notScene, '--json');
  assert.equal(r.status, 2);
  assert.equal(JSON.parse(r.stdout).problems[0].message, 'a scene is a JSON object');
  r = run('render', path.join(ROOT, 'examples/scenes/lens.json'), '--looks', 'photo');
  assert.equal(r.status, 2);
  assert.match(r.stderr, /no look or pose photo/);
  assert.equal(run('--help').status, 0);
  assert.equal(run('nonsense').status, 2);
});

test('render draws with the engine built from src/, never a dist/ left over from an old build', (t) => {
  // a copy of lk3d whose dist/ holds a stale "engine" that says so when used (and none of examples/ or test/)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lk3d-copy-'));
  for (const f of ['bin', 'src', 'schema', 'build.mjs', 'package.json'])
    fs.cpSync(path.join(ROOT, f), path.join(dir, f), { recursive: true });
  fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(dir, 'node_modules'), 'dir');
  fs.mkdirSync(path.join(dir, 'dist'));
  fs.writeFileSync(
    path.join(dir, 'dist/lk3d.min.js'),
    'window.LK3D = { mount(el) { dispatchEvent(new ErrorEvent("error", { message: "drawn with the stale dist/" }));' +
      ' el.innerHTML = \'<div class="lk3d-stage" style="height:8px"></div>\'; return { ready: Promise.resolve(), set() {} }; } };',
  );
  const scene = tmp('box.json', JSON.stringify({ parts: [{ id: 'box', name: 'Box', shapes: [{ box: [1, 1, 1] }] }] }));
  const out = path.join(dir, 'out'),
    r = spawnSync(
      process.execPath,
      [path.join(dir, 'bin/lk3d.mjs'), 'render', scene, '--looks', 'pen', '--poses', 'rest', '--out', out],
      LIMIT,
    );
  assert.ok(!r.error, `render did not finish: ${r.error}`);
  if (r.status === 2 && /needs Playwright/.test(r.stderr)) return t.skip('no Playwright here');
  assert.doesNotMatch(r.stdout + r.stderr, /stale dist/);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(fs.statSync(path.join(out, 'box-pen-rest.png')).size > 1000, 'a picture of the box');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('render with Playwright but no browser says so and ends, never waits forever', (t) => {
  // planted: a browser that is not installed (CI ran npm test before installing one, and render hung six hours)
  try {
    require.resolve('playwright');
  } catch {
    return t.skip('no Playwright here');
  }
  const none = fs.mkdtempSync(path.join(os.tmpdir(), 'lk3d-no-browsers-')),
    scene = tmp('ball.json', JSON.stringify({ parts: [{ id: 'ball', shapes: [{ sphere: 1 }] }] })),
    r = spawnSync(process.execPath, [path.join(ROOT, 'bin/lk3d.mjs'), 'render', scene, '--out', none], {
      ...LIMIT,
      timeout: 30000,
      env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: none },
    });
  fs.rmSync(none, { recursive: true, force: true });
  assert.ok(!r.error, `render did not end: ${r.error}`);
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /needs Playwright's Chromium: npx playwright install chromium/);
});

test('a warning is said and passes: lk3d check exits 0 on warnings alone', () => {
  const L = [
    { box: [0.6, 0.2, 0.2], at: [0.2, 0.2, 0] },
    { box: [0.2, 0.2, 0.6], at: [0.4, 0.2, 0.3] },
  ];
  const scene = tmp(
    'wings.json',
    JSON.stringify({
      parts: [
        { id: 'base', name: 'Base', shapes: [{ box: [2, 0.2, 2] }] },
        { id: 'wing-l', name: 'Left', shapes: L, at: [-0.5, 0, 0] },
        { id: 'wing-r', name: 'Right', shapes: L, at: [0.5, 0, 0], rot: [0, 180, 0] },
      ],
    }),
  );
  const r = run('check', scene);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /warning: parts\[2\]: wing-l and wing-r are the same shapes turned 180° about y/);
  assert.match(r.stdout, /no problems, 1 warning/);
});

test('render --sheet: every picture on one, and the questions to answer looking at it', (t) => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'lk3d-sheet-'));
  let r = run(
    'render',
    path.join(ROOT, 'examples/scenes/lens.json'),
    '--looks',
    'pen',
    '--poses',
    'rest',
    '--sheet',
    '--names',
    '--out',
    out,
  );
  if (r.status === 2 && /needs Playwright/.test(r.stderr)) return t.skip('no Playwright here');
  assert.equal(r.status, 0, r.stderr);
  assert.ok(fs.statSync(path.join(out, 'lens-sheet.png')).size > 10000, 'the sheet');
  assert.ok(fs.existsSync(path.join(out, 'lens-names.png')), 'the parts by id');
  const questions = fs.readFileSync(path.join(out, 'lens-sheet.md'), 'utf8');
  assert.match(questions, /«distance from the object to the lens» sit where it measures/);
  assert.match(questions, /«focal length»/);
  // a step's words, and a part that rests on one other only
  const scene = tmp(
    'small.json',
    JSON.stringify({
      parts: [
        { id: 'base', name: 'Base', shapes: [{ box: [2, 0.2, 2] }] },
        { id: 'post', name: 'Post', shapes: [{ box: [0.2, 1, 0.2], at: [0, 0.6, 0] }] },
      ],
      steps: [{ title: 'Step one', text: 'Look at the <b>post</b>', labels: ['post'] }],
      expect: [{ seen: 'post', step: 1 }],
    }),
  );
  r = run('render', scene, '--looks', 'pen', '--poses', 'rest', '--sheet', '--out', out);
  assert.equal(r.status, 0, r.stderr);
  const small = fs.readFileSync(path.join(out, 'small-sheet.md'), 'utf8');
  assert.match(small, /Step 1 says «Look at the post»\. Does the picture show Post\?/);
  assert.match(small, /Is Post visible in step 1\?/);
  assert.match(small, /Does Post rest on Base as the real object does\?/);
});

test("lk3d place writes each placed part's at into the file, only those numbers, and a second run changes nothing", () => {
  const text = JSON.stringify(
    {
      parts: [
        { id: 'base', name: 'Base', shapes: [{ box: [2, 0.2, 2] }] },
        { id: 'post', name: 'Post', place: { on: 'base' }, label: [0.1, 0.6, 0], shapes: [{ box: [0.2, 1, 0.2] }] },
        { id: 'cap', name: 'Cap', place: { on: 'post' }, at: [0, 0, 0], shapes: [{ box: [0.4, 0.1, 0.4] }] },
      ],
    },
    null,
    2,
  );
  const file = tmp('placed.json', text + '\n');
  let r = run('check', file);
  assert.equal(r.status, 1, 'refused before: no at, and an at that drifted');
  assert.match(
    r.stdout,
    /post has place but no at[\s\S]*cap's at \[0, 0, 0\] is not where place puts it \(\[0, 1.15, 0\]\)/,
  );
  r = run('place', file);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const once = fs.readFileSync(file, 'utf8');
  assert.deepEqual(JSON.parse(once).parts[1].at, [0, 0.6, 0]);
  assert.match(once, /"place": \{\n\s+"on": "base"\n\s+\},\n\s+"at": \[0, 0.6, 0\],/, 'at right after place');
  assert.equal(run('check', file).status, 0);
  run('place', file);
  assert.equal(fs.readFileSync(file, 'utf8'), once, 'a second run changes nothing');
  // a scene a script writes is placed by the script
  r = run('place', path.join(ROOT, 'examples/scenes/armillary.json'));
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /written by examples\/armillary.mjs: place its parts there, with resolvePlace/);
});

test('lk3d skill install copies the skill, its links pointing at the guides it bundles; pack zips it; llms.txt lists the guides', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lk3d-skill-'));
  let r = run('skill', 'install', '--to', dir);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const skill = path.join(dir, 'lk3d'),
    text = fs.readFileSync(path.join(skill, 'SKILL.md'), 'utf8');
  assert.ok(fs.existsSync(path.join(skill, 'references/craft.md')), 'its references');
  assert.ok(!fs.existsSync(path.join(skill, 'evals')), 'not its evals');
  // every link to a guide points into the copy, and the guide is there
  for (const [, link] of text.matchAll(/\]\((docs\/[^)#\s]+\.md)/g))
    assert.ok(fs.existsSync(path.join(skill, link)), `${link} is bundled`);
  assert.doesNotMatch(text, /\]\(\.\.\/\.\.\/docs\//, 'no link out of the copy');
  // installed again: replaced, not added to; a folder that is not a skill is left alone
  fs.writeFileSync(path.join(skill, 'stale.md'), 'old');
  run('skill', 'install', '--to', dir);
  assert.ok(!fs.existsSync(path.join(skill, 'stale.md')));
  const notSkill = path.join(dir, 'other');
  fs.mkdirSync(path.join(notSkill, 'lk3d'), { recursive: true });
  r = run('skill', 'install', '--to', notSkill);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /is not a skill/);
  // packed: a zip with the same files, each readable
  r = run('skill', 'pack', '--out', dir);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const zip = path.join(dir, 'lk3d-skill.zip'),
    test = spawnSync('unzip', ['-t', zip], { encoding: 'utf8' });
  if (!test.error) assert.match(test.stdout, /No errors detected/);
  assert.equal(fs.readFileSync(zip).readUInt32LE(0), 0x04034b50);
  // llms.txt: every guide, each with its first sentence
  r = spawnSync(process.execPath, [path.join(ROOT, 'scripts/llms.mjs'), dir], LIMIT);
  assert.equal(r.status, 0, r.stderr);
  const index = fs.readFileSync(path.join(dir, 'llms.txt'), 'utf8');
  for (const guide of ['scene-format', 'api', 'shapes', 'recipes'].filter((g) =>
    fs.existsSync(path.join(ROOT, `docs/${g}.md`)),
  ))
    assert.match(index, new RegExp(`docs/${guide}\\.md\\): \\S`), guide);
  assert.ok(fs.statSync(path.join(dir, 'llms-full.txt')).size > 100000);
});

test('render: a step that plays a teardown is pictured where its play ends (apart); a sequence at its stages, captioned', (t) => {
  let playwright = null;
  try {
    playwright = require.resolve('playwright', { paths: [ROOT] });
  } catch {
    // (none here)
  }
  if (!playwright) return t.skip('needs Playwright');
  const scene = tmp(
      'box.json',
      JSON.stringify({
        title: 'A box',
        parts: [
          { id: 'base', name: 'Base', shapes: [{ box: [2, 0.2, 2] }] },
          { id: 'lid', name: 'Lid', at: [0, 0.2, 0], explode: [0, 1, 0], shapes: [{ box: [1, 0.2, 1] }] },
        ],
        sequences: [{ id: 'off', name: 'Off', stages: [{ parts: ['lid'], title: 'Lid' }] }],
        steps: [{ title: 'Open', play: ['off'] }],
      }),
    ),
    out = path.dirname(scene),
    r = run('render', scene, '--looks', 'pen', '--poses', 'steps,sequences', '--out', out);
  if (r.status === 2 && /needs Playwright/.test(r.stderr)) return t.skip('no browser here');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(
    fs.readFileSync(path.join(out, 'box-pen-step1.txt'), 'utf8'),
    /Off: stage 1 of 1, Lid/,
    'the step pictured apart',
  );
  const captions = JSON.parse(fs.readFileSync(path.join(out, 'box-render.json'), 'utf8')).pictures.map(
    (p) => p.caption,
  );
  assert.deepEqual(
    captions.filter((c) => c.startsWith('off')),
    ['off 0/1', 'off 1/1: Lid'],
  );
});
