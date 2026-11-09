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
function solidOf(part) {
  const mesh = flatten(part),
    closed = part.batches.every((batch) => {
      if (!closedOf.has(batch.mesh)) closedOf.set(batch.mesh, isClosed(batch.mesh));
      return closedOf.get(batch.mesh);
    });
  return { part, mesh, bvh: buildBVH(mesh), closed };
}
const offsetAt = (solid, apart) => mulv(solid.part.explode, apart);

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
    pairs = candidates(solids, tolerance);
  for (const [i, j] of pairs) {
    const a = solids[i],
      b = solids[j];
    if (near(a, b, 0, tolerance)) touchesAtRest[i] = touchesAtRest[j] = true;
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
  const shapes = (scene.parts || []).reduce((count, part) => count + (part.shapes || []).length, 0);
  return {
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
    process.exitCode = result.problems.length ? 1 : 0;
  });
}
