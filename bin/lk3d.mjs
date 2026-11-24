#!/usr/bin/env node
// lk3d from the command line: check a scene, and draw it to pictures to look at (what an author, or an AI agent writing
// a scene, runs after each step).
//   lk3d check scene.json [--json]
//       the format (lk3d/validate) and the geometry (lk3d/lint), what the scene expects (expect), with the scene's
//       size: exit code 1 on any problem; warnings are said, and pass
//   lk3d render scene.json [--looks pen,ink,studio] [--poses rest,apart,cut,steps] [--theme NAME] [--ortho]
//                          [--width 640] [--out DIR] [--sheet] [--names]
//       PNG pictures, one per look and pose (steps: one per guided step, when the scene has them), drawn by the real
//       engine in a headless browser (Playwright); without Playwright it says so: the scene is then not checked by eye.
//       --sheet: every picture on one (NAME-sheet.png) and the questions to answer looking at it (NAME-sheet.md);
//       --names: a picture with every part labelled by its id. Beside each picture, NAME-LOOK-POSE.txt: the figure in words
//       there (fig.describe()), for its alt text; and NAME-render.json: each picture, its caption, and the renderer that
//       drew it (webgl2, webgl or 2d)
//   lk3d place scene.json
//       each part with place (on, under, in, against, alignedWith) gets the at it says, written into the file: only
//       those numbers change, and a second run changes nothing; a scene a script makes is placed by that script
//       (resolvePlace from lk3d/place), not here
//   lk3d skill install [--to claude|codex|PATH]   lk3d skill pack [--out DIR]
//       the lk3d skill for AI agents (SKILL.md, its references, and the guides they link to, bundled under docs/):
//       copied into ~/.claude/skills/lk3d (or ~/.codex/skills/lk3d, or PATH/lk3d), or packed as lk3d-skill.zip
//   lk3d export scene.json [out.glb] [--animate] [--motion id=value,…]
//       the scene as glTF 2.0 binary (Blender, game engines, viewers): parts as named nodes with their materials, posed
//       at the motions' starts (or --motion), each motion an animation with --animate
// A model given as a file ("file": "heart.glb") is read in, as a build would: from beside the scene, or beside the page
// one folder up (as the examples keep them), or from where lk3d runs.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import '../src/models.js'; // (the glTF reader: check and export read the scene's models)
import { validate } from '../src/validate.js';
import { lint } from '../src/lint.js';
import { sceneToGLB } from '../src/gltf-write.js';
import { patchPlace } from '../src/place.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
// the words on the command line: flags (--name, or --name value) anywhere, the rest in order (the command, the file)
const VALUED = new Set(['looks', 'poses', 'theme', 'width', 'out', 'motion', 'to']),
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
  POSES = ['rest', 'apart', 'cut', 'steps', 'sequences'];
const USAGE = `usage: lk3d check scene.json [--json]
       lk3d place scene.json
       lk3d skill install [--to claude|codex|PATH] | lk3d skill pack [--out DIR]
       lk3d export scene.json [out.glb] [--animate] [--motion id=value,…]
       lk3d render scene.json [--looks pen,ink,studio] [--poses rest,apart,cut,steps] [--theme NAME] [--ortho] [--width 640] [--out DIR] [--sheet] [--names]`;

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

// the example scenes a script writes: placed there, before writing, so a rerun of the script keeps it
const GENERATED = {
  'cell-tour.json': 'examples/cell-tour.mjs',
  'cell-tour-bilayer.json': 'examples/cell-tour.mjs',
  'armillary.json': 'examples/armillary.mjs',
};
function place(scenePath) {
  const script = GENERATED[path.basename(scenePath)];
  if (script && path.resolve(path.dirname(scenePath)) === path.join(ROOT, 'examples/scenes'))
    throw new Error(`${scenePath} is written by ${script}: place its parts there, with resolvePlace from lk3d/place`);
  const text = fs.readFileSync(scenePath, 'utf8'),
    placed = patchPlace(text);
  if (placed === text) console.log(`${scenePath}: every placed part is where its place puts it`);
  else {
    fs.writeFileSync(scenePath, placed);
    console.log(`${scenePath}: at written where place puts each part`);
  }
}

// ---- the skill for AI agents: SKILL.md and references/ as they are, and the guides they link to (and those link to),
// bundled under docs/ with the links pointing there (from SKILL.md ../../docs/…, from references/ ../../../docs/…)
const SKILL = path.join(ROOT, 'skill', 'lk3d'),
  DOCS = path.join(ROOT, 'docs');
function skillFiles() {
  const out = [],
    walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== 'evals') walk(file); // (the evals stay with the package's tests)
        } else if (entry.name !== '.DS_Store') out.push([path.relative(SKILL, file), file]);
      }
    };
  walk(SKILL);
  const seen = new Set(),
    todo = out.map(([, file]) => file).filter((file) => file.endsWith('.md'));
  while (todo.length) {
    const file = todo.pop();
    for (const [, link] of fs.readFileSync(file, 'utf8').matchAll(/\]\(([^)#\s]+\.md)(?:#[^)]*)?\)/g)) {
      const target = path.resolve(path.dirname(file), link);
      if (path.dirname(target) === DOCS && fs.existsSync(target) && !seen.has(target)) {
        seen.add(target);
        out.push([path.join('docs', path.basename(target)), target]);
        todo.push(target);
      }
    }
  }
  return out.sort(([a], [b]) => (a < b ? -1 : 1));
}
const skillBytes = (file) =>
  Buffer.from(
    fs.readFileSync(file, 'utf8').replaceAll('](../../../docs/', '](../docs/').replaceAll('](../../docs/', '](docs/'),
  );
function skill(action) {
  const files = skillFiles();
  if (action === 'install') {
    const to = flag('to', 'claude'),
      base = { claude: '~/.claude/skills', codex: '~/.codex/skills' }[to] || to,
      dest = path.resolve(base.replace(/^~(?=$|\/)/, process.env.HOME || ''), 'lk3d');
    if (path.resolve(dest) === SKILL) throw new Error('that is the skill itself');
    if (fs.existsSync(dest) && !fs.existsSync(path.join(dest, 'SKILL.md')))
      throw new Error(`${dest} exists and is not a skill: give another --to`);
    fs.rmSync(dest, { recursive: true, force: true }); // (an older copy: replaced, so no file it no longer has stays)
    for (const [rel, file] of files) {
      fs.mkdirSync(path.dirname(path.join(dest, rel)), { recursive: true });
      fs.writeFileSync(path.join(dest, rel), skillBytes(file));
    }
    console.log(`the lk3d skill (${files.length} files) is in ${dest}`);
  } else if (action === 'pack') {
    const out = path.resolve(flag('out', '.'), 'lk3d-skill.zip');
    fs.writeFileSync(out, zip(files.map(([rel, file]) => [`lk3d/${rel.split(path.sep).join('/')}`, skillBytes(file)])));
    console.log(
      `${out}: the lk3d skill, ${files.length} files: upload it to a Claude app as a skill, or unzip it into a tool's skills folder`,
    );
  } else throw new Error('lk3d skill install [--to claude|codex|PATH] | lk3d skill pack [--out DIR]');
}
// a zip of [name, bytes] (deflated; the same bytes every time: no dates)
function zip(entries) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
      for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
      return n >>> 0;
    }),
    crc = (bytes) => {
      let c = 0xffffffff;
      for (const byte of bytes) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
      return (c ^ 0xffffffff) >>> 0;
    },
    local = [],
    central = [];
  let offset = 0;
  for (const [name, data] of entries) {
    const packed = zlib.deflateRawSync(data),
      nameBytes = Buffer.from(name),
      head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(0x0800, 6); // (names in UTF-8)
    head.writeUInt16LE(8, 8);
    head.writeUInt16LE(0, 10);
    head.writeUInt16LE(0x5c21, 12); // (1 January 2026)
    head.writeUInt32LE(crc(data), 14);
    head.writeUInt32LE(packed.length, 18);
    head.writeUInt32LE(data.length, 22);
    head.writeUInt16LE(nameBytes.length, 26);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(0x0314, 4);
    head.copy(entry, 6, 4, 30);
    entry.writeUInt32LE(0o100644 * 0x10000, 38);
    entry.writeUInt32LE(offset, 42);
    local.push(head, nameBytes, packed);
    central.push(entry, nameBytes);
    offset += head.length + nameBytes.length + packed.length;
  }
  const size = central.reduce((sum, part) => sum + part.length, 0),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(size, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, ...central, end]);
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
  const all = [...problems, ...geometry.problems],
    // (a warning is said and passes: the check fails on problems only)
    failing = all.filter((problem) => problem.level !== 'warning'),
    warnings = all.length - failing.length;
  if (flag('json')) console.log(JSON.stringify({ summary: geometry.summary, problems: all }, null, 2));
  else {
    const summary = geometry.summary;
    if (summary)
      console.log(
        `${path.basename(scenePath)}: ${summary.parts} parts (${summary.named} named, ${summary.accents} accent), ` +
          `${summary.shapes} shapes, ${summary.placed} placed, ${summary.triangles} triangles, ` +
          `${+summary.size.toFixed(2)} units across`,
      );
    // each sequence: its stages, how long it plays (each stage and its hold), and the order it was checked in
    for (const sequence of summary?.sequences || [])
      console.log(
        `  ${sequence.id}: ${sequence.stages} stages, plays ${sequence.seconds} s, checked in this order: ${sequence.order.join(', ')}`,
      );
    for (const problem of all)
      console.log(
        `  ${problem.level === 'warning' ? 'warning: ' : ''}${problem.path || '(scene)'}: ${problem.message}`,
      );
    console.log(
      (failing.length ? `${failing.length} problem${failing.length > 1 ? 's' : ''}` : 'no problems') +
        (warnings ? `, ${warnings} warning${warnings > 1 ? 's' : ''}` : ''),
    );
  }
  process.exitCode = failing.length ? 1 : 0;
}

// the page the pictures are drawn on: the built engine, the scene, a fixed width; window.__ready once it is complete
const PAGE = `<!doctype html><meta charset="utf-8"><title>lk3d render</title>
<style>body{margin:0;background:#fff;font-family:system-ui,sans-serif}#g{width:WIDTHpx}.lk3d{margin:0}.lk3d-hint{display:none}</style>
<div id="g"></div><script src="/lk3d.min.js"></script><script src="/lk3d-models.min.js"></script><script src="/lk3d-story.min.js"></script><script type="module">
const query = new URLSearchParams(location.search), scene = await (await fetch('/scene.json')).json(), errors = [];
window.addEventListener('error', (e) => errors.push(String(e.message)));
if (query.get('ortho')) scene.view = { ...scene.view, projection: 'ortho' };
const names = !!query.get('names'); // (every part labelled with its id: the contact sheet's map of the parts)
if (names) for (const part of scene.parts || []) if (part && part.id) part.name = part.id;
const pose = query.get('pose');
const fig = LK3D.mount(document.getElementById('g'), scene, { controls: false, adaptive: false, locale: 'en',
  style: query.get('look'), theme: query.get('theme') || undefined,
  labels: names ? 'all' : pose === 'apart' ? 'auto' : pose === 'step' ? undefined : 'none',
  step: -1 }); // (before the first step: a step is gone to below, as a picture)
await Promise.race([fig.ready, new Promise((resolve) => setTimeout(resolve, 30000))]);
if (pose === 'apart') fig.set({ explode: 1 });
if (pose === 'cut') fig.set({ cut: true });
// a step as a picture: each motion it plays where its play ends (a teardown apart, a build built), nothing played
if (pose === 'step') fig.step(Number(query.get('step')), { ms: 0, settled: true });
// a sequence at the end of a stage, in that stage's camera: its stage played at once (motion reduced) on a stopped clock
if (pose === 'sequence') {
  const sequence = fig.sequence(query.get('sequence')), at = Number(query.get('at'));
  LK3D.reduce = true;
  LK3D.clock.speed = 0;
  sequence.set(Math.max(0, at - 1));
  if (at > 0) {
    const played = sequence.play({ to: at });
    LK3D.clock.step(1e7);
    await played;
  }
}
for (let k = 0; k < 3; k++) await new Promise((resolve) => requestAnimationFrame(resolve));
window.__ready = { errors, renderer: fig.renderer, words: fig.describe() };
</script>`;

// the engine render draws with, and its models add-on (a scene may draw glTF models): built from src/ now, in memory
// (not dist/, which a fresh clone lacks and an old build would leave out of date); only where esbuild is not installed,
// an installed package without its development tools, the bundles it shipped with (built from the same source when it
// was packed)
async function engineScript(models = false) {
  const story = models === 'story';
  try {
    const build = await import('../build.mjs');
    return await (story
      ? build.bundle('iife', build.STORY_ENTRY)
      : models
        ? build.bundle('iife', build.MODELS_ENTRY)
        : build.bundle());
  } catch (error) {
    const shipped = path.join(
      ROOT,
      story ? 'dist/lk3d-story.min.js' : models ? 'dist/lk3d-models.min.js' : 'dist/lk3d.min.js',
    );
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
    stepCount = Array.isArray(data.steps) ? data.steps.length : 0,
    sequenceList = Array.isArray(data.sequences) ? data.sequences : [],
    poses = String(
      flag(
        'poses',
        ['rest,apart,cut', stepCount && 'steps', sequenceList.length && 'sequences'].filter(Boolean).join(','),
      ),
    ).split(','),
    unknown = [...looks.filter((look) => !LOOKS.includes(look)), ...poses.filter((pose) => !POSES.includes(pose))];
  if (!(width >= 64 && width <= 4096))
    return fail(`--width is a number of pixels from 64 to 4096, not ${flag('width')}`);
  if (unknown.length)
    return fail(`no look or pose ${unknown.join(', ')} (looks: ${LOOKS.join(', ')}; poses: ${POSES.join(', ')})`);
  if (poses.includes('steps') && !stepCount) return fail('--poses steps: the scene has no steps');
  if (poses.includes('sequences') && !sequenceList.length) return fail('--poses sequences: the scene has no sequences');
  // each sequence at 0 and at the end of its stages: all of them when there are 12 or fewer, else the first, the last
  // and ten between, evenly
  const stageEnds = (count) =>
    count <= 12
      ? Array.from({ length: count + 1 }, (_, k) => k)
      : [0, ...new Set(Array.from({ length: 12 }, (_, k) => 1 + Math.round(((count - 1) * k) / 11)))];
  const scene = JSON.stringify(data),
    engine = await engineScript(),
    models = await engineScript(true),
    // (the story add-on, for a scene with sequences: none for any other, which draws as it always did)
    story = sequenceList.length ? await engineScript('story') : '',
    page = PAGE.replace('WIDTH', String(width));
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://x').pathname;
    const [type, body] =
      pathname === '/lk3d.min.js'
        ? ['text/javascript', engine]
        : pathname === '/lk3d-models.min.js'
          ? ['text/javascript', models]
          : pathname === '/lk3d-story.min.js'
            ? ['text/javascript', story]
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
  const pictures = []; // (each picture drawn, with its caption: the contact sheet's tiles)
  try {
    const tab = await browser.newPage({ deviceScaleFactor: 2 });
    for (const look of looks)
      for (const [pose, query, picture, caption] of poses.flatMap((pose) =>
        pose === 'steps'
          ? Array.from({ length: stepCount }, (_, index) => ['step', `&step=${index}`, `step${index + 1}`])
          : pose === 'sequences'
            ? sequenceList.flatMap((sequence) =>
                stageEnds(sequence.stages.length).map((at) => {
                  const title = at ? sequence.stages[at - 1].title : '';
                  return [
                    'sequence',
                    `&sequence=${encodeURIComponent(sequence.id)}&at=${at}`,
                    `${sequence.id}-${at}`,
                    `${sequence.id} ${at}/${sequence.stages.length}${title ? ': ' + title : ''}`,
                  ];
                }),
              )
            : [[pose, '', pose]],
      )) {
        await tab.goto(
          `${base}?look=${look}&pose=${pose}${query}${theme ? '&theme=' + theme : ''}${ortho ? '&ortho=1' : ''}`,
        );
        const result = await (await tab.waitForFunction(() => window.__ready, null, { timeout: 60000 })).jsonValue();
        const png = path.join(out, `${name}-${look}-${picture}.png`);
        await tab.locator('.lk3d-stage').screenshot({ path: png });
        // (its alt text beside it: the figure in words, as a screen reader hears it there)
        fs.writeFileSync(png.replace(/\.png$/, '.txt'), result.words + '\n');
        console.log(
          png + ` (${result.renderer})` + (result.errors.length ? '  errors: ' + result.errors.join('; ') : ''),
        );
        errorCount += result.errors.length;
        const step = pose === 'step' ? data.steps[Number(picture.slice(4)) - 1] : null;
        pictures.push({
          png,
          caption: caption || (step ? `step ${picture.slice(4)}: ${step.title || ''}` : `${look} · ${pose}`),
          look,
          pose: step ? picture : pose === 'sequence' ? 'sequences' : pose,
          renderer: result.renderer,
          errors: result.errors,
        });
      }
    // every part named by its id, at rest in the first look: the sheet's map of which part is which
    if (flag('names')) {
      await tab.goto(
        `${base}?look=${looks[0]}&pose=rest&names=1${theme ? '&theme=' + theme : ''}${ortho ? '&ortho=1' : ''}`,
      );
      await tab.waitForFunction(() => window.__ready, null, { timeout: 60000 });
      const png = path.join(out, `${name}-names.png`);
      await tab.locator('.lk3d-stage').screenshot({ path: png });
      console.log(png);
      pictures.unshift({ png, caption: 'the parts, by id' });
    }
    if (flag('sheet')) await contactSheet(browser, data, name, out, pictures);
    // what was drawn, by what (WebGL 2, WebGL 1, or the 2D fallback), with each picture's errors: NAME-render.json, for
    // a tool that shows the pictures (lessonkit's review sheet)
    fs.writeFileSync(
      path.join(out, `${name}-render.json`),
      JSON.stringify(
        {
          pictures: pictures
            .filter((picture) => picture.look)
            .map(({ png, caption, look, pose, renderer, errors }) => ({
              file: path.basename(png),
              caption,
              look,
              pose,
              renderer,
              errors,
            })),
        },
        null,
        2,
      ) + '\n',
    );
  } finally {
    await browser.close();
    server.close();
  }
  console.log('look at each picture: is every part where it should be, and does it read at a glance?');
  process.exitCode = errorCount ? 1 : 0;
}

// The contact sheet: every picture drawn, on one image with its caption (NAME-sheet.png), and the questions to answer
// while looking at it, made from the scene (NAME-sheet.md, also printed): what no check can see, the eye must.
async function contactSheet(browser, data, name, out, pictures) {
  const tiles = pictures
    .map(
      ({ png, caption }) =>
        `<figure><img src="data:image/png;base64,${fs.readFileSync(png).toString('base64')}"><figcaption>${caption.replace(/[<&]/g, (c) => (c === '<' ? '&lt;' : '&amp;'))}</figcaption></figure>`,
    )
    .join('');
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  await page.setContent(
    `<style>body{margin:0;padding:12px;font:14px system-ui,sans-serif;background:#fff;display:grid;grid-template-columns:repeat(3,1fr);gap:12px}` +
      `figure{margin:0}img{width:100%;border:1px solid #ddd}figcaption{padding:4px 2px;color:#333}</style>${tiles}`,
  );
  const sheet = path.join(out, `${name}-sheet.png`);
  await page.screenshot({ path: sheet, fullPage: true });
  await page.close();
  console.log(sheet);
  // the questions, at most 20
  const named = (id) => (data.parts || []).find((part) => part && part.id === id)?.name || id,
    questions = [];
  // (a sequence's first, before the cut at 20: what no check can see of a way out, the eye must)
  for (const sequence of data.sequences || [])
    questions.push(
      sequence.build
        ? `Does each part of ${sequence.id} come in by a way it could really take, in an order it could really be built in?`
        : 'Does each part leave by a way it could really take?',
      `Is each stage of ${sequence.id} framed so that what moves in it is seen?`,
    );
  for (const item of data.expect || [])
    if (item && item.seen != null) questions.push(`Is ${named(item.seen)} visible in step ${item.step}?`);
  (data.steps || []).forEach((step, k) => {
    const text = String(step.text || '').replace(/<[^>]+>/g, '');
    const labels = Array.isArray(step.labels) ? step.labels.map(named).join(', ') : 'what it is about';
    questions.push(`Step ${k + 1} says «${text}». Does the picture show ${labels}?`);
  });
  for (const dimension of data.dimensions || [])
    questions.push(`Does «${dimension.name || dimension.id}» sit where it measures?`);
  let contacts = {};
  try {
    contacts = lint(data).contacts || {};
  } catch {
    // (a scene the check cannot build: lk3d check says why)
  }
  for (const [id, touching] of Object.entries(contacts))
    if (touching.length === 1)
      questions.push(`Does ${named(id)} rest on ${named(touching[0])} as the real object does?`);
  for (const part of data.parts || [])
    if (part && part.mirrorOf)
      questions.push(
        `Are ${named(part.mirrorOf)} and ${named(part.id)} mirror images (a left and a right), not turned copies?`,
      );
  const text =
    `# ${data.title || name}: questions to answer while looking at ${name}-sheet.png\n\n` +
    questions
      .slice(0, 20)
      .map((q) => `- ${q}`)
      .join('\n') +
    '\n';
  fs.writeFileSync(path.join(out, `${name}-sheet.md`), text);
  console.log(text);
}

try {
  if (command === 'check' && file) check(file);
  else if (command === 'render' && file) await render(file);
  else if (command === 'export' && file) exportGLB(file, words[2]);
  else if (command === 'place' && file) place(file);
  else if (command === 'skill') skill(file);
  else if (!command || command === 'help' || flags.help) console.log(USAGE);
  else {
    console.error(USAGE);
    process.exitCode = 2;
  }
} catch (error) {
  fail(error.message);
}
