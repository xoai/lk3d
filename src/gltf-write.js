// Writing a figure out as glTF 2.0 binary (.glb), for Blender, a game engine, a 3D viewer or a slide: each part a node
// with its mesh (positions, normals, its vertex colours) and a material (its studio colour, the metalness and roughness
// of its material, see-through when it is), named as the scene names it (its id and note under extras.lk3d), posed as
// the figure is now; and, when asked, each motion as an animation of the parts it moves (joints and keys both), sampled
// along its range at its speed. One root node holds the parts, scaled from the scene's unit to metres (glTF's).
// Not written: textures (a textured model keeps its geometry and base colour), lines, labels, liquids' flow.
import { flatten, buildScene } from './geometry.js';
import { M } from './math.js';
import { tracksOf, motionMatrix } from './motion.js';
import { jointsOf, jointOf, solve } from './joints.js';

const UNIT = { mm: 0.001, cm: 0.01, dm: 0.1, m: 1, km: 1000 };
const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4); // (glTF's colours are linear)

// a rigid matrix (column-major) as translation and rotation (a unit quaternion); null when it scales or shears
export function trs(m) {
  const col = (k) => Math.hypot(m[4 * k], m[4 * k + 1], m[4 * k + 2]);
  if ([0, 1, 2].some((k) => Math.abs(col(k) - 1) > 1e-4)) return null;
  const [a, b, c, , d, e, f, , g, h, i] = m,
    tr = a + e + i;
  let q;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    q = [(f - h) / s, (g - c) / s, (b - d) / s, s / 4];
  } else if (a > e && a > i) {
    const s = Math.sqrt(1 + a - e - i) * 2;
    q = [s / 4, (b + d) / s, (g + c) / s, (f - h) / s];
  } else if (e > i) {
    const s = Math.sqrt(1 + e - a - i) * 2;
    q = [(b + d) / s, s / 4, (f + h) / s, (g - c) / s];
  } else {
    const s = Math.sqrt(1 + i - a - e) * 2;
    q = [(g + c) / s, (f + h) / s, s / 4, (b - d) / s];
  }
  const n = Math.hypot(...q);
  return { t: [m[12], m[13], m[14]], r: q.map((x) => x / n) };
}

// S: the built scene (buildScene); o.matrix(p): where each part is now (default: as drawn); o.animations: [{ name,
// times: [s, …], matrix(p, k): the part's matrix at the k-th time }]; o.unit, o.title; o.flatten: geometry.js's flatten,
// passed in, so the exporter's own script (export-script.js) carries no second copy of the shapes. → the .glb's bytes
export function toGLB(S, o = {}) {
  const chunks = [],
    views = [],
    accessors = [],
    meshes = [],
    materials = [],
    nodes = [],
    animations = [];
  let size = 0;
  const view = (typed, target) => {
    while (size % 4) {
      chunks.push(new Uint8Array(1));
      size++;
    }
    const u8 = new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength);
    chunks.push(u8);
    views.push({ buffer: 0, byteOffset: size, byteLength: u8.byteLength, ...(target && { target }) });
    size += u8.byteLength;
    return views.length - 1;
  };
  const acc = (typed, type, extra = {}) => {
    const n = { SCALAR: 1, VEC3: 3, VEC4: 4 }[type],
      ct = typed instanceof Float32Array ? 5126 : typed instanceof Uint32Array ? 5125 : 5123;
    accessors.push({
      bufferView: view(typed, extra.target),
      componentType: ct,
      count: typed.length / n,
      type,
      ...extra.a,
    });
    return accessors.length - 1;
  };
  const bounds = (f, n) => {
    const lo = Array(n).fill(Infinity),
      hi = Array(n).fill(-Infinity);
    for (let k = 0; k < f.length; k++) {
      lo[k % n] = Math.min(lo[k % n], f[k]);
      hi[k % n] = Math.max(hi[k % n], f[k]);
    }
    return { min: lo, max: hi };
  };
  const place = (node, m) => {
    const x = trs(m);
    if (!x) node.matrix = Array.from(m);
    else {
      if (x.t.some((v) => Math.abs(v) > 1e-7)) node.translation = x.t;
      if (Math.abs(x.r[3]) < 1 - 1e-7) node.rotation = x.r;
    }
  };
  const nodeOf = new Map();
  for (const p of S.parts) {
    if (p.hidden || !p.batches.length) continue;
    const g = o.flatten(p);
    if (!g.count) continue;
    const pos = new Float32Array(g.p),
      nrm = new Float32Array(g.n),
      idx = g.count > 65535 ? new Uint32Array(g.i) : new Uint16Array(g.i);
    const base = p.studioColor.map(lin);
    const attributes = {
      POSITION: acc(pos, 'VEC3', { target: 34962, a: bounds(pos, 3) }),
      NORMAL: acc(nrm, 'VEC3', { target: 34962 }),
    };
    if (g.c) {
      // (a vertex's own colour where it has one, over the part's: as the engine mixes them)
      const col = new Float32Array(g.count * 4);
      for (let v = 0; v < g.count; v++) {
        const a = g.c[4 * v + 3] / 255;
        for (let k = 0; k < 3; k++) col[4 * v + k] = base[k] + (lin(g.c[4 * v + k] / 255) - base[k]) * a;
        col[4 * v + 3] = 1;
      }
      attributes.COLOR_0 = acc(col, 'VEC4', { target: 34962 });
    }
    materials.push({
      name: p.name || p.id,
      pbrMetallicRoughness: {
        baseColorFactor: [...(g.c ? [1, 1, 1] : base), p.alpha],
        metallicFactor: p.mat[0],
        roughnessFactor: p.mat[1],
      },
      ...(p.alpha < 1 && { alphaMode: 'BLEND' }),
      doubleSided: true, // (an open shell, a membrane: seen from both sides, as the engine draws them)
    });
    meshes.push({
      name: p.name || p.id,
      primitives: [{ attributes, indices: acc(idx, 'SCALAR', { target: 34963 }), material: materials.length - 1 }],
    });
    const node = {
      name: p.name || p.id,
      mesh: meshes.length - 1,
      extras: { lk3d: { id: p.id, ...(p.note && { note: p.note }) } },
    };
    if (o.matrix) place(node, o.matrix(p));
    nodes.push(node);
    nodeOf.set(p, nodes.length - 1);
  }
  // motions: a sampler per part and path (translation, rotation) that changes along the times
  for (const an of o.animations || []) {
    const times = new Float32Array(an.times),
      channels = [],
      samplers = [];
    let input = null;
    for (const [p, n] of nodeOf) {
      const poses = an.times.map((_, k) => trs(an.matrix(p, k)));
      if (poses.some((x) => !x)) continue;
      const moves = (f) => poses.some((x) => x[f].some((v, i) => Math.abs(v - poses[0][f][i]) > 1e-6));
      // (a quaternion and its negation are one turn: kept on one side, so the turn in between is the short way)
      for (let k = 1; k < poses.length; k++)
        if (poses[k].r.reduce((s, v, i) => s + v * poses[k - 1].r[i], 0) < 0) poses[k].r = poses[k].r.map((v) => -v);
      for (const [f, path, type] of [
        ['t', 'translation', 'VEC3'],
        ['r', 'rotation', 'VEC4'],
      ]) {
        if (!moves(f)) continue;
        if (input == null) input = acc(times, 'SCALAR', { a: { min: [times[0]], max: [times[times.length - 1]] } });
        samplers.push({
          input,
          output: acc(new Float32Array(poses.flatMap((x) => x[f])), type),
          interpolation: 'LINEAR',
        });
        channels.push({ sampler: samplers.length - 1, target: { node: n, path } });
      }
    }
    if (channels.length) animations.push({ name: an.name, channels, samplers });
  }
  const k = UNIT[o.unit] ?? 1;
  nodes.push({ name: o.title || 'lk3d', children: nodes.map((_, i) => i), ...(k !== 1 && { scale: [k, k, k] }) });
  const json = {
    asset: { version: '2.0', generator: 'lk3d' },
    scene: 0,
    scenes: [{ name: o.title || 'lk3d', nodes: [nodes.length - 1] }],
    nodes,
    meshes,
    materials,
    accessors,
    bufferViews: views,
    buffers: [{ byteLength: size + ((4 - (size % 4)) % 4) }],
    ...(animations.length && { animations }),
  };
  // the container: a 12-byte header, the JSON chunk (padded with spaces) and the binary chunk (padded with zeros)
  const text = new TextEncoder().encode(JSON.stringify(json)),
    jl = text.length + ((4 - (text.length % 4)) % 4),
    bl = json.buffers[0].byteLength,
    out = new Uint8Array(12 + 8 + jl + 8 + bl),
    dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true);
  dv.setUint32(4, 2, true);
  dv.setUint32(8, out.length, true);
  dv.setUint32(12, jl, true);
  dv.setUint32(16, 0x4e4f534a, true);
  out.set(text, 20);
  out.fill(0x20, 20 + text.length, 20 + jl);
  dv.setUint32(20 + jl, bl, true);
  dv.setUint32(24 + jl, 0x004e4942, true);
  let at = 28 + jl;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

// a scene (data) straight to .glb, without a page (lk3d export, tools): posed at the motions' values (o.motion, else
// their starts) and the joints' (o.joints); o.animate: each motion as an animation, o.samples poses along its range
export function sceneToGLB(spec, o = {}) {
  const S = buildScene(spec, o.quality ?? 1),
    motions = spec.motions || [],
    J = jointsOf(spec);
  for (const p of S.parts) {
    p.tracks = tracksOf(motions, p);
    p.joint = jointOf(J, p);
  }
  const at = (values) => {
    const pose = J && solve(J, motions, values, o.joints || {});
    return (p) => {
      let m = M.mul(M.trans(p.offset), motionMatrix(p.tracks, values));
      if (p.joint) m = M.mul(m, pose.matrix.get(p.joint.id));
      return m;
    };
  };
  const now = { ...o.motion };
  const animations = !o.animate
    ? []
    : motions.map((mo) => {
        const [a, b] = mo.range,
          n = o.samples ?? 120,
          secs = (b - a) / (mo.speed ?? b - a),
          poses = Array.from({ length: n + 1 }, (_, k) => at({ ...now, [mo.id]: a + ((b - a) * k) / n }));
        return { name: mo.name || mo.id, times: poses.map((_, k) => (secs * k) / n), matrix: (p, k) => poses[k](p) };
      });
  return toGLB(S, { matrix: at(now), animations, unit: spec.unit, title: spec.title, flatten });
}
