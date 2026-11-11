# How lk3d works

lk3d is about 8 000 lines of plain JavaScript (ES modules, no dependencies). This page is the map.

## Files

| File                                                                        |                                                                                                                                                                                                                                           |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/index.js`                                                              | `mount()`: makes a figure's context and its parts in order (`src/figure/`), adds the built-in controls, returns the figure's API; the module's exports                                                                                    |
| `src/namespace.js`, `src/clock.js`                                          | the `LK3D` object (the settings figures read live: `defaults`, `locales`, `themes`, `reduce`, `toGLB`) and `build`; the clock every figure animates by, and the screen's refresh measured                                                 |
| `src/figure/context.d.ts`                                                   | a mounted figure's shared state (`Ctx`): what each part of the figure owns and what the others read                                                                                                                                       |
| `src/figure/backend.js`                                                     | the WebGL context (at most 8 held by a page's figures), the renderer on it, the 2D fallback, a context given up, lost and restored                                                                                                        |
| `src/figure/pose.js`                                                        | where each part is: taken apart, moved, by its handle, motions and joints, the spin; motions played, taking apart tweened                                                                                                                 |
| `src/figure/liquids.js`                                                     | a figure's liquids and gases moved on by their laws each frame (`fluids.js`), their bodies shaped again when they change                                                                                                                  |
| `src/figure/camera.js`                                                      | the camera fitted to the stage, views and their glides, zooming towards a point, the cut's plane, rays through the stage                                                                                                                  |
| `src/figure/dom.js`                                                         | the elements (stage, canvas, words for screen readers, list of parts, hint, scale, credits), the info box and what is said aloud                                                                                                          |
| `src/figure/loop.js`                                                        | the frame loop: drawing only on change, the canvas's size and adaptive resolution, things moved along paths by the clock, watching size and visibility                                                                                    |
| `src/figure/look.js`                                                        | the looks, the themes and the sun; the look in use, with the stage's background and variables                                                                                                                                             |
| `src/figure/labels.js`                                                      | labels and leader lines (measured once, moved with transforms), the scale bar                                                                                                                                                             |
| `src/figure/pick.js`                                                        | picking: a ray through the stage against each part's bounding-volume trees                                                                                                                                                                |
| `src/figure/idle.js`                                                        | the work done in idle slices after the first picture (the trees, crease shading, edges) and `ready`                                                                                                                                       |
| `src/figure/input.js`                                                       | the pointer, wheel and keys; handles grabbed and dragged, and each as a range input                                                                                                                                                       |
| `src/figure/additions.js`, `src/figure/api.js`                              | what a page adds (particles, flows, streams, lines); the figure's API                                                                                                                                                                     |
| `src/figure/steps.js`                                                       | guided steps: going to one (everything it describes set, the rest back at the start; the cut swept in, the camera framing what it focuses on), and the panel of words with Back and Next                                                  |
| `src/geometry.js`                                                           | `Mesh` (positions, normals, indices, optional vertex colours and texture coordinates), the shapes for machines (lathe, cylinder, box, sphere, torus, tube, helix, loop), placement and repeats, `buildScene` (parts → batches), materials |
| `src/science.js`                                                            | the shapes for the sciences: ellipsoid, capsule, blob, shell, tree, molecule, dna, extrude, terrain, ring, orbit, blade, and a seeded random generator                                                                                    |
| `src/gltf.js`                                                               | reading `.glb` models (synchronously, from base64): nodes, quantized attributes, colours, texture coordinates and maps                                                                                                                    |
| `src/gltf-write.js`                                                         | writing a figure out as `.glb`: a node, mesh and material for each part, posed as shown, and each motion as an animation when asked                                                                                                       |
| `src/export.js`, `src/export-script.js`                                     | the exporter apart from the engine: `lk3d/export` (the module, with lk3d) and `dist/lk3d-export.min.js` (the script)                                                                                                                      |
| `src/flow.js`                                                               | streaks along paths: their geometry each frame (seeded, so pictures repeat), the colour ramps, and the path measure particles share                                                                                                       |
| `src/renderer-gl.js`, `src/shaders.js`                                      | the WebGL 2 and WebGL 1 renderer and its shaders (written once, compiled as GLSL ES 1.00 or 3.00)                                                                                                                                         |
| `src/renderer-2d.js`                                                        | the Canvas 2D fallback                                                                                                                                                                                                                    |
| `src/bvh.js`                                                                | bounding-volume trees: picking and ambient occlusion by rays on the CPU                                                                                                                                                                   |
| `src/math.js`                                                               | small vector and 4×4 matrix helpers (column-major, as WebGL wants them), colours                                                                                                                                                          |
| `src/changed.js`                                                            | whether what something was made from has changed since (values compared without garbage): a part's matrix, groups of parts alike, the shadow map, the liquids' bodies                                                                     |
| `src/handles.js`                                                            | the handle maths: a pointer ray to an angle, a distance or a place along a path (pure, tested in Node)                                                                                                                                    |
| `src/motion.js`                                                             | motions: keys between values, and a part's matrix at the motions' values (shared by the engine and the check)                                                                                                                             |
| `src/joints.js`                                                             | joints: each part posed by how it is joined (turned, slid, held by a rod, aimed, following another joint), solved in order from the motions (shared by the engine, the check and the export)                                              |
| `src/fluids.js`                                                             | liquids and gases by their laws: a vessel's volume and level, settling by density, Torricelli's outflow, the falling stream, the ideal gas, a plume (shared by the engine and the check)                                                  |
| `src/stream.js`                                                             | streams: a path's travel-time table, the radius profile, and the hull the GPU marches through                                                                                                                                             |
| `src/lint.js`                                                               | the geometry check: parts that run into each other when taken apart or as a motion moves, floating parts, hidden labels (not in the runtime bundle)                                                                                       |
| `src/controls.js`, `src/stylesheet.js`, `src/text-width.js`, `src/locales/` | the built-in buttons, the stylesheet, label widths, the words                                                                                                                                                                             |
| `src/validate.js`, `schema/scene.schema.json`                               | the scene format and its validator (not in the runtime bundle)                                                                                                                                                                            |
| `index.d.ts`, `scene.d.ts`, `scripts/types.mjs`, `tsconfig.json`            | the TypeScript types: the page API by hand (`index.d.ts`), the scene's types generated from the schema (`scene.d.ts`, by `scripts/types.mjs`: `npm run types`); the sources are type-checked as JavaScript against them (`tsconfig.json`) |
| `build.mjs`                                                                 | the bundle (esbuild), with the shaders' GLSL squeezed (comments and spaces out, line breaks kept) and the context's fields renamed short                                                                                                  |
| `bin/lk3d.mjs`                                                              | the command line: `lk3d check`, `lk3d render` (the built engine in a headless browser) and `lk3d export`                                                                                                                                  |

## A mounted figure

`mount()` makes one object per figure, its context (`c`, typed as `Ctx` in `src/figure/context.d.ts`), puts in it
what the page gave (the element, the scene, the options, the state the page reads as `_state`, the canvas) and the
built scene, then hands it to each part of the figure in turn: `makePose(c)`, `makeLiquids(c)`, `makeCamera(c)`, … in
the order the figure's elements, listeners and timers have always been made. Each part keeps what only it uses in its
own closure (the frame loop's pending frame and resolution, a tween in progress, the picking trees) and puts on the
context what others read or call: `c.renderer_`, `c.width_` and `c.height_` (the stage's size), `c.viewProj_` (the
camera's matrix), `c.kick_()` (draw a frame), `c.showInfo_()`, `c.pickAt_()`, `c.addLines_()`… Each module's first
lines say what it owns and what it reads. A part calls another only through the context, and only once the figure is
made (in an event, a frame or a timer), so the order they are made in matters only for what they do at once.

Every field of the context ends in `_`, and nothing else in lk3d does: `build.mjs` renames them to one or two letters
(esbuild's `mangleProps`, the most used the shortest), so the context costs the bundle what local variables did, and
its fields can have names that say what they are. The parts read it as `c.state_.explode`, `c.built_.parts`,
`c.kick_()`, not through local copies: the same few strings then recur through the bundle, and gzip packs them (local
copies cost some 300 bytes gzipped). `index.js` imports the parts in the order `mount` makes them, which the bundle
keeps (another 300).

## A scene becomes batches

`buildScene` turns each part into **batches**: one geometry drawn at one or more placements. A part's plain shapes are
merged into one batch; a shape repeated round an axis (28 fins, 12 coils) stays one geometry drawn with 28 matrices
(instancing), unless a copy is mirrored or stretched, which is baked into the merged geometry instead (normals go
through the cofactor matrix, so they stay true). A textured model is a batch of its own. Uploaded, a batch's positions
are 16-bit and its normals 8-bit, quantized per batch. Parts alike share their batches' buffers, and at draw time the
batches of one shape on solid parts of one material form a group drawn in one instanced call per pass, each copy
with its part's matrix and state.

## The renderer

Every renderer has the same small interface, so another (WebGPU) can sit beside them:

```js
renderer = { kind: 'webgl2' | 'webgl1' | '2d', hifi, shadows, parallel,
  draw(frame),     // the parts (matrices, alpha, glow), the camera, the look, the cut, hover and selection…;
                   // false while its shaders are still compiling (the engine tries again next frame)
  prewarm(),       // after the first picture: compile what other looks need, in the background
  setAO(batch), upload(batch), instances(batch), release(thing), dispose() }
```

A frame (WebGL 2, studio look): the shadow map (drawn again only when something that casts a shadow moves, the cut
changes or lines move, not when the camera turns); the outline; the solid parts; the ground's shadow; solid
particles; see-through parts far to near (glass that refracts samples a copy of the picture made just before); the
pen look's edges; path particles; flow streaks (ribbons widened on screen in the vertex shader, inked over a light page
or added to a dark one); streams (the solid parts' depth, drawn again only when they or the camera move; each stream,
far to near, marched once per pixel from its hull's farthest face into a half-size picture, put over the page); the
glow (emission at half resolution, blurred at a quarter, added). Every look has one sun, fixed in the scene: it shades the
parts and casts the shadow, so the two always agree and stay put as the reader turns the model. It is high,
from the right and in front of the usual first view; each look then draws the same shadow its own way (hatched in
ink, soft in studio and pen). The environment is drawn once
into a cube map and prefiltered per roughness on the GPU. Every pass blends premultiplied colour, and so does the
canvas: the page shows through anti-aliased edges, shadows, glass and glow as it should.

WebGL is used where it has instancing and vertex arrays (every WebGL 2, nearly every WebGL 1); otherwise, or if a part
shader does not link or a mesh cannot be indexed, the figure draws in 2D instead. An effect whose shader does not link
on a device (streaks, streams, edges, particles, the glow) is left out, with a warning, and the rest draws.

## Many figures on a page

Each figure has its own WebGL context, and browsers keep only so many (16 in Chrome) before losing the oldest. So
the figures of a page hold at most 8 between them (`MAX_GL` in `figure/backend.js`). A figure mounted while 8 are held, far
off screen, makes no context until it comes near (its IntersectionObserver, 100 px around the screen); until then its
renderer is a stand-in that draws nothing (`renderer` is `''`, `ready` waits), while its picking trees, crease
shading and edges are worked out as usual. A figure coming near when 8 are held takes the context of the one seen
least recently that is off screen: that one draws once more, copies its picture to a 2D canvas under its WebGL one
(at CSS-pixel size, so it holds little memory), and gives its context up (`WEBGL_lose_context`). Coming back, it asks
for the context back (`restoreContext`), and the path every lost context takes rebuilds the renderer (buffers,
crease shading, edges, lines); the copy goes once it has drawn again. A context the browser loses or cannot make
meanwhile waits to be restored: the 2D fallback is only for a WebGL that cannot draw the scene. A figure scrolled
back to shows its last picture at once, and its own a frame or two later.

## Drawing only when something changes

Nothing is drawn unless something moved: `kick_()` (`figure/loop.js`) asks for one frame, and the loop runs only
while something animates (a glide, momentum, particles, a page's `tick`). The figure pauses while it is off screen (IntersectionObserver) or
the tab is hidden. While frames come late during motion it lowers its resolution, and draws at full resolution again
once still. The screen's refresh rate is measured from frame intervals (the median, snapped to a common rate).

A frame drawn does only what changed (`changed.js` compares what each thing was made from with what it is now, value by
value, without garbage). A part's matrix is worked out again only when what places it changed: taking apart, its
offset, its handle, the spin, its motions' values, the joints' pose (solved once for each change of a motion's or a
joint's value). Parts' matrices are new objects only then, so what follows compares them by identity: a group of parts
alike writes a copy's matrix and state again only for a part that moved or changed, and sends its buffer to the GPU
only then; the shadow map and the streams' depth are drawn again only when a part moves (or the cut, the light or,
for the depth, the camera). Turning the camera draws a thousand parts with no matrix worked out and nothing sent.
Liquids and gases are shaped again only when a volume or a height changed.

## Nothing read back while drawing

Labels are HTML, measured once (canvas text metrics, cached, measured again when web fonts arrive) and moved with
transforms, so a frame never forces the page to lay itself out. Picking casts a ray on the CPU against each batch's
bounding-volume tree (built in idle slices just after the first picture) instead of reading a pixel back from the GPU.
Ambient occlusion is computed the same way, a few milliseconds per frame after the first picture, then uploaded.

## Handles

A pointer that lands on a part with a handle (or near a small one) grabs it instead of turning the view. The pointer's
ray becomes a value (`handles.js`): for a turn, the angle of its hit on the plane at right angles to the axis, added up
as it goes round; for a slide, the point of the axis nearest the ray; along a path, the nearest point of the path on
screen. The value is held to `min`/`max` and `snap`, and the part (and what it `moves`) is drawn with the handle's
matrix. Each handle is also a range input, so the keyboard and screen readers reach it.

## The scene format

`schema/scene.schema.json` is the one description of the format: editors read it, `docs/scene-format.md` and the
scene's TypeScript types (`scene.d.ts`) are generated from it, and `src/validate.js` checks scenes against it (a small evaluator of the JSON Schema it uses, plus the rules a
schema cannot say). The engine's tests check that the schema names exactly the shapes, materials, surfaces and
environments the engine draws.

## Tests

`npm test`: geometry (every shape a closed solid facing outwards, volumes matching their formulas, placement and
instancing, picking against brute force), glTF reading and writing, handle maths, motions and joints, liquids and gases,
the validator and the geometry check against planted mistakes, the command line, the skill, the locales. `npm run
typecheck`: the sources (as JavaScript, against the types), the types, and every reference and example scene against
them. `npm run size`: the 65 KB budget. `npm run test:visual`: 18 reference scenes in their looks
(some also in the 2D fallback, a theme or the orthographic camera) and the page API, compared with stored pictures
(`test/visual/`). Pictures are stored per browser and platform: Chromium and Firefox on macOS, and Chromium, Firefox
and WebKit on Linux (the CI workflow's). WebKit is skipped on macOS 14 and older (Playwright cannot drive it there).
`npm test` also runs every reference and example scene through `lk3d check`, and checks that `scene.d.ts` is what the
schema makes.

## Limits

- **Shapes and models.** Generated shapes cover machines, cells and neurons, molecules, rock and landscapes, planets
  and solid geometry; detailed anatomy and scanned objects come in as glTF models, textured ones included (no
  animations, and one textured material per model shape: take a model with several apart by node).
- **Glass** refracts what is behind it once: glass seen through glass shows the opaque parts behind, not the first
  glass bent twice. Flat panes are best left without `refract`.
- **Very detailed shapes** (over 40 000 vertices in one shape) get no crease shading, to spare phones the rays.
- Animation is either written in the scene (`motions`: keyframes, and `joints` posed from them, each named motion with
  a slider and a play button under the figure; liquids pouring and gases settling by their laws) or driven by the page
  (spin, glow, particles, moved parts, a motion's value). There is no general physics engine; a page that simulates
  writes its own model.
- The cut is one plane at a time: the scene's (`section`), which a page can move or sweep through the model
  (`set({ section, cut })`); the reader cannot drag it.
- Ambient occlusion is computed per part (a part's own creases and hollows), not between parts.
- The 2D fallback has no section view (its button is not offered) and no shadows, and draws balls without sorting them
  by depth; WebGL 1 has no cast shadows, no glow halo, no surface detail, refraction or textures.
- Adaptive resolution counts every late frame, including frames made late by the page's own work (a simulation):
  lowering the resolution then does not help much. A page with heavy work of its own can pass `adaptive: false`.
- Adaptive resolution has been measured on a laptop and an iPhone; not yet on a slow Android phone.
- No WebGPU backend yet: today's scenes (about 20 draws, under 250 000 triangles) are not limited by what it improves;
  it becomes worth writing for GPU compute (large particle flows, Gaussian splats of scanned objects).
