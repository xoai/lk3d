// Builds lk3d: dist/lk3d.min.js (one script that sets the global LK3D) and dist/lk3d.mjs (an ES module). esbuild
// minifies the JavaScript; the shaders' GLSL, which it leaves as written, is squeezed here: comments, indentation and
// the spaces around operators go (the GLSL compilers need none of them), and every line break stays, so the
// preprocessor's lines (#ifdef …) keep theirs. The stylesheet (stylesheet.js) loses its line breaks and the spaces around
// its punctuation the same way.
//   node build.mjs            write dist/
//   node build.mjs --size     and fail if the script grows past the budget (BUDGET_KB gzipped)
//   import { bundle } from './build.mjs'; const js = await bundle()     the global script, in memory (lk3d's own tools)
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url)),
  ENTRY = path.join(HERE, 'src/index.js');
// the glTF exporter is not in the global script (the budget's): dist/lk3d-export.min.js brings it to a page that
// exports. The module bundle has it (src/export.js), so a page importing lk3d loses nothing.
const EXPORTER = path.join(HERE, 'src/export-script.js'),
  MODULE = path.join(HERE, 'src/export.js');
// lk3d's promise is to stay small: the global script, gzipped, may not grow past this without a decision to raise it
// (57 KB until November 2026, raised to 60 for scenes and models checked inside the engine and the cut-face fix, then
// to 65 to leave room for features to come: each still earns its bytes)
export const BUDGET_KB = 67;

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
    files = ['index.js', ...fs.readdirSync(path.join(src, 'figure')).map((f) => 'figure/' + f)].filter((f) =>
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
  plugins: [glsl],
});

export async function bundle(format = 'iife', entry = ENTRY) {
  return (await esbuild.build(options(format, entry))).outputFiles[0].text;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dist = path.join(HERE, 'dist');
  fs.mkdirSync(dist, { recursive: true });
  const iife = await bundle('iife'),
    esm = await bundle('esm', MODULE),
    exporter = await bundle('iife', EXPORTER);
  fs.writeFileSync(path.join(dist, 'lk3d.min.js'), iife);
  fs.writeFileSync(path.join(dist, 'lk3d.mjs'), esm);
  fs.writeFileSync(path.join(dist, 'lk3d-export.min.js'), exporter);
  const kb = (s) => (Buffer.byteLength(s) / 1024).toFixed(1),
    gz = (s) => (zlib.gzipSync(s, { level: 9 }).length / 1024).toFixed(1);
  console.log(
    `dist/lk3d.min.js ${kb(iife)} KB (${gz(iife)} KB gzipped), dist/lk3d.mjs ${kb(esm)} KB, ` +
      `dist/lk3d-export.min.js ${kb(exporter)} KB (${gz(exporter)} KB gzipped)`,
  );
  // (compared exactly: a rounded 42.0 may be a few bytes over)
  if (process.argv.includes('--size') && zlib.gzipSync(iife, { level: 9 }).length > BUDGET_KB * 1024) {
    console.error(`✗ dist/lk3d.min.js is ${gz(iife)} KB gzipped, over the budget of ${BUDGET_KB} KB`);
    process.exitCode = 1;
  } else if (process.argv.includes('--size')) console.log(`✓ within the budget of ${BUDGET_KB} KB gzipped`);
}
