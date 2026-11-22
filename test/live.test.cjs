// The live add-on's pieces (src/live.js: arrows, surfaces), against a host that records what they ask of it, as the
// core lends one (additions.js); and the built add-on (dist/lk3d-live.min.js) carrying none of the core.   npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// a host as the core lends it, recording entries added and the rods placed (start, end, radius)
function fakeHost() {
  const host = {
    entries: [],
    kicks: 0,
    kick: () => host.kicks++,
    renderer: () => 'webgl2',
    add: (entry) => host.entries.push(entry),
    remove: (entry) => host.entries.splice(host.entries.indexOf(entry), 1),
    upload() {},
    instances() {},
    refill() {},
    part: (kind, batches) => ({ id: kind, batches, glowColor: [1, 0.5, 0], emission: [0, 0, 0] }),
    rod: (start, end, radius) => ({ start, end, radius }),
    unit: (kind) => ({ kind }),
    outlines: () => [],
    taken: (id) => id === 'base',
    M: require('../src/math.js').M,
    ramp: () => [
      [0, 0, 0],
      [1, 1, 1],
    ],
    tone: (stops, tone) => [tone, tone, tone],
    dark: () => false,
    triangles: () => 0,
    maxTriangles: () => 1e6,
  };
  return host;
}
const placed = (host) => {
  const entry = host.entries.at(-1);
  entry.place();
  return entry.parts.map((part) => part.batches[0].placements);
};
const length = ({ start, end }) => Math.hypot(...end.map((v, i) => v - start[i]));

test('an arrow is a shaft and a cone; the head 4 radii long and 2.2 wide, at most 40 % of a short arrow', async () => {
  const { arrows } = await import('../src/live.js');
  const host = fakeHost(),
    a = arrows(host, { count: 4, radius: 0.01 });
  a.set(0, [0, 0, 0], [1, 0, 0]);
  a.set(1, [0, 0, 0], [0, 0.05, 0]); // (short: 0.05 against a head of 0.04)
  a.set(2, [0, 0, 0], [0, 0, 1], 0.02); // (its own radius)
  a.set(3, [0, 0, 0], [0, 0, 0]); // (too short to draw)
  const [shafts, heads] = placed(host);
  assert.equal(shafts.length, 3);
  assert.equal(heads.length, 3);
  // the long one: its head 0.04 long, 0.022 wide, its tip at `to`, its shaft to the head's base
  assert.ok(Math.abs(length(heads[0]) - 0.04) < 1e-12);
  assert.ok(Math.abs(heads[0].radius - 0.022) < 1e-12);
  assert.deepEqual(heads[0].end, [1, 0, 0]);
  assert.ok(Math.abs(length(shafts[0]) - 0.96) < 1e-12);
  assert.deepEqual(shafts[0].end, heads[0].start);
  // the short one: its head 40 % of it, as wide for its length as a full head
  assert.ok(Math.abs(length(heads[1]) - 0.02) < 1e-12);
  assert.ok(Math.abs(heads[1].radius - 0.011) < 1e-12);
  // its own radius: its head twice as long and wide
  assert.ok(Math.abs(length(heads[2]) - 0.08) < 1e-12);
  assert.equal(shafts[2].radius, 0.02);
});

test('arrows: a head given, hidden and cleared, glowing, unseen, removed', async () => {
  const { arrows } = await import('../src/live.js');
  const host = fakeHost(),
    a = arrows(host, { count: 2, radius: 0.01, head: { length: 0.1, radius: 0.03 } });
  a.set(0, [0, 0, 0], [0, 1, 0]);
  a.set(1, [0, 0, 0], [1, 0, 0]);
  const [, heads] = placed(host);
  assert.ok(Math.abs(length(heads[0]) - 0.1) < 1e-12);
  assert.equal(heads[0].radius, 0.03);
  a.set(1, null);
  assert.equal(placed(host)[0].length, 1, 'set(k, null) hides one');
  a.clear();
  assert.equal(placed(host)[1].length, 0, 'clear() hides all');
  a.glow(0.5);
  assert.deepEqual(host.entries[0].parts[0].emission, [0.5, 0.25, 0]);
  a.visible = false;
  assert.equal(host.entries[0].visible, false);
  assert.equal(a.visible, false);
  a.remove();
  assert.equal(host.entries.length, 0);
  a.set(5, [0, 0, 0], [1, 1, 1]); // (out of range: ignored, no error)
});

// a surface's mesh, after its heights are written and it is placed: every vertex of every strip, by (i, j)
function shaped(host, s, nx, nz, height) {
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) {
      const x = -1 + (2 * i) / (nx - 1),
        z = -1 + (2 * j) / (nz - 1);
      s.heights[i + nx * j] = height(x, z);
      if (s.tones) s.tones[i + nx * j] = (i + j) / (nx + nz - 2);
    }
  s.update();
  const entry = host.entries.at(-1);
  entry.place({});
  return entry.parts[0].batches;
}

test('a surface: positions on its grid, and normals as the analytic ones of a paraboloid and a sine sheet', async () => {
  const { surface } = await import('../src/live.js');
  for (const [name, height, gradient] of [
    ['paraboloid', (x, z) => 0.3 * (x * x + z * z), (x, z) => [0.6 * x, 0.6 * z]],
    [
      'sine sheet',
      (x, z) => 0.1 * Math.sin(3 * x) * Math.cos(2 * z),
      (x, z) => [0.3 * Math.cos(3 * x) * Math.cos(2 * z), -0.2 * Math.sin(3 * x) * Math.sin(2 * z)],
    ],
  ]) {
    const host = fakeHost(),
      s = surface(host, { size: [2, 2], res: [41, 41] }),
      [batch] = shaped(host, s, 41, 41, height),
      { positions, normals } = batch.mesh;
    let worst = 0;
    for (let k = 0; k < 41 * 41; k++) {
      const i = k % 41,
        j = Math.floor(k / 41);
      if (i === 0 || j === 0 || i === 40 || j === 40) continue; // (one-sided at the edges)
      const [x, y, z] = positions.subarray(3 * k, 3 * k + 3),
        [gx, gz] = gradient(x, z),
        length = Math.hypot(gx, 1, gz),
        want = [-gx / length, 1 / length, -gz / length];
      assert.ok(Math.abs(y - height(x, z)) < 1e-6, `${name}: height at ${x}, ${z}`);
      worst = Math.max(worst, Math.hypot(...want.map((v, a) => v - normals[3 * k + a])));
    }
    assert.ok(worst < 0.01, `${name}: the normals are off by ${worst}`);
  }
});

test('a surface over 65,535 points is split into strips that share their edge rows; its tones colour its points', async () => {
  const { surface } = await import('../src/live.js');
  const host = fakeHost(),
    s = surface(host, { size: [2, 2], res: [300, 300], colors: ['#000000', '#ffffff'] }),
    batches = shaped(host, s, 300, 300, (x, z) => x * z);
  assert.ok(batches.length >= 2, `${batches.length} strips`);
  for (const batch of batches) assert.ok(batch.mesh.count <= 65535, `a strip of ${batch.mesh.count} points`);
  // the rows: every row of the grid in some strip, and each strip's last row its next one's first
  const rows = new Set();
  batches.forEach((batch, b) => {
    const count = batch.mesh.count / 300;
    for (let r = 0; r < count; r++) rows.add(batch.from + r);
    if (b + 1 < batches.length) assert.equal(batch.from + count - 1, batches[b + 1].from, 'they share an edge row');
  });
  assert.equal(rows.size, 300);
  // triangles: 2 (nx − 1) (nz − 1) in all, none repeated across strips
  assert.equal(
    batches.reduce((sum, batch) => sum + batch.mesh.indices.length / 3, 0),
    2 * 299 * 299,
  );
  // the tones as vertex colours, alpha 255 (the point's own colour, not the part's)
  const { colors } = batches[0].mesh;
  assert.equal(colors[3], 255);
  assert.ok(colors[4 * 299] > colors[0], 'brighter along the ramp');
  assert.equal(host.entries[0].triangles, 2 * 299 * 299);
  assert.throws(() => surface(host, { id: 'base', size: [1, 1], res: [4, 4] }), /base/);
  s.remove();
  assert.equal(host.entries.length, 0);
});

test('a ray meets a surface where its heights are, at grazing angles too; heightAt reads them, NaN outside', async () => {
  const { surface } = await import('../src/live.js');
  const host = fakeHost(),
    s = surface(host, { id: 'sheet', size: [2, 2], res: [33, 33], at: [1, 0.5, 0] }),
    wave = (x, z) => 0.2 * Math.sin(4 * x) * Math.cos(3 * z);
  shaped(host, s, 33, 33, wave);
  const { hit } = host.entries[0],
    cell = 2 / 32;
  // straight down, and at grazing angles from the side: each crossing on the surface, to 1 % of a cell
  for (const [origin, direction] of [
    [
      [1.3, 3, 0.2],
      [0, -1, 0],
    ],
    [
      [-2, 0.6, 0.1],
      [1, -0.05, 0],
    ],
    [
      [1, 0.62, -3],
      [0.02, -0.06, 1],
    ],
    [
      [3.5, 0.9, -1.8],
      [-1, -0.12, 0.6],
    ],
  ]) {
    const length = Math.hypot(...direction),
      unit = direction.map((v) => v / length),
      found = hit(origin, unit);
    assert.ok(found, `a ray from ${origin}`);
    assert.equal(found.id, 'sheet');
    const [x, y, z] = found.point;
    assert.ok(Math.abs(y - 0.5 - s.heightAt(x - 1, z)) < 0.01 * cell, `on the surface: ${found.point}`);
    assert.ok(
      found.point.every((v, i) => Math.abs(v - (origin[i] + unit[i] * found.t)) < 1e-9),
      'at t along the ray',
    );
    assert.ok(found.normal[1] > 0, 'its normal points up');
  }
  assert.equal(hit([5, 3, 5], [0, -1, 0]), null, 'a ray beside it misses');
  assert.equal(hit([1, 3, 0], [0, 1, 0]), null, 'a ray away from it misses');
  assert.ok(Math.abs(s.heightAt(0.1, -0.3) - wave(0.1, -0.3)) < 0.01, 'heightAt: bilinear between the points');
  assert.ok(Number.isNaN(s.heightAt(1.5, 0)), 'NaN outside');
});

test('a surface is refused with its res or size wrong, over the triangle limit, or its heights the wrong length', async () => {
  const { surface } = await import('../src/live.js');
  const host = fakeHost();
  for (const [o, words] of [
    [{ size: [1, 1], res: [1, 5] }, /res/],
    [{ size: [1, 1], res: [600, 5] }, /res/],
    [{ size: [1, 1], res: [4.5, 5] }, /res/],
    [{ size: [0, 1], res: [4, 4] }, /size/],
    [{ size: [1], res: [4, 4] }, /size/],
  ])
    assert.throws(() => surface(host, o), words, JSON.stringify(o));
  host.maxTriangles = () => 1000;
  host.triangles = () => 400;
  assert.throws(
    () => surface(host, { size: [1, 1], res: [20, 20] }),
    /722 triangles; the limit here is 1000 with the scene's 400/,
  );
  const s = surface(host, { size: [1, 1], res: [10, 10] });
  s.heights = new Float32Array(3);
  assert.throws(() => s.update(), /heights/);
});

test('the built add-on carries no geometry or other part of the core, and says what it is for', () => {
  const dist = (f) => path.join(__dirname, '..', 'dist', f);
  if (!fs.existsSync(dist('lk3d-live.min.js'))) return; // (not built yet)
  const live = fs.readFileSync(dist('lk3d-live.min.js'), 'utf8'),
    core = fs.readFileSync(dist('lk3d.min.js'), 'utf8');
  for (const shape of ['helix', 'terrain', 'molecule', 'blade', 'lathe']) assert.ok(!live.includes(shape), shape);
  assert.ok(live.length < core.length / 8, `${live.length} B`);
  assert.match(live, /lk3d-live: load dist\/lk3d\.min\.js first/);
  assert.doesNotMatch(core, /lk3d-live: load/);
});
