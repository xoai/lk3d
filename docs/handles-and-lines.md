# Handles, motions, lines and flow

## Handles: parts the reader moves

A part with a `handle` moves under the pointer (mouse, finger or pen), held to one rule:

```js
{ turn: { axis: [1, 0, 0], center: [0, 0, 0] }, min: 0, max: 270, snap: 15, label: 'Focus ring' }   // degrees
{ turn: { axis: [1, 0, 0] }, moves: ['rotor'], label: 'Rotor' }        // no min/max: it goes round and round
{ slide: { axis: [1, 0, 0] }, value: -4.5, min: -5.5, max: -0.3, snap: 0.1, moves: ['stand'] }      // a distance
{ along: { path: [[x, y, z], …], closed: true }, label: 'Earth' }       // a place on a path, 0 to 1 of its length
```

- `value` is where the part is drawn (default 0, or `min`); a slide's value is in scene units along its axis.
- `moves` lists other parts or groups carried with it.
- A pointer that lands on a handle moves it; anywhere else it turns the view. Glass in front does not hide a handle, and
  a small one (a planet, a focal point) is caught within a finger's width.
- Each handle is also a hidden range input: Tab reaches it, the arrow keys move it (a turn without stops goes round and
  round), and a screen reader reads its `label` and its value, worded by the page's `handleText`.

The page hears every move the reader makes and can move a handle itself (that does not call `onHandle` back):

```js
const fig = LK3D.mount(el, scene, {
  onHandle: (id, v) => {
    d = -v * 10;
    redraw();
  },
  handleText: (id, v) => `d = ${-v * 10} cm`,
});
fig.handle('object').set(-3);
```

The engine's handle maths (`src/handles.js`: the pointer ray to an angle, a distance or a place on a path) is pure and
tested in Node. Examples: [the lens](../examples/lens.html), [the gauge](../examples/gauge.html),
[the Solar System](../examples/solar.html), [the generator](../examples/generator.html).

## Motions: parts that move together

A mechanism's movement as data: one value goes along a range (a crank's degrees, 0 to 1 for a sleeve that opens) and
each track says where its parts are at some values of it, moved by `[x, y, z]` and turned by degrees about an axis.
Between keys a part goes in a straight line (`ease: true`: starting and stopping smoothly at each key).

```json
"motions": [
  { "id": "reverser", "name": "Thrust reverser", "range": [0, 1], "speed": 0.8,
    "tracks": [{ "parts": ["sleeve"], "move": [[0, [0, 0, 0]], [1, [0.32, 0, 0]]], "ease": true }] },
  { "id": "crank", "range": [0, 360], "loop": true, "speed": 180,
    "tracks": [
      { "parts": ["crankshaft"], "turn": { "axis": [1, 0, 0], "keys": [[0, 0], [360, 360]] } },
      { "parts": ["piston"], "move": [[0, [0, 0.4, 0]], [90, [0, 0.06, 0]], [180, [0, -0.4, 0]], [270, [0, 0.06, 0]], [360, [0, 0.4, 0]]], "ease": true }
    ] }
]
```

A named motion gets a slider and a play button under the figure; the page drives any motion by its id:

```js
const rev = fig.motion('reverser'); // { value, playing, set(v), play(), stop() }
rev.set(0.5);
rev.play(); // on to its end (or back from it); round and round if it loops
fig.set({ motion: { crank: 90 } });
```

`lk3d check` runs each motion through its range and reports parts that run into each other on the way, as it does
for taking apart; `check.allow` excuses a pair by name. Played under reduced motion, a motion goes straight to where
it would end.

## Joints: parts posed by how they are joined

Keys for every part of a mechanism are a lot of numbers to get right: a piston's stroke is not a sine, a connecting
rod swings and slides at once. With `joints` (as URDF and the robot viewers have them) only the driver is moved; the
rest follow from how they are joined, exactly. A joint turns its parts (`turn: { axis, center }`, degrees) or slides
them (`slide: { axis }`, scene units), and its value comes from one place:

- `drive`: a motion's value (`"cycle"`), or scaled (`{ "motion": "cycle", "ratio": 0.5 }`), or read off keys;
- `follow`: another joint's (`{ "joint": "crank", "ratio": 0.5 }` for a cam at half speed; `keys` for a cam's lift);
- `rod`: a slide held by a rod of fixed length, from `at` (a point carried by `joint`) to `pin` (a point of its own
  parts): a piston, solved in closed form at every value;
- `aim`: a turn that keeps its parts pointing at `at` (carried by `joint`): the connecting rod;
- or the page: `fig.set({ joints: { crank: 90 } })`, over a drive.

`parent` carries a joint's parts with another joint first (the rod rides on its piston). Every point and axis is
written where the parts are drawn: at rest, every joint at 0.

```json
"motions": [{ "id": "cycle", "name": "Crank", "range": [0, 720], "loop": true, "speed": 180 }],
"joints": [
  { "id": "crank", "parts": ["crankshaft"], "turn": { "axis": [1, 0, 0], "center": [0, 0, 0] }, "drive": "cycle" },
  { "id": "piston", "parts": ["piston", "pin"], "slide": { "axis": [0, 1, 0] },
    "rod": { "joint": "crank", "at": [0, 0.4, 0], "pin": [0, 1.7, 0] } },
  { "id": "rod", "parent": "piston", "parts": ["conrod"], "turn": { "axis": [1, 0, 0], "center": [0, 1.7, 0] },
    "aim": { "joint": "crank", "at": [0, 0.4, 0] } },
  { "id": "cam", "parts": ["camshaft"], "turn": { "axis": [1, 0, 0], "center": [0, 2.6, 0] },
    "follow": { "joint": "crank", "ratio": 0.5 } }
]
```

A motion that only drives joints needs no `tracks`. The validator checks that what a joint names exists, that a part
is on one joint, that a rod holds a slide and an aim a turn, and that no joint reads itself through others; `lk3d
check` runs the motions through their range with the joints posed, as it does for keys.

## Exporting: glTF

`fig.exportGLB({ animate })` gives the figure as glTF 2.0 binary (a `Uint8Array`), posed as it is now: each part a
node named as the scene names it (its id and note under `extras.lk3d`), with its mesh, vertex colours and a material
from its studio colour and material; one root node scaled from the scene's `unit` to metres. `animate: true` adds
each motion as an animation along its range at its speed (keys and joints both). From the command line:
`lk3d export scene.json [out.glb] [--animate] [--motion crank=90]`. Textures, lines, labels and flows are not
written.

The exporter is not in the global script, which every reader downloads: a page that exports loads it after lk3d,
`<script src="lk3d-export.min.js"></script>` (`dist/lk3d-export.min.js`, built with the engine; 2 KB gzipped), or
imports `lk3d/export` instead of `lk3d`. Without it `exportGLB()` throws, saying so.

## Lines: rays, field lines, forces

```js
const rays = fig.lines({ count: 6, radius: 0.01, color: '#d99a00', studioColor: '#ffcf66', glow: '#ffb030' });
rays.set(0, [x0, y0, z0], [x1, y1, z1]); // segment k from a to b; set(k, null) hides it
rays.set(1, [x0, y0, z0], [x2, y2, z2], 0.02); // a fourth number: this segment's own radius
rays.radius = 0.015; // every segment without its own radius (setting it, or visible, draws again)
rays.visible = false;
rays.glow(0.8);
rays.clear();
```

Each set of lines is one draw: a unit cylinder drawn once per segment by instancing, with its matrices updated in place.

## Flow

Streaks that run along paths: air through an engine, blood along a vessel, water round a bend. Each is a thin ribbon
that fades from its head to its tail, wanders a little round its path (`spread`), and takes its colour from a ramp
along the path, so air can come in cool and leave hot.

![Air through a ducted fan in the pen look: cool streaks round the core, warming streaks through it](flow.png)

```js
// paths round the axis: a profile of [x, radius] turned to eight angles
const around = (profile, n) =>
  Array.from({ length: n }, (_, k) => {
    const a = ((k + 0.5) / n) * 2 * Math.PI;
    return profile.map(([x, r]) => [x, r * Math.cos(a), r * Math.sin(a)]);
  });
const air = fig.flow({ paths: around(BYPASS, 8), count: 500, ramp: 'cool', spread: 0.06, length: 0.1 });
const core = fig.flow({ paths: around(CORE, 6), count: 360, ramp: ['#3a83c6', '#3a83c6', '#e3801f', '#c8461c'] });
throttle.oninput = () => air.set({ amount: 0.15 + 0.85 * t, speed: 0.6 + 3.4 * t }); // more streaks, faster
fig.set({ timeScale: 0.2 }); // slow motion, for flows and particles alike
```

| Option              | Default  | Meaning                                                                                               |
| ------------------- | -------- | ----------------------------------------------------------------------------------------------------- |
| `path` or `paths`   |          | one polyline, or several (the streaks are shared out among them in turn)                              |
| `count`             | 300      | streaks (at most 8000)                                                                                |
| `speed`             | 0        | scene units a second; each streak runs a little faster or slower than that, so they drift apart       |
| `amount`            | 1        | the share of the streaks drawn: tie it to a throttle, a pressure, a heart rate                        |
| `length`            | 0.12     | a streak's length, as a share of its path                                                             |
| `width`             | 1.6      | in CSS pixels, never under 1.25 (thinner streaks flicker as they move)                                |
| `spread`, `opacity` | 0, 0.85  | how far streaks wander from the path (scene units); how strong they are                               |
| `ramp`              | `'cool'` | `'cool'`, `'heat'` (dull red, orange, yellow), one colour, or up to four from the path's start to end |
| `part`, `closed`    |          | a part whose movement the streaks follow; a path that joins up                                        |

A flow's `speed`, `amount` and `visible` are also properties (setting one draws again); `set({…})` changes those and
`length`, `width`, `spread`, `opacity` and `ramp` (not its paths, count or part).

How they are drawn follows the page. On a light page the streaks are ink: blended over the picture, never added
(added light washes out into white paper), and the presets end in a strong colour there; on a dark page (a theme
with `dark`, or the studio look) their light is added, and the presets end near white. They fade in and out at an
open path's ends, are hidden by solid parts but seen through glass, and stand still for a reader who asked for less
motion. Every streak's place comes from a fixed seed, so the same flow draws the same picture.

## Streams

Air, gas or liquid as a moving volume: a jet leaving a nozzle, air drawn into an intake, a plume. Where flow streaks
are lines along paths, a stream is a field the GPU draws inside a tube round its path. In the stream's own coordinates
(along the path, distance from it, which way round) it builds filaments that move downstream, broken into runs,
stirred by turbulence and rolled up more towards the edge as the stream goes on.

The air is carried by its travel time: it speeds up where the stream narrows and slows where it widens (by
continuity, speed × area stays the same), stretching as it speeds up and never running backwards. Where continuity is
not the whole story (gas squeezed denser in a compressor, heated in a combustor, a jet slowing as it mixes with still
air), `speeds` gives the speed along the path. The turbulence changes as the air travels, so a stream that stops,
stops changing. It is kinematics, not a fluid simulation: the speeds come from the page. Its colour comes from a ramp along
the path, and it fades in and out at its ends. It stops behind solid parts and is cut with them.

```js
// the hot core jet, widening as it leaves the nozzle; the bypass air as an annulus round it
const core = fig.stream({
  path: [
    [1.9, 0, 0],
    [3, 0, 0],
    [4, 0, 0],
  ],
  radius: [
    [0, 0.37],
    [1, 0.7],
  ],
  ramp: 'heat',
});
const bypass = fig.stream({
  path: [
    [0.6, 0, 0],
    [2.4, 0, 0],
  ],
  radius: [
    [0, 0.5, 0.78],
    [1, 0.4, 0.95],
  ],
  ramp: 'cool',
});
throttle.oninput = () => core.set({ density: 0.3 + 0.7 * t, speed: 1 + 4 * t });
```

| Option                | Default  | Meaning                                                                                           |
| --------------------- | -------- | ------------------------------------------------------------------------------------------------- |
| `path`                |          | the polyline along its middle, 2 to 16 points (more is an error)                                  |
| `radius`              | 0.1      | one number, or stops `[f, rOut]` or `[f, rIn, rOut]` (f from 0 at the start to 1 at the end)      |
| `speed`, `density`    | 0, 1     | scene units a second where its relative speed is 1 (by continuity: at the start); how thick it is |
| `speeds`              |          | its speed along the path, stops `[f, fraction of speed]`; without them, from continuity           |
| `fade`                | 0.7      | where along the path it starts to fade out                                                        |
| `turbulence`, `swirl` | 0.5, 0.5 | how much the filaments are stirred; how much more towards the edge, growing downstream            |
| `ramp`                | `'cool'` | as for flows                                                                                      |

A stream's `speed`, `density` and `visible` are also properties; `set({…})` changes those, `turbulence`, `swirl` and
`ramp`.

Streams are drawn at half resolution with 48 samples a pixel, so a page with several large streams costs the GPU more
than streaks do. Without WebGL a stream is drawn as streaks along its path.

## Flows on a timeline: the clock

Flows, streams and particles along a path move by `LK3D.clock`, the one clock every figure runs on. While it runs, each
frame moves them on by its own time. Stopped (`LK3D.clock.speed = 0`), they are placed for the clock's time instead,
which a page sets with `LK3D.clock.set(ms)`, forwards or back: each has gone what its speed (times the figure's
`timeScale`) carries it in that time, so the same time always draws the same picture. A video renderer seeking its own
timeline does just this ([a timeline](api.md#driving-a-figure-from-a-timeline)):

```js
LK3D.clock.speed = 0;
const air = fig.flow({ path, speed: 0.8 });
LK3D.clock.set(2500); // the streaks where 2.5 s of air carries them
fig.drawNow();
```

Their time starts at 0, or where the clock last ran. When a speed changes, the thing goes on from where it was last
drawn at its new speed; a timeline that changes speeds as it goes seeks in order, as an export does, to draw the same
picture each time. No re-simulation is needed: their places follow from their seeds and the distance travelled.

## Dimensions

A scene's `dimensions` are drawn on the figure as on a technical drawing: a **length** between two points, with
extension lines out to a dimension line, arrows at its ends and its value; an **angle** at a vertex, an arc with arrows
and its value in degrees.

```json
"unit": "dm",
"dimensions": [
  { "id": "d", "name": "the object's distance", "from": { "part": "object", "at": [-4.5, 0, 0] }, "to": [0, 0, 0],
    "offset": [0, -0.3, 0.5], "unit": "cm", "digits": 0 },
  { "id": "tilt", "angle": [[1, 0, 0], [0, 0, 0], [0.8, 0.6, 0]], "radius": 0.4 }
]
```

- **The value** is worked out from the points as they are shown, three significant figures by default (`digits` for a
  fixed number of decimals), in the scene's `unit`, or converted to the dimension's own (`unit: "cm"` in a scene in
  decimetres); an angle in degrees. `text` gives words of its own instead (`"Ø 40"`).
- **A point on a part**, `{part, at}` (`at` where it is with the part at rest), moves with the part: taken apart, moved
  by a motion or a joint, or by the reader's handle. A length to it changes as it moves: the lens bench's distance from
  the object to the lens follows the object as the reader slides it ([example](../examples/lens.html)).
- **Where the line goes**: `offset` moves the dimension line off the points, extension lines reaching out to it. An
  angle's arc is a third of its shorter arm from the vertex unless `radius` says; `arms: true` draws the arms too.
- **Which show**: every dimension the scene does not mark `hidden`; a step shows exactly the ones it names
  (`dimensions: ["d"]`, or `[]` for none), and a page sets them (`fig.set({ dimensions: ["d"] })`, `null` for the
  scene's own). Screen readers find them listed with their values, each called by its `name`.
