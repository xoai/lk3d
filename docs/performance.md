# Performance

lk3d draws only when something changes, pauses when the figure is off screen, compiles the realistic look's shaders in
the background, and lowers its resolution while frames run late. These are the measurements behind that, made with
the benchmark page (`node lessonkit/js/bench.cjs` in the lessonkit repository writes `build/bench/current.html`; open
it, keep the tab in front, press Run).

## Size

The global script `dist/lk3d.min.js`, built by `npm run build`. The budget is 67 KB gzipped (57 KB until November 2026; 60 when the engine began checking scenes and models itself; 65 for room to grow; 67 for guided steps, the cut the reader moves, the element, and streaks and crease shading off the main thread): `npm run size` fails past
it, and the CI workflow runs it. The glTF exporter is a script of its own, `dist/lk3d-export.min.js` (3.8 KB, 2.0 KB
gzipped), outside the budget: a page loads it only to export.

|                                                                                                                                         | Minified | Gzipped |
| --------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------- |
| lk3d 0.1.0                                                                                                                              | 148.0 KB | 59.2 KB |
| three.js r187, the smallest page (renderer, camera, box, basic material)                                                                | 522 KB   | 131 KB  |
| three.js r187 with what lk3d does (PBR and glass, shadows, environment, orbit controls, picking, glTF, labels, bloom, shape generators) | 708 KB   | 181 KB  |

Measured with esbuild (minify, ES2020) and gzip level 9 (lk3d by `npm run size`, 8 November 2026: 60 589 bytes, 5 971
under the budget; three.js, 2 November 2026).

## Frames

Apple M3 Pro laptop, Chrome, 120 Hz screen (8.3 ms per frame), 2 November 2026. Frame = time between frames
(includes the GPU), script = lk3d's own work per frame, both median / 95th percentile in ms.

| Scene                                      | Backend   | Triangles | First picture | Frame      | Script    |
| ------------------------------------------ | --------- | --------- | ------------- | ---------- | --------- |
| Generator, drawn look, spinning            | WebGL 2   | 37 348    | 55            | 8.3 / 10.1 | 0.3 / 0.6 |
| Generator, studio look, lamp glowing       | WebGL 2   | 37 348    | 48            | 8.3 / 10.0 | 0.3 / 0.6 |
| Six generators, spinning                   | WebGL 2   | 224 088   | 80            | 8.3 / 10.2 | 0.5 / 0.6 |
| Generator on WebGL 1                       | WebGL 1   | 37 348    | 19            | 8.3 / 9.8  | 0.3 / 0.5 |
| Generator, 2D fallback                     | Canvas 2D | 14 106    | 23            | 8.3 / 9.6  | 5.3 / 6.6 |
| Jet engine on its stand (pen, cut open)    | WebGL 2   | 444 220   | 50            | 8.3 / 9.2  | 0.4 / 0.5 |
| Animal cell, studio look                   | WebGL 2   | 117 452   | 61            | 8.3 / 10.2 | 0.2 / 0.4 |
| Generator, pen look (with edges), spinning | WebGL 2   | 37 348    | 37            | 8.3 / 9.3  | 0.2 / 0.3 |
| Jet engine, 2000 flow streaks              | WebGL 2   | 444 220   | 53            | 8.3 / 8.9  | 0.8 / 1.0 |
| Jet engine, 2000 streaks, pen, dark        | WebGL 2   | 444 220   | 59            | 8.3 / 9.0  | 0.8 / 1.0 |

Every scene kept the screen's rate. The pen look's edges cost no script: they are found once, in idle time after the
first picture, and drawn by the GPU. The jet engine's rows were measured again after it was rebuilt on its test stand
(twice the triangles: the stand, flanges and bolts, casings in halves). Flow streaks were the one thing whose script
grew with what is drawn, each placed on the CPU every frame it moved (about 0.6 ms for 2000 here); on WebGL 2 the GPU
places them now (below). On this machine the GPU's cost hides under the 120 Hz frame, so the numbers that
matter most come from phones.

## On a phone-like device

No phone has been measured yet; these numbers stand in for one. Chromium with its CPU slowed 4 and 6 times (the usual
stand-ins for a mid-range and a low-end Android phone), a 390 px screen at 2.75 device pixels per CSS pixel, touch,
the laptop's own GPU (Apple M3 Pro, through Metal, not slowed), 7 November 2026, `node test/bench/phone.mjs`. Times
are ms from `LK3D.mount`; frame = time between frames while the figure turns a step each frame for 3 s, median / 95th
percentile, on a 60 Hz screen.

| Scene (reference) | Triangles | CPU | Setup | First picture | Picking ready | Crease shading done | Frame       |
| ----------------- | --------- | --- | ----- | ------------- | ------------- | ------------------- | ----------- |
| Generator         | 15 266    | 1×  | 40    | 45            | 91            | 255                 | 16.7 / 16.8 |
|                   |           | 6×  | 126   | 152           | 243           | 950                 | 16.7 / 16.8 |
| Animal cell       | 53 016    | 1×  | 36    | 40            | 114           | 832                 | 16.7 / 16.7 |
|                   |           | 6×  | 217   | 248           | 503           | 4 070               | 16.7 / 16.7 |
| Jet engine        | 215 974   | 1×  | 39    | 47            | 232           | 670                 | 16.7 / 16.7 |
|                   |           | 6×  | 235   | 309           | 590           | 2 217               | 16.7 / 16.7 |
| Solar System      | 11 332    | 6×  | 132   | 154           | 340           | 887                 | 16.7 / 16.7 |
| Molecules         | 26 856    | 6×  | 224   | 245           | 562           | 6 836               | 16.7 / 16.7 |

The first picture comes within a third of a second even at 6×. The crease shading was the slow part (up to 7 s of
CPU on the molecules at 6×), done on the page in idle slices of a few milliseconds that wait while the reader turns
the figure. Since 11 November 2026 it is worked out in a Web Worker made of lk3d's own script (the file a `<script src>`
loaded, or an inline script's text: nothing more to ship), off the page's main thread, and without the slices' pauses
it finishes sooner: at 1× (the CPU slowdown does not reach a worker, so only 1× compares fairly), shading done
in ms from mounting, `node test/bench/phone.mjs` with the engine before and after:

| Scene       | On the page, in idle slices | In the worker |
| ----------- | --------------------------- | ------------- |
| Animal cell | 970                         | 353           |
| Jet engine  | 536                         | 245           |
| Molecules   | 2 170                       | 572           |

Where no worker can be made (lk3d imported as a module, a page whose policy forbids workers) the figure shades on the
page in idle slices, as before; `fig.stats().aoWorker` says which. What this cannot show is a phone's GPU: frames held the
screen's rate here because the laptop's GPU did the drawing. A real low-end phone (and its browser) is still the
measurement that matters.

## Flow streaks

`node test/bench/flow.mjs`: the ducted fan of the image tests with n streaks between its two flows, moving, each frame
drawn with `drawNow()` and timed (lk3d's own work, median / 95th percentile in ms; the GPU's work is not in it).
Headless Chromium on the same laptop (Metal), 11 November 2026.

| Streaks | CPU | Placed on the CPU (before) | Placed on the GPU (WebGL 2) |
| ------- | --- | -------------------------- | --------------------------- |
| 2 000   | 1×  | 0.5 / 0.7                  | 0.0 / 0.1                   |
| 8 000   | 1×  | 2.0 / 2.3                  | 0.0 / 0.2                   |
| 2 000   | 6×  | 3.6 / 4.9                  | 0.1 / 1.3                   |
| 8 000   | 6×  | 13.7 / 16.6                | 0.1 / 1.3                   |

Each streak used to be placed on the CPU every frame it moved, and its geometry sent to the GPU again (over 2 MB a
frame at 8 000). On WebGL 2 each flow's paths go to the GPU once, as a float texture (a row a path: each point and its
distance along), and its streaks' fixed numbers as instance attributes; the vertex shader places each corner from the
time travelled, finding its place along the path by halving, so a frame sends one number a flow. WebGL 1 and the 2D
fallback still place them on the CPU. What this moves to the GPU (three lookups of up to 16 steps a corner) is still to
be measured on a phone's GPU.

## Many parts

How far lk3d scales with the number of parts, measured with `node lessonkit/js/bench.cjs`: n small assemblies on a
grid (a plate, a post, a collar; every third with eight bolts; about 430 triangles each), all named, in the pen look.
Headless Chrome on the same laptop (Metal, 60 Hz), 2 November 2026; script is lk3d's work per frame, median / 95th
percentile in ms.

| Parts  | Triangles | Build (Node) | Geometry check (Node) | Frame (60 Hz) | Script      | Before parts alike were drawn together |
| ------ | --------- | ------------ | --------------------- | ------------- | ----------- | -------------------------------------- |
| 1 000  | 432 448   | 0.13 s       | 0.6 s                 | 16.7          | 2.0 / 2.7   | 2.4 / 2.6                              |
| 3 000  | 1 296 000 | 0.24 s       | 1.7 s                 | 16.7          | 4.9 / 5.5   | 18.3 / 22.0                            |
| 10 000 | 4 320 448 | 0.77 s       | 8.7 s                 | 16.7          | 16.7 / 21.4 | 62 / 70 (a frame took 66.6 ms)         |

What was fixed on the way (before: 1 000 parts cost 5.2 ms a frame; building 10 000 parts took 10 s, checking them 100 s):

- shapes alike are built once, and parts alike share one geometry (and its outlines, crease shading, edges and GPU
  buffers), placed by its matrix;
- every batch has a vertex array, so drawing it is one call, not a dozen;
- a part's uniforms are sent only when they differ from the last part's;
- the shadow map's key no longer searches for each part (a quadratic cost);
- labels are made only when first shown, and placed largest part first, never overlapping;
- the geometry check pairs parts through a spatial grid instead of testing every pair;
- parts alike are drawn together: the batches of one shape on solid parts of one material form a group, whose
  copies' matrices and their parts' state (colour and tint, glow, lit and cut) are one buffer, so each pass draws a
  group in one instanced call. A part drawn alone gets the same state as constant attributes, so both share one
  shader path.

**Only what changed, each frame** (8 November 2026). Until then every frame drawn, even one where only the camera
turned, worked out every part's matrix again (with a new array for each multiplication), wrote every copy of every
group of parts alike again and sent all of it to the GPU, and stringified the motions' values for each jointed part
and every liquid's and gas's shape. Now a part's matrix is worked out only when what places it changed, a group writes
and sends only the copies of parts that moved or changed, the joints are solved once for each change of a value, and
liquids and gases are shaped again only when a volume or a height changed (`changed.js`; see design.md). The same scene,
with a motion that lifts every fourth part, each frame drawn with `drawNow()` and timed (`node test/bench/parts.mjs`;
headless Chromium on the same laptop, Metal; median / 95th percentile in ms, the GPU's work not in it):

| Parts | Camera turning, before | after     | A motion playing, before | after     |
| ----- | ---------------------- | --------- | ------------------------ | --------- |
| 1 000 | 1.0 / 1.4              | 0.4 / 0.6 | 1.0 / 1.2                | 0.6 / 0.8 |
| 3 000 | 3.1 / 3.8              | 1.0 / 1.3 | 3.1 / 3.6                | 1.8 / 2.1 |

**What limits it now**: parts alike cost a few calls a pass however many there are; ten thousand of them keep 60
frames a second. What is left of lk3d's own JavaScript while the camera turns is a walk over every part in each pass
(whether it is drawn with its group, and the shadow's key) and the bounds of what is on screen; while parts move, the
groups they are in are sent whole (one buffer each). Parts that are each different are still drawn one by one (a model
of thousands of different parts would need its shapes merged into shared buffers). WebGPU would make that cheaper, so
it waits until a real scene needs it.

## Many figures on a page

Browsers keep only so many WebGL contexts (16 in Chrome) and lose the oldest past that, so a page of 20 figures used
to leave its first ones blank. Now the figures of a page hold at most 8: a figure far off screen makes its context
only when it comes near, and one coming near takes the context of the figure seen least recently, which keeps its
last picture on a 2D canvas until it comes back and draws again (design.md, "Many figures on a page"). The API test
mounts 24 figures and scrolls through them: each draws, at most 8 hold a context, none falls back to 2D or is blank,
and the first, scrolled back to, draws the same picture as before.

## Devices still to measure

- A recent iPhone (the adaptive resolution and the background shader compiling were tuned on one).
- A low-end Android phone (2 GB of memory, a Mali or Adreno 5xx GPU): the case lk3d's size and adaptive resolution
  are for. Open the published benchmark page on it and send the JSON the page gives.
