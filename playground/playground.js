// The playground: a scene's JSON in the editor, drawn as it is typed (once it is in the right form), checked as
// `lk3d check` does (check.js, in a worker), each problem shown where it is in the text. A scene comes from an example,
// or from the link (#scene=…, the text compressed into the address) that Share makes; it goes out as that link, as a
// .json file or as a .glb. The figure keeps its camera and its step while the scene is edited.
/* global LK3D */
import { locate, placeOf } from './locate.js';

const EXAMPLES = {
  bolt: 'A bolt and a nut',
  generator: 'An AC generator',
  lens: 'A lens bench (dimensions)',
  'cell-tour': 'A tour of a human cell (steps)',
  cell: 'An animal cell',
  molecules: 'Molecules',
  solar: 'The inner Solar System',
  flow: 'A ducted fan',
  skull: 'A fossil skull (a glTF model)',
};
const BOLT = {
  title: 'A bolt and a nut',
  unit: 'cm',
  parts: [
    {
      id: 'bolt',
      name: 'Bolt',
      note: 'its thread turns into the nut.',
      material: 'steel',
      color: '#9aa3ad',
      shapes: [{ cylinder: { r: 0.12, x0: -0.8, x1: 0.6 } }, { cylinder: { r: 0.22, x0: -0.95, x1: -0.8 } }],
    },
    {
      id: 'nut',
      name: 'Nut',
      note: 'screws onto the end of the bolt.',
      material: 'steel',
      color: '#c0c6cc',
      explode: [0.6, 0, 0],
      shapes: [{ cylinder: { r: 0.24, ri: 0.12, x0: 0.2, x1: 0.36 } }],
    },
  ],
  dimensions: [{ id: 'length', name: 'the bolt’s length', from: [-0.95, -0.3, 0], to: [0.6, -0.3, 0] }],
};

const $ = (id) => document.getElementById(id),
  editor = /** @type {HTMLTextAreaElement} */ ($('editor')),
  gutter = $('gutter'),
  host = $('figure'),
  list = $('problems'),
  summary = $('summary'),
  look = /** @type {HTMLSelectElement} */ ($('look')),
  theme = /** @type {HTMLSelectElement} */ ($('theme')),
  picker = /** @type {HTMLSelectElement} */ ($('example'));
let figure = null,
  checking = 0,
  timer = 0;
const modelData = {}; // a model's base64 by name, read once from the examples' files

// ---- the editor: line numbers, Tab as two spaces, Ctrl/Cmd + Enter to draw now
let numbered = 0;
const numberLines = () => {
  const lines = editor.value.split('\n').length;
  if (lines !== numbered) gutter.textContent = Array.from({ length: (numbered = lines) }, (_, k) => k + 1).join('\n');
  gutter.scrollTop = editor.scrollTop;
};
editor.addEventListener('scroll', () => (gutter.scrollTop = editor.scrollTop));
editor.addEventListener('keydown', (event) => {
  if (event.key === 'Tab' && !event.shiftKey) {
    event.preventDefault();
    editor.setRangeText('  ', editor.selectionStart, editor.selectionEnd, 'end');
    edited();
  } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    check();
  }
});
editor.addEventListener('input', () => edited());
function edited() {
  numberLines();
  clearTimeout(timer);
  timer = setTimeout(check, 400);
}
// a scene as text, two spaces an indent, with an array of numbers or short words on one line ([0.6, 0, 0]), as the
// examples are written
/** @param {any} scene */
const layOut = (scene) =>
  JSON.stringify(scene, null, 2).replace(/\[\s+([^[\]{}]*?)\s+\]/g, (whole, items) => {
    const line = '[' + items.split(/,\s+/).join(', ') + ']';
    return line.length <= 90 ? line : whole;
  });
/** @param {string} text @param {boolean} [fresh] a new scene, not an edit of the one shown (its own camera) */
function setText(text, fresh = true) {
  editor.value = text;
  numberLines();
  check(fresh);
}

// ---- the checks, in a worker; then the figure, drawn again when the scene is in the right form
const worker = new Worker(new URL('./check.js', import.meta.url), { type: 'module' });
let freshScene = true;
function check(fresh = false) {
  freshScene ||= fresh;
  worker.postMessage({ id: ++checking, text: editor.value, models: modelData });
}
worker.onmessage = async ({ data }) => {
  if (data.id !== checking) return; // (an older text's: the newer one is on its way)
  list.innerHTML = '';
  if (data.syntax)
    return show([{ path: null, offset: data.syntax.offset, message: data.syntax.message, kind: 'JSON' }]);
  const format = data.problems.filter((problem) => problem.kind === 'format');
  summary.textContent = data.summary
    ? `${data.summary.parts} parts, ${data.summary.triangles.toLocaleString('en')} triangles`
    : '';
  if (!format.length) await draw(data.scene);
  show(data.problems);
};
/** @param {{ path: string | null, offset?: number | null, message: string, kind: string }[]} problems */
function show(problems) {
  list.innerHTML = '';
  if (!problems.length) {
    const ok = document.createElement('li');
    ok.className = 'ok';
    ok.textContent = 'No problems: the format and the geometry check out.';
    list.append(ok);
    return;
  }
  const places = locate(editor.value);
  for (const problem of problems) {
    const item = document.createElement('li'),
      where = document.createElement('code');
    const place =
      problem.path != null
        ? placeOf(places, problem.path)
        : problem.offset != null
          ? [problem.offset, problem.offset + 1]
          : null;
    if (place) {
      const line = editor.value.slice(0, place[0]).split('\n').length;
      where.textContent = `${problem.kind} · line ${line}${problem.path ? ' · ' + problem.path : ''}`;
    } else where.textContent = problem.kind + (problem.path ? ' · ' + problem.path : '');
    item.append(where, document.createElement('br'), problem.message);
    item.title = 'Show it in the scene';
    item.addEventListener('click', () => place && select(place));
    list.append(item);
  }
}
// a place in the text chosen and scrolled to
/** @param {number[]} place */
function select([start, end]) {
  editor.focus();
  editor.setSelectionRange(start, end);
  const line = editor.value.slice(0, start).split('\n').length,
    height = parseFloat(getComputedStyle(editor).lineHeight) || 19;
  editor.scrollTop = Math.max(0, (line - 4) * height);
}

/** @param {any} scene */
async function draw(scene) {
  // models given as files (the examples'), read in as a build would; the rest as written
  for (const [name, model] of Object.entries(scene.models || {}))
    if (model && model.file && !model.data) {
      if (!modelData[name]) {
        const bytes = new Uint8Array(await (await fetch('../examples/' + model.file)).arrayBuffer());
        let binary = '';
        for (let k = 0; k < bytes.length; k += 0x8000) binary += String.fromCharCode(...bytes.subarray(k, k + 0x8000));
        modelData[name] = btoa(binary);
      }
      scene.models[name] = { ...model, data: modelData[name] };
    }
  const camera = figure && !freshScene ? figure.camera() : null,
    step = figure && !freshScene ? figure.currentStep : undefined;
  try {
    figure = LK3D.mount(host, scene, {
      style: look.value,
      theme: theme.value || undefined,
      step: step >= 0 ? step : undefined,
    });
    if (camera) figure.set({ camera }); // (edited, not new: the reader's view kept)
    freshScene = false;
  } catch (error) {
    show([{ path: '', message: String(error.message || error), kind: 'drawing' }]);
  }
}
look.addEventListener('change', () => figure && figure.set({ style: look.value }));
theme.addEventListener('change', () => figure && figure.set({ theme: theme.value || null }));

// ---- scenes in and out: the examples, a shared link, a file
for (const [name, title] of Object.entries(EXAMPLES)) picker.add(new Option(title, name));
/** @param {string} name */
async function example(name) {
  const scene = name === 'bolt' ? BOLT : await (await fetch(`../examples/scenes/${name}.json`)).json();
  setText(layOut(scene));
}
picker.addEventListener('change', () => {
  history.replaceState(null, '', '#example=' + picker.value);
  example(picker.value);
});
const bytesToText = (bytes) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
const textToBytes = (text) =>
  Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), (char) => char.charCodeAt(0));
/** @param {Uint8Array} bytes @param {CompressionStream | DecompressionStream} stream */
const through = async (bytes, stream) =>
  new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
$('share').addEventListener('click', async (event) => {
  // (the button read now: after an await the event no longer has it)
  const button = /** @type {HTMLButtonElement} */ (event.currentTarget);
  const compact = JSON.stringify(JSON.parse(editor.value)),
    packed = await through(new TextEncoder().encode(compact), new CompressionStream('deflate-raw')),
    url = `${location.origin}${location.pathname}#scene=${bytesToText(packed)}`;
  history.replaceState(null, '', url);
  try {
    await navigator.clipboard.writeText(url);
    button.textContent = 'Link copied';
  } catch {
    button.textContent = 'Link in the address bar';
  }
  setTimeout(() => (button.textContent = 'Share'), 2000);
});
/** @param {BlobPart} content @param {string} name @param {string} type */
const save = (content, name, type) => {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([content], { type }));
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
};
const fileName = () => {
  try {
    return (JSON.parse(editor.value).title || 'scene').replace(/[^\w-]+/g, '-').toLowerCase();
  } catch {
    return 'scene';
  }
};
$('download').addEventListener('click', () => save(editor.value, fileName() + '.json', 'application/json'));
$('glb').addEventListener('click', async () => {
  if (!figure) return;
  if (!LK3D.toGLB)
    await new Promise((resolve, reject) => {
      const script = Object.assign(document.createElement('script'), { src: '../dist/lk3d-export.min.js' });
      script.onload = resolve;
      script.onerror = reject;
      document.head.append(script);
    });
  save(figure.exportGLB(), fileName() + '.glb', 'model/gltf-binary');
});
$('format').addEventListener('click', () => {
  try {
    setText(layOut(JSON.parse(editor.value)), false);
  } catch {
    check();
  }
});

// ---- the first scene: the link's, an example named in the address, else the bolt
const hash = new URLSearchParams(location.hash.slice(1));
if (hash.get('scene'))
  through(textToBytes(hash.get('scene')), new DecompressionStream('deflate-raw'))
    .then((bytes) => setText(layOut(JSON.parse(new TextDecoder().decode(bytes)))))
    .catch(() => example('bolt'));
else {
  const name = hash.get('example');
  picker.value = name && EXAMPLES[name] ? name : 'bolt';
  example(picker.value);
}
