// Writes assets/ball.glb, the textured model of the image tests: a sphere with a generated colour map (a checkerboard,
// a red band at the top so a flipped map shows) and a bumpy normal map. Made here, so no licensed file is needed.
//   node test/visual/make-assets.cjs
const fs = require('fs'),
  path = require('path'),
  zlib = require('zlib');
function png(w, h, px) {
  // px(x, y) → [r, g, b]
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      px(x, y).forEach((v, i) => {
        raw[y * (w * 3 + 1) + 1 + x * 3 + i] = v;
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
  ih[9] = 2;
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
const bufs = [new Float32Array(P), new Float32Array(NN), new Float32Array(UV), new Uint16Array(I)]
  .map((a) => Buffer.from(a.buffer))
  .concat([base, nrm]);
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
const n = P.length / 3;
const json = {
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
  bufferViews: views,
  buffers: [{ byteLength: bin.length }],
};
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
fs.writeFileSync(
  path.join(__dirname, 'assets/ball.glb'),
  Buffer.concat([head, ch(J, 0x4e4f534a), ch(bin, 0x004e4942)]),
);
console.log('assets/ball.glb');
