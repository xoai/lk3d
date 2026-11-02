// Writes the models of the image tests, made here so no licensed file is needed: assets/ball.glb, a sphere with a
// generated colour map (a checkerboard, a red band at the top so a flipped map shows) and a bumpy normal map; and
// assets/card.glb, a feather-like card with clear stripes (alphaMode MASK, double-sided), a glass bead
// (KHR_materials_transmission, tinted by KHR_materials_volume) and a pebble, a closed body marked double-sided as scans
// often are (it must keep a clean outline in the drawn looks).
//   node test/visual/make-assets.cjs
const fs = require('fs'),
  path = require('path'),
  zlib = require('zlib');
function png(w, h, px, ch = 3) {
  // px(x, y) → [r, g, b] (or [r, g, b, a], ch 4)
  const raw = Buffer.alloc((w * ch + 1) * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      px(x, y).forEach((v, i) => {
        raw[y * (w * ch + 1) + 1 + x * ch + i] = v;
      });
  const crc = (b) => {
    let c = ~0;
    for (const x of b) {
      c ^= x;
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    return ~c >>> 0;
  };
  const chunk = (t, d) => {
    const l = Buffer.alloc(4);
    l.writeUInt32BE(d.length);
    const td = Buffer.concat([Buffer.from(t), d]),
      c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([l, td, c]);
  };
  const ih = Buffer.alloc(13);
  ih.writeUInt32BE(w, 0);
  ih.writeUInt32BE(h, 4);
  ih[8] = 8;
  ih[9] = ch === 4 ? 6 : 2;
  return Buffer.concat([
    Buffer.from([0x89, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ih),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
const N = 128;
const base = png(N, N, (x, y) => (y < 8 ? [220, 40, 40] : ((x >> 4) + (y >> 5)) % 2 ? [40, 90, 200] : [230, 190, 60]));
const nrm = png(N, N, (x, y) => {
  const a = Math.cos((x / N) * Math.PI * 32) * 0.5,
    b = Math.cos((y / N) * Math.PI * 16) * 0.5;
  return [(a + 1) * 127.5, (b + 1) * 127.5, Math.sqrt(Math.max(0, 1 - a * a - b * b)) * 255].map(Math.round);
});
const P = [],
  NN = [],
  UV = [],
  I = [],
  S = 48,
  R = 24;
for (let j = 0; j <= R; j++)
  for (let i = 0; i <= S; i++) {
    const u = i / S,
      v = j / R,
      th = u * 2 * Math.PI,
      ph = v * Math.PI,
      p = [Math.sin(ph) * Math.cos(th), Math.cos(ph), -Math.sin(ph) * Math.sin(th)];
    P.push(...p);
    NN.push(...p);
    UV.push(u, v);
  }
for (let j = 0; j < R; j++)
  for (let i = 0; i < S; i++) {
    const a = j * (S + 1) + i,
      b = a + S + 1;
    I.push(a, b, a + 1, a + 1, b, b + 1);
  }
// a .glb of these buffers (one view each) and this JSON
function glb(file, bufs, json) {
  const views = [];
  let off = 0;
  const bin = Buffer.concat(
    bufs.map((b) => {
      const q = Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4)]);
      views.push({ buffer: 0, byteOffset: off, byteLength: b.length });
      off += q.length;
      return q;
    }),
  );
  Object.assign(json, { bufferViews: views, buffers: [{ byteLength: bin.length }] });
  const pad = (b, c) => Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4, c)]),
    J = pad(Buffer.from(JSON.stringify(json)), 0x20);
  const head = Buffer.alloc(12);
  head.writeUInt32LE(0x46546c67, 0);
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(12 + 8 + J.length + 8 + bin.length, 8);
  const ch = (b, t) => {
    const h = Buffer.alloc(8);
    h.writeUInt32LE(b.length, 0);
    h.writeUInt32LE(t, 4);
    return Buffer.concat([h, b]);
  };
  fs.mkdirSync(path.join(__dirname, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, 'assets', file), Buffer.concat([head, ch(J, 0x4e4f534a), ch(bin, 0x004e4942)]));
  console.log('assets/' + file);
}
const B = (a) => Buffer.from(a.buffer);
const n = P.length / 3;
glb(
  'ball.glb',
  [B(new Float32Array(P)), B(new Float32Array(NN)), B(new Float32Array(UV)), B(new Uint16Array(I)), base, nrm],
  {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: 'Ball', mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 }, indices: 3, material: 0 }] }],
    materials: [
      {
        pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0, roughnessFactor: 0.5 },
        normalTexture: { index: 1 },
      },
    ],
    textures: [{ source: 0 }, { source: 1 }],
    images: [
      { bufferView: 4, mimeType: 'image/png' },
      { bufferView: 5, mimeType: 'image/png' },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: n, type: 'VEC3', min: [-1, -1, -1], max: [1, 1, 1] },
      { bufferView: 1, componentType: 5126, count: n, type: 'VEC3' },
      { bufferView: 2, componentType: 5126, count: n, type: 'VEC2' },
      { bufferView: 3, componentType: 5123, count: I.length, type: 'SCALAR' },
    ],
  },
);

// the card: a feather's vane, 2 by 1, in the x-y plane facing +z only (the other side comes from doubleSided), its
// map brown with a cream shaft and clear slits between the barbs; the bead: a coarse sphere of glass beside it
const F = 128;
const vane = png(
  F,
  F / 2,
  (x, y) => {
    const v = Math.abs(y - F / 4) / (F / 4), // 0 on the shaft, 1 at the edge
      inside = v < 1 - 0.6 * Math.pow(Math.abs(x - F / 2) / (F / 2), 2),
      slit = v > 0.15 && (x + 24 * v) % 16 < 3;
    if (!inside || slit) return [0, 0, 0, 0];
    return v < 0.06 ? [235, 220, 190, 255] : [120 - 40 * v, 80 - 30 * v, 50, 255].map(Math.round);
  },
  4,
);
const bP = [],
  bI = [];
for (let j = 0; j <= 8; j++)
  for (let i = 0; i <= 12; i++) {
    const th = (i / 12) * 2 * Math.PI,
      ph = (j / 8) * Math.PI;
    bP.push(0.25 * Math.sin(ph) * Math.cos(th), 0.25 * Math.cos(ph), 0.25 * Math.sin(ph) * Math.sin(th));
  }
for (let j = 0; j < 8; j++)
  for (let i = 0; i < 12; i++) {
    const a = j * 13 + i,
      b = a + 13;
    bI.push(a, a + 1, b, a + 1, b + 1, b);
  }
glb(
  'card.glb',
  [
    B(new Float32Array([-1, -0.5, 0, 1, -0.5, 0, 1, 0.5, 0, -1, 0.5, 0])),
    B(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1])),
    B(new Float32Array([0, 1, 1, 1, 1, 0, 0, 0])),
    B(new Uint16Array([0, 1, 2, 0, 2, 3])),
    vane,
    B(new Float32Array(bP)),
    B(new Uint16Array(bI)),
  ],
  {
    asset: { version: '2.0' },
    extensionsUsed: ['KHR_materials_transmission', 'KHR_materials_volume'],
    scene: 0,
    scenes: [{ nodes: [0, 1, 2] }],
    nodes: [
      { name: 'Card', mesh: 0 },
      { name: 'Bead', mesh: 1, translation: [1.4, 0, 0] },
      { name: 'Pebble', mesh: 2, translation: [-1.4, 0, 0], scale: [1.4, 1, 1.2] },
    ],
    meshes: [
      { primitives: [{ attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 }, indices: 3, material: 0 }] },
      { primitives: [{ attributes: { POSITION: 4 }, indices: 5, material: 1 }] },
      { primitives: [{ attributes: { POSITION: 4 }, indices: 5, material: 2 }] },
    ],
    materials: [
      {
        pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0, roughnessFactor: 0.7 },
        alphaMode: 'MASK',
        doubleSided: true,
      },
      {
        pbrMetallicRoughness: { metallicFactor: 0, roughnessFactor: 0.05 },
        extensions: {
          KHR_materials_transmission: { transmissionFactor: 1 },
          KHR_materials_volume: { attenuationColor: [0.9, 0.35, 0.05], thicknessFactor: 0.5 },
        },
      },
      { pbrMetallicRoughness: { baseColorFactor: [0.35, 0.45, 0.3, 1], roughnessFactor: 0.8 }, doubleSided: true },
    ],
    textures: [{ source: 0 }],
    images: [{ bufferView: 4, mimeType: 'image/png' }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 4, type: 'VEC3', min: [-1, -0.5, 0], max: [1, 0.5, 0] },
      { bufferView: 1, componentType: 5126, count: 4, type: 'VEC3' },
      { bufferView: 2, componentType: 5126, count: 4, type: 'VEC2' },
      { bufferView: 3, componentType: 5123, count: 6, type: 'SCALAR' },
      {
        bufferView: 5,
        componentType: 5126,
        count: bP.length / 3,
        type: 'VEC3',
        min: [-0.25, -0.25, -0.25],
        max: [0.25, 0.25, 0.25],
      },
      { bufferView: 6, componentType: 5123, count: bI.length, type: 'SCALAR' },
    ],
  },
);
