# Changelog

lk3d follows [semantic versioning](https://semver.org): before 1.0, a minor version (0.x.0) may change the scene
format or the API, and says how to move.

## 0.1.0 (unreleased)

The first release as its own package, after it grew as the 3D engine of lessonkit.

**Moving from lessonkit's copy:** `set({ spin })` now takes degrees, like every other angle in lk3d (views, handles,
`camera()`); multiply a radian angle by `180 / Math.PI`. A part's name and note keep only simple formatting (`b i em
strong sub sup br`); other HTML shows as text. `tick(fn)` gets the clock's time, which runs with `LK3D.clock`.

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
- **Small and fast**: 55.8 KB gzipped (140 KB minified), against a budget of 56 KB that `npm run size` enforces;
  draws only on change, pauses off screen, adapts its resolution.
