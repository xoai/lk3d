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
    taken: () => false,
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
