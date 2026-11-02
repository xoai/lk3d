// Builds lk3d: dist/lk3d.min.js (one script that sets the global LK3D) and dist/lk3d.mjs (an ES module). esbuild
// minifies the JavaScript; the shaders' GLSL, which it leaves as written, is squeezed here: comments, indentation and
// the spaces around operators go (the GLSL compilers need none of them), and every line break stays, so the
// preprocessor's lines (#ifdef …) keep theirs. The stylesheet (style.js) loses its line breaks and the spaces around
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
// lk3d's promise is to stay small: the global script, gzipped, may not grow past this without a decision to raise it
export const BUDGET_KB = 52;

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
    b.onLoad({ filter: /lk3d[\\/]src[\\/]style\.js$/ }, (a) => ({
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
const options = (format) => ({
  entryPoints: [ENTRY],
  bundle: true,
  write: false,
  format,
  minify: true,
  target: 'es2018',
  plugins: [glsl],
});

export async function bundle(format = 'iife') {
  return (await esbuild.build(options(format))).outputFiles[0].text;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dist = path.join(HERE, 'dist');
  fs.mkdirSync(dist, { recursive: true });
  const iife = await bundle('iife'),
    esm = await bundle('esm');
  fs.writeFileSync(path.join(dist, 'lk3d.min.js'), iife);
  fs.writeFileSync(path.join(dist, 'lk3d.mjs'), esm);
  const kb = (s) => (Buffer.byteLength(s) / 1024).toFixed(1),
    gz = (s) => (zlib.gzipSync(s, { level: 9 }).length / 1024).toFixed(1);
  console.log(`dist/lk3d.min.js ${kb(iife)} KB (${gz(iife)} KB gzipped), dist/lk3d.mjs ${kb(esm)} KB`);
  // (compared exactly: a rounded 42.0 may be a few bytes over)
  if (process.argv.includes('--size') && zlib.gzipSync(iife, { level: 9 }).length > BUDGET_KB * 1024) {
    console.error(`✗ dist/lk3d.min.js is ${gz(iife)} KB gzipped, over the budget of ${BUDGET_KB} KB`);
    process.exitCode = 1;
  } else if (process.argv.includes('--size')) console.log(`✓ within the budget of ${BUDGET_KB} KB gzipped`);
}
