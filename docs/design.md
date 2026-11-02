# How lk3d works

lk3d is about 5 000 lines of plain JavaScript (ES modules, no dependencies). This page is the map.

## Files

| File                                                             |                                                                                                                                                                                                                                                                                                             |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/index.js`                                                   | `mount()`: one closure per figure holding its state, in sections (a map at the top of `mount`): the elements, the renderer, the camera, drawing, labels, picking, ambient occlusion, the pointer and handles, particles, lines, views, the figure's API, the built-in controls, the handles as range inputs |
| `src/geometry.js`                                                | `Geo` (positions, normals, indices, optional vertex colours and texture coordinates), the shapes for machines (lathe, cylinder, box, sphere, torus, tube, helix, loop), placement and repeats, `buildScene` (parts → batches), materials                                                                    |
| `src/science.js`                                                 | the shapes for the sciences: ellipsoid, capsule, blob, shell, tree, molecule, dna, extrude, terrain, ring, orbit, blade, and a seeded random generator                                                                                                                                                      |
| `src/gltf.js`                                                    | reading `.glb` models (synchronously, from base64): nodes, quantized attributes, colours, texture coordinates and maps                                                                                                                                                                                      |
| `src/flow.js`                                                    | streaks along paths: their geometry each frame (seeded, so pictures repeat), the colour ramps, and the path measure particles share                                                                                                                                                                         |
| `src/renderer-gl.js`, `src/shaders.js`                           | the WebGL 2 and WebGL 1 renderer and its shaders (written once, compiled as GLSL ES 1.00 or 3.00)                                                                                                                                                                                                           |
| `src/renderer-2d.js`                                             | the Canvas 2D fallback                                                                                                                                                                                                                                                                                      |
| `src/bvh.js`                                                     | bounding-volume trees: picking and ambient occlusion by rays on the CPU                                                                                                                                                                                                                                     |
| `src/handles.js`                                                 | the handle maths: a pointer ray to an angle, a distance or a place along a path (pure, tested in Node)                                                                                                                                                                                                      |
| `src/motion.js`                                                  | motions: keys between values, and a part's matrix at the motions' values (shared by the engine and the check)                                                                                                                                                                                               |
| `src/stream.js`                                                  | streams: a path's travel-time table, the radius profile, and the hull the GPU marches through                                                                                                                                                                                                               |
| `src/lint.js`                                                    | the geometry check: parts that run into each other when taken apart or as a motion moves, floating parts, hidden labels (not in the runtime bundle)                                                                                                                                                         |
| `src/controls.js`, `src/style.js`, `src/text.js`, `src/locales/` | the built-in buttons, the stylesheet, label widths, the words                                                                                                                                                                                                                                               |
| `src/validate.js`, `schema/scene.schema.json`                    | the scene format and its validator (not in the runtime bundle)                                                                                                                                                                                                                                              |
| `build.mjs`                                                      | the bundle (esbuild), with the shaders' GLSL squeezed (comments and spaces out, line breaks kept)                                                                                                                                                                                                           |

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
glow (emission at half resolution, blurred at a quarter, added). The pen look's shadow map is drawn from a light
straight above and falls only on the ground; its shading light turns with the camera. The environment is drawn once
into a cube map and prefiltered per roughness on the GPU. Every pass blends premultiplied colour, and so does the
canvas: the page shows through anti-aliased edges, shadows, glass and glow as it should.

WebGL is used where it has instancing and vertex arrays (every WebGL 2, nearly every WebGL 1); otherwise, or if a part
shader does not link or a mesh cannot be indexed, the figure draws in 2D instead. An effect whose shader does not link
on a device (streaks, streams, edges, particles, the glow) is left out, with a warning, and the rest draws.

## Drawing only when something changes

Nothing is drawn unless something moved: `kick()` asks for one frame, and the loop runs only while something animates
(a glide, momentum, particles, a page's `tick`). The figure pauses while it is off screen (IntersectionObserver) or
the tab is hidden. While frames come late during motion it lowers its resolution, and draws at full resolution again
once still. The screen's refresh rate is measured from frame intervals (the median, snapped to a common rate).

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

`schema/scene.schema.json` is the one description of the format: editors read it, `docs/scene-format.md` is generated
from it, and `src/validate.js` checks scenes against it (a small evaluator of the JSON Schema it uses, plus the rules a
schema cannot say). The engine's tests check that the schema names exactly the shapes, materials, surfaces and
environments the engine draws.

## Tests

`npm test`: geometry (every shape a closed solid facing outwards, volumes matching their formulas, placement and
instancing, picking against brute force), glTF reading, handle maths, the validator against planted mistakes, the
locales. `npm run typecheck`: the types. `npm run size`: the 52 KB budget. `npm run test:visual`: 12 reference scenes
in each look and the 2D fallback, in Chromium, Firefox and WebKit, compared with stored pictures (`test/visual/`).

## Limits

- **Shapes and models.** Generated shapes cover machines, cells and neurons, molecules, rock and landscapes, planets
  and solid geometry; detailed anatomy and scanned objects come in as glTF models, textured ones included (no
  animations, and one textured material per model shape: take a model with several apart by node).
- **Glass** refracts what is behind it once: glass seen through glass shows the opaque parts behind, not the first
  glass bent twice. Flat panes are best left without `refract`.
- **Very detailed shapes** (over 40 000 vertices in one shape) get no crease shading, to spare phones the rays.
- Animation is what the page drives (spin, glow, particles, moved parts). There is no general physics engine; a page that
  simulates writes its own model.
- The cut is one plane through the model, chosen in the scene (`section`); the reader cannot move it yet.
- Ambient occlusion is computed per part (a part's own creases and hollows), not between parts.
- The 2D fallback has no section view (its button is not offered) and no shadows, and draws balls without sorting them
  by depth; WebGL 1 has no cast shadows, no glow halo, no surface detail, refraction or textures.
- Adaptive resolution counts every late frame, including frames made late by the page's own work (a simulation):
  lowering the resolution then does not help much. A page with heavy work of its own can pass `adaptive: false`.
- Adaptive resolution has been measured on a laptop and an iPhone; not yet on a slow Android phone.
- No WebGPU backend yet: today's scenes (about 20 draws, under 250 000 triangles) are not limited by what it improves;
  it becomes worth writing for GPU compute (large particle flows, Gaussian splats of scanned objects).
