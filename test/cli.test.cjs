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
