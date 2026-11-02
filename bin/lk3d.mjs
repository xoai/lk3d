#!/usr/bin/env node
// lk3d from the command line: check a scene, and draw it to pictures to look at (what an author, or an AI agent writing
// a scene, runs after each step).
//   lk3d check scene.json [--json]
//       the format (lk3d/validate) and the geometry (lk3d/lint), with the scene's size: exit code 1 on any problem
//   lk3d render scene.json [--looks pen,ink,studio] [--poses rest,apart,cut] [--theme NAME] [--ortho] [--width 640]
//                          [--out DIR]
//       PNG pictures, one per look and pose, drawn by the real engine in a headless browser (Playwright); without
//       Playwright it says so: the scene is then not checked by eye
// A model given as a file ("file": "heart.glb") is read in, as a build would: from beside the scene, or beside the page
// one folder up (as the examples keep them), or from where lk3d runs.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { validate } from '../src/validate.js';
import { lint } from '../src/lint.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const [cmd, file, ...rest] = process.argv.slice(2);
const flag = (name, dflt) => {
  const k = rest.indexOf('--' + name);
  return k < 0 ? dflt : rest[k + 1] && !rest[k + 1].startsWith('--') ? rest[k + 1] : true;
};
const USAGE = `usage: lk3d check scene.json [--json]
       lk3d render scene.json [--looks pen,ink,studio] [--poses rest,apart,cut] [--theme NAME] [--ortho] [--width 640] [--out DIR]`;

function load(f) {
  const scene = JSON.parse(fs.readFileSync(f, 'utf8'));
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

function check(f) {
  const scene = load(f),
    problems = validate(scene);
  // the geometry is checked only on a scene in the right form (a wrong one may not build)
  const r = problems.length ? { problems: [], summary: null } : lint(scene);
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
    console.log(
      'lk3d render needs Playwright: npm i -D playwright && npx playwright install chromium\n' +
        'not checked visually: nothing was drawn',
    );
    process.exitCode = 2;
    return;
  }
  const scene = JSON.stringify(load(f)),
    engine = fs.readFileSync(path.join(ROOT, 'dist/lk3d.min.js')),
    page = PAGE.replace('WIDTH', String(+flag('width', 640)));
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
    looks = String(flag('looks', 'pen,ink')).split(','),
    poses = String(flag('poses', 'rest,apart,cut')).split(','),
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
  else {
    console.log(USAGE);
    process.exitCode = cmd ? 2 : 0;
  }
} catch (e) {
  console.log(`lk3d ${cmd}: ${e.message}`);
  process.exitCode = 2;
}
