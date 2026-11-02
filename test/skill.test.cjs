// The lk3d skill (skill/lk3d): its links lead somewhere, its evals are well formed, and its worked example is what the
// skill asks for: right in form and geometry (no problem from validate or lint), 30 parts or more, one or two accents,
// a name and a note on every part, and a stand that stays whole when the engine is cut open.          npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'),
  path = require('path');
const { validate } = require('../src/validate.js');
const { lint } = require('../src/lint.js');

const SKILL = path.join(__dirname, '../skill/lk3d');
const read = (f) => fs.readFileSync(path.join(SKILL, f), 'utf8');
const md = (dir = SKILL) =>
  fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((e) =>
      e.isDirectory() ? md(path.join(dir, e.name)) : e.name.endsWith('.md') ? [path.join(dir, e.name)] : [],
    );

test('SKILL.md says what it is for, in the Agent Skills form', () => {
  const s = read('SKILL.md'),
    head = s.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(head, 'front matter');
  assert.match(head[1], /^name: lk3d$/m);
  const d = head[1].match(/^description: (.+)$/m)[1];
  assert.ok(d.length > 100 && d.length < 1024, `description: ${d.length} characters`);
  assert.ok(s.split(/\s+/).length < 2600, 'short: the detail is in the references');
});

test('every link in the skill leads to a file that exists', () => {
  for (const f of md())
    for (const [, link] of fs.readFileSync(f, 'utf8').matchAll(/\]\(([^)#\s]+)(?:#[^)]*)?\)/g)) {
      if (/^https?:/.test(link)) continue;
      assert.ok(fs.existsSync(path.resolve(path.dirname(f), link)), `${path.relative(SKILL, f)} → ${link}`);
    }
});

test('the evals: each a prompt, what a good answer has, and checks that can be measured', () => {
  const { evals } = JSON.parse(read('evals/evals.json'));
  assert.ok(evals.length >= 5);
  const ids = new Set();
  for (const e of evals) {
    assert.ok(e.id && !ids.has(e.id), e.id);
    ids.add(e.id);
    assert.ok(e.prompt.length > 40 && e.expected_output.length > 100, e.id);
    assert.ok(e.checks.minParts > 0 && e.checks.lintClean === true && e.checks.rendered === true, e.id);
  }
});

test('the worked example is what the skill asks for', () => {
  const scene = JSON.parse(read('references/example/turbofan.json'));
  assert.deepEqual(validate(scene), []);
  const r = lint(scene);
  assert.deepEqual(r.problems, []);
  assert.ok(r.summary.parts >= 60, `${r.summary.parts} parts: a machine's figure, each stage and section its own part`);
  assert.ok(r.summary.accents >= 1 && r.summary.accents <= 2, `${r.summary.accents} accents`);
  for (const p of scene.parts) assert.ok(p.name && p.note && /[.!?]$/.test(p.note), `${p.id}: a name and a whole note`);
  assert.equal(scene.lk3d, 1);
  assert.equal(scene.style, 'pen');
  assert.equal(scene.view.projection, 'ortho');
  // the object as it is: no invented stand or base kept whole while the rest is cut open, nothing excused
  assert.ok(!scene.parts.some((p) => p.cut === false), 'no invented stand');
  assert.equal(scene.check, undefined);
});
