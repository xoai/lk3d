// Checks a scene's geometry without drawing it (in Node, or a browser): what a reader would see as a mistake but no
// schema can say. Parts that run into each other while the model is taken apart (more than they overlap at rest: parts
// may sit inside others, an organelle in a cell, a filament in a bulb); parts that rest on nothing; labels that point
// at a place inside another part once taken apart, when labels show. Not part of the runtime bundle: import 'lk3d/lint'.
//   import { lint } from 'lk3d/lint';  lint(scene) → { problems: [{ path, message }], summary: { parts, shapes, … } }
//   node src/lint.js < scene.json        prints the summary and the problems; exit code 1 if there are any
// A scene excuses what it means on purpose, by name and nothing wider: check: { allow: [[a, b], …] } for two parts that
// may run into each other or hide each other's label (two pictures of one molecule, shown in turn), check: { float:
// [ids or groups] } for parts that hang in the air (planets, a cell's own nucleus drawn beside it), or float: true for a
// scene whose parts all float.
import { buildScene, flatten, edgesOf } from './geometry.js';
import { buildBVH, intersect } from './bvh.js';
import { add, mulv, sub, cross, dot, len, norm } from './math.js';

const RAYS = [norm([0.31, 0.83, 0.47]), norm([-0.72, 0.15, 0.68]), norm([0.18, -0.64, -0.75])];

// a part as one geometry in scene coordinates (moved apart by `apart`, 0 at rest), its bounds, a tree for rays, and
// whether it is closed (a solid that has an inside: no surface ends anywhere)
function solid(p) {
  const g = flatten(p);
  return { p, g, bvh: buildBVH(g), closed: g.count > 0 && edgesOf(g, 180).length === 0 };
}
const at = (s, apart) => mulv(s.p.explode, apart);

// how deep a point is inside a closed part (0: outside): the nearest hit of each of three rays must be the back of a
// face, so the point is enclosed; its depth is the nearest of those hits
function depthIn(s, q) {
  let inside = 0,
    depth = Infinity;
  for (const d of RAYS) {
    const h = intersect(s.g, s.bvh, q, d);
    if (!h) continue;
    const I = s.g.i,
      P = s.g.p,
      v = (k) => [P[3 * I[3 * h.tri + k]], P[3 * I[3 * h.tri + k] + 1], P[3 * I[3 * h.tri + k] + 2]],
      n = cross(sub(v(1), v(0)), sub(v(2), v(0)));
    if (dot(n, d) > 0) {
      inside++;
      depth = Math.min(depth, h.t);
    }
  }
  return inside >= 2 ? depth : 0;
}
// points on a part's surface, to test against another: 600, spread evenly by area (a thin plate cutting across a post
// has no vertex inside it, but some of the post's surface is), the same every run
function samples(s) {
  if (s.pts) return s.pts;
  const P = s.g.p,
    I = s.g.i,
    t = I.length / 3,
    cum = new Float64Array(t),
    v = (k, j) => [P[3 * I[3 * k + j]], P[3 * I[3 * k + j] + 1], P[3 * I[3 * k + j] + 2]];
  let total = 0;
  for (let k = 0; k < t; k++) cum[k] = total += len(cross(sub(v(k, 1), v(k, 0)), sub(v(k, 2), v(k, 0))));
  const out = [];
  for (let n = 0, k = 0; n < 600 && total > 0; n++) {
    const want = ((n + 0.5) / 600) * total;
    while (k < t - 1 && cum[k] < want) k++;
    let x = (n * 0.618034) % 1,
      y = (n * 0.754878) % 1;
    if (x + y > 1) [x, y] = [1 - x, 1 - y];
    const A = v(k, 0);
    out.push(add(A, add(mulv(sub(v(k, 1), A), x), mulv(sub(v(k, 2), A), y))));
  }
  return (s.pts = out);
}
// the share of a's points more than eps inside b, with both moved apart by `apart`
function through(a, b, apart, eps) {
  const pts = samples(a),
    shift = sub(at(a, apart), at(b, apart));
  let hits = 0;
  for (const q of pts) if (depthIn(b, add(q, shift)) > eps) hits++;
  return pts.length ? hits / pts.length : 0;
}
// do the bounds of a and b (moved apart by `apart`) overlap, give or take eps?
function near(a, b, apart, eps) {
  const oa = at(a, apart),
    ob = at(b, apart);
  for (let k = 0; k < 3; k++)
    if (a.p.lo[k] + oa[k] > b.p.hi[k] + ob[k] + eps || b.p.lo[k] + ob[k] > a.p.hi[k] + oa[k] + eps) return false;
  return true;
}

export function lint(scene, o = {}) {
  const S = buildScene(scene, o.quality ?? 0.5),
    eps = S.radius * 0.005, // half a percent of the model: closer than this is touching
    check = scene.check || {},
    pair = (a, b) => (check.allow || []).some(([x, y]) => (x === a && y === b) || (x === b && y === a)),
    named = (p, list) => list === true || (list || []).some((k) => k === p.id || k === p.group),
    index = new Map((scene.parts || []).map((p, k) => [p.id, k])),
    path = (p) => `parts[${index.get(p.id) ?? p.index}]`,
    problems = [],
    parts = S.parts.filter((p) => p.tris > 0).map(solid);
  // parts that run into each other on the way apart (a quarter, half, three quarters or all the way): more of one
  // inside the other than at rest
  for (let i = 0; i < parts.length; i++)
    for (let j = i + 1; j < parts.length; j++) {
      const a = parts[i],
        b = parts[j];
      if (pair(a.p.id, b.p.id) || (!a.closed && !b.closed)) continue;
      const share = (apart) =>
        near(a, b, apart, -eps)
          ? Math.max(b.closed ? through(a, b, apart, eps) : 0, a.closed ? through(b, a, apart, eps) : 0)
          : 0;
      const rest = share(0),
        worst = Math.max(share(0.25), share(0.5), share(0.75), share(1));
      if (worst > rest + 0.03)
        problems.push({
          path: path(a.p),
          message: `${a.p.id} and ${b.p.id} run into each other when taken apart (${Math.round(worst * 100)} % of one inside the other, ${Math.round(rest * 100)} % at rest): move them apart along other paths`,
        });
    }
  // parts that rest on nothing: touching no other part and above the ground
  if (check.float !== true)
    for (const a of parts) {
      if (named(a.p, check.float) || a.p.lo[1] <= S.lo[1] + eps) continue;
      if (!parts.some((b) => b !== a && near(a, b, 0, eps)))
        problems.push({
          path: path(a.p),
          message: `${a.p.id} touches no other part and hangs in the air: rest it on another part, or list it under check.float`,
        });
    }
  // labels that point inside another (opaque) part once taken apart, when labels show by themselves
  for (const a of parts) {
    if (!a.p.name || a.p.label === false) continue;
    const q = add(a.p.anchor, at(a, 1)),
      hid = parts.find(
        (b) =>
          b !== a &&
          b.closed &&
          !b.p.xray &&
          b.p.alpha >= 0.99 &&
          !pair(a.p.id, b.p.id) &&
          depthIn(b, sub(q, at(b, 1))) > eps,
      );
    if (hid)
      problems.push({
        path: path(a.p),
        message: `the label of ${a.p.id} points inside ${hid.p.id} when taken apart, where no one sees it: give the part a label point ("label": [x, y, z]) on its visible surface`,
      });
  }
  const shapes = (scene.parts || []).reduce((n, p) => n + (p.shapes || []).length, 0);
  return {
    problems,
    summary: {
      parts: S.parts.length,
      shapes,
      placed: S.parts.reduce((n, p) => n + p.batches.reduce((m, b) => m + b.mats.length, 0), 0),
      triangles: Math.round(S.parts.reduce((n, p) => n + p.tris, 0)),
      accents: S.parts.filter((p) => p.accent).length,
      named: S.parts.filter((p) => p.name).length,
      size: S.radius * 2,
    },
  };
}

// from the command line: a scene (JSON) on stdin; its summary, then one problem per line
if (typeof process !== 'undefined' && /lint\.js$/.test(process.argv[1] || '') && import.meta.url.endsWith('/lint.js')) {
  let text = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (d) => (text += d));
  process.stdin.on('end', () => {
    const r = lint(JSON.parse(text));
    console.log(JSON.stringify(r.summary));
    for (const e of r.problems) console.log(JSON.stringify(e));
    process.exitCode = r.problems.length ? 1 : 0;
  });
}
