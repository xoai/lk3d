// Shapes: every part of a scene is built from simple shapes generated here (no model files). A shape repeated around an
// axis stays one shape drawn many times (instancing), so a ring of 28 fins costs the memory of one fin.
import { D2R, M, sub, add, mulv, dot, cross, len, norm, carry, rgb } from './math.js';
import science, { rng, earcut, signedArea } from './science.js';
import { load as loadModel, parseGLB, bytes } from './gltf.js';
import { fluidsOf, bodies } from './fluids.js';
import { guard } from './guard.js';

// vertices and triangles the scene being built may still make (buildScene sets it: three times its triangle limit): a
// scene that asks for more is refused as it reaches it, whatever the estimate (least) said, before it can take the
// page's memory
let room = Infinity,
  cap = 0;
/** @param {number} count */
const words = (count) => (count >= 1e6 && count % 1e5 === 0 ? count / 1e6 + ' million' : String(count));
/** @param {string} what @param {number | string} [limit] the limit, or the limit already in words (words passes it on) */
const tooMany = (what, limit = cap) =>
  Object.assign(new Error(`lk3d: ${what}; the limit is ${words(/** @type {number} */ (limit))}`), { triangles: true });

// A mesh is positions, normals and triangles; every triangle is turned to face the way its normals point, so shapes
// can be written without minding winding order. Vertices may also carry a colour (colors: r, g, b, a per vertex, 0-255):
// alpha 255 is the vertex's own colour (an atom, a rock layer), alpha 0 takes the part's colour.
class Mesh {
  constructor() {
    this.positions = [];
    this.normals = [];
    this.indices = [];
    this.colors = null;
    this.uv = null;
    this.textures = null;
  } // uv, textures: a textured model's
  get count() {
    return this.positions.length / 3;
  }
  vertex(position, normal) {
    if (--room < 0) Mesh.fits(1);
    this.positions.push(position[0], position[1], position[2]);
    this.normals.push(normal[0], normal[1], normal[2]);
    if (this.colors) this.colors.push(0, 0, 0, 0);
    if (this.uv) this.uv.push(0, 0);
    return this.count - 1;
  }
  // colour the vertices from `from` on (all, by default)
  paint(hex, from = 0) {
    const [r, g, b] = rgb(hex).map((channel) => Math.round(channel * 255));
    if (!this.colors) this.colors = new Array(this.count * 4).fill(0);
    const colors = this.colors;
    for (let k = from; k < this.count; k++) {
      colors[4 * k] = r;
      colors[4 * k + 1] = g;
      colors[4 * k + 2] = b;
      colors[4 * k + 3] = 255;
    }
    return this;
  }
  // count more, or refused past the limit (a model asks before reading its values)
  static fits(count) {
    if (count > room) throw tooMany('the scene makes too many triangles');
  }
  triangle(a, b, c) {
    // (scalar arithmetic: this runs for every triangle of every scene)
    if (--room < 0) Mesh.fits(1);
    const positions = this.positions,
      normals = this.normals,
      a3 = 3 * a,
      b3 = 3 * b,
      c3 = 3 * c;
    const ux = positions[b3] - positions[a3],
      uy = positions[b3 + 1] - positions[a3 + 1],
      uz = positions[b3 + 2] - positions[a3 + 2],
      vx = positions[c3] - positions[a3],
      vy = positions[c3 + 1] - positions[a3 + 1],
      vz = positions[c3 + 2] - positions[a3 + 2];
    const faceX = uy * vz - uz * vy,
      faceY = uz * vx - ux * vz,
      faceZ = ux * vy - uy * vx;
    const facing =
      faceX * (normals[a3] + normals[b3] + normals[c3]) +
      faceY * (normals[a3 + 1] + normals[b3 + 1] + normals[c3 + 1]) +
      faceZ * (normals[a3 + 2] + normals[b3 + 2] + normals[c3 + 2]);
    if (facing < 0) this.indices.push(a, c, b);
    else this.indices.push(a, b, c);
  }
  quad(a, b, c, d) {
    this.triangle(a, b, c);
    this.triangle(a, c, d);
  }
  // mesh placed by m. Normals go through the cofactor matrix (the inverse transpose, up to scale), so they stay
  // perpendicular under a stretch; a mirror (det < 0) also turns the triangles round, so faces still point out.
  add(mesh, m) {
    const base = this.count,
      positions = mesh.positions,
      normals = mesh.normals;
    const c0 = m[5] * m[10] - m[6] * m[9],
      c1 = m[6] * m[8] - m[4] * m[10],
      c2 = m[4] * m[9] - m[5] * m[8]; // c1 × c2
    const d0 = m[9] * m[2] - m[10] * m[1],
      d1 = m[10] * m[0] - m[8] * m[2],
      d2 = m[8] * m[1] - m[9] * m[0]; // c2 × c0
    const e0 = m[1] * m[6] - m[2] * m[5],
      e1 = m[2] * m[4] - m[0] * m[6],
      e2 = m[0] * m[5] - m[1] * m[4]; // c0 × c1
    const det = m[0] * c0 + m[1] * c1 + m[2] * c2,
      sign = det < 0 ? -1 : 1;
    for (let k = 0; k < mesh.count; k++) {
      const x = positions[3 * k],
        y = positions[3 * k + 1],
        z = positions[3 * k + 2],
        normalX = normals[3 * k],
        normalY = normals[3 * k + 1],
        normalZ = normals[3 * k + 2];
      const nx = sign * (c0 * normalX + d0 * normalY + e0 * normalZ),
        ny = sign * (c1 * normalX + d1 * normalY + e1 * normalZ),
        nz = sign * (c2 * normalX + d2 * normalY + e2 * normalZ),
        length = Math.hypot(nx, ny, nz) || 1;
      this.positions.push(
        m[0] * x + m[4] * y + m[8] * z + m[12],
        m[1] * x + m[5] * y + m[9] * z + m[13],
        m[2] * x + m[6] * y + m[10] * z + m[14],
      );
      this.normals.push(nx / length, ny / length, nz / length);
    }
    if (mesh.colors || this.colors) {
      // colours: keep both sides' (alpha 0 where a side had none)
      if (!this.colors) this.colors = new Array(base * 4).fill(0);
      if (mesh.colors) for (const v of mesh.colors) this.colors.push(v);
      else for (let k = 0; k < mesh.count * 4; k++) this.colors.push(0);
    }
    if (mesh.uv || this.uv) {
      // texture coordinates likewise (0 where a side had none), and the maps they belong to
      if (!this.uv) this.uv = new Array(base * 2).fill(0);
      if (mesh.uv) for (const v of mesh.uv) this.uv.push(v);
      else for (let k = 0; k < mesh.count * 2; k++) this.uv.push(0);
      this.textures = this.textures || mesh.textures;
    }
    if (mesh.twoSided) this.twoSided = true; // (drawn with both faces: a model's double-sided surface)
    const indices = mesh.indices;
    if (sign > 0) for (const k of indices) this.indices.push(base + k);
    else
      for (let t = 0; t < indices.length; t += 3)
        this.indices.push(base + indices[t], base + indices[t + 2], base + indices[t + 1]);
    return this;
  }
}

// Revolve a profile of [x, r] points around the x axis. Each profile segment gets its own normals, so the edges
// between segments stay crisp (machined parts); smooth: true blends them (spheres, tori). from/to (degrees) make a
// sector, closed with flat sides (the profile must then be a closed outline; it may be concave, a cowl's thin wall).
function lathe(profile, options = {}) {
  // (a sector given backwards, from 90 to -90, is the same sector: from the smaller angle round to the larger)
  let from = options.from ?? 0,
    to = options.to ?? 360;
  if (to < from) [from, to] = [to, from];
  const mesh = new Mesh(),
    segments = Math.max(6, Math.round(((options.seg || 48) * (options.q || 1) * (to - from)) / 360));
  const startAngle = from * D2R,
    endAngle = to * D2R,
    full = Math.abs(endAngle - startAngle - 2 * Math.PI) < 1e-6;
  const raw = options.mirror ? profile.map(([x, r]) => [-x, r]).reverse() : profile;
  const closed = options.closed ?? (!full && raw.length > 2);
  // long straight stretches get points along them, so shading computed per vertex (ambient occlusion) has somewhere to
  // vary: a long wall would otherwise have vertices only at its two ends
  let extent = 0;
  for (const a of raw) for (const b of raw) extent = Math.max(extent, Math.hypot(a[0] - b[0], a[1] - b[1]));
  const maxLength = options.maxSeg || ((options.q ?? 1) < 0.75 ? Infinity : extent / 5),
    points = []; // not for the coarse 2D or phone geometry
  for (let k = 0; k < raw.length; k++) {
    const a = raw[k],
      b = raw[(k + 1) % raw.length];
    points.push(a);
    if (k + 1 === raw.length && !closed) break;
    const inserted = Math.floor(Math.hypot(b[0] - a[0], b[1] - a[1]) / maxLength);
    for (let j = 1; j <= inserted && !options.smooth; j++) {
      const t = j / (inserted + 1);
      points.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  const pieces = [];
  for (let k = 0; k + 1 < points.length + (closed ? 1 : 0); k++)
    pieces.push([points[k], points[(k + 1) % points.length]]);
  const revolved = (x, r, angle) => [x, r * Math.cos(angle), r * Math.sin(angle)];
  // normals point out of the solid whichever way round the profile was written: a profile traced counter-clockwise in
  // the (x, r) plane (closed along the axis if it is open) has them flipped
  let area = 0;
  for (let k = 0; k < points.length; k++) {
    const a = points[k],
      b = points[(k + 1) % points.length];
    area += a[0] * b[1] - b[0] * a[1];
  }
  const orientation = area > 0 ? -1 : 1;
  const pieceNormals = pieces.map(([p, q]) => {
    const dx = q[0] - p[0],
      dr = q[1] - p[1],
      length = Math.hypot(dx, dr) || 1;
    return [(-dr / length) * orientation, (dx / length) * orientation];
  });
  pieces.forEach(([p, q], index) => {
    let profileNormalStart = pieceNormals[index],
      profileNormalEnd = pieceNormals[index];
    if (options.smooth) {
      const previous = pieceNormals[(index - 1 + pieces.length) % pieces.length],
        next = pieceNormals[(index + 1) % pieces.length];
      if (index > 0 || closed)
        profileNormalStart = [profileNormalStart[0] + previous[0], profileNormalStart[1] + previous[1]];
      if (index < pieces.length - 1 || closed)
        profileNormalEnd = [profileNormalEnd[0] + next[0], profileNormalEnd[1] + next[1]];
    }
    const ring = [];
    for (let k = 0; k <= segments; k++) {
      const angle = startAngle + ((endAngle - startAngle) * k) / segments,
        cos = Math.cos(angle),
        sin = Math.sin(angle);
      const normalStart = norm([profileNormalStart[0], profileNormalStart[1] * cos, profileNormalStart[1] * sin]),
        normalEnd = norm([profileNormalEnd[0], profileNormalEnd[1] * cos, profileNormalEnd[1] * sin]);
      ring.push([
        mesh.vertex(revolved(p[0], p[1], angle), normalStart),
        mesh.vertex(revolved(q[0], q[1], angle), normalEnd),
      ]);
    }
    for (let k = 0; k < segments; k++) {
      const [a, b] = ring[k],
        [c, d] = ring[k + 1];
      if (p[1] < 1e-9 && q[1] < 1e-9) continue;
      mesh.quad(a, b, d, c);
    }
  });
  if (!full)
    for (const [angle, side] of [
      [startAngle, -1],
      [endAngle, 1],
    ]) {
      // the two flat sides of a sector: the profile's outline, triangulated (it may be concave)
      const normal = [0, -Math.sin(angle) * side, Math.cos(angle) * side],
        outline = signedArea(points) < 0 ? points.slice().reverse() : points,
        vertexIds = outline.map(([x, r]) => mesh.vertex(revolved(x, r, angle), normal));
      for (const [a, b, c] of earcut(outline)) mesh.triangle(vertexIds[a], vertexIds[b], vertexIds[c]);
    }
  return mesh;
}
function cylinder({ r, x0 = -0.5, x1 = 0.5, ri = 0, r1 }, options) {
  const endRadius = r1 ?? r;
  return ri > 0
    ? lathe(
        [
          [x0, ri],
          [x0, r],
          [x1, endRadius],
          [x1, ri],
        ],
        { ...options, closed: true },
      )
    : lathe(
        [
          [x0, 0],
          [x0, r],
          [x1, endRadius],
          [x1, 0],
        ],
        options,
      );
}
function box(size) {
  const mesh = new Mesh(),
    [a, b, c] = size.map((v) => v / 2);
  const faces = [
    [
      [1, 0, 0],
      [
        [a, -b, -c],
        [a, b, -c],
        [a, b, c],
        [a, -b, c],
      ],
    ],
    [
      [-1, 0, 0],
      [
        [-a, -b, -c],
        [-a, -b, c],
        [-a, b, c],
        [-a, b, -c],
      ],
    ],
    [
      [0, 1, 0],
      [
        [-a, b, -c],
        [-a, b, c],
        [a, b, c],
        [a, b, -c],
      ],
    ],
    [
      [0, -1, 0],
      [
        [-a, -b, -c],
        [a, -b, -c],
        [a, -b, c],
        [-a, -b, c],
      ],
    ],
    [
      [0, 0, 1],
      [
        [-a, -b, c],
        [a, -b, c],
        [a, b, c],
        [-a, b, c],
      ],
    ],
    [
      [0, 0, -1],
      [
        [-a, -b, -c],
        [-a, b, -c],
        [a, b, -c],
        [a, -b, -c],
      ],
    ],
  ];
  for (const [normal, corners] of faces) {
    const vertexIds = corners.map((corner) => mesh.vertex(corner, normal));
    mesh.quad(vertexIds[0], vertexIds[1], vertexIds[2], vertexIds[3]);
  }
  return mesh;
}
function sphere(r, options) {
  // options.seg: segments around (32 by default; 8 for a tiny bead repeated hundreds of times)
  const segments = options.seg || 32,
    steps = Math.max(4, Math.round((segments / 2) * (options.q || 1))),
    profile = [];
  for (let k = 0; k <= steps; k++) {
    const angle = (Math.PI * k) / steps;
    profile.push([-r * Math.cos(angle), r * Math.sin(angle)]);
  }
  return lathe(profile, { ...options, smooth: true, seg: segments });
}
function torus([major, minor], options) {
  const steps = Math.max(6, Math.round(12 * (options.q || 1))),
    profile = [];
  for (let k = 0; k < steps; k++) {
    const angle = (2 * Math.PI * k) / steps;
    profile.push([minor * Math.cos(angle), major + minor * Math.sin(angle)]);
  }
  return lathe(profile, { ...options, smooth: true, closed: true });
}
// A round tube along a path (parallel-transported frames, so it does not twist). r: a radius, or one per point
// (a tapering branch).
function tube(path, radius, options = {}) {
  const mesh = new Mesh(),
    sides = Math.max(5, Math.round(8 * (options.q || 1))),
    closed = !!options.closed;
  // (a point repeated adds nothing and has no direction: left out, with its radius)
  const keep = path.map((p, k) => k === 0 || len(sub(p, path[k - 1])) > 1e-9);
  const points = path.filter((_, k) => keep[k]),
    radii = Array.isArray(radius) ? radius.filter((_, k) => keep[k]) : null,
    count = points.length;
  if (count < 2) return mesh;
  // the direction at each point: across its two neighbours, or along its one segment where those cancel (a hairpin)
  const tangents = points.map((_, k) => {
    const before = points[closed ? (k - 1 + count) % count : Math.max(k - 1, 0)],
      after = points[closed ? (k + 1) % count : Math.min(k + 1, count - 1)],
      across = sub(after, before);
    return norm(len(across) > 1e-9 ? across : sub(after, points[k]));
  });
  let normal =
    Math.abs(tangents[0][0]) < 0.9 ? norm(cross(tangents[0], [1, 0, 0])) : norm(cross(tangents[0], [0, 1, 0]));
  const rings = [];
  for (let k = 0; k < count; k++) {
    if (k > 0) {
      const carried = carry(normal, tangents[k - 1], tangents[k]);
      normal = norm(sub(carried, mulv(tangents[k], dot(carried, tangents[k]))));
    }
    const binormal = cross(tangents[k], normal),
      ring = [];
    for (let j = 0; j <= sides; j++) {
      const angle = (2 * Math.PI * j) / sides,
        direction = add(mulv(normal, Math.cos(angle)), mulv(binormal, Math.sin(angle)));
      ring.push(mesh.vertex(add(points[k], mulv(direction, radii ? radii[k] : radius)), direction));
    }
    rings.push(ring);
  }
  for (let k = 0; k < count - 1 + (closed ? 1 : 0); k++) {
    const ring0 = rings[k],
      ring1 = rings[(k + 1) % count];
    for (let j = 0; j < sides; j++) mesh.quad(ring0[j], ring0[j + 1], ring1[j + 1], ring1[j]);
  }
  if (!closed)
    for (const [k, sign] of [
      [0, -1],
      [count - 1, 1],
    ]) {
      // flat ends
      const center = mesh.vertex(points[k], mulv(tangents[k], sign)),
        capIds = rings[k].map((_, j) =>
          mesh.vertex(
            [mesh.positions[3 * rings[k][j]], mesh.positions[3 * rings[k][j] + 1], mesh.positions[3 * rings[k][j] + 2]],
            mulv(tangents[k], sign),
          ),
        );
      for (let j = 0; j < sides; j++) mesh.triangle(center, capIds[j], capIds[j + 1]);
    }
  return mesh;
}
function helix({ r, x0 = -0.5, x1 = 0.5, turns = 8, wire = 0.02 }, options) {
  const steps = Math.max(24, Math.round(turns * 16 * (options.q || 1))),
    path = [];
  for (let k = 0; k <= steps; k++) {
    const t = k / steps,
      angle = 2 * Math.PI * turns * t;
    path.push([x0 + (x1 - x0) * t, r * Math.cos(angle), r * Math.sin(angle)]);
  }
  return tube(path, wire, options);
}
// A rounded rectangular loop of wire lying in the x-z plane at height y = R: a coil around a stator tooth.
function loop(
  { a: length = 0.8, b: width = 0.12, R: height = 0.4, wire = 0.02, corner = 0.03, turns = 1, gap = 0 },
  options,
) {
  const mesh = new Mesh(),
    cornerSteps = 5;
  for (let turn = 0; turn < turns; turn++) {
    // turns stack outwards from the axis, like the layers of a winding
    const halfLength = length / 2,
      halfWidth = width / 2,
      cornerRadius = Math.min(corner, halfLength, halfWidth),
      y = height + turn * gap,
      path = [];
    const arc = (centerX, centerZ, startAngle) => {
      for (let k = 0; k <= cornerSteps; k++) {
        const angle = startAngle + ((Math.PI / 2) * k) / cornerSteps;
        path.push([centerX + cornerRadius * Math.cos(angle), y, centerZ + cornerRadius * Math.sin(angle)]);
      }
    };
    arc(halfLength - cornerRadius, halfWidth - cornerRadius, 0);
    arc(-halfLength + cornerRadius, halfWidth - cornerRadius, Math.PI / 2);
    arc(-halfLength + cornerRadius, -halfWidth + cornerRadius, Math.PI);
    arc(halfLength - cornerRadius, -halfWidth + cornerRadius, 1.5 * Math.PI);
    mesh.add(tube(path, wire, { ...options, closed: true }), M.id());
  }
  return mesh;
}
const SHAPES = {
  lathe: (value, shape, options) =>
    lathe(value, {
      ...options,
      seg: shape.seg,
      from: shape.from,
      to: shape.to,
      smooth: shape.smooth,
      closed: shape.closed,
      mirror: shape.mirror,
    }),
  cylinder: (value, shape, options) => cylinder(value, { ...options, seg: shape.seg }),
  box: (value) => box(value),
  sphere: (value, shape, options) => sphere(value, { ...options, seg: shape.seg }),
  torus: (value, shape, options) => torus(value, options),
  tube: (value, shape, options) => tube(value, shape.r || 0.02, { ...options, closed: shape.closed }),
  helix: (value, shape, options) => helix(value, options),
  loop: (value, shape, options) => loop(value, options),
};
// cells, molecules, rock, planets, blades: each takes its parameters and the build options (quality q)
for (const [name, make] of Object.entries(science({ Mesh, lathe, tube, sphere, cylinder })))
  SHAPES[name] = (value, shape, options) => make(value, options);
// One shape of a part: its geometry (in the shape's own frame) and the placements it is drawn at: one, copies around
// an axis (repeat), or copies scattered at random inside a region (scatter: ribosomes, vesicles, stars). color: paints
// the shape in its own colour (alpha 255), so one part can hold differently coloured shapes.
// detail: 0.5 for a shape repeated hundreds of times (blades), 2 for a close-up; at most 16 in all (scatters in scatters
// would otherwise multiply it past any size)
const detail = (quality, factor) => Math.min(16, quality * (factor || 1));
function buildShape(shape, quality, context = {}) {
  quality = detail(quality, shape.detail);
  if (shape.scatter) return scatterShape(shape, quality, context);
  if (shape.model != null) return modelShape(shape, context);
  const kind = Object.keys(SHAPES).find((k) => k in shape);
  if (!kind)
    throw new Error(
      'lk3d: a shape needs one of ' +
        Object.keys(SHAPES).join(', ') +
        ', scatter: ' +
        JSON.stringify(shape).slice(0, 80),
    );
  // the geometry depends only on the shape's own numbers: made once for every shape alike in a scene (bolts, blades,
  // the same part a thousand times), placed by its matrices
  const key = context.cache && JSON.stringify({ ...shape, at: 0, rot: 0, scale: 0, repeat: 0, q: quality });
  let mesh = key && context.cache.get(key);
  if (!mesh) {
    mesh = SHAPES[kind](shape[kind], shape, { q: quality });
    if (shape.color) mesh.paint(shape.color);
    if (key) context.cache.set(key, mesh);
  }
  const placement = M.trs(shape.at, shape.rot, shape.scale),
    repeat = shape.repeat ? (typeof shape.repeat === 'number' ? { n: shape.repeat } : shape.repeat) : { n: 1 },
    axis = repeat.axis || 'x',
    turn = axis === 'x' ? M.rotX : axis === 'y' ? M.rotY : M.rotZ,
    matrices = [];
  for (let k = 0; k < repeat.n; k++)
    matrices.push(M.mul(turn(((repeat.start || 0) + (repeat.step ?? 360 / repeat.n) * k) * D2R), placement));
  return { mesh, placements: matrices };
}
// scatter: {shape: {…a shape…}, n, within: {sphere: r} | {shell: [ri, r]} | {box: [x, y, z]}, avoid: [{sphere: r, at}],
// size: [min, max], seed}. Each copy turned at random and scaled evenly, so all are drawn by instancing.
// model: a model the scene lists under `models` (models: {heart: {data: the .glb as base64}}), or one node of it:
// {model: heart, node: …}; color: its own colour in place of its base colour map (a glass eye's white film, a stain
// that misleads)
function modelShape(shape, context) {
  const model = (context.models || {})[shape.model];
  if (!model || !model.data)
    throw new Error(`lk3d: no model "${shape.model}" in the scene's models (each needs its .glb as base64 in data)`);
  // (a model is read once a scene, and each node of it, in each colour, made once: a model split into many parts, or
  // used many times, costs one decode)
  const files = (context.files ??= new Map()),
    key = 'model\u0000' + JSON.stringify([shape.model, shape.node, shape.color]);
  let mesh = context.cache && context.cache.get(key);
  if (!mesh) {
    if (!files.has(shape.model)) files.set(shape.model, parseGLB(bytes(model.data)));
    mesh = loadModel(Mesh, files.get(shape.model), shape.node);
    if (shape.color) {
      mesh.paint(shape.color);
      if (mesh.textures) mesh.textures = { ...mesh.textures, base: null }; // (its colour in place of the base colour map; relief kept)
    }
    if (context.cache) context.cache.set(key, mesh);
  }
  return { mesh, placements: [M.trs(shape.at, shape.rot, shape.scale)] };
}
function scatterShape(shape, quality, context) {
  const scatter = shape.scatter,
    inner = buildShape(scatter.shape, detail(quality, scatter.detail ?? 0.5), context),
    random = rng(scatter.seed ?? 1),
    placement = M.trs(shape.at, shape.rot, shape.scale);
  const within = scatter.within || { sphere: 1 },
    [minSize, maxSize] = scatter.size || [1, 1],
    matrices = [];
  const inside = (point) =>
    within.box
      ? true
      : Math.hypot(...point) <= (within.sphere ?? within.shell[1]) &&
        (!within.shell || Math.hypot(...point) >= within.shell[0]);
  const avoided = (point) =>
    (scatter.avoid || []).some(
      (zone) =>
        Math.hypot(
          point[0] - (zone.at || [0, 0, 0])[0],
          point[1] - (zone.at || [0, 0, 0])[1],
          point[2] - (zone.at || [0, 0, 0])[2],
        ) < zone.sphere,
    );
  const span = within.box ? within.box : [2, 2, 2].map((factor) => factor * (within.sphere ?? within.shell[1]));
  for (let tries = 0; matrices.length < (scatter.n || 50) && tries < (scatter.n || 50) * 60; tries++) {
    const point = span.map((extent) => (random() - 0.5) * extent);
    if (!inside(point) || avoided(point)) continue;
    const size = minSize + (maxSize - minSize) * random(),
      matrix = M.mul(
        M.trs(point, [random() * 360, random() * 360, random() * 360], [size, size, size]),
        inner.placements[0],
      );
    matrices.push(M.mul(placement, matrix));
  }
  return { mesh: inner.mesh, placements: matrices };
}

// Positions welded: firstAt[k] is the first vertex at k's place (rounded coordinates, hashed, the match checked exactly),
// so a shape's own seams (a crease's two normals, a colour's two sides) are one place.
function weld(mesh, scale = 1e4) {
  const count = mesh.count,
    positions = mesh.positions,
    rounded = new Int32Array(count * 3),
    firstAt = new Int32Array(count),
    buckets = new Map();
  for (let i = 0; i < count; i++) {
    const x = (rounded[3 * i] = Math.round(positions[3 * i] * scale)),
      y = (rounded[3 * i + 1] = Math.round(positions[3 * i + 1] * scale)),
      z = (rounded[3 * i + 2] = Math.round(positions[3 * i + 2] * scale));
    const hash = (Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)) | 0;
    let list = buckets.get(hash),
      match = -1;
    if (list)
      for (const j of list)
        if (rounded[3 * j] === x && rounded[3 * j + 1] === y && rounded[3 * j + 2] === z) {
          match = j;
          break;
        }
    if (match < 0) {
      match = i;
      if (list) list.push(i);
      else buckets.set(hash, [i]);
    }
    firstAt[i] = match;
  }
  return firstAt;
}

// Whether a shape is closed, a solid with an inside: every edge of its surface (welded finely, for its size, so a thin
// blade's two sides stay apart) used as often in one direction as in the other. Two solids meeting along an edge, a
// molecule's two half-rods at their middle, are closed; a surface that ends anywhere, or faces turned the wrong way, is
// not.
function isClosed(mesh) {
  if (!mesh.count) return false;
  const { min, max } = bounds(mesh),
    size = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2], 1e-9),
    far = Math.max(...min.map(Math.abs), ...max.map(Math.abs), 1e-9),
    firstAt = weld(mesh, Math.min(1e6 / size, 2e9 / far)),
    indices = mesh.indices,
    count = mesh.count,
    balance = new Map();
  for (let t = 0; t < indices.length; t += 3) {
    const corners = [firstAt[indices[t]], firstAt[indices[t + 1]], firstAt[indices[t + 2]]];
    if (corners[0] === corners[1] || corners[1] === corners[2] || corners[0] === corners[2]) continue; // (a sliver: no face)
    for (let side = 0; side < 3; side++) {
      const a = corners[side],
        b = corners[(side + 1) % 3],
        key = a < b ? a * count + b : b * count + a;
      balance.set(key, (balance.get(key) || 0) + (a < b ? 1 : -1));
    }
  }
  if (!balance.size) return false;
  for (const net of balance.values()) if (net !== 0) return false;
  return true;
}

// Normals for the outline: the average at each position, so the inked silhouette has no gaps at sharp edges.
function outlineNormals(mesh) {
  const count = mesh.count,
    normals = mesh.normals,
    firstAt = weld(mesh),
    sums = new Float32Array(count * 3),
    out = new Float32Array(count * 3);
  for (let k = 0; k < count; k++) {
    const first = firstAt[k];
    sums[3 * first] += normals[3 * k];
    sums[3 * first + 1] += normals[3 * k + 1];
    sums[3 * first + 2] += normals[3 * k + 2];
  }
  for (let k = 0; k < count; k++) {
    const first = firstAt[k],
      x = sums[3 * first],
      y = sums[3 * first + 1],
      z = sums[3 * first + 2],
      length = Math.hypot(x, y, z) || 1;
    out[3 * k] = x / length;
    out[3 * k + 1] = y / length;
    out[3 * k + 2] = z / length;
  }
  return out;
}

// The edges the pen look draws on a shape, as segments (x0, y0, z0, x1, y1, z1, and the mean normal of the faces that
// meet there nx, ny, nz, so an edge facing the light can be drawn lighter, …): where two faces meet at more than
// `angle` degrees (a box's corners, a step in a lathe's profile, a blade's rim) and where a surface ends (an open tube's
// rim). A curved surface is many faces at small angles, so it has none; a sphere has none at all. Triangles in the
// index ranges `soft` are left out.
function edgesOf(mesh, angle = 40, soft = []) {
  const firstAt = weld(mesh),
    positions = mesh.positions,
    indices = mesh.indices,
    cosLimit = Math.cos(angle * D2R),
    seen = new Map(), // an edge (its two welded ends) → [the first face's normal, how many faces, sharp]
    out = [];
  for (let t = 0; t < indices.length; t += 3) {
    if (soft.some(([start, end]) => t >= start && t < end)) continue; // (triangles of soft shapes: no edges)
    const corners = [firstAt[indices[t]], firstAt[indices[t + 1]], firstAt[indices[t + 2]]];
    if (corners[0] === corners[1] || corners[1] === corners[2] || corners[0] === corners[2]) continue; // a sliver at a pole: no face
    const corner0 = [positions[3 * corners[0]], positions[3 * corners[0] + 1], positions[3 * corners[0] + 2]],
      normal = cross(
        sub([positions[3 * corners[1]], positions[3 * corners[1] + 1], positions[3 * corners[1] + 2]], corner0),
        sub([positions[3 * corners[2]], positions[3 * corners[2] + 1], positions[3 * corners[2] + 2]], corner0),
      ),
      length = len(normal);
    if (length < 1e-12) continue;
    for (let j = 0; j < 3; j++) {
      const a = corners[j],
        b = corners[(j + 1) % 3],
        key = a < b ? a * 4294967296 + b : b * 4294967296 + a,
        entry = seen.get(key),
        unit = mulv(normal, 1 / length);
      if (!entry) seen.set(key, [unit, 1, false, unit]);
      else {
        entry[1]++;
        if (dot(entry[0], unit) < cosLimit) entry[2] = true;
        entry[3] = add(entry[3], unit);
      }
    }
  }
  for (const [key, entry] of seen)
    if (entry[1] !== 2 || entry[2]) {
      const a = Math.floor(key / 4294967296),
        b = key - a * 4294967296;
      out.push(
        positions[3 * a],
        positions[3 * a + 1],
        positions[3 * a + 2],
        positions[3 * b],
        positions[3 * b + 1],
        positions[3 * b + 2],
        ...norm(entry[3]),
      );
    }
  return new Float32Array(out);
}

// The bounding box of a geometry seen through a matrix.
function bounds(mesh, m) {
  const min = [1e9, 1e9, 1e9],
    max = [-1e9, -1e9, -1e9];
  for (let k = 0; k < mesh.count; k++) {
    const point = m
      ? M.pt(m, [mesh.positions[3 * k], mesh.positions[3 * k + 1], mesh.positions[3 * k + 2]])
      : [mesh.positions[3 * k], mesh.positions[3 * k + 1], mesh.positions[3 * k + 2]];
    for (let axis = 0; axis < 3; axis++) {
      if (point[axis] < min[axis]) min[axis] = point[axis];
      if (point[axis] > max[axis]) max[axis] = point[axis];
    }
  }
  return { min, max };
}

const MATERIALS = {
  // [metalness, roughness, wrap: light reaching round into the shade, as through soft tissue]
  metal: [0.9, 0.35],
  steel: [0.85, 0.45],
  copper: [0.95, 0.3],
  gold: [1, 0.25],
  plastic: [0, 0.5],
  rubber: [0, 0.9],
  paint: [0.1, 0.4],
  glass: [0, 0.05],
  magnet: [0.2, 0.45],
  matte: [0, 0.8],
  wood: [0, 0.7],
  tissue: [0, 0.6, 0.5],
  membrane: [0, 0.5, 0.4],
  skin: [0, 0.55, 0.45],
  bone: [0, 0.65, 0.15],
  rock: [0, 0.9],
  soil: [0, 0.95],
  ice: [0, 0.15, 0.2],
  water: [0.02, 0.08],
  gas: [0, 0.4, 0.3],
};
// fine surface detail drawn by the studio look (WebGL 2), in the part's own coordinates: kind, and its default scale
// (bumps per unit) and strength
const SURFACES = { brushed: [1, 40], knurl: [2, 60], ribs: [3, 80], grain: [4, 6], skin: [5, 30], cast: [6, 25] };
const surface = (spec) =>
  spec && SURFACES[spec.kind]
    ? [SURFACES[spec.kind][0], spec.scale ?? SURFACES[spec.kind][1], spec.strength ?? 0.5]
    : [0, 0, 0];

// a rotation with a uniform scale (and a translation): det > 0 and three columns of one length, at right angles
function rigid(m) {
  const columns = [
      [m[0], m[1], m[2]],
      [m[4], m[5], m[6]],
      [m[8], m[9], m[10]],
    ],
    length = Math.hypot(...columns[0]),
    tolerance = 1e-6 * length;
  const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  return (
    Math.abs(Math.hypot(...columns[1]) - length) < tolerance &&
    Math.abs(Math.hypot(...columns[2]) - length) < tolerance &&
    Math.abs(dot(columns[0], columns[1])) < tolerance * length &&
    Math.abs(dot(columns[1], columns[2])) < tolerance * length &&
    Math.abs(dot(columns[0], columns[2])) < tolerance * length &&
    dot(
      [
        columns[0][1] * columns[1][2] - columns[0][2] * columns[1][1],
        columns[0][2] * columns[1][0] - columns[0][0] * columns[1][2],
        columns[0][0] * columns[1][1] - columns[0][1] * columns[1][0],
      ],
      columns[2],
    ) > 0
  );
}

// shapes whose many small folds are not edges a pen would draw: living and grown forms, models made elsewhere
const SOFT = ['model', 'blob', 'tree', 'terrain', 'scatter', 'molecule', 'dna'];

// At least how many triangles a shape makes, from its numbers alone (each count below is less than what it builds):
// a scene that would make too many is refused before any of it is built, rather than holding the page for minutes
// (seg: 1e8, or a tree of eight levels of eight branches, or one branch eight million deep)
function least(shape, quality) {
  if (!shape || typeof shape !== 'object') return 0;
  quality = detail(quality, shape.detail);
  const scatter = shape.scatter,
    turn = (spec) => Math.abs((spec.to ?? 360) - (spec.from ?? 0)) / 360, // (a sector: how much of a turn)
    around = Math.max(6, Math.round((shape.seg || 32) * quality * turn(shape))), // segments around
    terrain = shape.terrain && Math.max(6, (shape.terrain.res || 0) * quality),
    tree = shape.tree || {},
    branches = tree.branches ?? 2,
    countOf = (v) => (Array.isArray(v) ? v.length : 0);
  if (scatter) return (scatter.n || 50) * least(scatter.shape, detail(quality, scatter.detail ?? 0.5));
  return (
    (shape.repeat ? shape.repeat.n || shape.repeat : 1) *
    Math.max(
      12,
      shape.lathe
        ? 2 * around * (shape.lathe.length - 1)
        : shape.cylinder
          ? 2 * around
          : shape.sphere
            ? (around * around) / 2
            : 0,
      shape.helix ? 150 * quality * (shape.helix.turns ?? 8) : 0,
      shape.loop ? 48 * (shape.loop.turns || 1) : 0,
      terrain ? 2 * terrain * terrain : 0,
      shape.tree ? 40 * (branches === 1 ? (tree.levels ?? 3) : branches ** ((tree.levels ?? 3) - 1)) : 0,
      shape.dna ? 12 * (shape.dna.pairs || 12) : 0,
      shape.tube ? 10 * countOf(shape.tube) : 0,
      shape.shell ? 16 * 48 * quality * turn(shape.shell) : 0,
      shape.molecule
        ? 48 * countOf(shape.molecule.atoms) +
            12 *
              (Array.isArray(shape.molecule.bonds) ? shape.molecule.bonds : []).reduce(
                (sum, bond) => sum + (+bond?.[2] || 1),
                0,
              )
        : 0,
    )
  );
}
// what went wrong building at a place in the scene, said there: lk3d's own sentence, or (a scene in a form the guard
// does not know to refuse) what JavaScript said, with where to look
const failedAt = (error, where) =>
  error.triangles
    ? error
    : new Error(
        `lk3d: ${where}: ` +
          (/^lk3d/.test(error.message)
            ? error.message.replace(/^lk3d:? /, '')
            : `cannot be built (${error.message}); validate(scene) from lk3d/validate says what is wrong`),
      );

// A scene: parts, each a list of batches (one geometry, drawn at one or more placements). Shapes of a part that are not
// repeated are merged into one batch, so a part costs one draw for its plain shapes plus one per repeated shape. Which
// of a batch's triangles get edges in the pen look: `drawsEdges` (none if false), less the ranges in `soft` (the part's
// `edges`, else every shape but the soft ones). max: the most triangles the scene may have (a part, at most 2 million);
// the guard first refuses a scene not in a form it can build (guard.js).
function buildScene(spec, quality = 1, max = 1e7) {
  const problem = guard(spec)[0];
  if (problem) throw new Error(`lk3d: ${problem.path || 'the scene'}: ${problem.message}`);
  const partMax = Math.min(2e6, max),
    limit = `${words(partMax)}${max > partMax ? ` a part, ${words(max)} in all` : ''}`;
  let total = 0;
  for (const part of spec.parts) {
    const count = (part.shapes || []).reduce((sum, shape) => sum + least(shape, quality), 0);
    if (count > partMax) throw tooMany(`part ${part.id} would have at least ${Math.round(count)} triangles`, partMax);
    total += count;
  }
  if (total > max) throw tooMany(`the scene would have at least ${Math.round(total)} triangles`, limit);
  cap = max;
  room = 3 * max;
  try {
    return build(spec, quality, max, partMax);
  } finally {
    room = Infinity;
  }
}
function build(spec, quality, max, partMax) {
  // shapes alike are made once; parts alike (the same shapes, placed elsewhere) share one merged geometry, in the
  // part's own frame and placed by its matrix, so their outlines, crease shading, edges and GPU buffers are made once
  const context = { models: spec.models, cache: new Map() },
    sharedParts = new Map(),
    outlines = new WeakMap();
  // liquids and gases (fluids.js): their parts' shapes are their bodies at the start, made from their vessels
  /** @type {Map<string, any> | null} */
  let fluidShapes = null;
  try {
    fluidShapes = spec.liquids || spec.gases ? bodies(fluidsOf(spec)).shapes : null;
  } catch (e) {
    throw failedAt(e, 'vessels, liquids and gases');
  }
  let total = 0;
  const parts = spec.parts.map((given, partIndex) => {
    const part =
      fluidShapes && fluidShapes.has(given.id)
        ? { ...given, shapes: fluidShapes.get(given.id) ? [fluidShapes.get(given.id)] : [], fluid: true }
        : given;
    const placement = M.trs(part.at, part.rot, part.scale),
      keepsPlacement = rigid(placement), // (a stretched or mirrored part is baked, as its shapes are)
      baked = keepsPlacement ? M.id() : placement,
      key = keepsPlacement && !part.fluid && JSON.stringify([part.shapes, part.edges]),
      shared = key && sharedParts.get(key),
      merged = shared ? shared.mesh : new Mesh(),
      soft = shared ? shared.soft : [],
      batches = [];
    let glass = !!(part.shapes || []).length; // (made only of a model's glass: see-through glass unless it says otherwise)
    for (const [shapeIndex, shape] of (part.shapes || []).entries()) {
      let built;
      try {
        built = buildShape(shape, quality, context);
      } catch (e) {
        throw failedAt(e, `parts[${partIndex}].shapes[${shapeIndex}]`);
      }
      // (its triangles counted as it comes, before its copies are baked into the part)
      if ((total += (built.mesh.indices.length / 3) * built.placements.length) > max)
        throw tooMany(`the scene has more than ${words(max)} triangles`);
      const matrices = built.placements.map((m) => M.mul(placement, m)),
        drawsEdges = part.edges ?? !SOFT.some((kind) => kind in shape);
      glass = glass && !!built.mesh.glass;
      if (built.mesh.textures) {
        const mesh = new Mesh();
        for (const m of matrices) mesh.add(built.mesh, m);
        batches.push({ mesh, placements: [M.id()], drawsEdges });
        continue;
      } // a textured model: a batch of its own
      // copies are drawn by the GPU only when each is a rotation and a uniform scale (its shader turns normals by the
      // matrix itself); a mirrored or stretched copy is baked into the part's own geometry instead
      if (matrices.length === 1 || !matrices.every(rigid)) {
        if (shared) continue;
        const from = merged.indices.length;
        for (const m of built.placements) merged.add(built.mesh, M.mul(baked, m));
        if (!drawsEdges) soft.push([from, merged.indices.length]);
      } else batches.push({ mesh: built.mesh, placements: matrices, drawsEdges });
    }
    if (key && !shared) sharedParts.set(key, { mesh: merged, soft });
    if (merged.count)
      batches.unshift({
        mesh: merged,
        placements: [keepsPlacement ? placement : M.id()],
        drawsEdges: true,
        soft,
        dynamic: part.fluid || undefined,
      });
    let low = [1e9, 1e9, 1e9],
      high = [-1e9, -1e9, -1e9],
      triangleCount = 0,
      /** @type {number[] | null} */
      anchor = null,
      best = -1e9;
    for (const batch of batches) {
      if (!outlines.has(batch.mesh)) outlines.set(batch.mesh, outlineNormals(batch.mesh));
      batch.outlineNormals = outlines.get(batch.mesh);
      triangleCount += (batch.mesh.indices.length / 3) * batch.placements.length;
      for (const m of batch.placements) {
        const box = bounds(batch.mesh, m);
        for (let axis = 0; axis < 3; axis++) {
          low[axis] = Math.min(low[axis], box.min[axis]);
          high[axis] = Math.max(high[axis], box.max[axis]);
        }
      }
    }
    if (triangleCount > partMax) throw tooMany(`part ${part.id} has ${Math.round(triangleCount)} triangles`, partMax);
    // where its label points: given, or the top of the part near its middle (the centre of a ring is empty space)
    const middle = mulv(add(low, high), 0.5);
    for (const batch of batches)
      for (const m of batch.placements) {
        const mesh = batch.mesh,
          step = Math.max(1, Math.floor(mesh.count / 4000));
        for (let v = 0; v < mesh.count; v += step) {
          const world = M.pt(m, [mesh.positions[3 * v], mesh.positions[3 * v + 1], mesh.positions[3 * v + 2]]),
            score = world[1] - 0.35 * Math.abs(world[0] - middle[0]) - 0.35 * Math.abs(world[2] - middle[2]);
          if (score > best) {
            best = score;
            anchor = world;
          }
        }
      }
    return {
      id: part.id || 'p' + partIndex,
      name: part.name || '',
      note: part.note || '',
      group: part.group || '',
      label: part.label,
      spin: part.spin || null,
      handle: part.handle || null,
      color: rgb(part.color),
      studioColor: rgb(part.studioColor || part.color),
      metalRoughness: [...(MATERIALS[part.material || (glass ? 'glass' : 'paint')] || MATERIALS.paint), 0].slice(0, 3),
      material: part.material || (glass ? 'glass' : 'paint'),
      surfaceDetail: surface(part.surface),
      refract: part.refract || 0,
      alpha: part.opacity ?? (glass ? 0.35 : 1),
      xray: !!part.xray,
      accent: !!part.accent,
      cut: part.cut !== false, // (false: whole when the model is cut open: a stand, a frame)
      explode: part.explode || [0, 0, 0],
      offset: [0, 0, 0],
      batches,
      min: low,
      max: high,
      center: middle,
      triangleCount,
      anchor: Array.isArray(part.label) ? part.label : anchor || middle,
      hidden: !!part.hidden,
      hiddenByScene: !!part.hidden, // (what the scene itself hides: set({hide}) adds to it)
      fluid: !!part.fluid, // (a liquid's or a gas's body: its shape changes as it flows, drains or is heated)
      emission: [0, 0, 0],
      glowColor: rgb(part.glow || '#ffcf6a'),
      index: partIndex,
    };
  });
  let low = [1e9, 1e9, 1e9],
    high = [-1e9, -1e9, -1e9];
  for (const part of parts)
    for (let axis = 0; axis < 3; axis++) {
      low[axis] = Math.min(low[axis], part.min[axis]);
      high[axis] = Math.max(high[axis], part.max[axis]);
    }
  return {
    parts,
    min: low,
    max: high,
    center: mulv(add(low, high), 0.5),
    radius: len(sub(high, low)) / 2 || 1,
    quality,
  };
}
// A scene built for a device: at the detail asked, else coarser (down to a quarter of it) where that would pass the
// device's limit, else refused (its quality: the detail it was built at)
function buildFitting(spec, quality, max) {
  for (;;)
    try {
      return buildScene(spec, quality, max);
    } catch (e) {
      if (!e.triangles || quality < 0.3) throw e;
      quality /= 2;
    }
}

// For tests and tools: a part as one plain geometry, every instance placed (what v1 drew).
function flatten(part) {
  const mesh = new Mesh();
  for (const batch of part.batches) for (const m of batch.placements) mesh.add(batch.mesh, m);
  return mesh;
}

export {
  Mesh,
  SHAPES,
  buildShape,
  buildScene,
  buildFitting,
  least,
  flatten,
  outlineNormals,
  edgesOf,
  isClosed,
  bounds,
  MATERIALS,
  SURFACES,
};
