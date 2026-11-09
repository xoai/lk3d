// Reading a 3D model made elsewhere (glTF 2.0 binary, .glb): a heart, a skull, a scanned fossil — forms that generated
// shapes cannot draw faithfully. Prepare the file beforehand (simplified and quantized, e.g. with gltfpack; lessonkit's
// ./lk model add does it) and give it to the scene as base64, so it is read synchronously: no network, no decoder.
// Supported: triangle meshes, node transforms (TRS or matrix), positions/normals in any component type (quantized,
// normalized or float: KHR_mesh_quantization), indices, COLOR_0, materials' base colours, and the textures of one
// material: TEXCOORD_0 (KHR_texture_transform applied), base colour, normal and metallic-roughness maps, as embedded
// WebP, PNG or JPEG images (the renderer decodes them); cut-outs (alphaMode), double-sided surfaces, and glass
// (KHR_materials_transmission, tinted by KHR_materials_volume). Not: skins, morph targets, sparse accessors, KTX2/Basis
// textures, meshopt or Draco compression (refused with a message).
// A file may come from anyone: what it says is checked before it is used (indices, offsets and lengths inside the
// file, counts against the bytes there and the scene's triangle limit, nodes a tree, numbers finite, images' sizes),
// so a damaged or hostile file is refused with a sentence, at once, without large allocations. Nothing is fetched: a
// file that points outside itself (a .bin, an image's uri) is refused.
import { M, sub, cross, norm, add } from './math.js';

const SIZE = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const READ = {
  5120: ['getInt8', 1, 127],
  5121: ['getUint8', 1, 255],
  5122: ['getInt16', 2, 32767],
  5123: ['getUint16', 2, 65535],
  5125: ['getUint32', 4, 0],
  5126: ['getFloat32', 4, 0],
};
const OUTSIDE =
  'its data and images must be inside the .glb (a .gltf with separate files can be packed into one, e.g. with gltfpack)';
const IMAGE_SIDE = 8192; // the most pixels an image may have a side (decoded, 8192² is 256 MB)

const fail = (message) => {
  throw new Error('lk3d model: ' + message);
};
// one of the file's lists (none: empty), and an item of it by its index: there, or the file is refused
const list = (object, key) =>
  object[key] == null ? [] : Array.isArray(object[key]) ? object[key] : fail(key + ' should be a list');
const item = (json, key, index) => {
  const entry = list(json, key)[index];
  return Number.isInteger(index) && entry && typeof entry === 'object'
    ? entry
    : fail(`${key}[${index}] is not in the file`);
};
const numbers = (value, count, what) =>
  Array.isArray(value) && value.length >= count && value.every(Number.isFinite)
    ? value
    : fail(`${what} should be ${count} numbers`);

function bytes(b64) {
  const refuse = () => fail('its data should be the .glb as base64');
  if (typeof b64 !== 'string') refuse();
  if (typeof atob === 'function') {
    let binary;
    try {
      binary = atob(b64);
    } catch {
      refuse();
    }
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  }
  return new Uint8Array(globalThis.Buffer.from(b64, 'base64')); // (Node, for tools and tests)
}
// the JSON and binary chunks of a .glb
function parseGLB(file) {
  const data = new DataView(file.buffer, file.byteOffset, file.byteLength);
  if (file.byteLength < 20 || data.getUint32(0, true) !== 0x46546c67 || data.getUint32(4, true) !== 2)
    fail('not a .glb file (glTF 2.0)');
  const end = data.getUint32(8, true),
    cutShort = () => fail('the file is cut short');
  if (end > file.byteLength) cutShort();
  let offset = 12,
    json = null,
    bin = null;
  while (offset + 8 <= end) {
    const chunkLength = data.getUint32(offset, true),
      type = data.getUint32(offset + 4, true),
      body = offset + 8 + chunkLength <= end ? file.subarray(offset + 8, offset + 8 + chunkLength) : cutShort();
    if (type === 0x4e4f534a && !json)
      try {
        json = JSON.parse(new TextDecoder().decode(body));
      } catch {
        fail('its JSON cannot be read');
      }
    else if (type === 0x004e4942 && !bin) bin = body;
    offset += 8 + chunkLength;
  }
  if (!json || typeof json !== 'object' || Array.isArray(json)) fail('it has no glTF JSON');
  for (const extension of list(json, 'extensionsRequired')) {
    if (
      !['KHR_mesh_quantization', 'KHR_materials_unlit', 'KHR_texture_transform', 'EXT_texture_webp'].includes(extension)
    )
      fail(
        `${extension} is not supported (write it without: gltfpack does by default, and glTF-Transform can decompress Draco meshes first)`,
      );
  }
  return { json, bin: bin || new Uint8Array(0) };
}
// a buffer view, as its place in the binary chunk (the only buffer: a file that points to another is refused)
function view(json, bin, index) {
  const bufferView = item(json, 'bufferViews', index),
    offset = +(bufferView.byteOffset || 0), // (numbers, whatever the file wrote: an offset of [] or "8" would otherwise join as text)
    length = +bufferView.byteLength;
  if (bufferView.buffer || (list(json, 'buffers')[0] || {}).uri != null) fail(OUTSIDE);
  if (!(offset >= 0 && length >= 0 && offset + length <= bin.length) || offset % 1 || length % 1)
    fail(`bufferViews[${index}] lies outside its data`);
  return { offset, length, stride: +bufferView.byteStride };
}
// an accessor's values as plain numbers, normalized ones mapped to -1..1 or 0..1 (of a type other than the one expected,
// it reads as numbers all the same: what they make is wrong, not unsafe)
function accessor(json, bin, index) {
  const entry = item(json, 'accessors', index),
    components = SIZE[entry.type],
    reader = READ[entry.componentType],
    count = +entry.count;
  const refuse = (why) => fail(`accessors[${index}] ${why}`);
  if (entry.sparse) fail('sparse accessors are not supported');
  if (!components || !reader || !(count >= 0) || count % 1 || entry.bufferView == null) refuse('is not one lk3d reads');
  const bufferView = view(json, bin, entry.bufferView),
    [getter, componentBytes, normalizeBy] = reader,
    stride = bufferView.stride || components * componentBytes,
    start = bufferView.offset + +(entry.byteOffset || 0);
  // (its last value inside its view: so its count is no more than the bytes there allow, before anything is made)
  if (
    !(stride >= components * componentBytes && stride <= 252 && start >= bufferView.offset) ||
    stride % 1 ||
    start % 1
  )
    refuse('has a wrong stride or offset');
  if (count && start + (count - 1) * stride + components * componentBytes > bufferView.offset + bufferView.length)
    refuse('reads past its data');
  const data = new DataView(bin.buffer, bin.byteOffset, bin.byteLength),
    out = new Float64Array(count * components);
  for (let k = 0; k < count; k++)
    for (let component = 0; component < components; component++) {
      let value = data[getter](start + k * stride + component * componentBytes, true);
      if (entry.normalized && normalizeBy) value = Math.max(value / normalizeBy, -1);
      else if (!Number.isFinite(value)) refuse('holds a number that is not finite');
      out[k * components + component] = value;
    }
  return { data: out, components, count };
}
const trsMatrix = (node) => {
  if (node.matrix != null) return numbers(node.matrix, 16, 'a node matrix').slice(0, 16);
  const [x, y, z, w] = node.rotation == null ? [0, 0, 0, 1] : numbers(node.rotation, 4, 'a node rotation');
  const rotation = [
    1 - 2 * (y * y + z * z),
    2 * (x * y + z * w),
    2 * (x * z - y * w),
    0,
    2 * (x * y - z * w),
    1 - 2 * (x * x + z * z),
    2 * (y * z + x * w),
    0,
    2 * (x * z + y * w),
    2 * (y * z - x * w),
    1 - 2 * (x * x + y * y),
    0,
    0,
    0,
    0,
    1,
  ];
  return M.mul(M.trans(node.translation || [0, 0, 0]), M.mul(rotation, M.scale(node.scale || [1, 1, 1])));
};
// the size an embedded image says it is (PNG, JPEG, WebP), or null where its header cannot be read (the browser then
// decides: an image it cannot decode leaves the part its colour)
function dims(data) {
  const readInt = (offset, length, littleEndian) => {
    let value = 0;
    for (let i = 0; i < length; i++) value += data[offset + i] * 256 ** (littleEndian ? i : length - 1 - i);
    return value;
  };
  if (data.length < 30) return null;
  if (data[0] === 0x89 && data[1] === 0x50) return [readInt(16, 4), readInt(20, 4)];
  if (data[0] === 0x52 && data[8] === 0x57) {
    const chunkType = String.fromCharCode(data[12], data[13], data[14], data[15]);
    if (chunkType === 'VP8X') return [1 + readInt(24, 3, 1), 1 + readInt(27, 3, 1)];
    if (chunkType === 'VP8L') return [1 + (readInt(21, 2, 1) & 0x3fff), 1 + ((readInt(22, 3, 1) >> 6) & 0x3fff)];
    if (chunkType === 'VP8 ') return [readInt(26, 2, 1) & 0x3fff, readInt(28, 2, 1) & 0x3fff];
  }
  if (data[0] === 0xff && data[1] === 0xd8)
    for (let offset = 2; offset + 9 < data.length;) {
      const marker = data[offset + 1];
      if (data[offset] !== 0xff) return null;
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc)
        return [readInt(offset + 7, 2), readInt(offset + 5, 2)];
      offset += marker === 0xff ? 1 : 2 + readInt(offset + 2, 2);
    }
  return null;
}

// The model's names (nodes and meshes), to map to the parts of a scene
function names(b64) {
  const { json } = parseGLB(bytes(b64)),
    named = (key) =>
      list(json, key)
        .map((entry) => entry && entry.name)
        .filter((name) => typeof name === 'string' && name);
  return { nodes: named('nodes'), meshes: named('meshes') };
}

// The geometry of a model, or of one of its nodes (with everything under it), as a Mesh in the model's units. Mesh.fits(n)
// refuses n more triangles past the scene's limit (geometry.js), asked before a primitive's values are read.
function load(Mesh, b64, only) {
  const { json, bin } = typeof b64 === 'string' ? parseGLB(bytes(b64)) : b64, // (or a file already read: parseGLB's)
    model = new Mesh(),
    nodes = list(json, 'nodes');
  const scene =
    json.scene != null || list(json, 'scenes').length
      ? item(json, 'scenes', json.scene || 0)
      : { nodes: nodes.map((_, i) => i) };
  let found = !only;
  // the nodes, depth first in the file's order, without recursion (a chain of nodes as deep as the file is long) and
  // each once (glTF's nodes are trees: a node reached twice is a loop, or has two parents)
  const seen = new Set(),
    stack = list(scene, 'nodes')
      .map((nodeIndex) => [nodeIndex, M.id(), false])
      .reverse();
  for (let next; (next = stack.pop());) {
    const [nodeIndex, parentMatrix, inside] = next,
      node = item(json, 'nodes', nodeIndex);
    if (seen.has(nodeIndex)) fail(`nodes[${nodeIndex}] is reached twice (a loop, or two parents)`);
    seen.add(nodeIndex);
    const matrix = M.mul(parentMatrix, trsMatrix(node)),
      meshEntry = node.mesh != null ? item(json, 'meshes', node.mesh) : null,
      included = !only || inside || node.name === only || (meshEntry && meshEntry.name === only);
    if (included) found = true;
    if (included && meshEntry)
      for (const primitive of list(meshEntry, 'primitives')) addPrimitive(primitive || {}, matrix);
    for (const child of list(node, 'children').slice().reverse()) stack.push([child, matrix, included]);
  }
  function addPrimitive(primitive, matrix) {
    if ((primitive.mode ?? 4) !== 4) return; // triangles only
    const attributes = primitive.attributes || {},
      positionAccessor = item(json, 'accessors', attributes.POSITION),
      indexAccessor = primitive.indices != null ? item(json, 'accessors', primitive.indices) : positionAccessor;
    Mesh.fits(Math.max(+indexAccessor.count, +positionAccessor.count) / 3 || 0); // (refused before its values are read, if over the limit)
    const positions = accessor(json, bin, attributes.POSITION),
      mesh = new Mesh(),
      vertexCount = positions.count;
    const attribute = (name) => (attributes[name] != null ? accessor(json, bin, attributes[name]) : null);
    const indices =
      primitive.indices != null
        ? Array.from(accessor(json, bin, primitive.indices).data)
        : Array.from({ length: vertexCount }, (_, k) => k);
    // (each one of the vertices, three to a triangle)
    if (indices.length % 3 || indices.some((index) => !(index >= 0 && index < vertexCount) || index % 1))
      fail(`its indices are past its ${vertexCount} vertices, or not in threes`);
    const givenNormals = attribute('NORMAL');
    const position = (k) => [positions.data[3 * k], positions.data[3 * k + 1], positions.data[3 * k + 2]];
    let normals;
    if (givenNormals)
      normals = Array.from({ length: vertexCount }, (_, k) =>
        norm([givenNormals.data[3 * k], givenNormals.data[3 * k + 1], givenNormals.data[3 * k + 2]]),
      );
    else {
      // none given: from the faces around each vertex
      normals = Array.from({ length: vertexCount }, () => [0, 0, 0]);
      for (let t = 0; t < indices.length; t += 3) {
        const [a, b, c] = [indices[t], indices[t + 1], indices[t + 2]],
          faceNormal = cross(sub(position(b), position(a)), sub(position(c), position(a)));
        for (const corner of [a, b, c]) normals[corner] = add(normals[corner], faceNormal);
      }
      normals = normals.map(norm);
    }
    for (let k = 0; k < vertexCount; k++) mesh.vertex(position(k), normals[k]);
    for (let t = 0; t < indices.length; t += 3) mesh.triangle(indices[t], indices[t + 1], indices[t + 2]);
    const vertexColors = attribute('COLOR_0');
    const material = primitive.material != null ? item(json, 'materials', primitive.material) : null,
      pbr = (material && material.pbrMetallicRoughness) || {};
    // glass (KHR_materials_transmission): no base colour map (a scan's is a white film), painted its tint instead
    // (KHR_materials_volume's, else its own colour), and marked so its part is see-through glass
    const isGlass = material?.extensions?.KHR_materials_transmission?.transmissionFactor > 0,
      baseColor = (isGlass && material.extensions.KHR_materials_volume?.attenuationColor) || pbr.baseColorFactor;
    const texture = (!isGlass && pbr.baseColorTexture) || material?.normalTexture;
    const texcoords = texture && attribute('TEXCOORD_0');
    if (texcoords) {
      // texture coordinates, moved by KHR_texture_transform once here
      const transform = texture.extensions?.KHR_texture_transform || {};
      const [offsetU, offsetV] = numbers(transform.offset || [0, 0], 2, 'a texture offset'),
        [scaleU, scaleV] = numbers(transform.scale || [1, 1], 2, 'a texture scale'),
        cos = Math.cos(transform.rotation || 0),
        sin = Math.sin(transform.rotation || 0);
      mesh.uv = [];
      for (let k = 0; k < vertexCount; k++) {
        const u = texcoords.data[2 * k] * scaleU,
          v = texcoords.data[2 * k + 1] * scaleV;
        mesh.uv.push(cos * u + sin * v + offsetU, -sin * u + cos * v + offsetV);
      }
      // cut-outs (feathers, leaves, hair as cards): MASK drops what is below its cutoff; BLEND is drawn the same way at
      // half (sorting every card of a model for true blending is not worth its cost)
      const alphaMode = material.alphaMode;
      const maps = {
        base: isGlass ? null : image(pbr.baseColorTexture),
        normal: image(material.normalTexture),
        metalRoughness: image(pbr.metallicRoughnessTexture),
        materialIndex: primitive.material,
        alphaCutoff: alphaMode === 'MASK' ? (material.alphaCutoff ?? 0.5) : alphaMode === 'BLEND' ? 0.5 : 0,
      };
      if (model.textures && model.textures.materialIndex !== maps.materialIndex)
        fail('the textures of one material per model shape (take each node apart: {model, node})');
      mesh.textures = maps;
    }
    if (vertexColors) {
      mesh.colors = [];
      const srgb = (value) => Math.round(Math.pow(Math.min(1, Math.max(0, value)), 1 / 2.2) * 255); // glTF colours are linear
      for (let k = 0; k < vertexCount; k++)
        mesh.colors.push(
          srgb(vertexColors.data[k * vertexColors.components]),
          srgb(vertexColors.data[k * vertexColors.components + 1]),
          srgb(vertexColors.data[k * vertexColors.components + 2]),
          255,
        );
    } else if (baseColor) {
      // the material's colour, written as sRGB hex for paint()
      const hex = (value) =>
        Math.round(Math.pow(Math.min(1, Math.max(0, value)), 1 / 2.2) * 255)
          .toString(16)
          .padStart(2, '0');
      mesh.paint('#' + hex(baseColor[0]) + hex(baseColor[1]) + hex(baseColor[2]));
    }
    // a double-sided surface (a card of feathers, a leaf) is drawn with both faces; marked, not copied, so a closed
    // body marked so (a scan often is) keeps its outline in the drawn looks
    if (material?.doubleSided) mesh.twoSided = true;
    model.add(mesh, matrix);
    model.glass = isGlass && model.glass !== false; // (all of it glass)
  }
  // an embedded image (a texture's source, or its WebP one), as bytes and their type: PNG, JPEG or WebP, of a size the
  // page can decode
  function image(info) {
    if (!info) return null;
    const texture = item(json, 'textures', info.index),
      source = texture.extensions?.EXT_texture_webp?.source ?? texture.source;
    if (source == null) return null;
    const imageEntry = item(json, 'images', source);
    if (imageEntry.bufferView == null) fail(OUTSIDE);
    const bufferView = view(json, bin, imageEntry.bufferView),
      data = bin.subarray(bufferView.offset, bufferView.offset + bufferView.length),
      size = dims(data) || [0];
    if (!/^image\/(png|jpeg|webp)$/.test(imageEntry.mimeType) || Math.max(...size) > IMAGE_SIDE)
      fail(
        `its images are PNG, JPEG or WebP, at most ${IMAGE_SIDE} pixels a side (not ${imageEntry.mimeType}, ${size.join(' × ')})`,
      );
    return { bytes: data, mime: imageEntry.mimeType };
  }
  if (!found) {
    const allNames = [...nodes, ...list(json, 'meshes')]
      .map((entry) => entry && entry.name)
      .filter((name) => typeof name === 'string' && name);
    fail(
      `no node or mesh called "${only}"` +
        (allNames.length
          ? ` (it has: ${[...new Set(allNames)].slice(0, 20).join(', ')})`
          : ' (its nodes have no names)'),
    );
  }
  return model;
}

export { load, names, parseGLB, bytes, dims };
