// @ts-check
// place: a part placed by its relation to others (on, under, in, against, alignedWith, and an offset), worked out into
// the `at` the engine reads. lk3d place writes it into the file's text (patchPlace: only those numbers change, and a
// second run changes nothing); lk3d check refuses an `at` that no longer matches (lint.js, through placements); a scene
// made by a script resolves it there, before writing (resolvePlace). Not in the engine's bundle: import 'lk3d/place'.
//   resolvePlace(scene) → the scene, each placed part's at worked out (it throws, naming the part, if it cannot be)
//   placements(scene)  → { at: Map(part index → at), problems: [{ path, message }] }
//   patchPlace(text)   → the scene file's text with each placed part's at written in
import './models.js'; // (the glTF reader: a placed part's box may be a model's; Node tools always have it)
import { buildScene } from './geometry.js';

const AXES = 'xyz';
const r4 = (/** @type {number} */ v) => Math.round(v * 1e4) / 1e4 + 0; // (to 1e-4, and never -0)

/** @param {any} scene */
export function placements(scene) {
  const parts = Array.isArray(scene && scene.parts) ? scene.parts : [],
    /** @type {Map<number, number[]>} */
    at = new Map(),
    /** @type {{ path: string, message: string }[]} */
    problems = [],
    indexOf = new Map(parts.map((/** @type {any} */ part, /** @type {number} */ i) => [part.id, i])),
    placed = parts.flatMap((/** @type {any} */ part, /** @type {number} */ i) =>
      part && part.place && typeof part.place === 'object' ? [i] : [],
    );
  if (!placed.length) return { at, problems };
  const say = (/** @type {number} */ i, /** @type {string} */ message) =>
    problems.push({ path: `parts[${i}].place`, message });
  // the parts each placed part's place names, and those it waits for (a mirror's B, if it is placed)
  const named = (/** @type {any} */ place) =>
      ['on', 'under', 'in', 'against', 'alignedWith']
        .filter((key) => place[key] !== undefined)
        .map((key) => place[key]),
    waitsFor = new Map(
      placed.map((i) => [
        i,
        named(parts[i].place).flatMap((id) => {
          const j = indexOf.get(id);
          if (j === undefined) return [];
          const b = parts[j].mirrorOf !== undefined ? indexOf.get(parts[j].mirrorOf) : j;
          return b !== undefined && parts[b].place ? [b] : [];
        }),
      ]),
    );
  for (const i of placed)
    for (const id of named(parts[i].place))
      if (!indexOf.has(id)) say(i, `names "${id}", which is no part`);
      else if (id === parts[i].id) say(i, `places ${id} by itself`);
  // dependency order; what is left over is in a cycle
  /** @type {number[]} */
  const order = [],
    done = new Set();
  for (let progress = true; progress;) {
    progress = false;
    for (const i of placed)
      if (!done.has(i) && waitsFor.get(i).every((j) => done.has(j) || j === i)) {
        order.push(i);
        done.add(i);
        progress = true;
      }
  }
  const cycle = placed.filter((i) => !done.has(i));
  if (cycle.length)
    say(cycle[0], `${cycle.map((i) => parts[i].id).join(', ')} place each other in a cycle: one of them needs an at`);
  if (problems.length) return { at, problems };
  // each part's box: a placed part's without its own at (so the result does not depend on it), every other as drawn
  const unplaced = {
      ...scene,
      parts: parts.map((part, i) => (placed.includes(i) ? { ...part, at: undefined } : part)),
    },
    built = buildScene(unplaced, 1).parts,
    /** @type {(j: number) => { min: number[], max: number[] }} */
    drawn = (j) => {
      const part = parts[j];
      if (part.place) return shifted(built[j], at.get(j) || [0, 0, 0]);
      const b = part.mirrorOf !== undefined ? indexOf.get(part.mirrorOf) : undefined;
      if (b !== undefined && parts[b].place) return reflected(drawn(b), AXES.indexOf(part.plane));
      return built[j];
    };
  for (const i of order) {
    const part = parts[i],
      place = part.place,
      own = built[i],
      centre = (/** @type {{ min: number[], max: number[] }} */ box, /** @type {number} */ k) =>
        (box.min[k] + box.max[k]) / 2,
      /** @type {{ value: number, by: string }[][]} */
      fixed = [[], [], []],
      /** @type {{ value: number, by: string }[][]} */
      centred = [[], [], []],
      other = (/** @type {string} */ id) => drawn(/** @type {number} */ (indexOf.get(id)));
    if (place.on !== undefined || place.under !== undefined)
      for (const key of ['on', 'under']) {
        if (place[key] === undefined) continue;
        const b = other(place[key]);
        fixed[1].push({
          value: key === 'on' ? b.max[1] - own.min[1] : b.min[1] - own.max[1],
          by: `${key} ${place[key]}`,
        });
        for (const k of [0, 2]) centred[k].push({ value: centre(b, k) - centre(own, k), by: `${key} ${place[key]}` });
      }
    if (place.in !== undefined) {
      const b = other(place.in);
      for (const k of [0, 1, 2]) centred[k].push({ value: centre(b, k) - centre(own, k), by: `in ${place.in}` });
    }
    if (place.against !== undefined) {
      const b = other(place.against),
        side = String(place.side || ''),
        k = AXES.indexOf(side[1]),
        gap = place.gap || 0;
      if (k >= 0)
        fixed[k].push({
          value: side[0] === '+' ? b.max[k] + gap - own.min[k] : b.min[k] - gap - own.max[k],
          by: `against ${place.against} (${side})`,
        });
    }
    if (place.alignedWith !== undefined) {
      const b = other(place.alignedWith);
      for (const axis of Array.isArray(place.axes) ? place.axes : []) {
        const k = AXES.indexOf(axis);
        if (k >= 0) fixed[k].push({ value: centre(b, k) - centre(own, k), by: `alignedWith ${place.alignedWith}` });
      }
    }
    const was = Array.isArray(part.at) ? part.at : null,
      offset = Array.isArray(place.offset) ? place.offset : [0, 0, 0],
      result = [0, 1, 2].map((k) => {
        const twice = fixed[k].length > 1 ? fixed[k] : !fixed[k].length && centred[k].length > 1 ? centred[k] : null;
        if (twice) say(i, `fixes ${part.id} along ${AXES[k]} twice (${twice.map((f) => f.by).join(', ')}): keep one`);
        // (an axis no relation fixes keeps the at written, which holds the offset already: so a second run changes
        // nothing; without an at yet, it starts at the offset)
        const by = fixed[k][0] || centred[k][0];
        return r4(by ? by.value + (offset[k] || 0) : was ? was[k] || 0 : offset[k] || 0);
      });
    at.set(i, result);
  }
  return { at, problems };
}
const shifted = (/** @type {{ min: number[], max: number[] }} */ box, /** @type {number[]} */ by) => ({
  min: box.min.map((v, k) => v + by[k]),
  max: box.max.map((v, k) => v + by[k]),
});
const reflected = (/** @type {{ min: number[], max: number[] }} */ box, /** @type {number} */ k) => {
  const min = box.min.slice(),
    max = box.max.slice();
  [min[k], max[k]] = [-box.max[k], -box.min[k]];
  return { min, max };
};

/** the scene with each placed part's at worked out from its place (a copy; it throws if one cannot be)
 * @template T @param {T} scene @returns {T} */
export function resolvePlace(scene) {
  const { at, problems } = placements(scene);
  if (problems.length) throw new Error(`lk3d: ${problems[0].path}: ${problems[0].message}`);
  const s = /** @type {any} */ (scene);
  return {
    ...s,
    parts: s.parts.map((/** @type {any} */ part, /** @type {number} */ i) =>
      at.has(i) ? { ...part, at: at.get(i) } : part,
    ),
  };
}

/** a scene file's text with each placed part's at written in: only those numbers change (an at already right is left
 * as it is written), and an at a placed part lacks goes right after its place, as the file lays out its keys
 * @param {string} text */
export function patchPlace(text) {
  const root = parse(text),
    scene = JSON.parse(text),
    { at, problems } = placements(scene);
  if (problems.length) throw new Error(`lk3d: ${problems[0].path}: ${problems[0].message}`);
  const partsNode = root.keys && root.keys.get('parts'),
    edits = [];
  for (const [i, value] of at) {
    const node = partsNode && partsNode.items && partsNode.items[i];
    if (!node || !node.keys) continue;
    const written = `[${value.map((v) => JSON.stringify(v)).join(', ')}]`,
      old = node.keys.get('at');
    if (old) {
      const was = JSON.parse(text.slice(old.start, old.end));
      if (!(Array.isArray(was) && was.length === 3 && was.every((v, k) => v === value[k])))
        edits.push({ start: old.start, end: old.end, text: written });
    } else {
      const place = /** @type {any} */ (node.keys.get('place')),
        line = text.lastIndexOf('\n', place.keyStart) + 1,
        multiline = text.slice(node.start, place.keyStart).includes('\n');
      edits.push({
        start: place.end,
        end: place.end,
        text: multiline ? `,\n${text.slice(line, place.keyStart)}"at": ${written}` : `, "at": ${written}`,
      });
    }
  }
  edits.sort((a, b) => b.start - a.start);
  for (const edit of edits) text = text.slice(0, edit.start) + edit.text + text.slice(edit.end);
  return text;
}

// where each value of a JSON text lies: [start, end), an object's keys (with where each key starts), an array's items
/** @typedef {{ start: number, end: number, keyStart?: number, keys?: Map<string, Node>, items?: Node[] }} Node */
/** @param {string} text @returns {Node} */
function parse(text) {
  let at = 0;
  const space = () => {
      while (/\s/.test(text[at])) at++;
    },
    string = () => {
      const start = at++;
      while (text[at] !== '"') at += text[at] === '\\' ? 2 : 1;
      at++;
      return JSON.parse(text.slice(start, at));
    },
    /** @returns {Node} */
    value = () => {
      space();
      const start = at;
      if (text[at] === '{') {
        at++;
        const keys = new Map();
        for (space(); text[at] !== '}'; space()) {
          const keyStart = at,
            key = string();
          space();
          at++; // :
          const node = value();
          node.keyStart = keyStart;
          keys.set(key, node);
          space();
          if (text[at] === ',') at++;
          space();
        }
        at++;
        return { start, end: at, keys };
      }
      if (text[at] === '[') {
        at++;
        const items = [];
        for (space(); text[at] !== ']'; space()) {
          items.push(value());
          space();
          if (text[at] === ',') at++;
        }
        at++;
        return { start, end: at, items };
      }
      if (text[at] === '"') string();
      else while (at < text.length && !/[\s,\]}]/.test(text[at])) at++;
      return { start, end: at };
    };
  return value();
}

// node src/place.js < scene.json: each placed part's at, as JSON lines ({ part, at }), then any problem ({ path,
// message }) and exit code 1 (lessonkit's ./lk place writes them into spec.yaml)
const direct =
  typeof process !== 'undefined' &&
  !!process.argv?.[1] &&
  import.meta.url ===
    new URL('file://' + (/^\//.test(process.argv[1]) ? '' : '/') + process.argv[1].replace(/\\/g, '/')).href;
if (direct) {
  let text = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => (text += chunk));
  process.stdin.on('end', () => {
    let found;
    try {
      found = placements(JSON.parse(text));
    } catch (e) {
      found = { at: new Map(), problems: [{ path: 'parts', message: `place cannot be worked out: ${e.message}` }] };
    }
    for (const [part, value] of found.at) console.log(JSON.stringify({ part, at: value }));
    for (const problem of found.problems) console.log(JSON.stringify(problem));
    process.exitCode = found.problems.length ? 1 : 0;
  });
}
