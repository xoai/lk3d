// The skill's evals (skill/lk3d/evals/evals.json), graded: each eval is a prompt an agent tried with the skill, and its
// checks are measured on the scene the agent wrote. Put each answer in one folder as ID.json (the eval's id), with its
// pictures beside it as ID-*.png (lk3d render --out), then:
//   npm run evals -- DIR      (node scripts/evals.mjs DIR)
// It prints each eval's result and the pass rate, which each release's CHANGELOG records. An eval with no scene in the
// folder fails. The checks: minParts (at least so many parts), accents ([least, most]), handles (at least so many parts
// with a handle), lintClean (lk3d check finds no problem), rendered (a picture beside it), scale ("bar": a scale bar).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validate } from '../src/validate.js';
import { lint } from '../src/lint.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const EVALS = path.join(ROOT, 'skill/lk3d/evals/evals.json');

/** the scene's models given as files, read in from beside the scene (as lk3d check does) */
function withModels(scene, dir) {
  for (const model of Object.values(scene.models || {}))
    if (model.file && !model.data) {
      const file = path.resolve(dir, model.file);
      if (fs.existsSync(file)) model.data = fs.readFileSync(file).toString('base64');
    }
  return scene;
}

/** each eval's result on the answers in dir: { id, passed, failed: [what failed] } */
export function grade(dir, evals = JSON.parse(fs.readFileSync(EVALS, 'utf8')).evals) {
  const files = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
  return evals.map(({ id, checks }) => {
    const file = path.join(dir, `${id}.json`);
    if (!fs.existsSync(file)) return { id, passed: false, failed: [`no ${id}.json`] };
    const failed = [];
    let scene;
    try {
      scene = withModels(JSON.parse(fs.readFileSync(file, 'utf8')), dir);
    } catch (e) {
      return { id, passed: false, failed: [`${id}.json is not JSON (${e.message})`] };
    }
    const problems = validate(scene);
    const linted = problems.length ? null : lint(scene);
    const summary = linted?.summary;
    const lintProblems = linted ? linted.problems.filter((p) => p.level !== 'warning') : [];
    if (checks.lintClean && (problems.length || lintProblems.length))
      failed.push(`lk3d check: ${[...problems, ...lintProblems].length} problems`);
    if (checks.minParts && !(summary && summary.parts >= checks.minParts))
      failed.push(`${summary ? summary.parts : '?'} parts, fewer than ${checks.minParts}`);
    if (checks.accents && !(summary && summary.accents >= checks.accents[0] && summary.accents <= checks.accents[1]))
      failed.push(`${summary ? summary.accents : '?'} accents, not ${checks.accents[0]} to ${checks.accents[1]}`);
    const handles = (scene.parts || []).filter((p) => p.handle).length;
    if (checks.handles && handles < checks.handles) failed.push(`${handles} handles, fewer than ${checks.handles}`);
    if (checks.rendered && !files.some((f) => f.startsWith(`${id}-`) && f.endsWith('.png'))) failed.push('no picture');
    if (checks.scale === 'bar' && !scene.scale?.bar) failed.push('no scale bar');
    return { id, passed: !failed.length, failed };
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2];
  if (!dir) {
    console.error('usage: npm run evals -- DIR   (each answer as DIR/ID.json, its pictures as DIR/ID-*.png)');
    process.exit(2);
  }
  const results = grade(dir),
    passed = results.filter((r) => r.passed).length;
  for (const r of results) console.log(`${r.passed ? '✓' : '✗'} ${r.id}${r.passed ? '' : ': ' + r.failed.join('; ')}`);
  console.log(`pass rate: ${passed} of ${results.length} (${Math.round((100 * passed) / results.length)} %)`);
}
