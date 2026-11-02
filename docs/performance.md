# Performance

lk3d draws only when something changes, pauses when the figure is off screen, compiles the realistic look's shaders in
the background, and lowers its resolution while frames run late. These are the measurements behind that, made with
the benchmark page (`node lessonkit/js/bench.cjs` in the lessonkit repository writes `build/bench/current.html`; open
it, keep the tab in front, press Run).

## Size

The global script `dist/lk3d.min.js`, built by `npm run build`; `npm run size` fails past the budget of 52 KB gzipped.

|                                                                                                                                         | Minified | Gzipped |
| --------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------- |
| lk3d 0.1.0                                                                                                                              | 128.6 KB | 50.9 KB |
| three.js r187, the smallest page (renderer, camera, box, basic material)                                                                | 522 KB   | 131 KB  |
| three.js r187 with what lk3d does (PBR and glass, shadows, environment, orbit controls, picking, glTF, labels, bloom, shape generators) | 708 KB   | 181 KB  |

Measured with esbuild (minify, ES2018) and gzip level 9, 2 November 2026.

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
(twice the triangles: the stand, flanges and bolts, casings in halves). Flow streaks are the one thing whose script
grows with what is drawn: each streak is placed on the CPU every frame it moves (about 0.6 ms for 2000 here), so a page that needs thousands on a
phone draws fewer (`amount`). On this machine the GPU's cost hides under the 120 Hz frame, so the numbers that
matter most come from phones.

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

**What limits it now**: parts alike cost a few calls a pass however many there are; ten thousand of them keep 60
frames a second. Most of what is left is lk3d's own JavaScript each frame a part moves (each part's matrix, then
each copy's in its group: about 1.7 µs a part), and parts that are each different, which are still drawn one by one
(a model of thousands of different parts would need its shapes merged into shared buffers). WebAssembly would not
help the first much; WebGPU would make the second cheaper, so it waits until a real scene needs it.

## Devices still to measure

- A recent iPhone (the adaptive resolution and the background shader compiling were tuned on one).
- A low-end Android phone (2 GB of memory, a Mali or Adreno 5xx GPU): the case lk3d's size and adaptive resolution
  are for. Open the published benchmark page on it and send the JSON the page gives.
