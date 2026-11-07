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
import { buildScene, flatten, isClosed } from './geometry.js';
import { buildBVH, intersect } from './bvh.js';
import { M, add, mulv, sub, cross, dot, len, norm } from './math.js';
import { tracksOf, motionMatrix } from './motion.js';
import { jointsOf, jointOf, motionsOf, solve as solveJoints } from './joints.js';
import * as FX from './fluids.js';

const RAYS = [norm([0.31, 0.83, 0.47]), norm([-0.72, 0.15, 0.68]), norm([0.18, -0.64, -0.75])];

// a part as one geometry in scene coordinates (moved apart by `apart`, 0 at rest), its bounds, a tree for rays, and
// whether it is closed (a solid that has an inside: no surface ends anywhere)
const closedOf = new WeakMap(); // (per geometry: parts alike share theirs)
function solid(p) {
  const g = flatten(p),
    closed = p.batches.every((b) => {
      if (!closedOf.has(b.geo)) closedOf.set(b.geo, isClosed(b.geo));
      return closedOf.get(b.geo);
    });
  return { p, g, bvh: buildBVH(g), closed };
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
// the share of a's points more than eps inside b, with both moved apart by `apart` (a point outside b's box is not
// inside b: no rays are cast for it)
function through(a, b, apart, eps) {
  const pts = samples(a),
    shift = sub(at(a, apart), at(b, apart));
  let hits = 0;
  for (const q of pts) {
    const r = add(q, shift);
    if (inBox(b, r) && depthIn(b, r) > eps) hits++;
  }
  return pts.length ? hits / pts.length : 0;
}
// the share of a's points more than eps inside b, each part placed by its matrix (a motion's): a's points into the
// scene by Ma, then into b's own frame at rest by the inverse of Mb
function throughM(a, Ma, b, Mb, eps) {
  const pts = samples(a),
    to = M.mul(M.invert(Mb), Ma);
  let hits = 0;
  for (const q of pts) {
    const r = M.pt(to, q);
    if (inBox(b, r) && depthIn(b, r) > eps) hits++;
  }
  return pts.length ? hits / pts.length : 0;
}
// a part's box placed by a matrix (its eight corners, moved)
function boxAt(s, m) {
  const lo = [Infinity, Infinity, Infinity],
    hi = [-Infinity, -Infinity, -Infinity];
  for (let c = 0; c < 8; c++) {
    const w = M.pt(
      m,
      [0, 1, 2].map((a) => ((c >> a) & 1 ? s.p.hi[a] : s.p.lo[a])),
    );
    for (let a = 0; a < 3; a++) {
      lo[a] = Math.min(lo[a], w[a]);
      hi[a] = Math.max(hi[a], w[a]);
    }
  }
  return [lo, hi];
}
// is the point within the part's bounds at rest? (a cheap test before casting rays)
const inBox = (s, q) => [0, 1, 2].every((k) => q[k] >= s.p.lo[k] && q[k] <= s.p.hi[k]);
// do the bounds of a and b (moved apart by `apart`) overlap, give or take eps?
function near(a, b, apart, eps) {
  const oa = at(a, apart),
    ob = at(b, apart);
  for (let k = 0; k < 3; k++)
    if (a.p.lo[k] + oa[k] > b.p.hi[k] + ob[k] + eps || b.p.lo[k] + ob[k] > a.p.hi[k] + oa[k] + eps) return false;
  return true;
}

// the stretch of the way apart (from 0 to 1) in which a's and b's boxes overlap, give or take eps; null if never. Each
// box moves along its own explode, so on each axis the overlap holds between two amounts
function when(a, b, eps) {
  let t0 = 0,
    t1 = 1;
  for (let k = 0; k < 3; k++) {
    // a.lo + t·ea ≤ b.hi + t·eb + eps and b.lo + t·eb ≤ a.hi + t·ea + eps, as d·t ≤ c twice
    const d = a.p.explode[k] - b.p.explode[k];
    for (const [c, s] of [
      [b.p.hi[k] + eps - a.p.lo[k], d],
      [a.p.hi[k] + eps - b.p.lo[k], -d],
    ]) {
      if (Math.abs(s) < 1e-12) {
        if (c < 0) return null;
      } else if (s > 0) t1 = Math.min(t1, c / s);
      else t0 = Math.max(t0, c / s);
    }
  }
  return t0 <= t1 ? [t0, t1] : null;
}
// the amounts apart at which to test a pair: within the stretch they overlap, in steps that move one part against the
// other by less than half the thinner one (a pin sent through a thin plate is caught), at most 32
function amounts(a, b, eps) {
  const w = when(a, b, -eps);
  if (!w) return [];
  const rel = len(sub(a.p.explode, b.p.explode)),
    thin = Math.max(
      eps,
      Math.min(...[0, 1, 2].map((k) => a.p.hi[k] - a.p.lo[k]), ...[0, 1, 2].map((k) => b.p.hi[k] - b.p.lo[k])),
    ),
    n = Math.min(32, Math.max(4, Math.ceil(((w[1] - w[0]) * rel) / (thin / 2)))),
    out = [];
  for (let k = 0; k <= n; k++) if (w[0] + ((w[1] - w[0]) * k) / n > 0) out.push(w[0] + ((w[1] - w[0]) * k) / n);
  return out;
}

// the pairs of parts worth testing: those whose boxes, swept along their way apart and grown by eps, share a cell of
// a grid (a part that spans a great many cells, a casing, is paired with every part): a model of thousands of parts
// is not tested pair by pair
function candidates(parts, eps) {
  const n = parts.length,
    boxes = parts.map(({ p }) => {
      const lo = p.lo.slice(),
        hi = p.hi.slice();
      for (let a = 0; a < 3; a++) {
        lo[a] += Math.min(0, p.explode[a]) - eps;
        hi[a] += Math.max(0, p.explode[a]) + eps;
      }
      return [lo, hi];
    }),
    sizes = boxes.map(([lo, hi]) => Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2])).sort((a, b) => a - b),
    cell = Math.max(1e-6, (sizes[n >> 1] || 1) * 2),
    grid = new Map(),
    big = [],
    out = new Set();
  boxes.forEach(([lo, hi], i) => {
    const c0 = lo.map((v) => Math.floor(v / cell)),
      c1 = hi.map((v) => Math.floor(v / cell));
    if ((c1[0] - c0[0] + 1) * (c1[1] - c0[1] + 1) * (c1[2] - c0[2] + 1) > 512) return big.push(i);
    for (let x = c0[0]; x <= c1[0]; x++)
      for (let y = c0[1]; y <= c1[1]; y++)
        for (let z = c0[2]; z <= c1[2]; z++) {
          const k = x + ',' + y + ',' + z,
            list = grid.get(k) || [];
          for (const j of list) out.add(j * n + i);
          list.push(i);
          grid.set(k, list);
        }
  });
  for (const i of big) for (let j = 0; j < n; j++) if (j !== i) out.add(Math.min(i, j) * n + Math.max(i, j));
  return [...out].map((k) => [Math.floor(k / n), k % n]);
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
  // parts that make nothing to draw, or a shape whose numbers are not numbers (NaN): the rest of the check is blind there
  for (const p of S.parts)
    if ((!p.tris && !p.fluid) || p.batches.some((b) => !b.geo.p.every(Number.isFinite)))
      // (an empty vessel's liquid: none)
      problems.push({
        path: path(p),
        message: p.tris
          ? `${p.id} has a shape whose size or place is not a number: check its fields`
          : `${p.id} makes no triangles: check its shapes (an empty outline, a radius of 0, a node the model lacks)`,
      });
  // parts that run into each other on the way apart (wherever their boxes meet on it): more of one inside the other
  // than at rest
  const near0 = parts.map(() => false), // (whether each part touches another at rest: for the check below)
    pairs = candidates(parts, eps);
  for (const [i, j] of pairs) {
    const a = parts[i],
      b = parts[j];
    if (near(a, b, 0, eps)) near0[i] = near0[j] = true;
    if (pair(a.p.id, b.p.id) || (!a.closed && !b.closed)) continue;
    {
      const share = (apart) =>
        near(a, b, apart, -eps)
          ? Math.max(b.closed ? through(a, b, apart, eps) : 0, a.closed ? through(b, a, apart, eps) : 0)
          : 0;
      const rest = share(0),
        worst = Math.max(0, ...amounts(a, b, eps).map(share));
      if (worst > rest + 0.03)
        problems.push({
          path: path(a.p),
          message: `${a.p.id} and ${b.p.id} run into each other when taken apart (${Math.round(worst * 100)} % of one inside the other, ${Math.round(rest * 100)} % at rest): move them apart along other paths`,
        });
    }
  }
  // parts that run into each other as a motion goes through its range (the others at their start): more of one inside
  // the other than with every motion at its start
  // (a part on a joint is posed by it too: moved by the motion when the joint's value comes from it)
  const J = jointsOf(scene),
    joint = parts.map((s) => jointOf(J, s.p)),
    poses = new Map(),
    jointAt = (i, v) => {
      if (!joint[i]) return M.id();
      const k = JSON.stringify(v);
      if (!poses.has(k)) poses.set(k, solveJoints(J, scene.motions, v));
      return poses.get(k).matrix.get(joint[i].id);
    };
  for (const mo of scene.motions || []) {
    const [a0, a1] = mo.range,
      keys = (mo.tracks || []).reduce((n, tr) => n + (tr.move || (tr.turn && tr.turn.keys) || []).length, 0),
      n = Math.min(64, Math.max(16, keys * 4, joint.some((j) => j && motionsOf(J, j).has(mo.id)) ? 48 : 0)),
      tracks = parts.map((s) => tracksOf(scene.motions, s.p)),
      movers = parts
        .map((s, i) => i)
        .filter((i) => tracks[i].some((x) => x.mo === mo) || (joint[i] && motionsOf(J, joint[i]).has(mo.id)));
    const at = (i, v) => M.mul(motionMatrix(tracks[i], v), jointAt(i, v)),
      rest = parts.map((s, i) => at(i, {}));
    for (const i of movers)
      for (const [j, b] of parts.entries()) {
        if (j === i || (movers.includes(j) && j < i) || pair(parts[i].p.id, b.p.id)) continue;
        const a = parts[i];
        if (!a.closed && !b.closed) continue;
        const share = (Ma, Mb) => {
          const [la, ha] = boxAt(a, Ma),
            [lb, hb] = boxAt(b, Mb);
          if ([0, 1, 2].some((k) => la[k] > hb[k] - eps || lb[k] > ha[k] - eps)) return 0;
          return Math.max(b.closed ? throughM(a, Ma, b, Mb, eps) : 0, a.closed ? throughM(b, Mb, a, Ma, eps) : 0);
        };
        const at0 = share(rest[i], rest[j]);
        let worst = 0;
        for (let k = 0; k <= n; k++) {
          const v = { [mo.id]: a0 + ((a1 - a0) * k) / n };
          worst = Math.max(worst, share(at(i, v), at(j, v)));
        }
        if (worst > at0 + 0.03)
          problems.push({
            path: path(a.p),
            message: `${a.p.id} and ${b.p.id} run into each other as ${mo.id} moves (${Math.round(worst * 100)} % of one inside the other, ${Math.round(at0 * 100)} % at its start): change the motion's keys or joints`,
          });
      }
  }
  // liquids and gases (fluids.js): what each vessel holds, and where a pour or a heated gas would take it
  if (scene.liquids || scene.gases) {
    const F = FX.fluidsOf(scene),
      at = (v) => `vessels[${(scene.vessels || []).indexOf(scene.vessels.find((x) => x.id === v.id))}]`,
      held = (v) => F.liquids.filter((l) => l.in === v.id).reduce((n, l) => n + l.volume, 0);
    for (const v of F.vessels.values()) {
      const cap = FX.capacity(v.inside),
        // (everything that can pour into it, from the liquids that become one of its own)
        poured = F.liquids
          .filter((l) => l.into && F.liquids.find((x) => x.part === l.into)?.in === v.id)
          .reduce((n, l) => n + l.volume, 0);
      if (held(v) > cap * 1.0001)
        problems.push({
          path: at(v),
          message: `${v.id} holds ${+held(v).toFixed(3)} but its inside takes ${+cap.toFixed(3)}: less liquid, or a larger inside`,
        });
      else if (poured && held(v) + poured > cap * 1.0001)
        problems.push({
          path: at(v),
          message: `${v.id} would overflow if all that pours into it came (${+(held(v) + poured).toFixed(3)}; it takes ${+cap.toFixed(3)})`,
        });
      // its inside, filled to the brim, against its own walls: a profile wider than the vessel goes through the glass
      const wall = parts.find((x) => x.p.id === v.part);
      if (wall && wall.closed) {
        // (both ways: a liquid through the glass, or the glass inside a liquid wider than the vessel; from a hair above
        // its floor, which a liquid rests on)
        const [h0, h1] = [v.inside[0][0], v.inside.at(-1)[0]],
          full = solid(
            buildScene({ parts: [{ id: v.id, shapes: [FX.shapeOf(v, h0 + (h1 - h0) * 0.01, h1)] }] }, 0.5).parts[0],
          ),
          out = Math.max(through(full, wall, 0, eps), through(wall, full, 0, eps));
        if (out > 0.03)
          problems.push({
            path: at(v),
            message: `the inside given for ${v.id} goes through the walls of ${v.part} (${Math.round(out * 100)} % of one in the other): give its radius at each height inside the glass`,
          });
      }
    }
    for (const [i, x] of F.gases.entries()) {
      const v = F.vessels.get(x.in),
        h = FX.pistonHeight(v.inside, x.n, x.T, x.p, x.mass, F.m);
      if (h >= v.inside[v.inside.length - 1][0] - 1e-9)
        problems.push({
          path: `gases[${i}]`,
          message: `the gas in ${v.id} would push its piston out of it: fewer moles, a lower temperature, or a taller vessel`,
        });
    }
  }
  // parts that rest on nothing: touching no other part and above the ground
  if (check.float !== true)
    for (const [i, a] of parts.entries()) {
      if (named(a.p, check.float) || a.p.lo[1] <= S.lo[1] + eps) continue;
      if (!near0[i])
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
          inBox(b, sub(q, at(b, 1))) &&
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
      size: parts.length ? S.radius * 2 : 0,
    },
  };
}

// from the command line: a scene (JSON) on stdin; its summary, then one problem per line
// (run as `node src/lint.js`, not merely imported by a script of the same name)
const direct =
  typeof process !== 'undefined' &&
  !!process.argv?.[1] &&
  import.meta.url ===
    new URL('file://' + (/^\//.test(process.argv[1]) ? '' : '/') + process.argv[1].replace(/\\/g, '/')).href;
if (direct) {
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
