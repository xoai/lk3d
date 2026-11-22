// Checks a scene's geometry without drawing it (in Node, or a browser): what a reader would see as a mistake but no
// schema can say. Parts that run into each other while the model is taken apart (more than they overlap at rest: parts
// may sit inside others, an organelle in a cell, a filament in a bulb); parts that rest on nothing; labels that point
// at a place inside another part once taken apart, when labels show. Not part of the runtime bundle: import 'lk3d/lint'.
//   import { lint } from 'lk3d/lint';  lint(scene) → { problems: [{ path, message, level? }], summary: { parts, … },
//                                                      contacts: { id: [ids whose surfaces it meets at rest] } }
//   node src/lint.js < scene.json        prints the summary and the findings; exit code 1 if there are problems
// A finding with level: 'warning' is said and passes (lk3d check exits 0 on warnings alone); every other is a problem.
// What a scene says must be true (expect: inside, touches, clear, above, size, seen) is checked here too, each failing
// item reported at its place, expect[i].
// A scene excuses what it means on purpose, by name and nothing wider: check: { allow: [[a, b], …] } for two parts that
// may run into each other or hide each other's label (two pictures of one molecule, shown in turn), check: { float:
// [ids or groups] } for parts that hang in the air (planets, a cell's own nucleus drawn beside it), or float: true for a
// scene whose parts all float.
import './models.js'; // (the glTF reader: a scene's models are checked like its other parts)
import { buildScene, flatten, isClosed } from './geometry.js';
import { buildBVH, intersect, nearest } from './bvh.js';
import { M, add, mulv, sub, cross, dot, len, norm } from './math.js';
import { tracksOf, motionMatrix } from './motion.js';
import { jointsOf, jointOf, motionsOf, solve as solveJoints } from './joints.js';
import * as FX from './fluids.js';
import { stepState } from './stepstate.js';
import { placements } from './place.js';

const RAYS = [norm([0.31, 0.83, 0.47]), norm([-0.72, 0.15, 0.68]), norm([0.18, -0.64, -0.75])];

// a part as one geometry in scene coordinates (moved apart by `apart`, 0 at rest), its bounds, a tree for rays, and
// whether it is closed (a solid that has an inside: no surface ends anywhere)
const closedOf = new WeakMap(); // (per geometry: parts alike share theirs)
function solidOf(part) {
  const mesh = flatten(part),
    closed = part.batches.every((batch) => {
      if (!closedOf.has(batch.mesh)) closedOf.set(batch.mesh, isClosed(batch.mesh));
      return closedOf.get(batch.mesh);
    });
  return { part, mesh, bvh: buildBVH(mesh), closed };
}
const offsetAt = (solid, apart) => mulv(solid.part.explode, apart);
const REST = M.id(); // (a part as built: where it is at rest)

// how deep a point is inside a closed part (0: outside): the nearest hit of each of three rays must be the back of a
// face, so the point is enclosed; its depth is the nearest of those hits
function depthIn(solid, point) {
  let inside = 0,
    depth = Infinity;
  for (const ray of RAYS) {
    const hit = intersect(solid.mesh, solid.bvh, point, ray);
    if (!hit) continue;
    const indices = solid.mesh.indices,
      positions = solid.mesh.positions,
      corner = (k) => [
        positions[3 * indices[3 * hit.triangle + k]],
        positions[3 * indices[3 * hit.triangle + k] + 1],
        positions[3 * indices[3 * hit.triangle + k] + 2],
      ],
      normal = cross(sub(corner(1), corner(0)), sub(corner(2), corner(0)));
    if (dot(normal, ray) > 0) {
      inside++;
      depth = Math.min(depth, hit.t);
    }
  }
  return inside >= 2 ? depth : 0;
}
// points on a part's surface, to test against another: 600, spread evenly by area (a thin plate cutting across a post
// has no vertex inside it, but some of the post's surface is), the same every run
function samples(solid) {
  if (solid.surfacePoints) return solid.surfacePoints;
  const positions = solid.mesh.positions,
    indices = solid.mesh.indices,
    triangleCount = indices.length / 3,
    cumulativeArea = new Float64Array(triangleCount),
    corner = (triangle, j) => [
      positions[3 * indices[3 * triangle + j]],
      positions[3 * indices[3 * triangle + j] + 1],
      positions[3 * indices[3 * triangle + j] + 2],
    ];
  let total = 0;
  for (let k = 0; k < triangleCount; k++)
    cumulativeArea[k] = total += len(cross(sub(corner(k, 1), corner(k, 0)), sub(corner(k, 2), corner(k, 0))));
  const points = [];
  for (let sample = 0, triangle = 0; sample < 600 && total > 0; sample++) {
    const target = ((sample + 0.5) / 600) * total;
    while (triangle < triangleCount - 1 && cumulativeArea[triangle] < target) triangle++;
    let x = (sample * 0.618034) % 1,
      y = (sample * 0.754878) % 1;
    if (x + y > 1) [x, y] = [1 - x, 1 - y];
    const first = corner(triangle, 0);
    points.push(add(first, add(mulv(sub(corner(triangle, 1), first), x), mulv(sub(corner(triangle, 2), first), y))));
  }
  return (solid.surfacePoints = points);
}
// the share of a's points more than `tolerance` inside b, with both moved apart by `apart` (a point outside b's box is
// not inside b: no rays are cast for it)
function through(a, b, apart, tolerance) {
  const points = samples(a),
    shift = sub(offsetAt(a, apart), offsetAt(b, apart));
  let hits = 0;
  for (const point of points) {
    const moved = add(point, shift);
    if (inBox(b, moved) && depthIn(b, moved) > tolerance) hits++;
  }
  return points.length ? hits / points.length : 0;
}
// the share of a's points more than `tolerance` inside b, each part placed by its matrix (a motion's): a's points into
// the scene by matrixA, then into b's own frame at rest by the inverse of matrixB
function throughMatrices(a, matrixA, b, matrixB, tolerance) {
  const points = samples(a),
    aToB = M.mul(M.invert(matrixB), matrixA);
  let hits = 0;
  for (const point of points) {
    const moved = M.pt(aToB, point);
    if (inBox(b, moved) && depthIn(b, moved) > tolerance) hits++;
  }
  return points.length ? hits / points.length : 0;
}
// a part's box placed by a matrix (its eight corners, moved)
function boxAt(solid, m) {
  const low = [Infinity, Infinity, Infinity],
    high = [-Infinity, -Infinity, -Infinity];
  for (let corner = 0; corner < 8; corner++) {
    const moved = M.pt(
      m,
      [0, 1, 2].map((axis) => ((corner >> axis) & 1 ? solid.part.max[axis] : solid.part.min[axis])),
    );
    for (let axis = 0; axis < 3; axis++) {
      low[axis] = Math.min(low[axis], moved[axis]);
      high[axis] = Math.max(high[axis], moved[axis]);
    }
  }
  return [low, high];
}
// is the point within the part's bounds at rest? (a cheap test before casting rays)
const inBox = (solid, point) =>
  [0, 1, 2].every((axis) => point[axis] >= solid.part.min[axis] && point[axis] <= solid.part.max[axis]);
// the points of a part tested against another's surface: its surface samples and its corners (a ball on a floor meets it
// at one vertex), at most 4,000 corners, spread evenly
function contactPoints(solid) {
  if (solid.contactPoints) return solid.contactPoints;
  const positions = solid.mesh.positions,
    count = positions.length / 3,
    stride = Math.max(1, Math.ceil(count / 4000)),
    points = samples(solid).slice();
  for (let k = 0; k < count; k += stride) points.push([positions[3 * k], positions[3 * k + 1], positions[3 * k + 2]]);
  return (solid.contactPoints = points);
}
// do a and b touch, each placed by its matrix? Their surfaces come within `tolerance` (a point of one's within that of
// the other's), or one reaches inside the other (a closed part). Boxes that meet are not enough: a post standing inside
// a cage of bars is within the cage's box and touches none of its bars.
function touching(a, matrixA, b, matrixB, tolerance) {
  const [lowA, highA] = boxAt(a, matrixA),
    [lowB, highB] = boxAt(b, matrixB);
  if ([0, 1, 2].some((k) => lowA[k] > highB[k] + tolerance || lowB[k] > highA[k] + tolerance)) return false;
  const meets = (p, matrixP, q, matrixQ) => {
    const pToQ = M.mul(M.invert(matrixQ), matrixP);
    return contactPoints(p).some((point) => {
      const moved = M.pt(pToQ, point);
      return (
        nearest(q.mesh, q.bvh, moved, tolerance) <= tolerance || (q.closed && inBox(q, moved) && depthIn(q, moved) > 0)
      );
    });
  };
  return meets(a, matrixA, b, matrixB) || meets(b, matrixB, a, matrixA);
}
// do the bounds of a and b (moved apart by `apart`) overlap, give or take `tolerance`?
function near(a, b, apart, tolerance) {
  const offsetA = offsetAt(a, apart),
    offsetB = offsetAt(b, apart);
  for (let k = 0; k < 3; k++)
    if (
      a.part.min[k] + offsetA[k] > b.part.max[k] + offsetB[k] + tolerance ||
      b.part.min[k] + offsetB[k] > a.part.max[k] + offsetA[k] + tolerance
    )
      return false;
  return true;
}

// the stretch of the way apart (from 0 to 1) in which a's and b's boxes overlap, give or take `tolerance`; null if
// never. Each box moves along its own explode, so on each axis the overlap holds between two amounts
function when(a, b, tolerance) {
  let t0 = 0,
    t1 = 1;
  for (let k = 0; k < 3; k++) {
    // a.min + t·ea ≤ b.max + t·eb + tolerance and b.min + t·eb ≤ a.max + t·ea + tolerance, as rate·t ≤ limit twice
    const relative = a.part.explode[k] - b.part.explode[k];
    for (const [limit, rate] of [
      [b.part.max[k] + tolerance - a.part.min[k], relative],
      [a.part.max[k] + tolerance - b.part.min[k], -relative],
    ]) {
      if (Math.abs(rate) < 1e-12) {
        if (limit < 0) return null;
      } else if (rate > 0) t1 = Math.min(t1, limit / rate);
      else t0 = Math.max(t0, limit / rate);
    }
  }
  return t0 <= t1 ? [t0, t1] : null;
}
// the amounts apart at which to test a pair: within the stretch they overlap, in steps that move one part against the
// other by less than half the thinner one (a pin sent through a thin plate is caught), at most 32
function amounts(a, b, tolerance) {
  const stretch = when(a, b, -tolerance);
  if (!stretch) return [];
  const relative = len(sub(a.part.explode, b.part.explode)),
    thin = Math.max(
      tolerance,
      Math.min(
        ...[0, 1, 2].map((k) => a.part.max[k] - a.part.min[k]),
        ...[0, 1, 2].map((k) => b.part.max[k] - b.part.min[k]),
      ),
    ),
    steps = Math.min(32, Math.max(4, Math.ceil(((stretch[1] - stretch[0]) * relative) / (thin / 2)))),
    list = [];
  for (let k = 0; k <= steps; k++)
    if (stretch[0] + ((stretch[1] - stretch[0]) * k) / steps > 0)
      list.push(stretch[0] + ((stretch[1] - stretch[0]) * k) / steps);
  return list;
}

// the pairs of parts worth testing: those whose boxes, swept along their way apart and grown by `tolerance`, share a
// cell of a grid (a part that spans a great many cells, a casing, is paired with every part): a model of thousands of
// parts is not tested pair by pair
function candidates(solids, tolerance) {
  const count = solids.length,
    boxes = solids.map(({ part }) => {
      const low = part.min.slice(),
        high = part.max.slice();
      for (let axis = 0; axis < 3; axis++) {
        low[axis] += Math.min(0, part.explode[axis]) - tolerance;
        high[axis] += Math.max(0, part.explode[axis]) + tolerance;
      }
      return [low, high];
    }),
    sizes = boxes
      .map(([low, high]) => Math.max(high[0] - low[0], high[1] - low[1], high[2] - low[2]))
      .sort((a, b) => a - b),
    cellSize = Math.max(1e-6, (sizes[count >> 1] || 1) * 2),
    grid = new Map(),
    big = [],
    pairKeys = new Set();
  boxes.forEach(([low, high], i) => {
    const firstCell = low.map((value) => Math.floor(value / cellSize)),
      lastCell = high.map((value) => Math.floor(value / cellSize));
    if ((lastCell[0] - firstCell[0] + 1) * (lastCell[1] - firstCell[1] + 1) * (lastCell[2] - firstCell[2] + 1) > 512)
      return big.push(i);
    for (let x = firstCell[0]; x <= lastCell[0]; x++)
      for (let y = firstCell[1]; y <= lastCell[1]; y++)
        for (let z = firstCell[2]; z <= lastCell[2]; z++) {
          const key = x + ',' + y + ',' + z,
            list = grid.get(key) || [];
          for (const j of list) pairKeys.add(j * count + i);
          list.push(i);
          grid.set(key, list);
        }
  });
  for (const i of big)
    for (let j = 0; j < count; j++) if (j !== i) pairKeys.add(Math.min(i, j) * count + Math.max(i, j));
  return [...pairKeys].map((key) => [Math.floor(key / count), key % count]);
}

export function lint(scene, options = {}) {
  const built = buildScene(scene, options.quality ?? 0.5),
    tolerance = built.radius * 0.005, // half a percent of the model: closer than this is touching
    check = scene.check || {},
    allowed = (a, b) =>
      (check.allow || []).some(([first, second]) => (first === a && second === b) || (first === b && second === a)),
    named = (part, list) => list === true || (list || []).some((name) => name === part.id || name === part.group),
    indexById = new Map((scene.parts || []).map((part, k) => [part.id, k])),
    path = (part) => `parts[${indexById.get(part.id) ?? part.index}]`,
    problems = [],
    solids = built.parts.filter((part) => part.triangleCount > 0).map(solidOf);
  // parts that make nothing to draw, or a shape whose numbers are not numbers (NaN): the rest of the check is blind there
  for (const part of built.parts)
    if (
      (!part.triangleCount && !part.fluid) ||
      part.batches.some((batch) => !batch.mesh.positions.every(Number.isFinite))
    )
      // (an empty vessel's liquid: none)
      problems.push({
        path: path(part),
        message: part.triangleCount
          ? `${part.id} has a shape whose size or place is not a number: check its fields`
          : `${part.id} makes no triangles: check its shapes (an empty outline, a radius of 0, a node the model lacks)`,
      });
  // parts that run into each other on the way apart (wherever their boxes meet on it): more of one inside the other
  // than at rest
  const touchesAtRest = solids.map(() => false), // (whether each part touches another at rest: for the check below)
    contacts = Object.fromEntries(solids.map((solid) => [solid.part.id, []])),
    pairs = candidates(solids, tolerance);
  for (const [i, j] of pairs) {
    const a = solids[i],
      b = solids[j];
    if (near(a, b, 0, tolerance) && touching(a, REST, b, REST, tolerance)) {
      touchesAtRest[i] = touchesAtRest[j] = true;
      contacts[a.part.id].push(b.part.id);
      contacts[b.part.id].push(a.part.id);
    }
    if (allowed(a.part.id, b.part.id) || (!a.closed && !b.closed)) continue;
    {
      const share = (apart) =>
        near(a, b, apart, -tolerance)
          ? Math.max(b.closed ? through(a, b, apart, tolerance) : 0, a.closed ? through(b, a, apart, tolerance) : 0)
          : 0;
      const rest = share(0),
        worst = Math.max(0, ...amounts(a, b, tolerance).map(share));
      if (worst > rest + 0.03)
        problems.push({
          path: path(a.part),
          message: `${a.part.id} and ${b.part.id} run into each other when taken apart (${Math.round(worst * 100)} % of one inside the other, ${Math.round(rest * 100)} % at rest): move them apart along other paths`,
        });
    }
  }
  // parts that run into each other as a motion goes through its range (the others at their start): more of one inside
  // the other than with every motion at its start
  // (a part on a joint is posed by it too: moved by the motion when the joint's value comes from it)
  const sceneJoints = jointsOf(scene),
    jointFor = solids.map((solid) => jointOf(sceneJoints, solid.part)),
    poses = new Map(),
    jointAt = (i, values) => {
      if (!jointFor[i]) return M.id();
      const key = JSON.stringify(values);
      if (!poses.has(key)) poses.set(key, solveJoints(sceneJoints, scene.motions, values));
      return poses.get(key).matrix.get(jointFor[i].id);
    };
  for (const motion of scene.motions || []) {
    const [start, end] = motion.range,
      keyCount = (motion.tracks || []).reduce(
        (count, track) => count + (track.move || (track.turn && track.turn.keys) || []).length,
        0,
      ),
      steps = Math.min(
        64,
        Math.max(
          16,
          keyCount * 4,
          jointFor.some((joint) => joint && motionsOf(sceneJoints, joint).has(motion.id)) ? 48 : 0,
        ),
      ),
      tracks = solids.map((solid) => tracksOf(scene.motions, solid.part)),
      movers = solids
        .map((solid, i) => i)
        .filter(
          (i) =>
            tracks[i].some((entry) => entry.motion === motion) ||
            (jointFor[i] && motionsOf(sceneJoints, jointFor[i]).has(motion.id)),
        );
    const matrixAt = (i, values) => M.mul(motionMatrix(tracks[i], values), jointAt(i, values)),
      restMatrices = solids.map((solid, i) => matrixAt(i, {}));
    for (const i of movers)
      for (const [j, b] of solids.entries()) {
        if (j === i || (movers.includes(j) && j < i) || allowed(solids[i].part.id, b.part.id)) continue;
        const a = solids[i];
        if (!a.closed && !b.closed) continue;
        const share = (matrixA, matrixB) => {
          const [lowA, highA] = boxAt(a, matrixA),
            [lowB, highB] = boxAt(b, matrixB);
          if ([0, 1, 2].some((k) => lowA[k] > highB[k] - tolerance || lowB[k] > highA[k] - tolerance)) return 0;
          return Math.max(
            b.closed ? throughMatrices(a, matrixA, b, matrixB, tolerance) : 0,
            a.closed ? throughMatrices(b, matrixB, a, matrixA, tolerance) : 0,
          );
        };
        const atStart = share(restMatrices[i], restMatrices[j]);
        let worst = 0;
        for (let k = 0; k <= steps; k++) {
          const values = { [motion.id]: start + ((end - start) * k) / steps };
          worst = Math.max(worst, share(matrixAt(i, values), matrixAt(j, values)));
        }
        if (worst > atStart + 0.03)
          problems.push({
            path: path(a.part),
            message: `${a.part.id} and ${b.part.id} run into each other as ${motion.id} moves (${Math.round(worst * 100)} % of one inside the other, ${Math.round(atStart * 100)} % at its start): change the motion's keys or joints`,
          });
      }
  }
  // liquids and gases (fluids.js): what each vessel holds, and where a pour or a heated gas would take it
  if (scene.liquids || scene.gases) {
    const fluids = FX.fluidsOf(scene),
      vesselPath = (vessel) =>
        `vessels[${(scene.vessels || []).indexOf(scene.vessels.find((other) => other.id === vessel.id))}]`,
      held = (vessel) =>
        fluids.liquids.filter((liquid) => liquid.in === vessel.id).reduce((sum, liquid) => sum + liquid.volume, 0);
    for (const vessel of fluids.vessels.values()) {
      const capacity = FX.capacity(vessel.inside),
        // (everything that can pour into it, from the liquids that become one of its own)
        poured = fluids.liquids
          .filter(
            (liquid) => liquid.into && fluids.liquids.find((other) => other.part === liquid.into)?.in === vessel.id,
          )
          .reduce((sum, liquid) => sum + liquid.volume, 0);
      if (held(vessel) > capacity * 1.0001)
        problems.push({
          path: vesselPath(vessel),
          message: `${vessel.id} holds ${+held(vessel).toFixed(3)} but its inside takes ${+capacity.toFixed(3)}: less liquid, or a larger inside`,
        });
      else if (poured && held(vessel) + poured > capacity * 1.0001)
        problems.push({
          path: vesselPath(vessel),
          message: `${vessel.id} would overflow if all that pours into it came (${+(held(vessel) + poured).toFixed(3)}; it takes ${+capacity.toFixed(3)})`,
        });
      // its inside, filled to the brim, against its own walls: a profile wider than the vessel goes through the glass
      const wall = solids.find((solid) => solid.part.id === vessel.part);
      if (wall && wall.closed) {
        // (both ways: a liquid through the glass, or the glass inside a liquid wider than the vessel; from a hair above
        // its floor, which a liquid rests on)
        const [h0, h1] = [vessel.inside[0][0], vessel.inside.at(-1)[0]],
          full = solidOf(
            buildScene({ parts: [{ id: vessel.id, shapes: [FX.shapeOf(vessel, h0 + (h1 - h0) * 0.01, h1)] }] }, 0.5)
              .parts[0],
          ),
          crossing = Math.max(through(full, wall, 0, tolerance), through(wall, full, 0, tolerance));
        if (crossing > 0.03)
          problems.push({
            path: vesselPath(vessel),
            message: `the inside given for ${vessel.id} goes through the walls of ${vessel.part} (${Math.round(crossing * 100)} % of one in the other): give its radius at each height inside the glass`,
          });
      }
    }
    for (const [i, gas] of fluids.gases.entries()) {
      const vessel = fluids.vessels.get(gas.in),
        height = FX.pistonHeight(vessel.inside, gas.n, gas.T, gas.p, gas.mass, fluids.unitsPerMetre);
      if (height >= vessel.inside[vessel.inside.length - 1][0] - 1e-9)
        problems.push({
          path: `gases[${i}]`,
          message: `the gas in ${vessel.id} would push its piston out of it: fewer moles, a lower temperature, or a taller vessel`,
        });
    }
  }
  // parts that rest on nothing: touching no other part and above the ground
  if (check.float !== true)
    for (const [i, solid] of solids.entries()) {
      if (named(solid.part, check.float) || solid.part.min[1] <= built.min[1] + tolerance) continue;
      if (!touchesAtRest[i])
        problems.push({
          path: path(solid.part),
          message: `${solid.part.id} touches no other part and hangs in the air: rest it on another part, or list it under check.float`,
        });
    }
  // labels that point inside another (opaque) part once taken apart, when labels show by themselves
  for (const a of solids) {
    if (!a.part.name || a.part.label === false) continue;
    const labelPoint = add(a.part.anchor, offsetAt(a, 1)),
      hiding = solids.find(
        (b) =>
          b !== a &&
          b.closed &&
          !b.part.xray &&
          b.part.alpha >= 0.99 &&
          !allowed(a.part.id, b.part.id) &&
          inBox(b, sub(labelPoint, offsetAt(b, 1))) &&
          depthIn(b, sub(labelPoint, offsetAt(b, 1))) > tolerance,
      );
    if (hiding)
      problems.push({
        path: path(a.part),
        message: `the label of ${a.part.id} points inside ${hiding.part.id} when taken apart, where no one sees it: give the part a label point ("label": [x, y, z]) on its visible surface`,
      });
  }
  // turned copies that may be meant as mirror images (a warning: said, and the check passes)
  problems.push(...turnedCopies(scene, solids, tolerance, path));
  problems.push(...placed(scene, built));
  // what the scene says must be true (expect)
  if (Array.isArray(scene.expect)) problems.push(...expectations(scene, built, solids, tolerance, jointAt));
  const shapes = (scene.parts || []).reduce((count, part) => count + (part.shapes || []).length, 0);
  for (const list of Object.values(contacts)) list.sort();
  return {
    contacts,
    problems,
    summary: {
      parts: built.parts.length,
      shapes,
      placed: built.parts.reduce(
        (count, part) => count + part.batches.reduce((partCount, batch) => partCount + batch.placements.length, 0),
        0,
      ),
      triangles: Math.round(built.parts.reduce((count, part) => count + part.triangleCount, 0)),
      accents: built.parts.filter((part) => part.accent).length,
      named: built.parts.filter((part) => part.name).length,
      size: solids.length ? built.radius * 2 : 0,
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
  process.stdin.on('data', (chunk) => (text += chunk));
  process.stdin.on('end', () => {
    const result = lint(JSON.parse(text));
    console.log(JSON.stringify(result.summary));
    for (const problem of result.problems) console.log(JSON.stringify(problem));
    process.exitCode = result.problems.some((problem) => problem.level !== 'warning') ? 1 : 0;
  });
}

// ---- expect: what the scene says must be true, as its author means it. The model as drawn at rest (each motion at its
// start, joints solved); a name is a part's id or a group's (a group as the first: each of its parts; as the second: the
// box round all of them). Each item that fails is reported at expect[i], saying what was found and how to fix it.
function expectations(scene, built, solids, tolerance, jointAt) {
  const problems = [],
    fail = (k, message) => problems.push({ path: `expect[${k}]`, message }),
    byName = (name) => {
      const own = solids.findIndex((solid) => solid.part.id === name);
      return own >= 0 ? [own] : solids.map((solid, i) => i).filter((i) => solids[i].part.group === name);
    },
    tracks = solids.map((solid) => tracksOf(scene.motions, solid.part)),
    pose = (i, values) => M.mul(motionMatrix(tracks[i], values), jointAt(i, values)),
    // the box round some parts, each posed by the motions' values and moved apart by `apart`
    /** @type {(indices: number[], values?: object, apart?: number) => [number[], number[]]} */
    boxOf = (indices, values = {}, apart = 0) => {
      const low = [Infinity, Infinity, Infinity],
        high = [-Infinity, -Infinity, -Infinity];
      for (const i of indices) {
        const [l, h] = boxAt(solids[i], pose(i, values)),
          shift = mulv(solids[i].part.explode, apart);
        for (let k = 0; k < 3; k++) {
          low[k] = Math.min(low[k], l[k] + shift[k]);
          high[k] = Math.max(high[k], h[k] + shift[k]);
        }
      }
      return [low, high];
    },
    AXES = 'xyz',
    round = (v) => +v.toPrecision(3),
    // how far a's box reaches outside b's (0: within), and along which axis
    outside = ([la, ha], [lb, hb]) => {
      let worst = 0,
        axis = 0;
      for (let k = 0; k < 3; k++) {
        const over = Math.max(lb[k] - la[k], ha[k] - hb[k]);
        if (over > worst) [worst, axis] = [over, k];
      }
      return [worst, AXES[axis]];
    },
    // the motions that move any of these parts, each sampled along its range as the motion check samples it
    motionSamples = (indices) =>
      (scene.motions || [])
        .filter((motion) =>
          indices.some(
            (i) =>
              tracks[i].some((entry) => entry.motion === motion) ||
              !isIdentity(jointAt(i, { [motion.id]: motion.range[1] })),
          ),
        )
        .flatMap((motion) =>
          Array.from({ length: 33 }, (_, k) => ({
            motion,
            values: { [motion.id]: motion.range[0] + ((motion.range[1] - motion.range[0]) * k) / 32 },
          })),
        );
  scene.expect.forEach((item, k) => {
    if (!item || typeof item !== 'object') return;
    const name = item.inside ?? item.touches ?? item.clear ?? item.above ?? item.size ?? item.seen,
      other = item.of ?? item.with,
      A = byName(name),
      B = other == null ? [] : byName(other);
    if (!A.length || (other != null && !B.length)) return; // (validate names the unknown one)
    if (item.inside != null) {
      for (const a of A) {
        for (const { motion, values } of [{ motion: null, values: {} }, ...motionSamples([a, ...B])]) {
          const [over, axis] = outside(boxOf([a], values), boxOf(B, values));
          if (over > tolerance) {
            fail(
              k,
              `${solids[a].part.id} is not inside ${other} (it reaches ${round(over)} beyond it along ${axis}` +
                (motion ? ` as ${motion.id} moves, at ${round(values[motion.id])})` : ' at rest)') +
                ': move it, or change the expectation',
            );
            return;
          }
        }
      }
    } else if (item.touches != null) {
      // (by their surfaces, as "hangs in the air" and contacts measure: each of A's parts meets one of B's)
      const [lb, hb] = boxOf(B);
      for (const a of A) {
        if (B.some((b) => b !== a && touching(solids[a], pose(a, {}), solids[b], pose(b, {}), tolerance))) continue;
        const [la, ha] = boxOf([a]);
        let gap = 0,
          axis = 0;
        for (let j = 0; j < 3; j++) {
          const g = Math.max(lb[j] - ha[j], la[j] - hb[j]);
          if (g > gap) [gap, axis] = [g, j];
        }
        return void fail(
          k,
          `${solids[a].part.id} does not touch ${other} (` +
            (gap > tolerance
              ? `a gap of ${round(gap)} along ${AXES[axis]}`
              : `within its bounds, but their surfaces do not meet`) +
            `): rest it on ${other}, or change the expectation`,
        );
      }
    } else if (item.clear != null) {
      for (const a of A)
        for (const b of B) {
          const sa = solids[a],
            sb = solids[b];
          if (!sa.closed && !sb.closed)
            return void fail(
              k,
              `clear needs a closed part: ${sa.part.id} and ${sb.part.id} are both open surfaces (use inside or above)`,
            );
          const share = (apart) =>
              near(sa, sb, apart, -tolerance)
                ? Math.max(
                    sb.closed ? through(sa, sb, apart, tolerance) : 0,
                    sa.closed ? through(sb, sa, apart, tolerance) : 0,
                  )
                : 0,
            sharePosed = (values) =>
              Math.max(
                sb.closed ? throughMatrices(sa, pose(a, values), sb, pose(b, values), tolerance) : 0,
                sa.closed ? throughMatrices(sb, pose(b, values), sa, pose(a, values), tolerance) : 0,
              );
          const found = [
            [share(0), 'at rest'],
            ...amounts(sa, sb, tolerance).map((apart) => [
              share(apart),
              `as the model is taken apart (${round(apart)} of the way)`,
            ]),
            ...motionSamples([a, b]).map(({ motion, values }) => [
              sharePosed(values),
              `as ${motion.id} moves, at ${round(values[motion.id])}`,
            ]),
          ].find(([amount]) => amount > 0.03);
          if (found)
            return void fail(
              k,
              `${sa.part.id} is not clear of ${sb.part.id}: it runs into it ${found[1]} (${Math.round(found[0] * 100)} % of one inside the other): move it, or change the expectation`,
            );
        }
    } else if (item.above != null) {
      const top = boxOf(B)[1][1],
        [least, most] = item.by || [0, Infinity];
      for (const a of A) {
        const gap = boxOf([a])[0][1] - top;
        if (gap < least - tolerance || gap > most + tolerance)
          return void fail(
            k,
            (gap < -tolerance
              ? `${solids[a].part.id} is not above ${other} (it reaches ${round(-gap)} below its top)`
              : `${solids[a].part.id} is above ${other} by ${round(Math.abs(gap) < tolerance ? 0 : gap)}, not by ${least} to ${most}`) +
              ': move it, or change the expectation',
          );
      }
    } else if (item.size != null) {
      // (a group: each of its parts)
      const axis = AXES.indexOf(item.axis),
        [least, most] = item.is,
        slack = 1e-6 * built.radius,
        wrong = A.map((a) => {
          const [low, high] = boxOf([a]);
          return [a, high[axis] - low[axis]];
        }).find(([, extent]) => extent < least - slack || extent > most + slack);
      if (wrong)
        fail(
          k,
          `${solids[wrong[0]].part.id} is ${round(wrong[1])} along ${item.axis}, not ${least} to ${most}: change its size, or the expectation`,
        );
    } else if (item.seen != null) {
      const steps = (scene.steps || []).filter((step) => step && typeof step === 'object'),
        step = typeof item.step === 'number' ? steps[item.step - 1] : steps.find((each) => each.id === item.step);
      if (!step) return; // (validate names the step that is not there)
      const state = stepState(scene, step),
        values = Object.fromEntries((scene.motions || []).map((motion) => [motion.id, state.motion(motion)])),
        cutAway = (i) => {
          const part = solids[i].part;
          if (state.cut === false || part.cut === false) return false;
          const box = boxOf([i], values, state.explode),
            beyond = (plane, offset) => {
              const n = norm(plane.normal || [1, 0, 0]);
              return (
                Math.min(
                  ...[0, 1, 2, 3, 4, 5, 6, 7].map((c) =>
                    dot(
                      n,
                      [0, 1, 2].map((j) => box[(c >> j) & 1][j]),
                    ),
                  ),
                ) > offset
              );
            };
          // the plane, swept in from just outside what it cuts as far as the step says (true: all the way): from the
          // parts it cuts that the step shows, as the figure sweeps it (figure/camera.js, cutPlane_)
          const n = norm(state.section.normal),
            swept = state.cut === true ? 1 : Math.max(0, Math.min(1, +state.cut || 0)),
            outer = Math.max(
              ...solids.map((s, j) => {
                if (s.part.cut === false || state.hidden(s.part)) return -Infinity;
                const [l, h] = boxOf([j], values, state.explode);
                return dot(
                  n,
                  [0, 1, 2].map((a) => (n[a] > 0 ? h[a] : l[a])),
                );
              }),
            ),
            from = Math.max(state.section.offset || 0, outer + built.radius * 0.01),
            offset = swept < 1 ? from + ((state.section.offset || 0) - from) * swept : state.section.offset || 0;
          return (
            beyond(state.section, offset) &&
            (!state.section.second || beyond(state.section.second, state.section.second.offset || 0))
          );
        };
      for (const a of A) {
        const part = solids[a].part,
          where = `in step ${typeof item.step === 'number' ? item.step : `"${item.step}"`}`;
        if (state.hidden(part))
          return void fail(k, `${part.id} is hidden ${where}: show it there, or change the expectation`);
        if (cutAway(a))
          return void fail(k, `${part.id} is cut away ${where}: cut elsewhere there, or change the expectation`);
        if (Array.isArray(step.labels) && !step.labels.includes(part.id) && !step.labels.includes(part.group))
          return void fail(
            k,
            `${part.id} is not among the labels ${where}: add it to the step's labels, or change the expectation`,
          );
      }
    }
  });
  return problems;
}
const isIdentity = (m) => m.every((v, i) => Math.abs(v - (i % 5 === 0 ? 1 : 0)) < 1e-12);

// ---- turned copies: two parts of the same shapes, one turned 180° about an axis from the other, as a left and a right
// pair is often made. A turn is not a reflection: unless the shapes are symmetric across the plane the turn also
// flips, the copy is the same hand as the original, a left wing where a right one should be. Warned of, never failed;
// check.mirror excuses a pair with its reason. (Copies made inside one part, by repeat, are not compared.)
function turnedCopies(scene, solids, tolerance, path) {
  const warnings = [],
    excused = (a, b) =>
      ((scene.check && scene.check.mirror) || []).some(
        (entry) => entry && Array.isArray(entry.pair) && entry.pair.includes(a) && entry.pair.includes(b) && a !== b,
      ),
    raw = new Map((scene.parts || []).filter((part) => part && part.id != null).map((part) => [part.id, part])),
    keyOf = (part) => JSON.stringify([part.shapes, part.edges ?? null]),
    AXES = 'xyz';
  for (let i = 0; i < solids.length; i++)
    for (let j = i + 1; j < solids.length; j++) {
      const A = raw.get(solids[i].part.id),
        B = raw.get(solids[j].part.id);
      if (!A || !B || !A.shapes || keyOf(A) !== keyOf(B) || excused(A.id, B.id)) continue;
      // B's turn relative to A's: a half turn about one of the axes, the other two flipped
      // (scale included: a copy already mirrored by a negative scale is a reflection, not a turn, and is left alone)
      const R = M.mul(M.trs(null, B.rot, B.scale), M.invert(M.trs(null, A.rot, A.scale))),
        diagonal = [R[0], R[5], R[10]],
        offDiagonal = [R[1], R[2], R[4], R[6], R[8], R[9]];
      if (offDiagonal.some((v) => Math.abs(v) > 1e-6)) continue;
      const kept = diagonal.findIndex((v) => Math.abs(v - 1) < 1e-6);
      if (kept < 0 || diagonal.some((v, k) => k !== kept && Math.abs(v + 1) > 1e-6)) continue;
      // the pair lies apart along one of the flipped axes (the mirror's); a turned copy is the mirror image only if the
      // part is symmetric across the plane of the other flipped axis, through its own middle
      const centre = (solid) => [0, 1, 2].map((k) => (solid.part.min[k] + solid.part.max[k]) / 2),
        a = solids[i],
        ca = centre(a),
        apart = sub(centre(solids[j]), ca),
        flipped = [0, 1, 2].filter((k) => k !== kept),
        across = Math.abs(apart[flipped[0]]) >= Math.abs(apart[flipped[1]]) ? flipped[0] : flipped[1],
        other = flipped[0] === across ? flipped[1] : flipped[0];
      const symmetric = samples(a).every((point) => {
        const reflected = point.slice();
        reflected[other] = 2 * ca[other] - point[other];
        return nearest(a.mesh, a.bvh, reflected, tolerance * 2) <= tolerance * 2;
      });
      if (!symmetric) {
        const scale = [1, 1, 1];
        scale[across] = -1;
        warnings.push({
          path: path(solids[j].part),
          level: 'warning',
          message: `${A.id} and ${B.id} are the same shapes turned 180° about ${AXES[kept]}, so one is a left-hand copy of the other: make one the mirror of the other ("mirrorOf": "${A.id}", "plane": "${AXES[across]}", in place of its shapes and at) if they are a left and a right, or say why not under check.mirror`,
        });
      }
    }
  return warnings;
}

// place (place.js): each placed part's at must be where its place puts it (lk3d place writes it), and a part that has
// place has an at; its handle, which place does not move, should still be on it
function placed(scene, built) {
  if (!(scene.parts || []).some((part) => part && part.place)) return [];
  let found;
  try {
    found = placements(scene);
  } catch (e) {
    return [{ path: 'parts', message: `place cannot be worked out: ${e.message}` }];
  }
  const out = found.problems.slice(),
    say = (v) => `[${v.map((x) => +x.toFixed(4)).join(', ')}]`;
  for (const [i, at] of found.at) {
    const part = scene.parts[i];
    if (!Array.isArray(part.at))
      out.push({ path: `parts[${i}]`, message: `${part.id} has place but no at: run lk3d place, which writes it` });
    else if (part.at.some((v, k) => Math.abs(v - at[k]) > 1e-4))
      out.push({
        path: `parts[${i}].at`,
        message: `${part.id}'s at ${say(part.at)} is not where place puts it (${say(at)}): run lk3d place`,
      });
    const handle = part.handle,
      centre = handle && ((handle.turn && handle.turn.center) || (handle.plane && handle.plane.center)),
      box = built.parts[i];
    if (Array.isArray(centre) && box && centre.some((v, k) => v < box.min[k] - 1e-6 || v > box.max[k] + 1e-6))
      out.push({
        path: `parts[${i}].handle`,
        level: 'warning',
        message: `${part.id}'s handle ${handle.turn ? 'turns about' : 'moves in a plane through'} ${say(centre)}, outside the part: place moves the part, not its handle, so move the handle's center with it`,
      });
  }
  return out;
}
