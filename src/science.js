// Shapes for the sciences, generated from a few numbers: cells and organelles (ellipsoid, capsule, blob, shell,
// scatter), neurons and vessels (tree), molecules (molecule, dna), rock (extrude, terrain), planets (shell, ring,
// orbit) and machines with airfoils (blade). Every random choice comes from a seed, so a scene is the same each time;
// detail follows the quality q (coarser on phones and in the 2D fallback).
import { D2R, M, sub, add, mulv, dot, cross, len, norm } from './math.js';

// seeded random numbers in [0, 1) (mulberry32)
function rng(seed) {
  let state = (seed * 2654435761) >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let bits = state;
    bits = Math.imul(bits ^ (bits >>> 15), bits | 1);
    bits ^= bits + Math.imul(bits ^ (bits >>> 7), bits | 61);
    return ((bits ^ (bits >>> 14)) >>> 0) / 4294967296;
  };
}
// smooth noise in 3D, about -1..1: values on an integer lattice, blended with smoothstep
function noise3(seed) {
  const random = rng(seed),
    lattice = Float64Array.from({ length: 512 }, () => random() * 2 - 1);
  const corner = (i, j, k) => lattice[((i * 73856093) ^ (j * 19349663) ^ (k * 83492791)) & 511];
  const smooth = (t) => t * t * (3 - 2 * t);
  return (x, y, z) => {
    const i = Math.floor(x),
      j = Math.floor(y),
      k = Math.floor(z),
      blendX = smooth(x - i),
      blendY = smooth(y - j),
      blendZ = smooth(z - k);
    const lerp = (a, b, t) => a + (b - a) * t;
    return lerp(
      lerp(
        lerp(corner(i, j, k), corner(i + 1, j, k), blendX),
        lerp(corner(i, j + 1, k), corner(i + 1, j + 1, k), blendX),
        blendY,
      ),
      lerp(
        lerp(corner(i, j, k + 1), corner(i + 1, j, k + 1), blendX),
        lerp(corner(i, j + 1, k + 1), corner(i + 1, j + 1, k + 1), blendX),
        blendY,
      ),
      blendZ,
    );
  };
}
// an even mesh of the unit sphere (no crowded poles): an icosahedron, each triangle split in four `level` times
function icosphere(level) {
  const golden = (1 + Math.sqrt(5)) / 2;
  let positions = [
    [-1, golden, 0],
    [1, golden, 0],
    [-1, -golden, 0],
    [1, -golden, 0],
    [0, -1, golden],
    [0, 1, golden],
    [0, -1, -golden],
    [0, 1, -golden],
    [golden, 0, -1],
    [golden, 0, 1],
    [-golden, 0, -1],
    [-golden, 0, 1],
  ].map(norm);
  let triangles = [
    [0, 11, 5],
    [0, 5, 1],
    [0, 1, 7],
    [0, 7, 10],
    [0, 10, 11],
    [1, 5, 9],
    [5, 11, 4],
    [11, 10, 2],
    [10, 7, 6],
    [7, 1, 8],
    [3, 9, 4],
    [3, 4, 2],
    [3, 2, 6],
    [3, 6, 8],
    [3, 8, 9],
    [4, 9, 5],
    [2, 4, 11],
    [6, 2, 10],
    [8, 6, 7],
    [9, 8, 1],
  ];
  for (let step = 0; step < level; step++) {
    const midpoints = new Map(),
      midpoint = (a, b) => {
        const key = a < b ? a * 1e6 + b : b * 1e6 + a;
        if (!midpoints.has(key)) {
          midpoints.set(key, positions.length);
          positions.push(norm(mulv(add(positions[a], positions[b]), 0.5)));
        }
        return midpoints.get(key);
      };
    triangles = triangles.flatMap(([a, b, c]) => {
      const ab = midpoint(a, b),
        bc = midpoint(b, c),
        ca = midpoint(c, a);
      return [
        [a, ab, ca],
        [b, bc, ab],
        [c, ca, bc],
        [ab, bc, ca],
      ];
    });
  }
  return { positions, triangles };
}
const levelFor = (quality, base = 3) =>
  Math.max(1, Math.min(5, Math.round(base + Math.log2(Math.max(0.25, quality || 1)))));

export default ({ Mesh, lathe, tube, sphere, cylinder }) => {
  // a closed mesh from shared vertices, with normals given (or averaged from the faces around each vertex)
  function meshOf(positions, triangles, normals) {
    let vertexNormals = normals;
    if (!vertexNormals) {
      // from the faces; turned outwards if the triangles were written the other way round (negative volume)
      let volume = 0;
      for (const [a, b, c] of triangles) volume += dot(positions[a], cross(positions[b], positions[c]));
      const sign = volume < 0 ? -1 : 1;
      vertexNormals = positions.map(() => [0, 0, 0]);
      for (const [a, b, c] of triangles) {
        const faceNormal = mulv(cross(sub(positions[b], positions[a]), sub(positions[c], positions[a])), sign);
        for (const vertex of [a, b, c]) vertexNormals[vertex] = add(vertexNormals[vertex], faceNormal);
      }
      vertexNormals = vertexNormals.map(norm);
    }
    const mesh = new Mesh();
    positions.forEach((position, k) => mesh.vertex(position, vertexNormals[k]));
    for (const [a, b, c] of triangles) mesh.triangle(a, b, c);
    return mesh;
  }
  // a matrix that takes the x axis from a to b (its length |b − a|), for rods between two points; and the rod's y axis
  function between(a, b) {
    const span = sub(b, a),
      length = len(span),
      xAxis = mulv(span, 1 / length),
      up = Math.abs(xAxis[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const zAxis = norm(cross(xAxis, up)),
      yAxis = cross(zAxis, xAxis);
    return {
      matrix: [
        xAxis[0],
        xAxis[1],
        xAxis[2],
        0,
        yAxis[0],
        yAxis[1],
        yAxis[2],
        0,
        zAxis[0],
        zAxis[1],
        zAxis[2],
        0,
        a[0],
        a[1],
        a[2],
        1,
      ],
      length,
      yAxis,
    };
  }

  // ellipsoid: [a, b, c], semi-axes along x, y, z (a cell, a nucleus, an egg)
  function ellipsoid([semiX, semiY, semiZ], options) {
    const { positions, triangles } = icosphere(levelFor(options.q));
    return meshOf(
      positions.map(([x, y, z]) => [semiX * x, semiY * y, semiZ * z]),
      triangles,
      positions.map(([x, y, z]) => norm([x / semiX, y / semiY, z / semiZ])),
    );
  }
  // capsule: {r, x0, x1}: a cylinder with round ends, along x (a mitochondrion, a bacterium, a pill)
  function capsule({ r: radius, x0 = -0.5, x1 = 0.5 }, options) {
    const steps = Math.max(4, Math.round(8 * (options.q || 1))),
      profile = [];
    for (let k = 0; k <= steps; k++) {
      const angle = ((Math.PI / 2) * k) / steps;
      profile.push([x0 - radius * Math.cos(angle), radius * Math.sin(angle)]);
    }
    for (let k = 0; k <= steps; k++) {
      const angle = ((Math.PI / 2) * k) / steps;
      profile.push([x1 + radius * Math.sin(angle), radius * Math.cos(angle)]);
    }
    return lathe(profile, { ...options, smooth: true });
  }
  // blob: {r, amp, freq, seed, stretch: [sx, sy, sz]}: a sphere with a smooth, irregular surface (a cell body, a
  // nucleus, a rock, a small moon): its radius varies by ±amp
  function blob({ r: radius = 0.5, amp = 0.15, freq = 1.6, seed = 1, stretch = [1, 1, 1] }, options) {
    const { positions, triangles } = icosphere(levelFor(options.q, 4)),
      noise = noise3(seed);
    return meshOf(
      positions.map((point) => {
        const pointRadius =
          radius * (1 + amp * noise(point[0] * freq + 7.1, point[1] * freq + 3.3, point[2] * freq + 5.7));
        return [
          point[0] * pointRadius * stretch[0],
          point[1] * pointRadius * stretch[1],
          point[2] * pointRadius * stretch[2],
        ];
      }),
      triangles,
    );
  }
  // shell: {r, ri, from, to}: a sphere around the x axis, hollow inside ri, with the wedge outside from..to (degrees)
  // cut away to show the inside (Earth's layers, a cell's membrane); ri: 0 for a solid core
  function shell({ r: radius, ri: innerRadius = 0, from = 0, to = 360 }, options) {
    const mesh = new Mesh(),
      polarSteps = Math.max(8, Math.round(24 * (options.q || 1))),
      full = Math.abs(to - from - 360) < 1e-6;
    const aroundSteps = Math.max(6, Math.round((48 * (options.q || 1) * (to - from)) / 360)),
      fromAngle = from * D2R,
      toAngle = to * D2R;
    // the direction at an angle from the x axis (polar) and around it (around)
    const direction = (polar, around) => [
      Math.cos(polar),
      Math.sin(polar) * Math.cos(around),
      Math.sin(polar) * Math.sin(around),
    ];
    for (const [layerRadius, facing] of innerRadius > 0
      ? [
          [radius, 1],
          [innerRadius, -1],
        ]
      : [[radius, 1]]) {
      const grid = [];
      for (let i = 0; i <= polarSteps; i++) {
        const row = [];
        for (let j = 0; j <= aroundSteps; j++) {
          const unit = direction((Math.PI * i) / polarSteps, fromAngle + ((toAngle - fromAngle) * j) / aroundSteps);
          row.push(mesh.vertex(mulv(unit, layerRadius), mulv(unit, facing)));
        }
        grid.push(row);
      }
      for (let i = 0; i < polarSteps; i++)
        for (let j = 0; j < aroundSteps; j++) mesh.quad(grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]);
    }
    if (!full)
      for (const [cutAngle, side] of [
        [fromAngle, -1],
        [toAngle, 1],
      ]) {
        // the cut faces: half-discs, or half-rings
        const normal = [0, -Math.sin(cutAngle) * side, Math.cos(cutAngle) * side];
        const outer = [],
          inner = [];
        for (let i = 0; i <= polarSteps; i++) {
          const unit = direction((Math.PI * i) / polarSteps, cutAngle);
          outer.push(mesh.vertex(mulv(unit, radius), normal));
          if (innerRadius > 0) inner.push(mesh.vertex(mulv(unit, innerRadius), normal));
        }
        if (innerRadius > 0)
          for (let i = 0; i < polarSteps; i++) mesh.quad(outer[i], outer[i + 1], inner[i + 1], inner[i]);
        else {
          const center = mesh.vertex([0, 0, 0], normal);
          for (let i = 0; i < polarSteps; i++) mesh.triangle(center, outer[i], outer[i + 1]);
        }
      }
    return mesh;
  }
  // tree: branching tubes, tapering (dendrites, axon terminals, blood vessels, roots, a river's tributaries).
  // {at, dir, length, r, levels, branches, spread (degrees), shrink, taper, bend, seed}
  function tree(
    {
      at = [0, 0, 0],
      dir: direction = [1, 0, 0],
      length = 1,
      r: radius = 0.04,
      levels = 3,
      branches = 2,
      spread = 35,
      shrink = 0.65,
      taper = 0.6,
      bend = 0.12,
      seed = 1,
    },
    options,
  ) {
    // the form (each branch's wander, where its branches start) is drawn at FORM steps whatever the detail, so a phone
    // or the 2D fallback (built coarser) shows the same tree: the detail only chooses how many of its points are drawn
    const FORM = 8,
      mesh = new Mesh(),
      random = rng(seed),
      drawnSteps = Math.min(FORM, Math.max(4, Math.round(FORM * (options.q || 1))));
    const grow = (start, startDirection, branchLength, startRadius, level) => {
      const forward = norm(startDirection),
        side = norm(cross(forward, Math.abs(forward[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0])),
        up = cross(side, forward),
        path = [start],
        radii = [];
      let point = start,
        heading = forward;
      for (let k = 1; k <= FORM; k++) {
        // a gently wandering path
        heading = norm(add(heading, add(mulv(side, (random() - 0.5) * bend), mulv(up, (random() - 0.5) * bend))));
        point = add(point, mulv(heading, branchLength / FORM));
        path.push(point);
      }
      const endRadius = startRadius * taper;
      for (let k = 0; k <= FORM; k++) radii.push(startRadius + ((endRadius - startRadius) * k) / FORM);
      const drawn = Array.from({ length: drawnSteps + 1 }, (_, i) => Math.round((i * FORM) / drawnSteps));
      mesh.add(
        tube(
          drawn.map((k) => path[k]),
          drawn.map((k) => radii[k]),
          options,
        ),
        M.id(),
      );
      if (level >= levels) return;
      for (let branch = 0; branch < branches; branch++) {
        const fork = branch === branches - 1 ? FORM : Math.max(1, Math.round(FORM * (0.45 + 0.5 * random()))),
          azimuth = 2 * Math.PI * (branch / branches + 0.3 * random());
        const outward = add(mulv(side, Math.cos(azimuth)), mulv(up, Math.sin(azimuth))),
          spreadAngle = spread * D2R * (0.6 + 0.8 * random());
        grow(
          path[fork],
          add(mulv(heading, Math.cos(spreadAngle)), mulv(outward, Math.sin(spreadAngle))),
          branchLength * shrink * (0.8 + 0.4 * random()),
          radii[fork] * 0.85,
          level + 1,
        );
      }
    };
    grow(at, direction, length, radius, 1);
    return mesh;
  }
  // molecule: {atoms: [{el, at: [x, y, z] (ångström)}], bonds: [[i, j, order]], scale, style: 'ball' | 'space'}:
  // atoms in their usual (CPK) colours, ball-and-stick or space-filling; bonds in the two atoms' colours
  function molecule({ atoms = [], bonds = [], scale = 1, style = 'ball', bond: bondRadius = 0.09 }, options) {
    const mesh = new Mesh();
    atoms.forEach((atom) => {
      const element = ELEMENTS[atom.el] || ELEMENTS.X,
        radius = (atom.r ?? (style === 'space' ? element[2] : element[1])) * scale;
      const ball = sphere(radius, options).paint(atom.color || element[0]);
      mesh.add(ball, M.trans(mulv(atom.at, scale)));
    });
    if (style !== 'space')
      for (const [i, j, order = 1] of bonds) {
        const first = mulv(atoms[i].at, scale),
          second = mulv(atoms[j].at, scale);
        if (len(sub(second, first)) < 1e-9) continue; // (two atoms at one place: no rod between them)
        const { yAxis } = between(first, second),
          rodRadius = bondRadius * scale * (order > 1 ? 0.6 : 1);
        for (let k = 0; k < order; k++) {
          // a double or triple bond: rods side by side
          const offset = mulv(yAxis, (k - (order - 1) / 2) * rodRadius * 2.6),
            start = add(first, offset),
            end = add(second, offset),
            middle = mulv(add(start, end), 0.5);
          for (const [rodStart, rodEnd, element] of [
            [start, middle, atoms[i].el],
            [middle, end, atoms[j].el],
          ]) {
            const frame = between(rodStart, rodEnd),
              rod = cylinder({ r: rodRadius, x0: 0, x1: frame.length }, options).paint(
                (ELEMENTS[element] || ELEMENTS.X)[0],
              );
            mesh.add(rod, frame.matrix);
          }
        }
      }
    return mesh;
  }
  // dna: {pairs, seq, r, rise, twist, groove, scale}: a double helix along x in nanometres (radius 1, rise 0.34 per
  // base pair, 10.5 pairs per turn): two backbones and the base pairs between them, coloured A T G C
  function dna(
    {
      pairs = 12,
      seq: sequence = 'ATGCGTACGTTAGC',
      r: radius = 1,
      rise = 0.34,
      twist = 360 / 10.5,
      groove = 150,
      wire = 0.11,
      scale = 1,
    },
    options,
  ) {
    const mesh = new Mesh(),
      scaled = (point) => mulv(point, scale),
      helixPoint = (step, angle) => scaled([step * rise, radius * Math.cos(angle), radius * Math.sin(angle)]);
    const pairCount = Math.max(2, pairs),
      perPair = Math.max(3, Math.round(6 * (options.q || 1))),
      /** @type {number[][][]} */
      strands = [[], []];
    for (let k = 0; k <= (pairCount - 1) * perPair; k++) {
      const t = k / perPair,
        angle = t * twist * D2R;
      strands[0].push(helixPoint(t, angle));
      strands[1].push(helixPoint(t, angle + groove * D2R));
    }
    mesh.add(tube(strands[0], wire * scale, options).paint(BACKBONE[0]), M.id());
    mesh.add(tube(strands[1], wire * scale, options).paint(BACKBONE[1]), M.id());
    const PAIR = { A: 'T', T: 'A', G: 'C', C: 'G' };
    for (let k = 0; k < pairCount; k++) {
      const letter = sequence[k % sequence.length].toUpperCase(),
        angle = k * twist * D2R,
        onFirst = helixPoint(k, angle),
        onSecond = helixPoint(k, angle + groove * D2R),
        middle = mulv(add(onFirst, onSecond), 0.5);
      for (const [from, to, base] of [
        [onFirst, middle, letter],
        [middle, onSecond, PAIR[letter] || 'A'],
      ]) {
        const frame = between(from, to);
        mesh.add(
          cylinder({ r: wire * 0.6 * scale, x0: 0, x1: frame.length }, options).paint(BASES[base]),
          frame.matrix,
        );
      }
    }
    return mesh;
  }
  // extrude: {outline: [[x, y], …], depth}: a flat outline (any simple polygon) made solid along z (a rock layer seen
  // in section, a fault block, a Golgi cisterna, a tooth's cross-section)
  function extrude({ outline, depth = 0.2 }) {
    const mesh = new Mesh(),
      points = outline.length && signedArea(outline) < 0 ? outline.slice().reverse() : outline,
      halfDepth = depth / 2,
      triangles = earcut(points);
    for (const [facing, faceZ] of [
      [1, halfDepth],
      [-1, -halfDepth],
    ]) {
      const vertexIds = points.map(([x, y]) => mesh.vertex([x, y, faceZ], [0, 0, facing]));
      for (const [a, b, c] of triangles) mesh.triangle(vertexIds[a], vertexIds[b], vertexIds[c]);
    }
    for (let k = 0; k < points.length; k++) {
      const a = points[k],
        b = points[(k + 1) % points.length],
        normal = norm([b[1] - a[1], a[0] - b[0], 0]);
      mesh.quad(
        mesh.vertex([a[0], a[1], -halfDepth], normal),
        mesh.vertex([b[0], b[1], -halfDepth], normal),
        mesh.vertex([b[0], b[1], halfDepth], normal),
        mesh.vertex([a[0], a[1], halfDepth], normal),
      );
    }
    return mesh;
  }
  // terrain: {size: [x, z], res, base, height: {amp, freq, seed}, layers: [{thick, color}], top, tilt}: a block of
  // ground whose top is a smooth landscape and whose sides show its rock layers (top layer first, the last one to the
  // bottom); tilt (degrees) dips the layers along x
  /** @param {{ size?: number[], res?: number, base?: number, height?: { amp?: number, freq?: number, seed?: number },
   *   layers?: { thick: number, color: string }[], top?: string, tilt?: number }} t @param {any} options */
  function terrain(
    { size = [2, 2], res = 24, base = 0.6, height = {}, layers = [], top = '#7a9a55', tilt = 0 },
    options,
  ) {
    const mesh = new Mesh(),
      steps = Math.max(6, Math.round(res * (options.q || 1))),
      noise = noise3(height.seed ?? 3),
      [sizeX, sizeZ] = size;
    const heightAt = (x, z) =>
      base + (height.amp ?? 0.12) * noise(x * (height.freq ?? 1.5), 0.37, z * (height.freq ?? 1.5));
    const xAt = (i) => -sizeX / 2 + (sizeX * i) / steps,
      zAt = (j) => -sizeZ / 2 + (sizeZ * j) / steps;
    // the top surface, normals from the slope
    const grid = [];
    for (let i = 0; i <= steps; i++) {
      const row = [];
      for (let j = 0; j <= steps; j++) {
        const x = xAt(i),
          z = zAt(j),
          delta = 1e-3;
        row.push(
          mesh.vertex(
            [x, heightAt(x, z), z],
            norm([
              -(heightAt(x + delta, z) - heightAt(x - delta, z)) / (2 * delta),
              1,
              -(heightAt(x, z + delta) - heightAt(x, z - delta)) / (2 * delta),
            ]),
          ),
        );
      }
      grid.push(row);
    }
    for (let i = 0; i < steps; i++)
      for (let j = 0; j < steps; j++) mesh.quad(grid[i][j], grid[i][j + 1], grid[i + 1][j + 1], grid[i + 1][j]);
    mesh.paint(top);
    // the layer boundaries under a point: from the top down, then the bottom (y = 0)
    const bounds = (x) => {
      let y = base + Math.tan(tilt * D2R) * x;
      const boundaries = [];
      for (const layer of layers.slice(0, -1)) {
        y -= layer.thick;
        boundaries.push(y);
      }
      return boundaries;
    };
    const colour = (k) => (layers[Math.min(k, layers.length - 1)] || { color: '#9a8466' }).color;
    // the four sides, in bands of colour
    const side = (points, normal) => {
      for (let k = 0; k + 1 < points.length; k++) {
        const [x0, z0] = points[k],
          [x1, z1] = points[k + 1],
          top0 = heightAt(x0, z0),
          top1 = heightAt(x1, z1),
          bounds0 = bounds(x0),
          bounds1 = bounds(x1);
        const levels0 = [top0, ...bounds0.map((y) => Math.min(top0, Math.max(0, y))), 0],
          levels1 = [top1, ...bounds1.map((y) => Math.min(top1, Math.max(0, y))), 0];
        for (let layer = 0; layer + 1 < levels0.length; layer++) {
          if (levels0[layer] - levels0[layer + 1] < 1e-9 && levels1[layer] - levels1[layer + 1] < 1e-9) continue;
          const from = mesh.count;
          mesh.quad(
            mesh.vertex([x0, levels0[layer], z0], normal),
            mesh.vertex([x0, levels0[layer + 1], z0], normal),
            mesh.vertex([x1, levels1[layer + 1], z1], normal),
            mesh.vertex([x1, levels1[layer], z1], normal),
          );
          mesh.paint(colour(layer), from);
        }
      }
    };
    const edge = (pointAt) => Array.from({ length: steps + 1 }, (_, k) => pointAt(k));
    side(
      edge((k) => [xAt(k), -sizeZ / 2]),
      [0, 0, -1],
    );
    side(
      edge((k) => [sizeX / 2, zAt(k)]),
      [1, 0, 0],
    );
    side(
      edge((k) => [xAt(steps - k), sizeZ / 2]),
      [0, 0, 1],
    );
    side(
      edge((k) => [-sizeX / 2, zAt(steps - k)]),
      [-1, 0, 0],
    );
    // the bottom: a fan from its middle to every point of the sides' lower edge (one quad would leave the sides'
    // points along it unjoined, and the block open)
    const from = mesh.count,
      down = [0, -1, 0],
      middle = mesh.vertex([0, 0, 0], down),
      rim = [
        ...edge((k) => [xAt(k), -sizeZ / 2]),
        ...edge((k) => [sizeX / 2, zAt(k)]).slice(1),
        ...edge((k) => [xAt(steps - k), sizeZ / 2]).slice(1),
        ...edge((k) => [-sizeX / 2, zAt(steps - k)]).slice(1),
      ].map(([x, z]) => mesh.vertex([x, 0, z], down));
    for (let k = 0; k + 1 < rim.length; k++) mesh.triangle(middle, rim[k], rim[k + 1]);
    mesh.paint(colour(layers.length - 1), from);
    return mesh;
  }
  // ring: {r, ri, thickness}: a flat ring around the x axis (Saturn's rings, a washer)
  const ring = ({ r, ri, thickness = 0.01 }, options) =>
    cylinder({ r, ri, x0: -thickness / 2, x1: thickness / 2 }, options);
  // orbit: {a, e, wire}: an ellipse in the x-z plane with a focus at the origin (where the Sun is): semi-major axis a,
  // eccentricity e
  function orbit({ a, e = 0, wire = 0.01 }, options) {
    const steps = Math.max(48, Math.round(160 * (options.q || 1))),
      b = a * Math.sqrt(1 - e * e),
      path = [];
    for (let k = 0; k < steps; k++) {
      const angle = (2 * Math.PI * k) / steps;
      path.push([a * (Math.cos(angle) - e), 0, b * Math.sin(angle)]);
    }
    return tube(path, wire, { ...options, closed: true });
  }
  // blade: {root, span, chord, tip, twist, thickness, camber}: an airfoil blade standing out along y from radius root
  // to root + span, its chord along x (a fan, compressor or turbine blade; repeat it around the x axis). The section is
  // a NACA-style airfoil of the given thickness and camber (fractions of the chord), turned by twist (degrees) at the
  // root, decreasing to 0 at the tip
  function blade(
    { root = 0.2, span = 0.5, chord = 0.15, tip, twist = 35, thickness = 0.1, camber = 0.04, sweep = 0 },
    options,
  ) {
    const spanSteps = Math.max(4, Math.round(10 * (options.q || 1))),
      chordSteps = Math.max(8, Math.round(16 * (options.q || 1))),
      positions = [],
      triangles = [];
    const halfThicknessAt = (x) =>
      5 * thickness * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);
    const camberAt = (x) => camber * 4 * x * (1 - x);
    const outline = []; // the airfoil's outline: upper surface from the leading edge back, lower surface forward
    for (let k = 0; k <= chordSteps; k++) {
      const x = (1 - Math.cos((Math.PI * k) / chordSteps)) / 2;
      outline.push([x, camberAt(x) + halfThicknessAt(x)]);
    }
    for (let k = chordSteps - 1; k > 0; k--) {
      const x = (1 - Math.cos((Math.PI * k) / chordSteps)) / 2;
      outline.push([x, camberAt(x) - halfThicknessAt(x)]);
    }
    for (let section = 0; section <= spanSteps; section++) {
      const fraction = section / spanSteps,
        sectionChord = chord + ((tip ?? chord) - chord) * fraction,
        angle = twist * (1 - fraction) * D2R,
        y = root + span * fraction,
        sweepOffset = sweep * span * fraction;
      for (const [x, z] of outline) {
        const alongChord = (x - 0.5) * sectionChord,
          acrossChord = z * sectionChord;
        positions.push([
          alongChord * Math.cos(angle) - acrossChord * Math.sin(angle) + sweepOffset,
          y,
          alongChord * Math.sin(angle) + acrossChord * Math.cos(angle),
        ]);
      }
    }
    const outlineLength = outline.length;
    for (let section = 0; section < spanSteps; section++)
      for (let k = 0; k < outlineLength; k++) {
        const a = section * outlineLength + k,
          b = section * outlineLength + ((k + 1) % outlineLength),
          c = a + outlineLength,
          d = b + outlineLength;
        triangles.push([a, b, d], [a, d, c]);
      }
    for (const [section, flip] of /** @type {[number, boolean][]} */ ([
      [0, true],
      [spanSteps, false],
    ])) {
      // root and tip, closed by a fan from the section's middle
      const centerIndex = positions.length,
        first = section * outlineLength;
      positions.push(
        mulv(
          positions.slice(first, first + outlineLength).reduce((sum, point) => add(sum, point), [0, 0, 0]),
          1 / outlineLength,
        ),
      );
      for (let k = 0; k < outlineLength; k++)
        triangles.push(
          flip
            ? [centerIndex, first + ((k + 1) % outlineLength), first + k]
            : [centerIndex, first + k, first + ((k + 1) % outlineLength)],
        );
    }
    return meshOf(positions, triangles);
  }
  return { ellipsoid, capsule, blob, shell, tree, molecule, dna, extrude, terrain, ring, orbit, blade };
};
export { rng, earcut, signedArea };

// [colour (CPK, as Jmol draws them), ball radius (Å, for ball-and-stick), van der Waals radius (Å, space-filling)]
const ELEMENTS = {
  H: ['#ffffff', 0.25, 1.2],
  He: ['#d9ffff', 0.3, 1.4],
  Li: ['#cc80ff', 0.5, 1.82],
  Be: ['#c2ff00', 0.42, 1.53],
  B: ['#ffb5b5', 0.38, 1.92],
  C: ['#3d3d3d', 0.36, 1.7],
  N: ['#3050f8', 0.34, 1.55],
  O: ['#ff2d1f', 0.33, 1.52],
  F: ['#90e050', 0.3, 1.47],
  P: ['#ff8000', 0.45, 1.8],
  S: ['#ffd02a', 0.45, 1.8],
  Cl: ['#1ff01f', 0.44, 1.75],
  Na: ['#ab5cf2', 0.5, 2.27],
  K: ['#8f40d4', 0.55, 2.75],
  Mg: ['#8aff00', 0.45, 1.73],
  Ca: ['#3dff00', 0.5, 2.31],
  Fe: ['#e06633', 0.45, 2.0],
  Cu: ['#c88033', 0.45, 1.4],
  Zn: ['#7d80b0', 0.45, 1.39],
  Ne: ['#b3e3f5', 0.32, 1.54],
  Ar: ['#80d1e3', 0.4, 1.88],
  Br: ['#a62929', 0.47, 1.85],
  I: ['#940094', 0.52, 1.98],
  Si: ['#f0c8a0', 0.45, 2.1],
  Al: ['#bfa6a6', 0.45, 1.84],
  X: ['#ff1493', 0.4, 1.6],
};
const BACKBONE = ['#e0a14a', '#6b8fd6'],
  BASES = { A: '#e8574a', T: '#4a90d9', G: '#f2c14e', C: '#5cb85c' };
function signedArea(points) {
  let area = 0;
  for (let k = 0; k < points.length; k++) {
    const point = points[k],
      next = points[(k + 1) % points.length];
    area += point[0] * next[1] - next[0] * point[1];
  }
  return area / 2;
}
// triangles of a simple polygon given counter-clockwise (ear clipping: fine for the few dozen points of an outline)
function earcut(points) {
  const remaining = points.map((_, k) => k),
    triangles = [],
    turn = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const inTriangle = (point, a, b, c) => turn(a, b, point) >= 0 && turn(b, c, point) >= 0 && turn(c, a, point) >= 0;
  let guard = 0;
  while (remaining.length > 3 && guard++ < 10000) {
    let cut = false;
    for (let k = 0; k < remaining.length; k++) {
      const i0 = remaining[(k + remaining.length - 1) % remaining.length],
        i1 = remaining[k],
        i2 = remaining[(k + 1) % remaining.length],
        a = points[i0],
        b = points[i1],
        c = points[i2];
      if (turn(a, b, c) <= 1e-12) continue; // a reflex corner is not an ear
      if (remaining.some((j) => j !== i0 && j !== i1 && j !== i2 && inTriangle(points[j], a, b, c))) continue;
      triangles.push([i0, i1, i2]);
      remaining.splice(k, 1);
      cut = true;
      break;
    }
    if (!cut) break; // degenerate outline: stop rather than loop
  }
  if (remaining.length === 3) triangles.push(remaining.slice());
  return triangles;
}
