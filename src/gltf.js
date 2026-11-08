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

const fail = (m) => {
  throw new Error('lk3d model: ' + m);
};
// one of the file's lists (none: empty), and an item of it by its index: there, or the file is refused
const list = (o, k) => (o[k] == null ? [] : Array.isArray(o[k]) ? o[k] : fail(k + ' should be a list'));
const item = (json, k, i) => {
  const x = list(json, k)[i];
  return Number.isInteger(i) && x && typeof x === 'object' ? x : fail(`${k}[${i}] is not in the file`);
};
const nums = (v, n, what) =>
  Array.isArray(v) && v.length >= n && v.every(Number.isFinite) ? v : fail(`${what} should be ${n} numbers`);

function bytes(b64) {
  const no = () => fail('its data should be the .glb as base64');
  if (typeof b64 !== 'string') no();
  if (typeof atob === 'function') {
    let s;
    try {
      s = atob(b64);
    } catch {
      no();
    }
    const u = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
    return u;
  }
  return new Uint8Array(globalThis.Buffer.from(b64, 'base64')); // (Node, for tools and tests)
}
// the JSON and binary chunks of a .glb
function parseGLB(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (u8.byteLength < 20 || dv.getUint32(0, true) !== 0x46546c67 || dv.getUint32(4, true) !== 2)
    fail('not a .glb file (glTF 2.0)');
  const end = dv.getUint32(8, true),
    short = () => fail('the file is cut short');
  if (end > u8.byteLength) short();
  let off = 12,
    json = null,
    bin = null;
  while (off + 8 <= end) {
    const len = dv.getUint32(off, true),
      type = dv.getUint32(off + 4, true),
      body = off + 8 + len <= end ? u8.subarray(off + 8, off + 8 + len) : short();
    if (type === 0x4e4f534a && !json)
      try {
        json = JSON.parse(new TextDecoder().decode(body));
      } catch {
        fail('its JSON cannot be read');
      }
    else if (type === 0x004e4942 && !bin) bin = body;
    off += 8 + len;
  }
  if (!json || typeof json !== 'object' || Array.isArray(json)) fail('it has no glTF JSON');
  for (const ext of list(json, 'extensionsRequired')) {
    if (!['KHR_mesh_quantization', 'KHR_materials_unlit', 'KHR_texture_transform', 'EXT_texture_webp'].includes(ext))
      fail(
        `${ext} is not supported (write it without: gltfpack does by default, and glTF-Transform can decompress Draco meshes first)`,
      );
  }
  return { json, bin: bin || new Uint8Array(0) };
}
// a buffer view, as its place in the binary chunk (the only buffer: a file that points to another is refused)
function view(json, bin, k) {
  const v = item(json, 'bufferViews', k),
    o = +(v.byteOffset || 0), // (numbers, whatever the file wrote: an offset of [] or "8" would otherwise join as text)
    l = +v.byteLength;
  if (v.buffer || (list(json, 'buffers')[0] || {}).uri != null) fail(OUTSIDE);
  if (!(o >= 0 && l >= 0 && o + l <= bin.length) || o % 1 || l % 1) fail(`bufferViews[${k}] lies outside its data`);
  return { o, l, stride: +v.byteStride };
}
// an accessor's values as plain numbers, normalized ones mapped to -1..1 or 0..1 (of a type other than the one expected,
// it reads as numbers all the same: what they make is wrong, not unsafe)
function accessor(json, bin, i) {
  const a = item(json, 'accessors', i),
    n = SIZE[a.type],
    r = READ[a.componentType],
    count = +a.count;
  const no = (why) => fail(`accessors[${i}] ${why}`);
  if (a.sparse) fail('sparse accessors are not supported');
  if (!n || !r || !(count >= 0) || count % 1 || a.bufferView == null) no('is not one lk3d reads');
  const v = view(json, bin, a.bufferView),
    [get, size, max] = r,
    stride = v.stride || n * size,
    base = v.o + +(a.byteOffset || 0);
  // (its last value inside its view: so its count is no more than the bytes there allow, before anything is made)
  if (!(stride >= n * size && stride <= 252 && base >= v.o) || stride % 1 || base % 1)
    no('has a wrong stride or offset');
  if (count && base + (count - 1) * stride + n * size > v.o + v.l) no('reads past its data');
  const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength),
    out = new Float64Array(count * n);
  for (let k = 0; k < count; k++)
    for (let c = 0; c < n; c++) {
      let x = dv[get](base + k * stride + c * size, true);
      if (a.normalized && max) x = Math.max(x / max, -1);
      else if (!Number.isFinite(x)) no('holds a number that is not finite');
      out[k * n + c] = x;
    }
  return { data: out, n, count };
}
const trsMatrix = (node) => {
  if (node.matrix != null) return nums(node.matrix, 16, 'a node matrix').slice(0, 16);
  const [x, y, z, w] = node.rotation == null ? [0, 0, 0, 1] : nums(node.rotation, 4, 'a node rotation');
  const R = [
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
  return M.mul(M.trans(node.translation || [0, 0, 0]), M.mul(R, M.scale(node.scale || [1, 1, 1])));
};
// the size an embedded image says it is (PNG, JPEG, WebP), or null where its header cannot be read (the browser then
// decides: an image it cannot decode leaves the part its colour)
function dims(b) {
  const at = (k, n, le) => {
    let v = 0;
    for (let i = 0; i < n; i++) v += b[k + i] * 256 ** (le ? i : n - 1 - i);
    return v;
  };
  if (b.length < 30) return null;
  if (b[0] === 0x89 && b[1] === 0x50) return [at(16, 4), at(20, 4)];
  if (b[0] === 0x52 && b[8] === 0x57) {
    const c = String.fromCharCode(b[12], b[13], b[14], b[15]);
    if (c === 'VP8X') return [1 + at(24, 3, 1), 1 + at(27, 3, 1)];
    if (c === 'VP8L') return [1 + (at(21, 2, 1) & 0x3fff), 1 + ((at(22, 3, 1) >> 6) & 0x3fff)];
    if (c === 'VP8 ') return [at(26, 2, 1) & 0x3fff, at(28, 2, 1) & 0x3fff];
  }
  if (b[0] === 0xff && b[1] === 0xd8)
    for (let k = 2; k + 9 < b.length;) {
      const m = b[k + 1];
      if (b[k] !== 0xff) return null;
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return [at(k + 7, 2), at(k + 5, 2)];
      k += m === 0xff ? 1 : 2 + at(k + 2, 2);
    }
  return null;
}

// The model's names (nodes and meshes), to map to the parts of a scene
function names(b64) {
  const { json } = parseGLB(bytes(b64)),
    named = (k) =>
      list(json, k)
        .map((n) => n && n.name)
        .filter((s) => typeof s === 'string' && s);
  return { nodes: named('nodes'), meshes: named('meshes') };
}

// The geometry of a model, or of one of its nodes (with everything under it), as a Geo in the model's units. Geo.fits(n)
// refuses n more triangles past the scene's limit (geometry.js), asked before a primitive's values are read.
function load(Geo, b64, only) {
  const { json, bin } = typeof b64 === 'string' ? parseGLB(bytes(b64)) : b64, // (or a file already read: parseGLB's)
    g = new Geo(),
    nodes = list(json, 'nodes');
  const scene =
    json.scene != null || list(json, 'scenes').length
      ? item(json, 'scenes', json.scene || 0)
      : { nodes: nodes.map((_, i) => i) };
  let found = !only;
  // the nodes, depth first in the file's order, without recursion (a chain of nodes as deep as the file is long) and
  // each once (glTF's nodes are trees: a node reached twice is a loop, or has two parents)
  const seen = new Set(),
    todo = list(scene, 'nodes')
      .map((i) => [i, M.id(), false])
      .reverse();
  for (let next; (next = todo.pop());) {
    const [i, parent, inside] = next,
      node = item(json, 'nodes', i);
    if (seen.has(i)) fail(`nodes[${i}] is reached twice (a loop, or two parents)`);
    seen.add(i);
    const m = M.mul(parent, trsMatrix(node)),
      mesh = node.mesh != null ? item(json, 'meshes', node.mesh) : null,
      hit = !only || inside || node.name === only || (mesh && mesh.name === only);
    if (hit) found = true;
    if (hit && mesh) for (const prim of list(mesh, 'primitives')) addPrimitive(prim || {}, m);
    for (const c of list(node, 'children').slice().reverse()) todo.push([c, m, hit]);
  }
  function addPrimitive(prim, m) {
    if ((prim.mode ?? 4) !== 4) return; // triangles only
    const at = prim.attributes || {},
      pa = item(json, 'accessors', at.POSITION),
      ia = prim.indices != null ? item(json, 'accessors', prim.indices) : pa;
    Geo.fits(Math.max(+ia.count, +pa.count) / 3 || 0); // (refused before its values are read, if over the limit)
    const P = accessor(json, bin, at.POSITION),
      local = new Geo(),
      n = P.count;
    const each = (k) => (at[k] != null ? accessor(json, bin, at[k]) : null);
    const idx =
      prim.indices != null
        ? Array.from(accessor(json, bin, prim.indices).data)
        : Array.from({ length: n }, (_, k) => k);
    // (each one of the vertices, three to a triangle)
    if (idx.length % 3 || idx.some((v) => !(v >= 0 && v < n) || v % 1))
      fail(`its indices are past its ${n} vertices, or not in threes`);
    const N = each('NORMAL');
    const pos = (k) => [P.data[3 * k], P.data[3 * k + 1], P.data[3 * k + 2]];
    let normals;
    if (N) normals = Array.from({ length: n }, (_, k) => norm([N.data[3 * k], N.data[3 * k + 1], N.data[3 * k + 2]]));
    else {
      // none given: from the faces around each vertex
      normals = Array.from({ length: n }, () => [0, 0, 0]);
      for (let t = 0; t < idx.length; t += 3) {
        const [a, b, c] = [idx[t], idx[t + 1], idx[t + 2]],
          f = cross(sub(pos(b), pos(a)), sub(pos(c), pos(a)));
        for (const v of [a, b, c]) normals[v] = add(normals[v], f);
      }
      normals = normals.map(norm);
    }
    for (let k = 0; k < n; k++) local.v(pos(k), normals[k]);
    for (let t = 0; t < idx.length; t += 3) local.tri(idx[t], idx[t + 1], idx[t + 2]);
    const col = each('COLOR_0');
    const mat = prim.material != null ? item(json, 'materials', prim.material) : null,
      pbr = (mat && mat.pbrMetallicRoughness) || {};
    // glass (KHR_materials_transmission): no base colour map (a scan's is a white film), painted its tint instead
    // (KHR_materials_volume's, else its own colour), and marked so its part is see-through glass
    const clear = mat?.extensions?.KHR_materials_transmission?.transmissionFactor > 0,
      bc = (clear && mat.extensions.KHR_materials_volume?.attenuationColor) || pbr.baseColorFactor;
    const tx = (!clear && pbr.baseColorTexture) || mat?.normalTexture;
    const T = tx && each('TEXCOORD_0');
    if (T) {
      // texture coordinates, moved by KHR_texture_transform once here
      const t = tx.extensions?.KHR_texture_transform || {};
      const [ox, oy] = nums(t.offset || [0, 0], 2, 'a texture offset'),
        [sx, sy] = nums(t.scale || [1, 1], 2, 'a texture scale'),
        c = Math.cos(t.rotation || 0),
        s = Math.sin(t.rotation || 0);
      local.uv = [];
      for (let k = 0; k < n; k++) {
        const u = T.data[2 * k] * sx,
          v = T.data[2 * k + 1] * sy;
        local.uv.push(c * u + s * v + ox, -s * u + c * v + oy);
      }
      // cut-outs (feathers, leaves, hair as cards): MASK drops what is below its cutoff; BLEND is drawn the same way at
      // half (sorting every card of a model for true blending is not worth its cost)
      const mode = mat.alphaMode;
      const maps = {
        base: clear ? null : image(pbr.baseColorTexture),
        normal: image(mat.normalTexture),
        mr: image(pbr.metallicRoughnessTexture),
        mat: prim.material,
        cut: mode === 'MASK' ? (mat.alphaCutoff ?? 0.5) : mode === 'BLEND' ? 0.5 : 0,
      };
      if (g.tex && g.tex.mat !== maps.mat)
        fail('the textures of one material per model shape (take each node apart: {model, node})');
      local.tex = maps;
    }
    if (col) {
      local.c = [];
      const srgb = (v) => Math.round(Math.pow(Math.min(1, Math.max(0, v)), 1 / 2.2) * 255); // glTF colours are linear
      for (let k = 0; k < n; k++)
        local.c.push(srgb(col.data[k * col.n]), srgb(col.data[k * col.n + 1]), srgb(col.data[k * col.n + 2]), 255);
    } else if (bc) {
      // the material's colour, written as sRGB hex for paint()
      const s = (v) =>
        Math.round(Math.pow(Math.min(1, Math.max(0, v)), 1 / 2.2) * 255)
          .toString(16)
          .padStart(2, '0');
      local.paint('#' + s(bc[0]) + s(bc[1]) + s(bc[2]));
    }
    // a double-sided surface (a card of feathers, a leaf) is drawn with both faces; marked, not copied, so a closed
    // body marked so (a scan often is) keeps its outline in the drawn looks
    if (mat?.doubleSided) local.twoSided = true;
    g.add(local, m);
    g.clear = clear && g.clear !== false; // (all of it glass)
  }
  // an embedded image (a texture's source, or its WebP one), as bytes and their type: PNG, JPEG or WebP, of a size the
  // page can decode
  function image(info) {
    if (!info) return null;
    const t = item(json, 'textures', info.index),
      src = t.extensions?.EXT_texture_webp?.source ?? t.source;
    if (src == null) return null;
    const im = item(json, 'images', src);
    if (im.bufferView == null) fail(OUTSIDE);
    const v = view(json, bin, im.bufferView),
      b = bin.subarray(v.o, v.o + v.l),
      d = dims(b) || [0];
    if (!/^image\/(png|jpeg|webp)$/.test(im.mimeType) || Math.max(...d) > IMAGE_SIDE)
      fail(
        `its images are PNG, JPEG or WebP, at most ${IMAGE_SIDE} pixels a side (not ${im.mimeType}, ${d.join(' × ')})`,
      );
    return { bytes: b, mime: im.mimeType };
  }
  if (!found) {
    const all = [...nodes, ...list(json, 'meshes')].map((x) => x && x.name).filter((s) => typeof s === 'string' && s);
    fail(
      `no node or mesh called "${only}"` +
        (all.length ? ` (it has: ${[...new Set(all)].slice(0, 20).join(', ')})` : ' (its nodes have no names)'),
    );
  }
  return g;
}

export { load, names, parseGLB, bytes, dims };
