#!/usr/bin/env node
// lk3d from the command line: check a scene, and draw it to pictures to look at (what an author, or an AI agent writing
// a scene, runs after each step).
//   lk3d check scene.json [--json]
//       the format (lk3d/validate) and the geometry (lk3d/lint), with the scene's size: exit code 1 on any problem
//   lk3d render scene.json [--looks pen,ink,studio] [--poses rest,apart,cut] [--theme NAME] [--ortho] [--width 640]
//                          [--out DIR]
//       PNG pictures, one per look and pose, drawn by the real engine in a headless browser (Playwright); without
//       Playwright it says so: the scene is then not checked by eye
//   lk3d export scene.json [out.glb] [--animate] [--motion id=value,…]
//       the scene as glTF 2.0 binary (Blender, game engines, viewers): parts as named nodes with their materials, posed
//       at the motions' starts (or --motion), each motion an animation with --animate
// A model given as a file ("file": "heart.glb") is read in, as a build would: from beside the scene, or beside the page
// one folder up (as the examples keep them), or from where lk3d runs.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { validate } from '../src/validate.js';
import { lint } from '../src/lint.js';
import { sceneToGLB } from '../src/gltf-write.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
// the words on the command line: flags (--name, or --name value) anywhere, the rest in order (the command, the file)
const VALUED = new Set(['looks', 'poses', 'theme', 'width', 'out', 'motion']),
  flags = {},
  words = [];
for (const args = process.argv.slice(2); args.length;) {
  const arg = args.shift();
  if (arg.startsWith('--')) flags[arg.slice(2)] = VALUED.has(arg.slice(2)) && args.length ? args.shift() : true;
  else words.push(arg);
}
const [command, file] = words,
  flag = (name, fallback) => flags[name] ?? fallback;
// a failure said where it belongs: on stderr, or as JSON when JSON was asked for
const fail = (message, code = 2) => {
  if (flags.json) console.log(JSON.stringify({ summary: null, problems: [{ path: '(scene)', message }] }, null, 2));
  else console.error(`lk3d ${command}: ${message}`);
  process.exitCode = code;
};
const LOOKS = ['pen', 'studio', 'ink'],
  POSES = ['rest', 'apart', 'cut'];
const USAGE = `usage: lk3d check scene.json [--json]
       lk3d export scene.json [out.glb] [--animate] [--motion id=value,…]
       lk3d render scene.json [--looks pen,ink,studio] [--poses rest,apart,cut] [--theme NAME] [--ortho] [--width 640] [--out DIR]`;

function load(scenePath) {
  const scene = JSON.parse(fs.readFileSync(scenePath, 'utf8'));
  if (!scene || typeof scene !== 'object' || Array.isArray(scene)) throw new Error('a scene is a JSON object');
  for (const [name, model] of Object.entries(scene.models || {}))
    if (model.file && !model.data) {
      const found = [path.dirname(scenePath), path.dirname(path.dirname(scenePath)), '.']
        .map((dir) => path.resolve(dir, model.file))
        .find((candidate) => fs.existsSync(candidate));
      if (!found) throw new Error(`the model ${name}: no file ${model.file} beside the scene, the page or here`);
      model.data = fs.readFileSync(found).toString('base64');
    }
  return scene;
}

function exportGLB(scenePath, outPath) {
  const scene = load(scenePath),
    problems = validate(scene);
  if (problems.length)
    return fail(
      `not a valid scene (lk3d check ${path.basename(scenePath)}): ${problems[0].path}: ${problems[0].message}`,
      1,
    );
  const motion = Object.fromEntries(
    String(flag('motion', ''))
      .split(',')
      .filter(Boolean)
      .map((pair) => [pair.split('=')[0], +pair.split('=')[1]]),
  );
  const glb = sceneToGLB(scene, { motion, animate: !!flag('animate') }),
    target = outPath || scenePath.replace(/\.json$/i, '') + '.glb';
  fs.writeFileSync(target, glb);
  console.log(
    `${target}: ${(glb.length / 1e6).toFixed(1)} MB` +
      (flag('animate') ? `, ${(scene.motions || []).length} animation(s)` : ''),
  );
}

function check(scenePath) {
  const scene = load(scenePath),
    problems = validate(scene);
  // the geometry is checked only on a scene in the right form (a wrong one may not build); a scene that still does not
  // build is one problem, said as the others are
  let geometry = { problems: [], summary: null };
  if (!problems.length)
    try {
      geometry = lint(scene);
    } catch (error) {
      geometry.problems.push({ path: '(scene)', message: error.message.replace(/^lk3d: /, '') });
    }
  const all = [...problems, ...geometry.problems];
  if (flag('json')) console.log(JSON.stringify({ summary: geometry.summary, problems: all }, null, 2));
  else {
    const summary = geometry.summary;
    if (summary)
      console.log(
        `${path.basename(scenePath)}: ${summary.parts} parts (${summary.named} named, ${summary.accents} accent), ` +
          `${summary.shapes} shapes, ${summary.placed} placed, ${summary.triangles} triangles, ` +
          `${+summary.size.toFixed(2)} units across`,
      );
    for (const problem of all) console.log(`  ${problem.path || '(scene)'}: ${problem.message}`);
    console.log(all.length ? `${all.length} problem${all.length > 1 ? 's' : ''}` : 'no problems');
  }
  process.exitCode = all.length ? 1 : 0;
}

// the page the pictures are drawn on: the built engine, the scene, a fixed width; window.__ready once it is complete
const PAGE = `<!doctype html><meta charset="utf-8"><title>lk3d render</title>
<style>body{margin:0;background:#fff;font-family:system-ui,sans-serif}#g{width:WIDTHpx}.lk3d{margin:0}.lk3d-hint{display:none}</style>
<div id="g"></div><script src="/lk3d.min.js"></script><script type="module">
const query = new URLSearchParams(location.search), scene = await (await fetch('/scene.json')).json(), errors = [];
window.addEventListener('error', (e) => errors.push(String(e.message)));
if (query.get('ortho')) scene.view = { ...scene.view, projection: 'ortho' };
const fig = LK3D.mount(document.getElementById('g'), scene, { controls: false, adaptive: false, locale: 'en',
  style: query.get('look'), theme: query.get('theme') || undefined, labels: query.get('pose') === 'apart' ? 'auto' : 'none' });
await Promise.race([fig.ready, new Promise((resolve) => setTimeout(resolve, 30000))]);
if (query.get('pose') === 'apart') fig.set({ explode: 1 });
if (query.get('pose') === 'cut') fig.set({ cut: true });
for (let k = 0; k < 3; k++) await new Promise((resolve) => requestAnimationFrame(resolve));
window.__ready = { errors, renderer: fig.renderer };
</script>`;

// the engine render draws with: built from src/ now, in memory (not dist/, which a fresh clone lacks and an old build
// would leave out of date); only where esbuild is not installed, an installed package without its development tools,
// the bundle it shipped with (built from the same source when it was packed)
async function engineScript() {
  try {
    return await (await import('../build.mjs')).bundle();
  } catch (error) {
    const shipped = path.join(ROOT, 'dist/lk3d.min.js');
    if (error.code === 'ERR_MODULE_NOT_FOUND' && fs.existsSync(shipped)) return fs.readFileSync(shipped);
    throw new Error(`could not build the engine from src/ (${error.message.split('\n')[0]}): run npm install in lk3d`, {
      cause: error,
    });
  }
}

async function render(scenePath) {
  let playwright = null;
  for (const name of ['playwright', '@playwright/test'])
    try {
      playwright = await import(name);
      break;
    } catch {
      // (try the next)
    }
  if (!playwright || !playwright.chromium) {
    console.error(
      'lk3d render needs Playwright: npm i -D playwright && npx playwright install chromium\n' +
        'not checked visually: nothing was drawn',
    );
    process.exitCode = 2;
    return;
  }
  const data = load(scenePath),
    problems = validate(data);
  if (problems.length) {
    for (const problem of problems) console.error(`  ${problem.path || '(scene)'}: ${problem.message}`);
    return fail(
      `the scene is not in the right form (${problems.length} problem${problems.length > 1 ? 's' : ''}): run lk3d check`,
      1,
    );
  }
  const width = Number(flag('width', 640)),
    looks = String(flag('looks', 'pen,ink')).split(','),
    poses = String(flag('poses', 'rest,apart,cut')).split(','),
    unknown = [...looks.filter((look) => !LOOKS.includes(look)), ...poses.filter((pose) => !POSES.includes(pose))];
  if (!(width >= 64 && width <= 4096))
    return fail(`--width is a number of pixels from 64 to 4096, not ${flag('width')}`);
  if (unknown.length)
    return fail(`no look or pose ${unknown.join(', ')} (looks: ${LOOKS.join(', ')}; poses: ${POSES.join(', ')})`);
  const scene = JSON.stringify(data),
    engine = await engineScript(),
    page = PAGE.replace('WIDTH', String(width));
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://x').pathname;
    const [type, body] =
      pathname === '/lk3d.min.js'
        ? ['text/javascript', engine]
        : pathname === '/scene.json'
          ? ['application/json', scene]
          : ['text/html', page];
    res.writeHead(200, { 'content-type': type });
    res.end(body);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/`,
    out = path.resolve(String(flag('out', '.'))),
    name = path.basename(scenePath).replace(/\.json$/, ''),
    theme = flag('theme', ''),
    ortho = flag('ortho', false);
  fs.mkdirSync(out, { recursive: true });
  // the browser started inside the guard that closes the server: an error left it listening, and Node waited forever
  // (a CI job with Playwright but no browser yet hung six hours)
  let browser;
  try {
    browser = await playwright.chromium.launch();
  } catch (error) {
    server.close();
    console.error(
      "lk3d render needs Playwright's Chromium: npx playwright install chromium\n" +
        `(${String(error.message).split('\n')[0]})\nnot checked visually: nothing was drawn`,
    );
    process.exitCode = 2;
    return;
  }
  let errorCount = 0;
  try {
    const tab = await browser.newPage({ deviceScaleFactor: 2 });
    for (const look of looks)
      for (const pose of poses) {
        await tab.goto(`${base}?look=${look}&pose=${pose}${theme ? '&theme=' + theme : ''}${ortho ? '&ortho=1' : ''}`);
        const result = await (await tab.waitForFunction(() => window.__ready, null, { timeout: 60000 })).jsonValue();
        const png = path.join(out, `${name}-${look}-${pose}.png`);
        await tab.locator('.lk3d-stage').screenshot({ path: png });
        console.log(png + (result.errors.length ? '  errors: ' + result.errors.join('; ') : ''));
        errorCount += result.errors.length;
      }
  } finally {
    await browser.close();
    server.close();
  }
  console.log('look at each picture: is every part where it should be, and does it read at a glance?');
  process.exitCode = errorCount ? 1 : 0;
}

try {
  if (command === 'check' && file) check(file);
  else if (command === 'render' && file) await render(file);
  else if (command === 'export' && file) exportGLB(file, words[2]);
  else if (!command || command === 'help' || flags.help) console.log(USAGE);
  else {
    console.error(USAGE);
    process.exitCode = 2;
  }
} catch (error) {
  fail(error.message);
}
