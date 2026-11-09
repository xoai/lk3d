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
const toLinear = (value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4); // (glTF's colours are linear)

// a rigid matrix (column-major) as translation and rotation (a unit quaternion); null when it scales or shears
export function trs(m) {
  const columnLength = (k) => Math.hypot(m[4 * k], m[4 * k + 1], m[4 * k + 2]);
  if ([0, 1, 2].some((k) => Math.abs(columnLength(k) - 1) > 1e-4)) return null;
  const [a, b, c, , d, e, f, , g, h, i] = m,
    trace = a + e + i;
  let quaternion;
  if (trace > 0) {
    const factor = Math.sqrt(trace + 1) * 2;
    quaternion = [(f - h) / factor, (g - c) / factor, (b - d) / factor, factor / 4];
  } else if (a > e && a > i) {
    const factor = Math.sqrt(1 + a - e - i) * 2;
    quaternion = [factor / 4, (b + d) / factor, (g + c) / factor, (f - h) / factor];
  } else if (e > i) {
    const factor = Math.sqrt(1 + e - a - i) * 2;
    quaternion = [(b + d) / factor, factor / 4, (f + h) / factor, (g - c) / factor];
  } else {
    const factor = Math.sqrt(1 + i - a - e) * 2;
    quaternion = [(g + c) / factor, (f + h) / factor, factor / 4, (b - d) / factor];
  }
  const length = Math.hypot(...quaternion);
  return { translation: [m[12], m[13], m[14]], rotation: quaternion.map((component) => component / length) };
}

// built: the built scene (buildScene); options.matrix(part): where each part is now (default: as drawn);
// options.animations: [{ name, times: [s, …], matrix(part, k): the part's matrix at the k-th time }]; options.unit,
// options.title, options.author and options.license (glTF's copyright: "© author, licence"); options.flatten:
// geometry.js's flatten, passed in, so the exporter's own script (export-script.js) carries no second copy of the
// shapes. → the .glb's bytes
export function toGLB(built, options = {}) {
  const chunks = [],
    bufferViews = [],
    accessors = [],
    meshes = [],
    materials = [],
    nodes = [],
    animations = [];
  let binaryLength = 0;
  const addView = (typed, target) => {
    while (binaryLength % 4) {
      chunks.push(new Uint8Array(1));
      binaryLength++;
    }
    const bytes = new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength);
    chunks.push(bytes);
    bufferViews.push({ buffer: 0, byteOffset: binaryLength, byteLength: bytes.byteLength, ...(target && { target }) });
    binaryLength += bytes.byteLength;
    return bufferViews.length - 1;
  };
  const addAccessor = (typed, type, extra = {}) => {
    const components = { SCALAR: 1, VEC3: 3, VEC4: 4 }[type],
      componentType = typed instanceof Float32Array ? 5126 : typed instanceof Uint32Array ? 5125 : 5123;
    accessors.push({
      bufferView: addView(typed, extra.target),
      componentType,
      count: typed.length / components,
      type,
      ...extra.minMax,
    });
    return accessors.length - 1;
  };
  const bounds = (values, components) => {
    const min = Array(components).fill(Infinity),
      max = Array(components).fill(-Infinity);
    for (let k = 0; k < values.length; k++) {
      min[k % components] = Math.min(min[k % components], values[k]);
      max[k % components] = Math.max(max[k % components], values[k]);
    }
    return { min, max };
  };
  const place = (node, matrix) => {
    const pose = trs(matrix);
    if (!pose) node.matrix = Array.from(matrix);
    else {
      if (pose.translation.some((value) => Math.abs(value) > 1e-7)) node.translation = pose.translation;
      if (Math.abs(pose.rotation[3]) < 1 - 1e-7) node.rotation = pose.rotation;
    }
  };
  const nodeIndexOf = new Map();
  for (const part of built.parts) {
    if (part.hidden || !part.batches.length) continue;
    const mesh = options.flatten(part);
    if (!mesh.count) continue;
    const positions = new Float32Array(mesh.positions),
      normals = new Float32Array(mesh.normals),
      indices = mesh.count > 65535 ? new Uint32Array(mesh.indices) : new Uint16Array(mesh.indices);
    const baseColor = part.studioColor.map(toLinear);
    const attributes = {
      POSITION: addAccessor(positions, 'VEC3', { target: 34962, minMax: bounds(positions, 3) }),
      NORMAL: addAccessor(normals, 'VEC3', { target: 34962 }),
    };
    if (mesh.colors) {
      // (a vertex's own colour where it has one, over the part's: as the engine mixes them)
      const colors = new Float32Array(mesh.count * 4);
      for (let vertex = 0; vertex < mesh.count; vertex++) {
        const alpha = mesh.colors[4 * vertex + 3] / 255;
        for (let k = 0; k < 3; k++)
          colors[4 * vertex + k] = baseColor[k] + (toLinear(mesh.colors[4 * vertex + k] / 255) - baseColor[k]) * alpha;
        colors[4 * vertex + 3] = 1;
      }
      attributes.COLOR_0 = addAccessor(colors, 'VEC4', { target: 34962 });
    }
    materials.push({
      name: part.name || part.id,
      pbrMetallicRoughness: {
        baseColorFactor: [...(mesh.colors ? [1, 1, 1] : baseColor), part.alpha],
        metallicFactor: part.metalRoughness[0],
        roughnessFactor: part.metalRoughness[1],
      },
      ...(part.alpha < 1 && { alphaMode: 'BLEND' }),
      doubleSided: true, // (an open shell, a membrane: seen from both sides, as the engine draws them)
    });
    meshes.push({
      name: part.name || part.id,
      primitives: [
        { attributes, indices: addAccessor(indices, 'SCALAR', { target: 34963 }), material: materials.length - 1 },
      ],
    });
    const node = {
      name: part.name || part.id,
      mesh: meshes.length - 1,
      extras: { lk3d: { id: part.id, ...(part.note && { note: part.note }) } },
    };
    if (options.matrix) place(node, options.matrix(part));
    nodes.push(node);
    nodeIndexOf.set(part, nodes.length - 1);
  }
  // motions: a sampler per part and path (translation, rotation) that changes along the times
  for (const animation of options.animations || []) {
    const times = new Float32Array(animation.times),
      channels = [],
      samplers = [];
    /** @type {number | null} */
    let input = null;
    for (const [part, nodeIndex] of nodeIndexOf) {
      const poses = animation.times.map((_, k) => trs(animation.matrix(part, k)));
      if (poses.some((pose) => !pose)) continue;
      const moves = (path) =>
        poses.some((pose) => pose[path].some((value, i) => Math.abs(value - poses[0][path][i]) > 1e-6));
      // (a quaternion and its negation are one turn: kept on one side, so the turn in between is the short way)
      for (let k = 1; k < poses.length; k++)
        if (poses[k].rotation.reduce((dot, value, i) => dot + value * poses[k - 1].rotation[i], 0) < 0)
          poses[k].rotation = poses[k].rotation.map((value) => -value);
      for (const [path, type] of [
        ['translation', 'VEC3'],
        ['rotation', 'VEC4'],
      ]) {
        if (!moves(path)) continue;
        if (input == null)
          input = addAccessor(times, 'SCALAR', { minMax: { min: [times[0]], max: [times[times.length - 1]] } });
        samplers.push({
          input,
          output: addAccessor(new Float32Array(poses.flatMap((pose) => pose[path])), type),
          interpolation: 'LINEAR',
        });
        channels.push({ sampler: samplers.length - 1, target: { node: nodeIndex, path } });
      }
    }
    if (channels.length) animations.push({ name: animation.name, channels, samplers });
  }
  const scale = UNIT[options.unit] ?? 1;
  nodes.push({
    name: options.title || 'lk3d',
    children: nodes.map((_, i) => i),
    ...(scale !== 1 && { scale: [scale, scale, scale] }),
  });
  const json = {
    asset: {
      version: '2.0',
      generator: 'lk3d',
      ...((options.author || options.license) && {
        copyright: [options.author && '© ' + options.author, options.license].filter(Boolean).join(', '),
      }),
    },
    scene: 0,
    scenes: [{ name: options.title || 'lk3d', nodes: [nodes.length - 1] }],
    nodes,
    meshes,
    materials,
    accessors,
    bufferViews,
    buffers: [{ byteLength: binaryLength + ((4 - (binaryLength % 4)) % 4) }],
    ...(animations.length && { animations }),
  };
  // the container: a 12-byte header, the JSON chunk (padded with spaces) and the binary chunk (padded with zeros)
  const text = new TextEncoder().encode(JSON.stringify(json)),
    jsonLength = text.length + ((4 - (text.length % 4)) % 4),
    binLength = json.buffers[0].byteLength,
    out = new Uint8Array(12 + 8 + jsonLength + 8 + binLength),
    data = new DataView(out.buffer);
  data.setUint32(0, 0x46546c67, true);
  data.setUint32(4, 2, true);
  data.setUint32(8, out.length, true);
  data.setUint32(12, jsonLength, true);
  data.setUint32(16, 0x4e4f534a, true);
  out.set(text, 20);
  out.fill(0x20, 20 + text.length, 20 + jsonLength);
  data.setUint32(20 + jsonLength, binLength, true);
  data.setUint32(24 + jsonLength, 0x004e4942, true);
  let offset = 28 + jsonLength;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

// a scene (data) straight to .glb, without a page (lk3d export, tools): posed at the motions' values (options.motion,
// else their starts) and the joints' (options.joints); options.animate: each motion as an animation, options.samples
// poses along its range
export function sceneToGLB(spec, options = {}) {
  const built = buildScene(spec, options.quality ?? 1),
    motions = spec.motions || [],
    joints = jointsOf(spec);
  for (const part of built.parts) {
    part.tracks = tracksOf(motions, part);
    part.joint = jointOf(joints, part);
  }
  const poseAt = (values) => {
    const pose = joints && solve(joints, motions, values, options.joints || {});
    return (part) => {
      let matrix = M.mul(M.trans(part.offset), motionMatrix(part.tracks, values));
      if (part.joint && pose) matrix = M.mul(matrix, pose.matrix.get(part.joint.id));
      return matrix;
    };
  };
  const now = { ...options.motion };
  const animations = !options.animate
    ? []
    : motions.map((motion) => {
        const [start, end] = motion.range,
          sampleCount = options.samples ?? 120,
          seconds = (end - start) / (motion.speed ?? end - start),
          poses = Array.from({ length: sampleCount + 1 }, (_, k) =>
            poseAt({ ...now, [motion.id]: start + ((end - start) * k) / sampleCount }),
          );
        return {
          name: motion.name || motion.id,
          times: poses.map((_, k) => (seconds * k) / sampleCount),
          matrix: (part, k) => poses[k](part),
        };
      });
  return toGLB(built, {
    matrix: poseAt(now),
    animations,
    unit: spec.unit,
    title: spec.title,
    author: spec.author,
    license: spec.license,
    flatten,
  });
}
