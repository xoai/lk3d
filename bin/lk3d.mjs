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
  const a = args.shift();
  if (a.startsWith('--')) flags[a.slice(2)] = VALUED.has(a.slice(2)) && args.length ? args.shift() : true;
  else words.push(a);
}
const [cmd, file] = words,
  flag = (name, dflt) => flags[name] ?? dflt;
// a failure said where it belongs: on stderr, or as JSON when JSON was asked for
const fail = (message, code = 2) => {
  if (flags.json) console.log(JSON.stringify({ summary: null, problems: [{ path: '(scene)', message }] }, null, 2));
  else console.error(`lk3d ${cmd}: ${message}`);
  process.exitCode = code;
};
const LOOKS = ['pen', 'studio', 'ink'],
  POSES = ['rest', 'apart', 'cut'];
const USAGE = `usage: lk3d check scene.json [--json]
       lk3d export scene.json [out.glb] [--animate] [--motion id=value,…]
       lk3d render scene.json [--looks pen,ink,studio] [--poses rest,apart,cut] [--theme NAME] [--ortho] [--width 640] [--out DIR]`;

function load(f) {
  const scene = JSON.parse(fs.readFileSync(f, 'utf8'));
  if (!scene || typeof scene !== 'object' || Array.isArray(scene)) throw new Error('a scene is a JSON object');
  for (const [name, m] of Object.entries(scene.models || {}))
    if (m.file && !m.data) {
      const at = [path.dirname(f), path.dirname(path.dirname(f)), '.']
        .map((d) => path.resolve(d, m.file))
        .find((p) => fs.existsSync(p));
      if (!at) throw new Error(`the model ${name}: no file ${m.file} beside the scene, the page or here`);
      m.data = fs.readFileSync(at).toString('base64');
    }
  return scene;
}

function exportGLB(f, out) {
  const scene = load(f),
    problems = validate(scene);
  if (problems.length)
    return fail(`not a valid scene (lk3d check ${path.basename(f)}): ${problems[0].path}: ${problems[0].message}`, 1);
  const motion = Object.fromEntries(
    String(flag('motion', ''))
      .split(',')
      .filter(Boolean)
      .map((kv) => [kv.split('=')[0], +kv.split('=')[1]]),
  );
  const glb = sceneToGLB(scene, { motion, animate: !!flag('animate') }),
    to = out || f.replace(/\.json$/i, '') + '.glb';
  fs.writeFileSync(to, glb);
  console.log(
    `${to}: ${(glb.length / 1e6).toFixed(1)} MB` +
      (flag('animate') ? `, ${(scene.motions || []).length} animation(s)` : ''),
  );
}

function check(f) {
  const scene = load(f),
    problems = validate(scene);
  // the geometry is checked only on a scene in the right form (a wrong one may not build); a scene that still does not
  // build is one problem, said as the others are
  let r = { problems: [], summary: null };
  if (!problems.length)
    try {
      r = lint(scene);
    } catch (e) {
      r.problems.push({ path: '(scene)', message: e.message.replace(/^lk3d: /, '') });
    }
  const all = [...problems, ...r.problems];
  if (flag('json')) console.log(JSON.stringify({ summary: r.summary, problems: all }, null, 2));
  else {
    const s = r.summary;
    if (s)
      console.log(
        `${path.basename(f)}: ${s.parts} parts (${s.named} named, ${s.accents} accent), ${s.shapes} shapes, ` +
          `${s.placed} placed, ${s.triangles} triangles, ${+s.size.toFixed(2)} units across`,
      );
    for (const e of all) console.log(`  ${e.path || '(scene)'}: ${e.message}`);
    console.log(all.length ? `${all.length} problem${all.length > 1 ? 's' : ''}` : 'no problems');
  }
  process.exitCode = all.length ? 1 : 0;
}

// the page the pictures are drawn on: the built engine, the scene, a fixed width; window.__ready once it is complete
const PAGE = `<!doctype html><meta charset="utf-8"><title>lk3d render</title>
<style>body{margin:0;background:#fff;font-family:system-ui,sans-serif}#g{width:WIDTHpx}.lk3d{margin:0}.lk3d-hint{display:none}</style>
<div id="g"></div><script src="/lk3d.min.js"></script><script type="module">
const q = new URLSearchParams(location.search), scene = await (await fetch('/scene.json')).json(), errors = [];
window.addEventListener('error', (e) => errors.push(String(e.message)));
if (q.get('ortho')) scene.view = { ...scene.view, projection: 'ortho' };
const fig = LK3D.mount(document.getElementById('g'), scene, { controls: false, adaptive: false, locale: 'en',
  style: q.get('look'), theme: q.get('theme') || undefined, labels: q.get('pose') === 'apart' ? 'auto' : 'none' });
await Promise.race([fig.ready, new Promise((r) => setTimeout(r, 30000))]);
if (q.get('pose') === 'apart') fig.set({ explode: 1 });
if (q.get('pose') === 'cut') fig.set({ cut: true });
for (let k = 0; k < 3; k++) await new Promise((r) => requestAnimationFrame(r));
window.__ready = { errors, renderer: fig.renderer };
</script>`;

// the engine render draws with: built from src/ now, in memory (not dist/, which a fresh clone lacks and an old build
// would leave out of date); only where esbuild is not installed, an installed package without its development tools,
// the bundle it shipped with (built from the same source when it was packed)
async function engineScript() {
  try {
    return await (await import('../build.mjs')).bundle();
  } catch (e) {
    const shipped = path.join(ROOT, 'dist/lk3d.min.js');
    if (e.code === 'ERR_MODULE_NOT_FOUND' && fs.existsSync(shipped)) return fs.readFileSync(shipped);
    throw new Error(`could not build the engine from src/ (${e.message.split('\n')[0]}): run npm install in lk3d`, {
      cause: e,
    });
  }
}

async function render(f) {
  let pw = null;
  for (const name of ['playwright', '@playwright/test'])
    try {
      pw = await import(name);
      break;
    } catch {
      // (try the next)
    }
  if (!pw || !pw.chromium) {
    console.error(
      'lk3d render needs Playwright: npm i -D playwright && npx playwright install chromium\n' +
        'not checked visually: nothing was drawn',
    );
    process.exitCode = 2;
    return;
  }
  const data = load(f),
    wrong = validate(data);
  if (wrong.length) {
    for (const e of wrong) console.error(`  ${e.path || '(scene)'}: ${e.message}`);
    return fail(
      `the scene is not in the right form (${wrong.length} problem${wrong.length > 1 ? 's' : ''}): run lk3d check`,
      1,
    );
  }
  const width = Number(flag('width', 640)),
    looks = String(flag('looks', 'pen,ink')).split(','),
    poses = String(flag('poses', 'rest,apart,cut')).split(','),
    odd = [...looks.filter((l) => !LOOKS.includes(l)), ...poses.filter((p) => !POSES.includes(p))];
  if (!(width >= 64 && width <= 4096))
    return fail(`--width is a number of pixels from 64 to 4096, not ${flag('width')}`);
  if (odd.length)
    return fail(`no look or pose ${odd.join(', ')} (looks: ${LOOKS.join(', ')}; poses: ${POSES.join(', ')})`);
  const scene = JSON.stringify(data),
    engine = await engineScript(),
    page = PAGE.replace('WIDTH', String(width));
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x').pathname;
    const [type, body] =
      u === '/lk3d.min.js'
        ? ['text/javascript', engine]
        : u === '/scene.json'
          ? ['application/json', scene]
          : ['text/html', page];
    res.writeHead(200, { 'content-type': type });
    res.end(body);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/`,
    out = path.resolve(String(flag('out', '.'))),
    name = path.basename(f).replace(/\.json$/, ''),
    theme = flag('theme', ''),
    ortho = flag('ortho', false);
  fs.mkdirSync(out, { recursive: true });
  const browser = await pw.chromium.launch(),
    tab = await browser.newPage({ deviceScaleFactor: 2 });
  let bad = 0;
  try {
    for (const look of looks)
      for (const pose of poses) {
        await tab.goto(`${base}?look=${look}&pose=${pose}${theme ? '&theme=' + theme : ''}${ortho ? '&ortho=1' : ''}`);
        const r = await (await tab.waitForFunction(() => window.__ready, null, { timeout: 60000 })).jsonValue();
        const png = path.join(out, `${name}-${look}-${pose}.png`);
        await tab.locator('.lk3d-stage').screenshot({ path: png });
        console.log(png + (r.errors.length ? '  errors: ' + r.errors.join('; ') : ''));
        bad += r.errors.length;
      }
  } finally {
    await browser.close();
    server.close();
  }
  console.log('look at each picture: is every part where it should be, and does it read at a glance?');
  process.exitCode = bad ? 1 : 0;
}

try {
  if (cmd === 'check' && file) check(file);
  else if (cmd === 'render' && file) await render(file);
  else if (cmd === 'export' && file) exportGLB(file, words[2]);
  else if (!cmd || cmd === 'help' || flags.help) console.log(USAGE);
  else {
    console.error(USAGE);
    process.exitCode = 2;
  }
} catch (e) {
  fail(e.message);
}
