# Changelog

lk3d follows [semantic versioning](https://semver.org): before 1.0, a minor version (0.x.0) may change the scene
format or the API, and says how to move.

## Unreleased

- **Quarter cuts**: a second plane, `section.second` (`{normal, offset}`), and only what lies beyond both planes is cut
  away, as in a technical cutaway; both faces are filled and hatched, the reader drags either, and `fig.section` reports
  both. A step or the page drops it with `second: false` / `null`.
- **The playground** (`playground/`, published at https://xoai.github.io/lk3d/playground/): a scene's JSON beside the
  figure, drawn as it is typed and checked as `lk3d check` does (the format and the geometry, in a worker), each problem
  shown at its place in the text; the examples to start from; a look and a theme; Share makes a link with the scene in
  it, and the scene goes out as .json or .glb. `npm run playground` serves it from a checkout.
- **Dimensions** (`dimensions` in the scene): lengths between points and angles at vertices, drawn as on a technical
  drawing (extension lines, arrows, the value), their values worked out from the figure as shown, in the scene's unit or
  the dimension's own (`unit`); a point may ride on a part (`{part, at}`), so a length to it follows the part as the
  reader moves it. Steps (`dimensions: [ids]`) and the page (`fig.set({ dimensions })`) choose which show; screen
  readers find them listed. The lens bench example measures the object's distance and the focal length. New word:
  `dimensions`.
- **Examples**: a tour of a human cell (`examples/cell-tour.html`, its scene made by `examples/cell-tour.mjs`), made as
  detailed as an illustrated film: proteins in the membrane, nuclear pores, loose chromatin, smooth ER, mitochondria
  with folded cristae, a Golgi stack with swollen rims and budding vesicles, centrioles of nine triplets, and the
  cytoskeleton's three fibres; eleven guided steps, messenger RNA leaving through the pores, a close-up of the
  membrane. The lens bench measures the object's distance and the focal length.
- A label whose point the cut has taken points at its part's cut face instead; it hides only when the cut has taken
  the whole part. (0.2.0 hid the label of any part whose label point was cut away, though the rest of it still showed:
  the generator's south magnet when cut open, say.)

## 0.2.0 (11 November 2026)

- **Guided steps** (`steps` in the scene): the figure explained in order, each step its words (`title`, `text`) and a
  state of the figure: `view` or `focus`, `explode`, `cut` and `section`, `xray`, `labels`, `hide`, `select`, the
  motions' values (`motion`) and which `play`. A panel under the figure shows the step's words, said aloud, with Back
  and Next; a page goes through them with `fig.step(index or id)` (`currentStep`, `steps`), starts at one with
  `opts.step`, hears the reader's moves with `opts.onStep`, or leaves the panel out (`steps: false`). What a step leaves
  out goes back to the figure's start, so a step is the same picture however the reader came to it. The validator
  checks what steps name; `lk3d render` draws each step (`--poses steps`). New words in every locale: `steps`, `back`,
  `next`, `stepOf`.
- **Crease shading in a Web Worker**: the ambient occlusion is worked out off the page's main thread, in a worker made
  of lk3d's own script (nothing more to ship), and finishes 2 to 4 times sooner (the molecules: 2.2 s to 0.6 at full
  speed). Where no worker can be made it is shaded on the page as before; `fig.stats().aoWorker` says which.
- The size budget is 67 KB gzipped (65 before), for this release's additions.
- **Flow streaks are placed on the GPU** (WebGL 2): each flow's paths go to the GPU once, as a texture, and the vertex
  shader places every streak from the time travelled, so a frame sends one number a flow instead of its streaks'
  geometry. lk3d's own work for 8 000 moving streaks fell from 2.0 ms a frame to under 0.1 (13.7 to 0.1 with the CPU
  slowed six times, as on a low-end phone). WebGL 1 and the 2D fallback place them on the CPU, as before.
- **`<lk3d-figure>`**: a figure as an HTML element, for a page that writes no script (Markdown, a content system): the
  scene from `src` or a JSON script inside, options as attributes (`look`, `theme`, `labels`, `step` change it live;
  `locale`, `controls`, `steps`, `info`, `transparent` mount it again), a line for the part's name and note under it,
  and the reader's moves as events (`lk3d-pick`, `lk3d-handle`, `lk3d-step`, `lk3d-section`, `lk3d-error`);
  `element.figure` and `element.ready` for a script.
- **The reader moves the cut**: with the model cut open, dragging the cut face moves the plane along its normal (up
  and down where it is seen face on), held within the parts it cuts, and a slider beside **Cut open** does the same
  by keys and screen readers. `section.fixed: true` keeps it where the scene puts it; `opts.onSection` hears the
  reader's moves; `fig.section` reads where it is. Labels whose place the cut has passed are no longer shown. New
  words: `cutAt`, `cutAtLabel`.
- A pressed button reads on a dark page: its words take `--lk3d-highlight-ink` (dark by default, for the light
  highlight), not the page's ink, which a dark page sets light.
- Printed, a figure keeps its picture (and a step's words) without the buttons and the hint.
- The npm package leaves out the documentation's pictures (388 KB packed, from 1.1 MB); they are on GitHub.
- `fig.focus()` frames the parts whole: from far enough for the camera's field of view and the stage's shape, and as
  they are taken apart (it stood too close for a tall or wide group, cutting it off).

## 0.1.0 (8 November 2026)

The first release as its own package, after it grew as the 3D engine of lessonkit.

**Moving from lessonkit's copy:** `set({ spin })` now takes degrees, like every other angle in lk3d (views, handles,
`camera()`); multiply a radian angle by `180 / Math.PI`. A part's name and note keep only simple formatting (`b i em
strong sub sup br`); other HTML shows as text. `tick(fn)` gets the clock's time, which runs with `LK3D.clock`. A built
part's `lo hi tris` (the part `onPick` and `onHover` hand the page) are now `min max triangleCount`, and solid balls'
`pos4` is now `positionsAndColors`.

- **Scenes as data**: parts made of shapes, each with a name and a note; a JSON Schema
  (`schema/scene.schema.json`) and a validator (`lk3d/validate`) that says what is wrong where; TypeScript types.
- **Exploring**: turn and zoom by mouse, touch, pen and keyboard, pan by Shift-drag or right-drag; preset views;
  taking apart; cutting open with filled, hatched cut faces; see-through casings; labels with leader lines; a note for
  each part.
- **Moving parts by hand**: handles that turn, slide or follow a path, each also a range input for the keyboard and
  screen readers; lines for rays and field lines; flow streaks along paths, coloured by a ramp (cool to hot), as many
  and as fast as a page value says, with slow motion (`timeScale`); particles along paths; solid balls for
  simulations.
- **Shapes**: 21 kinds, for machines (lathe, cylinder, box, sphere, torus, tube, helix, loop, blade) and for the
  sciences (ellipsoid, capsule, blob, shell, tree, molecule, dna, extrude, terrain, ring, orbit, scatter); glTF 2.0
  models, textured ones included (base colour, normal and metallic-roughness maps; cut-outs by `alphaMode`, in every
  look and in the shadow; double-sided surfaces; glass by `KHR_materials_transmission`, see-through in its tint; a
  shape's `color` in place of a map), lit gently when pointed at so a scan's own colours still read.
- **Looks**: a drawn look, a physically based studio look with generated environments (studio, warm, night),
  surface detail and glass that bends light, and a pen look (near-white solids, smooth on curves and one tone on each
  flat face, thin outlines and edges where faces meet, colour for accents); an orthographic camera for technical
  illustrations; four
  colour themes (light, dark, blueprint, sepia, or the reader's setting) and themes of your own; WebGL 2, WebGL 1 (with
  instancing and vertex arrays) and a Canvas 2D fallback.
- **Accessible and international**: text descriptions, keyboard control, read-out handles, reduced motion; English and
  Vietnamese words; themes through CSS variables.
- **Dependable for tools**: `fig.ready` once a figure is complete; one clock (`LK3D.clock`) that tests can stop and
  step, so every transition can be checked frame by frame; scenes say which version of the format they are written in
  (`"lk3d": 1`).
- **Driven by a timeline** (a video renderer seeking to any time and taking a picture), without touching internals:
  `view(v, { ms })` glides for that long, or places the camera at once with 0, and `set({ camera: { yaw, pitch, dist
or zoom, target } })` places it at once; `set({ labels: [ids or groups] })` shows exactly those parts' labels,
  whatever else is on; a transparent page in every look (`transparent: true`, or a theme's `bg: 'transparent'`): the
  canvas clear, the theme's lines, solids and words still drawn; `LK3D.clock.set(ms)` sets the clock's time, backwards
  too, and with the clock stopped, flows, streams and particles along paths are placed for its time, so one time is one
  picture; `fig.drawNow()` draws before returning; `fig.project([x, y, z], id)` gives a point of the scene or of a part
  on the stage, for a page's own labels. Tweens no longer run backwards when the clock is set back. The page moves the
  cut: `set({ section: { normal, offset } })` places its plane, and `set({ cut: 0..1 })` sweeps it in from just outside
  the model to the section, at once, its shadow following.
- **Checked geometry** (`lk3d/lint`): parts that run into each other while the model is taken apart, parts hanging in
  the air, labels pointing inside other parts; a scene excuses what it means by name (`check: {allow, float}`).
- **Tools and a skill for AI agents**: `lk3d check` (form, geometry, size) and `lk3d render` (a PNG per look and pose,
  drawn by the engine in a headless browser), and an Agent Skill (`skill/lk3d`) with a worked example, a turbofan of
  92 parts.
- **Streams** (`fig.stream()`): air or gas as a moving volume along a path, drawn per pixel by the GPU: filaments
  moving downstream, turbulence, swirl at the edge, a colour ramp; for jets, intakes and plumes. The air moves by
  its travel time: faster where the stream narrows (continuity) or as `speeds` says, never backwards, and its
  turbulence changes with the flow, not the clock. Any number of radius stops; `fade`; the march lengthens for rays
  slanting along the stream.
- **Deep zoom** towards the pointer (wheel, pinch, `fig.zoom`), down to 2% of the whole-model distance by default
  (`view.minZoom`); the orthographic camera keeps its eye outside the model however close it zooms.
- **Pen is the default look** (then studio, then ink): a soft wash of each part's colour, wider tones, a one-pixel
  outline, edges lit or faint by the way they face, and a soft shadow of the object on the ground. Labels on a model
  of many parts are placed largest part first and never overlap.
- **Cutting open**: a part can stay whole (`cut: false`: a stand, a frame); flow streaks are cut with the parts; a
  lathe sector of a concave profile (half a cowl) is closed correctly.
- **Wired as it says** (an independent review, each fix with a test that plants the mistake): `onPick` fires only when
  the reader chooses a part, `onHover` as the pointer moves onto or off one; setting a property of particles, balls or
  lines draws again; the page's `set({explode})` and the reader's hands win over a running tween; a hidden handle
  cannot be grabbed; a handle that goes round turns past 0 both ways by keyboard; labels show a name's simple HTML;
  mounting again on an element replaces its figure, and `destroy()` leaves it as it was and settles `ready`; removed
  lines, balls, flows and streams free their GPU memory; an effect whose shader does not link is left out alone.
- **Right pixels**: the canvas blends premultiplied colour (translucent edges, shadows, glass and glow were too faint
  over a transparent page); the shadow follows the cut and moving lines; balls keep their size in ortho; model maps
  are read without colour management.
- **Sounder geometry and checks**: frames carried round right-angle bends (streams and tubes kept their width),
  terrain closed underneath, sectors given backwards, atoms on top of each other; the geometry check counts a part of
  solids meeting edge to edge (a molecule, a two-piece shaft) as solid, tests the way apart wherever two parts meet on
  it (a pin through a thin plate), and reports parts that make no triangles or NaN; parts alike share one picking
  tree; a model file is read once a scene. `lk3d check` and `render` take flags anywhere, send failures to stderr (as
  JSON under `--json`), check a scene before drawing it and refuse unknown looks.
- **Motions** (`motions` in the scene, `fig.motion(id)`): parts that move together as one value goes along a range
  (a crank and its piston, a sleeve sliding back), written as keyframes; a slider and a play button for a named one;
  `lk3d check` runs each through its range and reports parts that run into each other on the way.
- **Joints** (`joints` in the scene, `set({ joints })`): parts posed by how they are joined instead of keys for each
  (a crank driven by a motion, a piston held by its rod in closed form, the rod aimed at the crank pin, a cam
  following at half speed, joints carried by a parent); validated, and run through their motions by `lk3d check`.
- **glTF export** (`fig.exportGLB()`, `lk3d export`): parts as named nodes with their meshes and materials, posed as
  shown, motions as animations when asked (`{ animate: true }`, `--animate`). The exporter is apart from the global
  script: load `dist/lk3d-export.min.js` after it, or import `lk3d/export` (`dist/lk3d.mjs` has it).
- **lk3d's mark on every figure**: its name in the figure's top-left corner, in every look and in the 2D fallback, so
  what drew the figure is in view with it (and in a screenshot of it); the MIT notice heads every built file. The size
  budget goes from 56 to 57 KB for them.
- **A figure's own credit**: a scene's `author`, `license` and `url` are credited under the figure ("© author,
  licence", the name linked only to a web address) before its models', and written into an exported .glb as glTF's
  `copyright`.
- **A tree is the same tree at every detail**: its form is drawn at full detail always, so a phone and the 2D fallback
  (which build shapes coarser) show the branches a laptop does; they showed another tree.
- **A scene's words stay words**: a model's credit links only to a web address (`http`/`https`; the schema refuses
  another, and the engine shows it as plain text), and the sliders under a figure are built element by element, so a
  motion's name or range cannot add HTML.
- **Cut faces hatched on the cut's plane**: the hatching lies across the section and stays put as the camera moves
  (it was fixed to the screen).
- **Parts alike drawn together**: the batches of one shape on solid parts of one material are drawn in one instanced
  call per pass, each copy with its part's state; ten thousand alike parts keep 60 frames a second (they took 66 ms a
  frame).
- **One sun for every look**: shading and shadow come from one light fixed in the scene, so they agree and stay put
  as the reader turns the model; a look only changes how they are drawn (hatched in ink, soft in pen and studio). The
  ink outline keeps one width on screen (a pixel and a half), as pen's does.
- **The whole model in the first view**: the camera starts far enough back that every point of the model fits the stage,
  whatever its shape (a tall column on its stand, a long optical bench) and wherever the scene points the camera;
  figures that already fit keep their framing.
- **Liquids and gases by their laws** (`vessels`, `liquids`, `gases`, `unit`; `fig.liquid`, `fig.vessel`, `fig.gas`,
  `fig.plume`): a liquid fills its vessel to the level its volume gives, by the vessel's own shape; liquids stack by
  density; an open outlet pours by Torricelli's law into the liquid below, as a falling stream that curves and narrows
  as a projectile under continuity; a gas holds its piston where pV = nRT puts it; a plume rises and widens as a
  buoyant one does. `lk3d check` catches overfull and overflowing vessels, an inside wider than the glass and a piston
  pushed out ([liquids and gases](docs/fluids.md)).
- **Small and fast**: 59.2 KB gzipped (148 KB minified), against a budget of 65 KB that `npm run size` enforces;
  draws only on change, pauses off screen, adapts its resolution.
- **Safe with scenes and models from anyone**: `mount` and `buildScene` check a scene's shape before building
  (`src/guard.js`; the full validator with `opts.validate`), and the glTF reader refuses loops, out-of-range data,
  outside links and oversized images before allocating. A small screen or little memory caps a scene at a million
  triangles (rebuilt at lower detail first; `maxTriangles` to change it). A fuzz suite (`test/trust.test.cjs`) holds
  this. The budget went from 57 to 60 KB for it and for the cut-face fix below, then to 65 KB for room to grow.
- **Parts by keyboard and screen reader**: Page Down and Page Up go through a figure's named parts (as a click),
  Escape lets go; what is chosen is said aloud with its note; the parts are listed for screen readers, and the canvas
  says what its keys do. A finger moved up or down scrolls the page until the figure is touched, as the wheel does.
- **Cut faces drawn on the cut plane** (WebGL 2): a part buried inside a cut one no longer shows through its cut face,
  in every look; the ink look's tones follow curved surfaces without stair steps. Image tests check both
  (`test/visual/quality.spec.mjs`), and every shipped scene passes `lk3d check` (`test/scenes.test.cjs`).
- **Only what changed, each frame**: a part's matrix is worked out again only when what places it changes, groups of
  parts alike send to the GPU only the copies that moved, joints are solved once per change of a value and liquids
  shaped again only when a volume or height changes: turning the camera over 3 000 parts costs 1.0 ms a frame, not
  3.1 (`test/bench/parts.mjs`).
- **Many figures on a page**: they hold at most 8 WebGL contexts between them (browsers lose the oldest past 16); a
  figure far off screen makes its context when it comes near, and the one seen least recently gives its context up,
  keeping its last picture until it is back. A context the browser loses waits to be restored, never drawn in 2D.
- **Readable inside**: `mount()`, one 2 200-line closure, is now a part per subsystem in `src/figure/` (camera, frame
  loop, renderer and contexts, picking, labels, input, …) sharing one context object, and the sources are
  type-checked as JavaScript (`npm run typecheck`). Nothing changes for pages, pictures or size.
- **A misspelt field is caught**: every object in the scene format is closed, so `lk3d check`, `validate` and
  lessonkit refuse a field the format does not have, at the field itself and with the name it is nearest to
  (`parts[2].handle.mine: is not a field here (min?)`); a shape's field written on its part is said to belong on a
  shape. A page's own data goes under `extras`, on the scene or on a part (as in glTF), which lk3d keeps and does not
  read. Before, unknown fields were allowed anywhere but in shapes.
- **Leader lines updated in place**: each label's line and dot are made once and moved, not rebuilt as SVG every frame
  a label moves.
- **Built for ES2020** (from ES2018): Chrome and Edge 80, Firefox 74, Safari 13.1 (iOS 13.4) and Samsung Internet 13 or
  later, as lessonkit's pages already need; `?.` and `??` stay as written, about 0.9 KB smaller gzipped. The type check
  allows only what ES2020 has.
- **`lk3d render` without a browser ends**: with Playwright installed but not its Chromium, it says what to install
  and exits with code 2; before, its page server stayed open and it never exited.
