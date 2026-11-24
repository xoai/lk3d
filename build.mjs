// Builds lk3d: dist/lk3d.min.js (one script that sets the global LK3D) and dist/lk3d.mjs (an ES module). esbuild
// minifies the JavaScript; the shaders' GLSL, which it leaves as written, is squeezed here: comments, indentation and
// the spaces around operators go (the GLSL compilers need none of them), and every line break stays, so the
// preprocessor's lines (#ifdef …) keep theirs. The stylesheet (stylesheet.js) loses its line breaks and the spaces around
// its punctuation the same way.
//   node build.mjs            write dist/
//   node build.mjs --size     and fail if a script grows past its budget (gzipped: the core BUDGET_KB, the add-ons theirs)
//   node build.mjs --table    and write docs/size.md: each source file's share of the global script
//   import { bundle } from './build.mjs'; const js = await bundle()     the global script, in memory (lk3d's own tools)
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url)),
  ENTRY = path.join(HERE, 'src/script.js');
// Three add-ons stay out of the global script (the budget's), each a script of its own that a page loads after it: the
// glTF reader (dist/lk3d-models.min.js), for a page that shows a model; the glTF exporter (dist/lk3d-export.min.js),
// for a page that exports; and surfaces, arrows and the card over the stage (dist/lk3d-live.min.js), for a page that
// draws them or shows the card; and sequences and the tour (dist/lk3d-story.min.js), for a page whose scene has
// sequences or that runs a tour. The module bundle has them all (src/export.js, src/index.js), so a page importing
// lk3d loses nothing.
export const MODELS_ENTRY = path.join(HERE, 'src/models-script.js'),
  LIVE_ENTRY = path.join(HERE, 'src/live-script.js'),
  STORY_ENTRY = path.join(HERE, 'src/story-script.js');
const EXPORTER = path.join(HERE, 'src/export-script.js'),
  MODULE = path.join(HERE, 'src/export.js');
// lk3d's promise is to stay small: the global script, gzipped, may not grow past this. It was 57 KB until November
// 2026, then 60, 65 and 67, 68 for 0.4.0 (the figure's state and descriptions) and 70.5 for 0.6.0 (live figures: hits,
// page drags, turned parts, colour ramps and plane handles; see the CHANGELOG), then 70.9 and 71.1, 71.3, 71.5 for 0.8.0 (the add-on host, the
// scene format: measured steps, each to the code's need, to at most 74.5 decided by the user on 2026-11-23); it is
// frozen at 71.5: a raise needs a written decision in the CHANGELOG. The add-ons have budgets of their own.
export const BUDGET_KB = 71.5;
export const MODELS_BUDGET_KB = 5,
  EXPORT_BUDGET_KB = 3,
  LIVE_BUDGET_KB = 4,
  STORY_BUDGET_KB = 3.1;

export const squeeze = (glsl) =>
  glsl
    .replace(/\/\/[^\n]*/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?([=+\-*/<>,;(){}?:&|!]) ?/g, '$1')
    .replace(/\n\s*/g, '\n');
export const squeezeCSS = (css) => css.replace(/\s*\n\s*/g, '').replace(/\s*([{};:,])\s*/g, '$1');
const glsl = {
  name: 'glsl',
  setup(b) {
    b.onLoad({ filter: /lk3d[\\/]src[\\/]stylesheet\.js$/ }, (a) => ({
      contents: fs.readFileSync(a.path, 'utf8').replace(/`((?:[^`\\]|\\.)*)`/g, (m, g) => '`' + squeezeCSS(g) + '`'),
      loader: 'js',
    }));
    // the card's stylesheet (card.js; not its HTML, whose literals hold ${…})
    b.onLoad({ filter: /lk3d[\\/]src[\\/]card\.js$/ }, (a) => ({
      contents: fs
        .readFileSync(a.path, 'utf8')
        .replace(/`((?:[^`\\]|\\.)*)`/g, (m, g) => (g.includes('${') ? m : '`' + squeezeCSS(g) + '`')),
      loader: 'js',
    }));
    // the shaders' template literals (not one with ${…}: the header's is code that writes #defines)
    b.onLoad({ filter: /lk3d[\\/]src[\\/]shaders\.js$/ }, (a) => ({
      contents: fs
        .readFileSync(a.path, 'utf8')
        .replace(/`((?:[^`\\]|\\.)*)`/g, (m, g) => (g.includes('${') ? m : '`' + squeeze(g) + '`')),
      loader: 'js',
    }));
  },
};
// the licence's notice, kept at the top of every built file (and so in every copy of it): MIT asks that it stays
const { version } = JSON.parse(fs.readFileSync(path.join(HERE, 'package.json'), 'utf8'));
export const BANNER = `/*! lk3d ${version} | MIT License | Copyright (c) 2026 xoai */`;
// A mounted figure's shared state and the functions its parts call on each other are the fields of one object (the
// context: src/figure/context.d.ts), whose names end in _. The bundle renames them as it renames locals: one or two
// letters, the most used the shortest, in the order letters are most common in the code (which gzip likes). They are
// only ever that object's fields, so the short names cannot meet another property; nothing public, in the scene format
// or the browser's ends in _.
const LETTERS = 'etnoarisclpdhuxfmgybwvkjqzETNOARISCLPDHUXFMGYBWVKJQZ';
function contextNames() {
  const src = path.join(HERE, 'src'),
    files = ['core.js', ...fs.readdirSync(path.join(src, 'figure')).map((f) => 'figure/' + f)].filter((f) =>
      f.endsWith('.js'),
    ),
    uses = {};
  for (const f of files)
    for (const [, k] of fs
      .readFileSync(path.join(src, f), 'utf8')
      .replace(/(^|\s)\/\/.*$/gm, '') // (not in comments)
      .matchAll(/\.(\w+_)\b/g))
      uses[k] = (uses[k] || 0) + 1;
  const names = [...LETTERS, ...[...LETTERS].flatMap((a) => [...LETTERS].map((b) => a + b))];
  return Object.fromEntries(
    Object.keys(uses)
      .sort((a, b) => uses[b] - uses[a] || (a < b ? -1 : 1))
      .map((k, i) => [k, names[i]]),
  );
}
// the models and story add-ons' matrices are the core's, read from LK3D.M on the page, and they carry only the few
// vector sums they need besides (the reader is all else it carries); inside the crease-shading worker, where the add-on does nothing,
// there is no LK3D: M is then undefined, and unused
const coreMaths = {
  name: 'core-maths',
  setup(b) {
    b.onResolve({ filter: /^\.\/math\.js$/ }, () => ({ path: 'core-maths', namespace: 'core-maths' }));
    b.onLoad({ filter: /.*/, namespace: 'core-maths' }, () => ({
      contents:
        'export const M = globalThis.LK3D && globalThis.LK3D.M;' +
        'export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];' +
        'export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];' +
        'export const mulv = (a, s) => [a[0] * s, a[1] * s, a[2] * s];' +
        'export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];' +
        'export const len = (a) => Math.hypot(a[0], a[1], a[2]);' +
        'export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];' +
        'export const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };',
      loader: 'js',
    }));
  },
};
const options = (format, entry) => ({
  entryPoints: [entry],
  banner: { js: BANNER },
  bundle: true,
  write: false,
  format,
  minify: true,
  target: 'es2020', // (Chrome and Edge 80, Firefox 74, Safari 13.1: README; `?.` and `??` kept as written)
  mangleProps: /_$/,
  mangleCache: contextNames(),
  plugins: entry === MODELS_ENTRY || entry === STORY_ENTRY ? [glsl, coreMaths] : [glsl],
});

export async function bundle(format = 'iife', entry = ENTRY) {
  return (await esbuild.build(options(format, entry))).outputFiles[0].text;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dist = path.join(HERE, 'dist');
  fs.mkdirSync(dist, { recursive: true });
  const iife = await bundle('iife'),
    esm = await bundle('esm', MODULE),
    models = await bundle('iife', MODELS_ENTRY),
    exporter = await bundle('iife', EXPORTER),
    live = await bundle('iife', LIVE_ENTRY),
    story = await bundle('iife', STORY_ENTRY);
  fs.writeFileSync(path.join(dist, 'lk3d.min.js'), iife);
  fs.writeFileSync(path.join(dist, 'lk3d.mjs'), esm);
  fs.writeFileSync(path.join(dist, 'lk3d-models.min.js'), models);
  fs.writeFileSync(path.join(dist, 'lk3d-export.min.js'), exporter);
  fs.writeFileSync(path.join(dist, 'lk3d-live.min.js'), live);
  fs.writeFileSync(path.join(dist, 'lk3d-story.min.js'), story);
  const kb = (s) => (Buffer.byteLength(s) / 1024).toFixed(1),
    bytes = (s) => zlib.gzipSync(s, { level: 9 }).length,
    gz = (s) => (bytes(s) / 1024).toFixed(1);
  console.log(
    `dist/lk3d.min.js ${kb(iife)} KB (${gz(iife)} KB gzipped), dist/lk3d.mjs ${kb(esm)} KB, ` +
      `dist/lk3d-models.min.js ${kb(models)} KB (${gz(models)} KB gzipped), ` +
      `dist/lk3d-export.min.js ${kb(exporter)} KB (${gz(exporter)} KB gzipped), ` +
      `dist/lk3d-live.min.js ${kb(live)} KB (${gz(live)} KB gzipped), ` +
      `dist/lk3d-story.min.js ${kb(story)} KB (${gz(story)} KB gzipped)`,
  );
  // (compared exactly: a rounded 42.0 may be a few bytes over)
  if (process.argv.includes('--size'))
    for (const [file, js, budget] of [
      ['lk3d.min.js', iife, BUDGET_KB],
      ['lk3d-models.min.js', models, MODELS_BUDGET_KB],
      ['lk3d-export.min.js', exporter, EXPORT_BUDGET_KB],
      ['lk3d-live.min.js', live, LIVE_BUDGET_KB],
      ['lk3d-story.min.js', story, STORY_BUDGET_KB],
    ])
      if (bytes(js) > budget * 1024) {
        console.error(`✗ dist/${file} is ${bytes(js)} B gzipped, over its budget of ${budget} KB`);
        process.exitCode = 1;
      } else console.log(`✓ dist/${file}: ${bytes(js)} B gzipped, within its budget of ${budget} KB`);
  if (process.argv.includes('--table')) {
    fs.writeFileSync(path.join(HERE, 'docs/size.md'), await sizeTable(bytes(iife)));
    console.log('docs/size.md');
  }
}

// docs/size.md: what each source file adds to the global script. esbuild says how many bytes of the minified script
// each one makes (its shaders squeezed as the build squeezes them); gzip works on the whole, so each file's gzipped share
// is an estimate: its share of the minified bytes, of the gzipped total.
async function sizeTable(gzipped) {
  const result = await esbuild.build({ ...options('iife', ENTRY), metafile: true }),
    out = Object.values(result.metafile.outputs)[0],
    rows = Object.entries(out.inputs)
      .map(([file, { bytesInOutput }]) => [path.relative(HERE, file), bytesInOutput])
      .filter(([, n]) => n > 0)
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)),
    total = rows.reduce((sum, [, n]) => sum + n, 0),
    kb = (n) => (n / 1024).toFixed(1);
  return [
    '# Size',
    '',
    `What each source file adds to the global script, \`dist/lk3d.min.js\`: ${kb(total)} KB minified and ${kb(gzipped)} KB`,
    `gzipped, against a budget of ${BUDGET_KB} KB (frozen: see [performance](performance.md#size)). Made by`,
    '`node build.mjs --size --table`. The minified bytes are exact; the gzipped share is an estimate (gzip compresses the',
    "whole script, not each file): the file's share of the minified bytes, of the gzipped total.",
    '',
    '| File | Minified | Gzipped (estimate) | Share |',
    '| ---- | -------: | -----------------: | ----: |',
    ...rows.map(
      ([file, n]) =>
        `| \`${file}\` | ${kb(n)} KB | ${kb((n / total) * gzipped)} KB | ${((100 * n) / total).toFixed(1)} % |`,
    ),
    '',
  ].join('\n');
}
