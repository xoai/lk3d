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
- **Exploring**: turn, zoom and pan by mouse, touch, pen and keyboard; preset views; taking apart; cutting open with
  filled, hatched cut faces; see-through casings; labels with leader lines; a note for each part.
- **Moving parts by hand**: handles that turn, slide or follow a path, each also a range input for the keyboard and
  screen readers; lines for rays and field lines; flow streaks along paths, coloured by a ramp (cool to hot), as many
  and as fast as a page value says, with slow motion (`timeScale`); particles along paths; solid balls for
  simulations.
- **Shapes**: 21 kinds, for machines (lathe, cylinder, box, sphere, torus, tube, helix, loop, blade) and for the
  sciences (ellipsoid, capsule, blob, shell, tree, molecule, dna, extrude, terrain, ring, orbit, scatter); glTF 2.0
  models, textured ones included (base colour, normal and metallic-roughness maps).
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
- **Parts alike drawn together**: the batches of one shape on solid parts of one material are drawn in one instanced
  call per pass, each copy with its part's state; ten thousand alike parts keep 60 frames a second (they took 66 ms a
  frame).
- **Small and fast**: 51 KB gzipped (a budget of 52); draws only on change, pauses off screen, adapts its resolution.
