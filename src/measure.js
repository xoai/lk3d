// Quantities measured on a scene's built geometry, each with its error: what a page or a lesson compares with the
// numbers its text states (a bond angle, a radius, a gap, a count of blades). Not part of the runtime bundle: import
// 'lk3d/measure'.
//   import { measure } from 'lk3d/measure';
//   measure(scene, { name: { angle: ['h2o.atom[1]', 'h2o.atom[0]', 'h2o.atom[2]'] }, … })
//     → { values: { name: 104.48 }, error: { name: 0 }, problems: [{ path: 'name', message }] }
//   node src/measure.js < {"scene": …, "measures": …}     one JSON line, the same; exit code 1 if there are problems
// Kinds: size (one part's extent along an axis; half: a radius), distance (two points; along: x, y or z, projected on
// that axis of the scene), gap (the nearest distance between two parts' surfaces), angle (at the middle of three points,
// in degrees), count (pieces drawn, or {parts: […]}), read (a number in the scene's data, by its path), sum (other measures added, "-id" subtracting one). A point is "id" (the
// centre of a part's box), "id.label", "id.atom[k]" or "id.shapes[j].atom[k]" (from 0), or [x, y, z]. At rest (the pose
// lk3d check tests: motions at their start, joints solved) or at a guided step (step: its id or its number from 1).
// Error: how far a value may be from the shapes the scene describes. A mesh only approaches a round surface, so what is
// measured on it carries the most the mesh can be from that surface, worked out from the shape's own numbers and the
// quality it was built at (4 here, or less where the scene would make too many triangles); atom centres, label points
// written, reads and counts are exact.
import './models.js'; // (the glTF reader: a model is measured like any other part)
import { buildFitting, shapesOf, flatten } from './geometry.js';
import { buildBVH, nearest } from './bvh.js';
import { M, add, sub, mulv, len, dot } from './math.js';
import { poseOf, poser, extentAlong } from './posed.js';

const QUALITY = 4,
  AXES = 'xyz',
  EDGE_STEPS = 32; // (points along each edge for a gap: what vertex-to-surface leaves, edge against edge, is found to 1/64)

// the most a shape's mesh is from the surface it draws, in the shape's own units, at the quality it was built at: the
// sagitta of each round outline from its own segment counts (as geometry.js and science.js make them); 0 for a shape
// whose mesh is its definition; else half its longest edge (a mesh whose corners lie on its surface is nowhere farther)
const sagitta = (r, n) => r * (1 - Math.cos(Math.PI / n));
const EXACT = ['box', 'extrude', 'blob', 'terrain', 'tree'];
function shapeError(shape, quality, mesh) {
  const q = Math.min(16, quality * (shape.detail || 1));
  if (shape.model != null || EXACT.some((kind) => kind in shape)) return 0;
  if (shape.sphere) {
    const seg = shape.seg || 32;
    return (
      sagitta(shape.sphere, Math.max(6, Math.round(seg * q))) +
      sagitta(shape.sphere, 2 * Math.max(4, Math.round((seg / 2) * q)))
    );
  }
  if (shape.cylinder) {
    const c = shape.cylinder;
    return sagitta(Math.max(c.r, c.r1 ?? c.r), Math.max(6, Math.round((shape.seg || 48) * q)));
  }
  if (shape.lathe) {
    const turn = Math.abs((shape.to ?? 360) - (shape.from ?? 0)) / 360,
      r = Math.max(...shape.lathe.map((point) => Math.abs(point[1])));
    return sagitta(r, Math.max(6, Math.round((shape.seg || 48) * q * turn)) / turn);
  }
  if (shape.torus) {
    const [major, minor] = shape.torus;
    return sagitta(minor, Math.max(6, Math.round(12 * q))) + sagitta(major + minor, Math.max(6, Math.round(48 * q)));
  }
  if (shape.shell) {
    const { r, from = 0, to = 360 } = shape.shell,
      turn = Math.abs(to - from) / 360;
    return (
      sagitta(r, 2 * Math.max(8, Math.round(24 * q))) +
      sagitta(r, Math.max(6, Math.round((48 * q * (to - from)) / 360)) / turn)
    );
  }
  if (shape.tube) {
    const r = Array.isArray(shape.r) ? Math.max(...shape.r) : shape.r || 0.02;
    return sagitta(r, Math.max(5, Math.round(8 * q)));
  }
  return longestEdge(mesh) / 2;
}
function longestEdge(mesh) {
  const p = mesh.positions,
    ix = mesh.indices;
  let longest = 0;
  for (let t = 0; t < ix.length; t += 3)
    for (let k = 0; k < 3; k++) {
      const a = 3 * ix[t + k],
        b = 3 * ix[t + ((k + 1) % 3)];
      longest = Math.max(longest, Math.hypot(p[a] - p[b], p[a + 1] - p[b + 1], p[a + 2] - p[b + 2]));
    }
  return longest;
}
// how much a matrix stretches (its longest column): a shape's error in scene units
const stretch = (m) =>
  Math.max(Math.hypot(m[0], m[1], m[2]), Math.hypot(m[4], m[5], m[6]), Math.hypot(m[8], m[9], m[10]));

/**
 * @param {any} scene
 * @param {Record<string, any>} measures
 * @returns {{ values: Record<string, number>, error: Record<string, number>, problems: { path: string, message: string }[] }}
 */
export function measure(scene, measures) {
  // (with no prototype: a measure may be called constructor or toString)
  const values = Object.create(null),
    error = Object.create(null),
    problems = [];
  let built;
  try {
    built = buildFitting(scene, QUALITY, 1e7);
  } catch (e) {
    for (const name of Object.keys(measures || {}))
      problems.push({ path: name, message: `the scene cannot be built: ${e.message}` });
    return { values, error, problems };
  }
  const parts = scene.parts || [],
    indexOf = new Map(parts.map((part, k) => [part.id, k])),
    poseMatrix = poser(scene),
    context = { models: scene.models, cache: new Map() },
    shapes = new Map(), // part index → its shapes, placed (made when first asked)
    errors = new Map(); // part index → the most its mesh is from its shapes
  const shapesFor = (i) => {
    if (!shapes.has(i)) shapes.set(i, shapesOf(scene, i, built.quality, context));
    return shapes.get(i);
  };
  const partError = (i) => {
    if (!errors.has(i)) {
      const list = shapesFor(i);
      errors.set(
        i,
        list.length
          ? Math.max(
              0,
              ...list.flatMap(({ shape, mesh, matrices }) => {
                // (a scatter's copies are built at its own detail, half the scene's unless it says)
                const e = shape.scatter
                  ? shapeError(
                      shape.scatter.shape,
                      Math.min(16, Math.min(16, built.quality * (shape.detail || 1)) * (shape.scatter.detail ?? 0.5)), // (clamped as geometry.js's detail() is)
                      mesh,
                    )
                  : shapeError(shape, built.quality, mesh);
                return matrices.map((m) => e * stretch(m));
              }),
            )
          : longestEdge(flatten(built.parts[i])) / 2, // (a liquid's body: no shapes of its own)
      );
      // (and the rounding of lk3d's single-precision matrices, a few parts in ten million of the part's size)
      const part = built.parts[i];
      errors.set(
        i,
        errors.get(i) +
          1e-6 * (1 + Math.hypot(...part.max.map((v, k) => Math.max(Math.abs(v), Math.abs(part.min[k]))))),
      );
    }
    return errors.get(i);
  };
  // the parts a name means: a part, or every part of a group
  const partsNamed = (name) => {
    if (indexOf.has(name)) return [indexOf.get(name)];
    return parts.map((part, k) => k).filter((k) => parts[k].group === name);
  };
  class Refused extends Error {}
  const refuse = (message) => {
    throw new Refused(message);
  };
  const onePart = (name) => {
    if (typeof name !== 'string') refuse('name a part by its id');
    if (indexOf.has(name)) return indexOf.get(name);
    refuse(partsNamed(name).length ? `${name} is a group: one part per measure` : `no part ${name}`);
  };
  // a part's matrix and shift in a pose: posed by motions and joints, then moved apart along its explode path
  const placed = (i, pose) => ({
    matrix: poseMatrix(built.parts[i], pose.values),
    shift: mulv(built.parts[i].explode, pose.explode),
  });
  const at = (i, pose, point) => {
    const { matrix, shift } = placed(i, pose);
    return add(M.pt(matrix, point), shift);
  };
  // a point, and its error
  const point = (token, pose) => {
    if (Array.isArray(token)) {
      if (token.length !== 3 || !token.every(Number.isFinite))
        refuse(`${JSON.stringify(token)} is not a point [x, y, z]`);
      return [token, 0];
    }
    if (typeof token !== 'string') refuse(`${JSON.stringify(token)} is not a point`);
    if (indexOf.has(token)) {
      const i = indexOf.get(token),
        { matrix, shift } = placed(i, pose),
        centre = [0, 1, 2].map((axis) => {
          const [low, high] = extentAlong(built.parts[i], matrix, axis);
          return (low + high) / 2 + shift[axis];
        });
      return [centre, partError(i)];
    }
    const label = /^(.+)\.label$/.exec(token);
    if (label) {
      const i = onePart(label[1]),
        written = parts[i].label;
      if (written === false) refuse(`${label[1]} has no label (label: false)`);
      return [at(i, pose, built.parts[i].anchor), Array.isArray(written) ? 0 : partError(i)];
    }
    const atom = /^(.+?)(?:\.shapes\[(\d+)\])?\.atom\[(\d+)\]$/.exec(token);
    if (atom) {
      const i = onePart(atom[1]),
        list = shapesFor(i),
        k = +atom[3],
        chosen =
          atom[2] === undefined
            ? list.find((each) => each.shape.molecule)
            : list[+atom[2]] || refuse(`${atom[1]} has no shape ${atom[2]} (it has ${list.length})`);
      if (!chosen || !chosen.shape.molecule)
        refuse(
          atom[2] === undefined
            ? `${atom[1]} has no molecule shape`
            : `${atom[1]}'s shape ${atom[2]} is not a molecule`,
        );
      const molecule = chosen.shape.molecule,
        atoms = molecule.atoms || [];
      if (!atoms[k]) refuse(`${atom[1]} has no atom ${k} (its molecule has ${atoms.length}: 0 to ${atoms.length - 1})`);
      return [at(i, pose, M.pt(chosen.matrices[0], mulv(atoms[k].at, molecule.scale ?? 1))), 0];
    }
    refuse(`no part ${token}, and not a point ("id", "id.label", "id.atom[k]", "id.shapes[j].atom[k]" or [x, y, z])`);
  };
  // the nearest distance between two parts' surfaces in a pose: every vertex of each, and points along every edge,
  // against the other's surface (vertex to face is exact; edge against edge is found to 1/64 of the longest edge)
  const gapBetween = (i, j, pose) => {
    const a = placed(i, pose),
      b = placed(j, pose),
      meshA = flatten(built.parts[i]),
      meshB = flatten(built.parts[j]),
      one = (from, fromPlaced, to, toPlaced) => {
        const bvh = buildBVH(to),
          into = M.mul(
            M.invert(toPlaced.matrix),
            M.mul(M.trans(sub(fromPlaced.shift, toPlaced.shift)), fromPlaced.matrix),
          ),
          p = from.positions,
          ix = from.indices;
        let least = Infinity;
        const test = (x, y, z) => {
          const before = least,
            d = nearest(to, bvh, M.pt(into, [x, y, z]), least);
          if (d < least) least = d;
          return Number.isFinite(d) ? d : before; // (nearest looks no farther than least: past it, least is what is known)
        };
        // (each vertex's distance, or at least the nearest found when it was tested: a lower bound either way)
        const atVertex = new Float64Array(p.length / 3);
        for (let k = 0; k < p.length; k += 3) atVertex[k / 3] = test(p[k], p[k + 1], p[k + 2]);
        for (let t = 0; t < ix.length; t += 3)
          for (let e = 0; e < 3; e++) {
            const u = 3 * ix[t + e],
              v = 3 * ix[t + ((e + 1) % 3)],
              length = Math.hypot(p[v] - p[u], p[v + 1] - p[u + 1], p[v + 2] - p[u + 2]);
            // (no point of an edge is nearer than its nearer end less its length: such an edge cannot do better)
            if (Math.min(atVertex[u / 3], atVertex[v / 3]) - length >= least) continue;
            for (let s = 1; s < EDGE_STEPS; s++) {
              const f = s / EDGE_STEPS;
              test(
                p[u] + (p[v] - p[u]) * f,
                p[u + 1] + (p[v + 1] - p[u + 1]) * f,
                p[u + 2] + (p[v + 2] - p[u + 2]) * f,
              );
            }
          }
        return least;
      };
    const value = Math.min(one(meshA, a, meshB, b), one(meshB, b, meshA, a)),
      sampling = Math.max(longestEdge(meshA), longestEdge(meshB)) / (2 * EDGE_STEPS);
    return [value, partError(i) + partError(j) + sampling];
  };
  // a number in the scene's data, by its path
  const read = (path) => {
    if (!Array.isArray(path) || !path.length) refuse('read: a path, as a list (["mars", "shapes", 0, "orbit", "a"])');
    let here = typeof path[0] === 'string' && indexOf.has(path[0]) ? parts[indexOf.get(path[0])] : scene;
    for (const step of indexOf.has(path[0]) ? path.slice(1) : path) {
      if (here === null || typeof here !== 'object' || !(step in here))
        refuse(`read: nothing at ${JSON.stringify(path)} (stopped at ${JSON.stringify(step)})`);
      here = here[step];
    }
    if (typeof here !== 'number') refuse(`read: ${JSON.stringify(path)} is not a number`);
    return here;
  };
  const count = (what) => {
    if (what && typeof what === 'object' && !Array.isArray(what)) {
      if (!Array.isArray(what.parts)) refuse('count: a part, a list of them, or {parts: [ids or groups]}');
      return what.parts.reduce((sum, name) => {
        const found = partsNamed(name);
        if (!found.length) refuse(`no part or group ${name}`);
        return sum + found.length;
      }, 0);
    }
    return (Array.isArray(what) ? what : [what]).reduce((sum, name) => {
      const found = partsNamed(name);
      if (!found.length) refuse(`no part or group ${name}`);
      return sum + found.reduce((n, i) => n + shapesFor(i).reduce((m, each) => m + each.matrices.length, 0), 0);
    }, 0);
  };
  // each measure, once (a sum asks for others; a loop of sums is refused)
  const kinds = Object.create(null),
    doing = new Set();
  const take = (name) => {
    if (name in values) return;
    const spec = measures[name];
    if (!spec || typeof spec !== 'object') refuse(`no measure ${name}`);
    if (doing.has(name)) refuse(`${name} sums itself`);
    doing.add(name);
    const pose = poseOf(scene, spec.step);
    if (!pose) refuse(`no step ${spec.step}`);
    let value, e, kind;
    if ('size' in spec) {
      const i = onePart(spec.size),
        axis = [...AXES].indexOf(spec.axis); // (one letter: 'xyz'.indexOf would take 'xy' or '')
      if (axis < 0) refuse('size: an axis, x, y or z');
      const [low, high] = extentAlong(built.parts[i], placed(i, pose).matrix, axis);
      [value, e, kind] = spec.half
        ? [(high - low) / 2, partError(i), 'length']
        : [high - low, 2 * partError(i), 'length'];
    } else if ('distance' in spec) {
      if (!Array.isArray(spec.distance) || spec.distance.length !== 2) refuse('distance: two points');
      const [[p, ep], [q, eq]] = spec.distance.map((token) => point(token, pose));
      // along: the distance projected on one of the scene's axes (|p[a] - q[a]|)
      const along = 'along' in spec ? ['x', 'y', 'z'].indexOf(spec.along) : -1;
      if ('along' in spec && along < 0) refuse('distance.along: x, y or z');
      [value, e, kind] = [along < 0 ? len(sub(p, q)) : Math.abs(p[along] - q[along]), ep + eq, 'length'];
    } else if ('gap' in spec) {
      if (!Array.isArray(spec.gap) || spec.gap.length !== 2) refuse('gap: two parts');
      [value, e] = gapBetween(onePart(spec.gap[0]), onePart(spec.gap[1]), pose);
      kind = 'length';
    } else if ('angle' in spec) {
      if (!Array.isArray(spec.angle) || spec.angle.length !== 3)
        refuse('angle: three points, the angle at the middle one');
      const [[a, ea], [v, ev], [b, eb]] = spec.angle.map((token) => point(token, pose)),
        u = sub(a, v),
        w = sub(b, v),
        lu = len(u),
        lw = len(w);
      if (!lu || !lw) refuse('angle: a point at the middle one has no direction');
      value = (Math.acos(Math.max(-1, Math.min(1, dot(u, w) / (lu * lw)))) * 180) / Math.PI;
      e = (((ea + ev) / lu + (eb + ev) / lw) * 180) / Math.PI;
      kind = 'angle';
    } else if ('count' in spec) [value, e, kind] = [count(spec.count), 0, 'count'];
    else if ('read' in spec) [value, e, kind] = [read(spec.read), 0, 'number'];
    else if ('sum' in spec) {
      if (!Array.isArray(spec.sum) || !spec.sum.length) refuse('sum: a list of measures ("-id" subtracts one)');
      value = 0;
      e = 0;
      for (const term of spec.sum) {
        const minus = typeof term === 'string' && term.startsWith('-'),
          other = minus ? term.slice(1) : term;
        try {
          take(other);
        } catch (failure) {
          if (failure instanceof Refused && !(other in values)) refuse(`${other}: ${failure.message}`);
          throw failure;
        }
        if (!(other in values)) refuse(`${other} could not be measured`);
        if (kind && kinds[other] !== kind) refuse(`sum: ${other} is a ${kinds[other]}, not a ${kind}`);
        kind = kinds[other];
        value += minus ? -values[other] : values[other];
        e += error[other];
      }
    } else refuse('one of size, distance, gap, angle, count, read or sum');
    doing.delete(name);
    if (!Number.isFinite(value)) refuse('is not a number (a shape with nothing to measure?)');
    values[name] = value;
    error[name] = e;
    kinds[name] = kind;
  };
  for (const name of Object.keys(measures || {}))
    try {
      take(name);
    } catch (failure) {
      if (!(failure instanceof Refused)) throw failure;
      doing.clear();
      if (!problems.some((problem) => problem.path === name)) problems.push({ path: name, message: failure.message });
    }
  return { values, error, problems };
}

// node src/measure.js < {"scene": …, "measures": …}: the values, errors and problems as one JSON line (lessonkit's
// ./lk check reads it); exit code 1 if there are problems
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
    let result;
    try {
      const { scene, measures } = JSON.parse(text);
      result = measure(scene, measures);
    } catch (e) {
      result = { values: {}, error: {}, problems: [{ path: 'measures', message: `cannot be measured: ${e.message}` }] };
    }
    console.log(JSON.stringify(result));
    process.exitCode = result.problems.length ? 1 : 0;
  });
}
