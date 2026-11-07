// Every scene lk3d ships, the reference scenes its pictures are drawn from and the examples' scenes, passes its own
// check (lk3d check: the schema, then the geometry: nothing runs into anything as it is taken apart or moves, nothing
// hangs in the air unless it says so, no label points inside a part). A scene that shows something the check would
// refuse in a reader's page is no reference.          npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const dirs = [path.join(ROOT, 'test/visual/scenes'), path.join(ROOT, 'examples/scenes')];

for (const dir of dirs)
  for (const f of fs
    .readdirSync(dir)
    .filter((n) => n.endsWith('.json'))
    .sort()) {
    test(`${path.relative(ROOT, dir)}/${f} passes lk3d check`, () => {
      const r = spawnSync(process.execPath, [path.join(ROOT, 'bin/lk3d.mjs'), 'check', path.join(dir, f), '--json'], {
        encoding: 'utf8',
        maxBuffer: 16 << 20,
      });
      let out;
      try {
        out = JSON.parse(r.stdout);
      } catch (e) {
        assert.fail(`lk3d check did not answer: ${r.stderr || r.stdout}`);
      }
      assert.deepEqual(
        out.problems.map((p) => `${p.path}: ${p.message}`),
        [],
      );
      assert.ok(out.summary && out.summary.parts > 0);
    });
  }
