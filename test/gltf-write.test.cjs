// glTF export (gltf-write.js): a well-formed .glb (its chunks, views inside the buffer and aligned, accessors with
// their bounds, indices in range), parts as named nodes with their materials, read back by lk3d's own glTF reader into
// the same geometry, posed as the figure is (joints included), and motions as animations.          npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const { sceneToGLB, toGLB, trs } = require('../src/gltf-write.js');
const { parseGLB, load } = require('../src/gltf.js');
const { Mesh, buildScene, flatten, bounds } = require('../src/geometry.js');
const { M } = require('../src/math.js');

const SCENE = {
  title: 'Thử',
  unit: 'dm',
  parts: [
    { id: 'base', name: 'Đế', note: 'the stand', material: 'steel', color: '#336699', shapes: [{ box: [2, 0.2, 2] }] },
    {
      id: 'arm',
      name: 'Tay',
      shapes: [
        { box: [0.2, 1, 0.2], at: [0.8, 0.6, 0] },
        { sphere: 0.15, at: [0.8, 1.2, 0], color: '#ff0000' },
      ],
    },
    {
      id: 'lens',
      material: 'glass',
      opacity: 0.35,
      shapes: [{ cylinder: { r: 0.3, x0: -0.025, x1: 0.025 }, at: [-0.6, 0.3, 0] }],
    },
  ],
  motions: [{ id: 'swing', name: 'Swing', range: [0, 90], speed: 45 }],
  joints: [{ id: 'hinge', parts: ['arm'], turn: { axis: [0, 0, 1], center: [0.8, 0.1, 0] }, drive: 'swing' }],
};
const near = (a, b, e = 1e-4) => Math.abs(a - b) < e;

test('a well-formed .glb: chunks, buffer views, accessors and indices', () => {
  const glb = sceneToGLB(SCENE);
  const dv = new DataView(glb.buffer, glb.byteOffset);
  assert.equal(dv.getUint32(0, true), 0x46546c67);
  assert.equal(dv.getUint32(8, true), glb.length);
  const { json, bin } = parseGLB(glb);
  assert.equal(json.asset.version, '2.0');
  assert.equal(json.buffers[0].byteLength, bin.length);
  for (const v of json.bufferViews) {
    assert.equal(v.byteOffset % 4, 0);
    assert.ok(v.byteOffset + v.byteLength <= bin.length);
  }
  for (const m of json.meshes)
    for (const pr of m.primitives) {
      const P = json.accessors[pr.attributes.POSITION],
        I = json.accessors[pr.indices];
      assert.ok(P.min && P.max && P.min.length === 3);
      const v = json.bufferViews[I.bufferView],
        idx = I.componentType === 5123 ? new Uint16Array(bin.buffer, bin.byteOffset + v.byteOffset, I.count) : null;
      if (idx) assert.ok(Math.max(...idx) < P.count);
      assert.equal(json.accessors[pr.attributes.NORMAL].count, P.count);
    }
});

test('parts as named nodes with their notes and materials, under a root scaled to metres', () => {
  const { json } = parseGLB(sceneToGLB(SCENE));
  const root = json.nodes[json.scenes[0].nodes[0]];
  assert.equal(root.name, 'Thử');
  assert.deepEqual(root.scale, [0.1, 0.1, 0.1]);
  assert.deepEqual(
    root.children.map((i) => json.nodes[i].name),
    ['Đế', 'Tay', 'lens'],
  );
  const base = json.nodes[0];
  assert.deepEqual(base.extras.lk3d, { id: 'base', note: 'the stand' });
  const mat = json.materials[json.meshes[base.mesh].primitives[0].material];
  assert.equal(mat.pbrMetallicRoughness.metallicFactor, 0.85);
  assert.ok(near(mat.pbrMetallicRoughness.baseColorFactor[2], ((0x99 / 255 + 0.055) / 1.055) ** 2.4)); // (linear)
  const glass = json.materials[json.meshes[json.nodes[2].mesh].primitives[0].material];
  assert.equal(glass.alphaMode, 'BLEND');
  assert.ok(glass.pbrMetallicRoughness.baseColorFactor[3] < 1);
  // (the arm's sphere has its own colour: vertex colours, red where the sphere is)
  const arm = json.meshes[json.nodes[1].mesh].primitives[0];
  assert.ok(arm.attributes.COLOR_0 != null);
});

test('read back by lk3d: the same triangles, where the figure has them', () => {
  const S = buildScene(SCENE),
    tris = S.parts.reduce((n, p) => n + flatten(p).indices.length, 0);
  const g = load(Mesh, parseGLB(sceneToGLB({ ...SCENE, unit: 'm' })));
  assert.equal(g.indices.length, tris);
  const a = bounds(g, M.id()),
    b = { min: S.min, max: S.max };
  for (let k = 0; k < 3; k++)
    assert.ok(near(a.min[k], b.min[k]) && near(a.max[k], b.max[k]), `${a.min} ${a.max} vs ${b.min} ${b.max}`);
});

test('posed as asked (a joint at 90°), and each motion as an animation of what it moves', () => {
  const { json } = parseGLB(sceneToGLB(SCENE, { motion: { swing: 90 }, animate: true, samples: 6 }));
  const arm = json.nodes[1],
    s = Math.SQRT1_2;
  assert.ok(near(arm.rotation[2], s) && near(arm.rotation[3], s), JSON.stringify(arm.rotation));
  assert.equal(json.nodes[0].rotation, undefined);
  const an = json.animations[0];
  assert.equal(an.name, 'Swing');
  assert.deepEqual(an.channels.map((c) => [json.nodes[c.target.node].name, c.target.path]).sort(), [
    ['Tay', 'rotation'],
    ['Tay', 'translation'],
  ]);
  const input = json.accessors[an.samplers[0].input];
  assert.deepEqual([input.count, input.min[0], input.max[0]], [7, 0, 2]); // (90° at 45° a second: 2 s)
});

test('trs: a rigid matrix as translation and rotation; a stretched one is refused', () => {
  const m = M.mul(M.trans([1, 2, 3]), M.rotY(Math.PI / 2)),
    x = trs(m);
  assert.deepEqual(x.translation, [1, 2, 3]);
  assert.ok(near(x.rotation[1], Math.SQRT1_2) && near(x.rotation[3], Math.SQRT1_2));
  assert.equal(trs(M.scale([2, 1, 1])), null);
  assert.ok(toGLB({ parts: [] }).length > 20);
});

test('the exporter is apart from the engine: lk3d/export sets it, and the global script leaves it out', () => {
  const X = require('../src/export.js');
  assert.equal(X.default.toGLB, toGLB, 'importing lk3d/export sets LK3D.toGLB, which fig.exportGLB() calls');
  assert.equal(X.sceneToGLB, sceneToGLB);
  assert.equal(typeof X.mount, 'function', 'the rest of lk3d with it');
  const fs = require('node:fs'),
    path = require('node:path'),
    dist = (f) => path.join(__dirname, '..', 'dist', f);
  if (!fs.existsSync(dist('lk3d-export.min.js'))) return; // (not built yet)
  const has = (f) => fs.readFileSync(dist(f), 'utf8').includes('generator:"lk3d"'); // (the writer's asset record)
  assert.deepEqual([has('lk3d.min.js'), has('lk3d-export.min.js'), has('lk3d.mjs')], [false, true, true]);
  // the models add-on carries the reader only, not the writer; the global script neither
  if (fs.existsSync(dist('lk3d-models.min.js'))) assert.equal(has('lk3d-models.min.js'), false);
});

test("the figure's author and licence go into the .glb as glTF's copyright, and nothing when it has neither", () => {
  const { parseGLB } = require('../src/gltf.js');
  const asset = (o) => parseGLB(sceneToGLB({ ...SCENE, ...o })).json.asset;
  assert.equal(asset({ author: 'xoai', license: 'CC BY-NC-ND 4.0' }).copyright, '© xoai, CC BY-NC-ND 4.0');
  assert.equal(asset({ license: 'CC0' }).copyright, 'CC0');
  assert.equal(asset({}).copyright, undefined);
});

test('each guided step is an animation: the parts where the step puts them and which show, at time 0; XMP metadata; valid glTF', async () => {
  const scene = {
    title: 'A box and a lid',
    alt: 'A box whose lid lifts off.',
    parts: [
      { id: 'box', name: 'Box', note: 'holds things', shapes: [{ box: [1, 0.5, 1] }] },
      { id: 'lid', name: 'Lid', shapes: [{ box: [1, 0.1, 1], at: [0, 0.3, 0] }], explode: [0, 2, 0] },
    ],
    motions: [
      {
        id: 'turn',
        range: [0, 90],
        tracks: [
          {
            parts: ['box'],
            turn: {
              axis: [0, 1, 0],
              keys: [
                [0, 0],
                [90, 90],
              ],
            },
          },
        ],
      },
    ],
    steps: [
      { id: 'shut', title: 'Shut' },
      { title: 'Open', explode: 1, hide: ['box'], motion: { turn: 90 } },
    ],
  };
  const glb = sceneToGLB(scene),
    gltf = parseGLB(glb).json,
    [shut, open] = gltf.animations,
    node = (name) => gltf.nodes.findIndex((n) => n.name === name),
    // the value a channel sets at time 0: read from the binary chunk
    value = (animation, nodeIndex, path) => {
      const channel = animation.channels.find((ch) =>
        path === 'visible'
          ? ch.target.extensions?.KHR_animation_pointer.pointer ===
            `/nodes/${nodeIndex}/extensions/KHR_node_visibility/visible`
          : ch.target.node === nodeIndex && ch.target.path === path,
      );
      const accessor = gltf.accessors[animation.samplers[channel.sampler].output],
        view = gltf.bufferViews[accessor.bufferView],
        binary = parseGLB(glb).bin,
        Type = accessor.componentType === 5121 ? Uint8Array : Float32Array;
      return Array.from(
        new Type(binary.buffer, binary.byteOffset + view.byteOffset, view.byteLength / Type.BYTES_PER_ELEMENT),
      );
    };
  assert.equal(shut.name, 'shut');
  assert.equal(open.name, 'step-2');
  assert.deepEqual(value(shut, node('Lid'), 'translation'), [0, 0, 0]);
  assert.deepEqual(value(open, node('Lid'), 'translation'), [0, 2, 0]); // (taken apart: along its explode path)
  assert.deepEqual(value(shut, node('Box'), 'visible'), [1]);
  assert.deepEqual(value(open, node('Box'), 'visible'), [0]); // (hidden by the step)
  const q = value(open, node('Box'), 'rotation'); // (turned 90° about y by the step's motion)
  assert.ok(Math.abs(Math.abs(q[1]) - Math.SQRT1_2) < 1e-5 && Math.abs(Math.abs(q[3]) - Math.SQRT1_2) < 1e-5, `${q}`);
  assert.ok(shut.samplers.every((sampler) => sampler.interpolation === 'STEP'));
  for (const ext of ['KHR_node_visibility', 'KHR_animation_pointer', 'KHR_xmp_json_ld'])
    assert.ok(gltf.extensionsUsed.includes(ext), ext);
  const packets = gltf.extensions.KHR_xmp_json_ld.packets;
  assert.equal(packets[gltf.asset.extensions.KHR_xmp_json_ld.packet]['dc:description']['rdf:_1']['@value'], scene.alt);
  assert.equal(
    packets[gltf.nodes[node('Box')].extensions.KHR_xmp_json_ld.packet]['dc:description']['rdf:_1']['@value'],
    'holds things',
  );
  // valid by the Khronos validator, no error (nor warning)
  const report = await require('gltf-validator').validateBytes(new Uint8Array(glb));
  assert.equal(report.issues.numErrors, 0, JSON.stringify(report.issues.messages.slice(0, 5)));
  assert.equal(report.issues.numWarnings, 0, JSON.stringify(report.issues.messages.slice(0, 5)));
  // a scene without steps: no step animation, nothing about visibility
  const plain = parseGLB(sceneToGLB({ parts: scene.parts.slice(0, 1) })).json;
  assert.equal(plain.animations, undefined);
  assert.deepEqual(plain.extensionsUsed, ['KHR_xmp_json_ld']);
});
