// Reading a 3D model made elsewhere (glTF 2.0 binary, .glb): a heart, a skull, a scanned fossil — forms that generated
// shapes cannot draw faithfully. `./lk model add` prepares the file (simplified, quantized with gltfpack) and the build
// embeds it in the page, so here it is read synchronously from base64: no network, no decoder to wait for.
// Supported: triangle meshes, node transforms (TRS or matrix), positions/normals in any component type (quantized,
// normalized or float: KHR_mesh_quantization), indices, COLOR_0, materials' base colours, and the textures of one
// material: TEXCOORD_0 (KHR_texture_transform applied), base colour, normal and metallic-roughness maps, as embedded
// WebP, PNG or JPEG images (the renderer decodes them). Not: skins, morph targets, sparse accessors, KTX2/Basis
// textures, meshopt or Draco compression (refused with a message).
import { M, sub, cross, norm, add } from './math.js';

const SIZE = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const READ = { 5120: ['getInt8', 1, 127], 5121: ['getUint8', 1, 255], 5122: ['getInt16', 2, 32767], 5123: ['getUint16', 2, 65535], 5125: ['getUint32', 4, 0], 5126: ['getFloat32', 4, 0] };

function bytes(b64) {
  if (typeof atob === 'function') { const s = atob(b64), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; }
  return new Uint8Array(Buffer.from(b64, 'base64'));
}
// the JSON and binary chunks of a .glb
function parseGLB(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('lk3d model: not a .glb file');
  let off = 12, json = null, bin = null;
  while (off < dv.byteLength) {
    const len = dv.getUint32(off, true), type = dv.getUint32(off + 4, true), body = u8.subarray(off + 8, off + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(body));
    else if (type === 0x004e4942) bin = body;
    off += 8 + len;
  }
  for (const ext of json.extensionsRequired || []) {
    if (!['KHR_mesh_quantization', 'KHR_materials_unlit', 'KHR_texture_transform', 'EXT_texture_webp'].includes(ext)) throw new Error(`lk3d model: ${ext} is not supported (prepare the file with ./lk model add, which writes it without compression)`);
  }
  return { json, bin };
}
// an accessor's values as plain numbers, normalized ones mapped to -1..1 or 0..1
function accessor(gltf, bin, i) {
  const a = gltf.accessors[i];
  if (a.sparse) throw new Error('lk3d model: sparse accessors are not supported');
  const v = gltf.bufferViews[a.bufferView], n = SIZE[a.type], [get, size, max] = READ[a.componentType];
  const stride = v.byteStride || n * size, base = (v.byteOffset || 0) + (a.byteOffset || 0);
  const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength), out = new Float64Array(a.count * n);
  for (let k = 0; k < a.count; k++) for (let c = 0; c < n; c++) {
    let x = dv[get](base + k * stride + c * size, true);
    if (a.normalized && max) x = Math.max(x / max, -1);
    out[k * n + c] = x;
  }
  return { data: out, n, count: a.count };
}
const trsMatrix = (node) => {
  if (node.matrix) return node.matrix.slice();
  const [x, y, z, w] = node.rotation || [0, 0, 0, 1];
  const R = [1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w), 0, 2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w), 0,
    2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y), 0, 0, 0, 0, 1];
  return M.mul(M.trans(node.translation || [0, 0, 0]), M.mul(R, M.scale(node.scale || [1, 1, 1])));
};

// The model's names (nodes and meshes), to map to the parts of a scene
function names(b64) {
  const { json } = parseGLB(bytes(b64));
  return { nodes: (json.nodes || []).map((n) => n.name).filter(Boolean), meshes: (json.meshes || []).map((m) => m.name).filter(Boolean) };
}

// The geometry of a model, or of one of its nodes (with everything under it), as a Geo in the model's units
function load(Geo, b64, only) {
  const { json, bin } = parseGLB(bytes(b64)), g = new Geo();
  const scene = (json.scenes || [])[json.scene || 0] || { nodes: (json.nodes || []).map((_, i) => i) };
  let found = !only;
  const visit = (i, parent, inside) => {
    const node = json.nodes[i], m = M.mul(parent, trsMatrix(node)), hit = !only || inside || node.name === only || (node.mesh != null && json.meshes[node.mesh].name === only);
    if (hit) found = true;
    if (hit && node.mesh != null) for (const prim of json.meshes[node.mesh].primitives) addPrimitive(prim, m);
    for (const c of node.children || []) visit(c, m, hit);
  };
  const addPrimitive = (prim, m) => {
    if ((prim.mode ?? 4) !== 4) return;  // triangles only
    const P = accessor(json, bin, prim.attributes.POSITION), local = new Geo(), n = P.count;
    const idx = prim.indices != null ? Array.from(accessor(json, bin, prim.indices).data) : Array.from({ length: n }, (_, k) => k);
    let N = prim.attributes.NORMAL != null ? accessor(json, bin, prim.attributes.NORMAL) : null;
    const pos = (k) => [P.data[3 * k], P.data[3 * k + 1], P.data[3 * k + 2]];
    let normals;
    if (N) normals = Array.from({ length: n }, (_, k) => norm([N.data[3 * k], N.data[3 * k + 1], N.data[3 * k + 2]]));
    else {  // none given: from the faces around each vertex
      normals = Array.from({ length: n }, () => [0, 0, 0]);
      for (let t = 0; t < idx.length; t += 3) { const [a, b, c] = [idx[t], idx[t + 1], idx[t + 2]], f = cross(sub(pos(b), pos(a)), sub(pos(c), pos(a))); for (const v of [a, b, c]) normals[v] = add(normals[v], f); }
      normals = normals.map(norm);
    }
    for (let k = 0; k < n; k++) local.v(pos(k), normals[k]);
    for (let t = 0; t < idx.length; t += 3) local.tri(idx[t], idx[t + 1], idx[t + 2]);
    const col = prim.attributes.COLOR_0 != null ? accessor(json, bin, prim.attributes.COLOR_0) : null;
    const mat = prim.material != null ? json.materials[prim.material] : null, bc = mat?.pbrMetallicRoughness?.baseColorFactor;
    const tx = mat?.pbrMetallicRoughness?.baseColorTexture || mat?.normalTexture;
    if (tx && prim.attributes.TEXCOORD_0 != null) {  // texture coordinates, moved by KHR_texture_transform once here
      const T = accessor(json, bin, prim.attributes.TEXCOORD_0), t = tx.extensions?.KHR_texture_transform || {};
      const [ox, oy] = t.offset || [0, 0], [sx, sy] = t.scale || [1, 1], c = Math.cos(t.rotation || 0), s = Math.sin(t.rotation || 0);
      local.uv = [];
      for (let k = 0; k < n; k++) { const u = T.data[2 * k] * sx, v = T.data[2 * k + 1] * sy; local.uv.push(c * u + s * v + ox, -s * u + c * v + oy); }
      const maps = { base: image(mat.pbrMetallicRoughness?.baseColorTexture), normal: image(mat.normalTexture), mr: image(mat.pbrMetallicRoughness?.metallicRoughnessTexture), mat: prim.material };
      if (g.tex && g.tex.mat !== maps.mat) throw new Error('lk3d model: the textures of one material per model shape (take each node apart: {model, node})');
      local.tex = maps;
    }
    if (col) {
      local.c = [];
      const srgb = (v) => Math.round(Math.pow(Math.min(1, Math.max(0, v)), 1 / 2.2) * 255);  // glTF colours are linear
      for (let k = 0; k < n; k++) local.c.push(srgb(col.data[k * col.n]), srgb(col.data[k * col.n + 1]), srgb(col.data[k * col.n + 2]), 255);
    } else if (bc) {  // the material's colour, written as sRGB hex for paint()
      const s = (v) => Math.round(Math.pow(Math.min(1, Math.max(0, v)), 1 / 2.2) * 255).toString(16).padStart(2, '0');
      local.paint('#' + s(bc[0]) + s(bc[1]) + s(bc[2]));
    }
    g.add(local, m);
  };
  // an embedded image (a texture's source, or its WebP one), as bytes and their type
  const image = (info) => {
    const t = info && json.textures[info.index], src = t && (t.extensions?.EXT_texture_webp?.source ?? t.source), im = src != null && json.images[src];
    if (!im) return null;
    if (im.bufferView == null) throw new Error('lk3d model: its images must be inside the .glb (./lk model add puts them there)');
    const v = json.bufferViews[im.bufferView];
    return { bytes: bin.subarray(v.byteOffset || 0, (v.byteOffset || 0) + v.byteLength), mime: im.mimeType };
  };
  for (const i of scene.nodes || []) visit(i, M.id(), false);
  if (!found) throw new Error(`lk3d model: no node or mesh called "${only}" (./lk model add lists them)`);
  return g;
}

export { load, names, parseGLB, bytes };
