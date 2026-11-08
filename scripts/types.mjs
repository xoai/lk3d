// Writes scene.d.ts, the TypeScript types of the scene, from schema/scene.schema.json: the schema is the one description
// of the format, so the types cannot say something it does not.
//   node scripts/types.mjs            write scene.d.ts (npm run types)
//   node scripts/types.mjs --check    fail if scene.d.ts is not what the schema makes (the tests do this too)
//   node scripts/types.mjs --scenes   type-check the example and reference scenes against Scene (npm run typecheck)
//
// It covers the constructs the schema uses: type (one or several), enum, const, properties and required,
// additionalProperties (false, true or a schema), patternProperties, items, prefixItems (a tuple, its optional tail
// from minItems), anyOf, oneOf, local $ref into $defs, and an object's oneOf/anyOf of `required` lists (its forms: a
// union, each form with its keys required; for oneOf, each form also without the keys that pick out the others).
// What TypeScript cannot say stays in the comments: bounds, patterns, minimum lengths, dependentSchemas. A keyword it
// does not know is an error, so a new construct in the schema is not silently left out of the types.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const OUT = path.join(ROOT, 'scene.d.ts');
const SCHEMA = path.join(ROOT, 'schema/scene.schema.json');

// Names for types the schema writes in place (its $defs are named after themselves, the root is Scene). A form type
// (an object with a oneOf/anyOf of required lists) needs a name; the others are named when a page may want to say them.
const NAMES = {
  '#/properties/style': 'Look',
  '#/properties/theme': 'SceneTheme',
  '#/properties/scale': 'SceneScale',
  '#/$defs/part/properties/material': 'Material',
  '#/$defs/motion/properties/tracks/items': 'MotionTrack',
  '#/$defs/shape/properties/scatter/properties/within': 'ScatterWithin',
};

// Keywords that say nothing about the type (bounds and the like go into the comment).
const IGNORED = new Set(['$schema', '$id', 'title', 'description', 'x-message', 'dependentSchemas']);
const NOTED = ['minimum', 'exclusiveMinimum', 'maximum', 'exclusiveMaximum', 'minLength', 'maxLength', 'pattern'];
const KNOWN = new Set([
  ...IGNORED,
  ...NOTED,
  'type',
  'enum',
  'const',
  'properties',
  'required',
  'additionalProperties',
  'patternProperties',
  'items',
  'prefixItems',
  'minItems',
  'maxItems',
  'anyOf',
  'oneOf',
  '$ref',
  '$defs',
]);

const pascal = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const key = (k) => (/^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k));
// a comment's line broken at spaces into lines of at most `width` (Prettier leaves comments as they are)
function wrap(line, width) {
  if (line.startsWith('@')) return [line];
  const out = [];
  let cur = '';
  for (const word of line.split(' ')) {
    if (cur && cur.length + 1 + word.length > width) {
      out.push(cur);
      cur = word;
    } else cur = cur ? `${cur} ${word}` : word;
  }
  return [...out, cur];
}
const simple = (t) => /^[\w$.]+(\[\])*$/.test(t) || /^\[.*\]$/.test(t);

/** the TypeScript of scene.d.ts (formatted with the package's Prettier settings) */
export async function generate(schema = JSON.parse(fs.readFileSync(SCHEMA, 'utf8'))) {
  const decls = [],
    todo = [], // [pointer, name, node] still to declare
    queued = new Map(); // pointer → name
  const defName = (ref) => {
    const m = /^#\/\$defs\/([^/]+)$/.exec(ref);
    if (!m || !schema.$defs?.[m[1]]) throw new Error(`scene.schema.json: ${ref} is not a $def`);
    return pascal(m[1]);
  };
  const queue = (ptr, name, node) => {
    if (!queued.has(ptr)) {
      queued.set(ptr, name);
      todo.push([ptr, name, node]);
    }
    return name;
  };

  function doc(node, extra = []) {
    const lines = [];
    const says = node.description || node['x-message'];
    if (says) lines.push(says);
    for (const k of NOTED) if (node[k] != null) lines.push(`@${k} ${node[k]}`);
    if (node.type === 'integer') lines.push('@integer');
    lines.push(...extra);
    if (!lines.length) return '';
    const text = lines.flatMap((l) => wrap(l.replace(/\*\//g, '*\\/'), 108));
    return text.length === 1 && text[0].length < 100
      ? `/** ${text[0]} */\n`
      : `/**\n${text.map((l) => ` * ${l}`).join('\n')}\n */\n`;
  }

  // the forms of an object: a oneOf/anyOf whose every branch only lists required keys
  function forms(node) {
    const which = node.oneOf ? 'oneOf' : node.anyOf ? 'anyOf' : null;
    if (!which || node.type !== 'object' || !node.properties) return null;
    const branches = node[which];
    if (!branches.every((b) => Object.keys(b).length === 1 && Array.isArray(b.required))) return null;
    for (const b of branches)
      for (const k of b.required) if (!(k in node.properties)) throw new Error(`a form requires ${k}, not a field`);
    return { which, branches: branches.map((b) => b.required) };
  }

  function check(node, ptr) {
    for (const k of Object.keys(node))
      if (!KNOWN.has(k)) throw new Error(`scene.schema.json ${ptr}: types.mjs does not know the keyword "${k}"`);
    if ((node.oneOf || node.anyOf) && node.type === 'object' && node.properties && !forms(node))
      throw new Error(`scene.schema.json ${ptr}: an object with oneOf/anyOf other than required lists`);
  }

  // a type expression for a node, naming it (and declaring it later) when it has a name
  function type(node, ptr) {
    if (node === true || node === undefined) return 'unknown';
    if (node === false) return 'never';
    check(node, ptr);
    if (node.$ref) return queue(node.$ref, defName(node.$ref), schema.$defs[node.$ref.split('/').pop()]);
    if (NAMES[ptr]) return queue(ptr, NAMES[ptr], node);
    if (forms(node)) throw new Error(`scene.schema.json ${ptr}: give this object a name in NAMES (types.mjs)`);
    return shape(node, ptr);
  }

  // the type itself, without naming it
  function shape(node, ptr) {
    if ('const' in node) return JSON.stringify(node.const);
    if (node.enum) return node.enum.map((v) => JSON.stringify(v)).join(' | ');
    const alts = node.anyOf || node.oneOf;
    if (alts && !node.type)
      return alts.map((a, i) => type(a, `${ptr}/${node.anyOf ? 'anyOf' : 'oneOf'}/${i}`)).join(' | ');
    const types = Array.isArray(node.type) ? node.type : node.type ? [node.type] : [];
    if (!types.length) return 'unknown';
    return types
      .map((t) => {
        if (t === 'string' || t === 'boolean' || t === 'null') return t;
        if (t === 'number' || t === 'integer') return 'number';
        if (t === 'array') return array(node, ptr);
        if (t === 'object') return object(node, ptr);
        throw new Error(`scene.schema.json ${ptr}: unknown type ${t}`);
      })
      .join(' | ');
  }

  function array(node, ptr) {
    if (node.prefixItems) {
      const n = node.prefixItems.length,
        min = node.minItems ?? 0;
      const els = node.prefixItems.map((p, i) => {
        const t = type(p, `${ptr}/prefixItems/${i}`);
        return i < min ? t : `(${t})?`;
      });
      if (node.items === false || node.maxItems === n) return `[${els.join(', ')}]`;
      return `[${els.join(', ')}, ...Array<${type(node.items, `${ptr}/items`)}>]`;
    }
    const t = type(node.items, `${ptr}/items`);
    return simple(t) ? `${t}[]` : `Array<${t}>`;
  }

  // an object's fields, as the body of an interface; `index`: with what other fields may be (where any are allowed)
  function fields(node, ptr, { index = true } = {}) {
    const req = new Set(node.required || []),
      deps = node.dependentSchemas || {};
    const rows = Object.entries(node.properties || {}).map(([k, p]) => {
      const t = type(p, `${ptr}/properties/${k}`);
      const own = p.$ref ? { ...p } : p; // a $ref's own description, not its target's
      const extra = deps[k]?.['x-message'] ? [`@remarks ${deps[k]['x-message']}`] : [];
      return `${doc(own, extra)}${key(k)}${req.has(k) ? '' : '?'}: ${t};`;
    });
    if (index) {
      const other = indexType(node, ptr);
      if (other) rows.push(`[key: string]: ${other};`);
    }
    return `{\n${rows.join('\n')}\n}`;
  }

  // what other fields may be: unknown (open), a schema's type, or nothing (closed)
  function indexType(node, ptr) {
    const ap = node.additionalProperties,
      pp = node.patternProperties || {};
    if (ap === false && !Object.keys(pp).length) return null;
    const ts = Object.entries(pp).map(([re, s]) => type(s, `${ptr}/patternProperties/${re}`));
    if (ap !== false) ts.push(ap && typeof ap === 'object' ? type(ap, `${ptr}/additionalProperties`) : 'unknown');
    if (ts.includes('unknown')) return 'unknown';
    // every listed field must fit the index type too
    for (const [k, p] of Object.entries(node.properties || {})) ts.push(type(p, `${ptr}/properties/${k}`));
    return [...new Set(ts)].join(' | ');
  }

  function object(node, ptr) {
    if (!node.properties && !node.patternProperties) {
      const t = indexType(node, ptr);
      return t ? `{ [key: string]: ${t} }` : 'Record<string, never>';
    }
    return fields(node, ptr);
  }

  // a named type: an interface for a plain object, a union of forms for an object with forms, else an alias
  function declare(ptr, name, node) {
    check(node, ptr);
    const f = forms(node);
    if (f) {
      const base = `${name}Fields`,
        firsts = f.branches.map((r) => r[0]);
      const exclusive =
        f.which === 'oneOf' &&
        new Set(firsts).size === firsts.length &&
        f.branches.every((r, i) => firsts.every((k, j) => i === j || !r.includes(k)));
      if (f.which === 'oneOf' && !exclusive)
        throw new Error(`scene.schema.json ${ptr}: oneOf forms whose first keys do not tell them apart`);
      const kind = `${name}Kind`;
      const cases = f.branches.map((r) => {
        const k = r.map((x) => JSON.stringify(x)).join(' | ');
        return f.which === 'oneOf'
          ? `Form<${base}, ${k}, Exclude<${kind}, ${JSON.stringify(r[0])}>>`
          : `Form<${base}, ${k}>`;
      });
      const other = indexType(node, ptr);
      const union = cases.map((c) => `| ${c}`).join('\n');
      let out = `${doc(node)}export type ${name} = ${other ? `(${union}) & { [key: string]: ${other} }` : union};\n\n`;
      if (f.which === 'oneOf')
        out += `/** the kinds of ${name}: exactly one of these keys picks its form */\nexport type ${kind} = ${firsts.map((x) => JSON.stringify(x)).join(' | ')};\n\n`;
      out += `/** the fields of ${name}, each optional (${name} says which are required, together) */\nexport interface ${base} ${fields(node, ptr, { index: false })}\n`;
      return out;
    }
    if (node.type === 'object' && !node.anyOf && !node.oneOf && (node.properties || node.patternProperties))
      return `${doc(node)}export interface ${name} ${fields(node, ptr)}\n`;
    return `${doc(node)}export type ${name} = ${shape(node, ptr)};\n`;
  }

  // declared in the order the scene reaches them, then any $def it does not reach
  queue('#', 'Scene', schema);
  let done = 0;
  const drain = () => {
    while (done < todo.length) decls.push(declare(...todo[done++]));
  };
  drain();
  for (const name of Object.keys(schema.$defs || {})) {
    queue(`#/$defs/${name}`, pascal(name), schema.$defs[name]);
    drain();
  }

  const head = `// The scene's types, generated from schema/scene.schema.json by scripts/types.mjs (npm run types): do not edit.
// What TypeScript cannot say (bounds, patterns, lists that may not be empty, refract only on glass) is in the
// comments, and lk3d/validate checks it.

/** one form of T: the keys K required, and the keys N (which pick out the other forms) absent */
type Form<T, K extends keyof T, N extends keyof T = never> = Omit<T, K | N> & Required<Pick<T, K>> & { [P in N]?: never };

`;
  const prettier = await import('prettier');
  const options = (await prettier.resolveConfig(OUT)) || {};
  return prettier.format(head + decls.join('\n'), { ...options, parser: 'typescript' });
}

// The example and reference scenes, each checked as `<the scene's JSON> satisfies Scene`, keeping its lines so that an
// error points at the scene's own line.
export function checkScenes(dirs = ['examples/scenes', 'test/visual/scenes']) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lk3d-scenes-'));
  const files = [],
    back = new Map();
  try {
    for (const dir of dirs)
      for (const f of fs
        .readdirSync(path.resolve(ROOT, dir))
        .filter((f) => f.endsWith('.json'))
        .sort()) {
        const rel = `${dir}/${f}`,
          name = rel.replace(/[^\w]/g, '_') + '.ts';
        const json = fs.readFileSync(path.resolve(ROOT, rel), 'utf8');
        const ts = `import type { Scene } from ${JSON.stringify(path.join(ROOT, 'index.js'))}; export default (${json.trimEnd()}) satisfies Scene;\n`;
        fs.writeFileSync(path.join(tmp, name), ts);
        files.push(name);
        back.set(name, rel);
      }
    const config = {
      compilerOptions: {
        strict: true,
        noEmit: true,
        target: 'es2020',
        module: 'nodenext',
        moduleResolution: 'nodenext',
        lib: ['es2020', 'dom'],
        skipLibCheck: true,
      },
      files,
    };
    fs.writeFileSync(path.join(tmp, 'tsconfig.json'), JSON.stringify(config));
    const tsc = path.join(ROOT, 'node_modules/.bin/tsc');
    const r = spawnSync(tsc, ['-p', 'tsconfig.json', '--pretty', 'false'], { cwd: tmp, encoding: 'utf8' });
    let out = `${r.stdout || ''}${r.stderr || ''}`;
    for (const [name, rel] of back) out = out.split(name).join(rel);
    return { ok: r.status === 0, count: files.length, output: out.trim() };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = process.argv[2];
  if (arg === '--scenes') {
    const r = checkScenes();
    if (!r.ok) {
      console.error(r.output);
      console.error('a scene does not type-check against Scene (scene.d.ts)');
      process.exit(1);
    }
    console.log(`${r.count} scenes type-check against Scene`);
  } else {
    const text = await generate();
    if (arg === '--check') {
      const now = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
      if (now !== text) {
        console.error('scene.d.ts is not what schema/scene.schema.json makes: run npm run types');
        process.exit(1);
      }
      console.log('scene.d.ts is up to date');
    } else {
      fs.writeFileSync(OUT, text);
      console.log('scene.d.ts');
    }
  }
}
