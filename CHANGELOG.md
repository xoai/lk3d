# Changelog

lk3d follows [semantic versioning](https://semver.org): before 1.0, a minor version (0.x.0) may change the scene
format or the API, and says how to move.

## Unreleased

Nothing a page or a scene already does changes.

- **Labels keep clear of the scale and the hint.** A label no longer lands under the scale bar and its note, or under
  the hint while it shows. Both are measured where the stylesheet puts them, again only when the stage's size or the
  hint changes. The hint and the scale each take at most half the stage's width at its foot, so a long note no longer
  covers the hint's last words, and a phone's note is at most 70 % wide at the top. Found by the review of the
  bai-giang lessons, where long notes hid labels on every phone.
- **A label that must show still keeps clear of the scale and the hint.** A step's labels, and the label of the part
  pointed at or chosen, show even where no free place is found; they now take the nearest place clear of the scale and
  the hint (half a line at a time, down or up), overlapping other labels if they must, instead of their own place under
  the note or the hint. At 375 px this was so in four bai-giang lessons (seven labels across their steps).
- **A shorter touch hint, as wide as a phone's stage.** "Drag sideways to turn · tap to turn freely · pinch to zoom"
  ("Kéo ngang để xoay · chạm để xoay tự do · chụm để phóng to"). On a narrow stage, where the scale moves to the top,
  the hint is no longer held to half the width: two lines at most instead of five in a lesson's lettering.
- **The ground is not drawn from below.** With the camera under the ground (or an orthographic view looking up), the
  ground and its shadow veiled everything in view in grey (a watch's dial seen from under it). They are left out there,
  and come back as the camera rises above the ground.
- **The check no longer reports parts that turn together as running into each other.** Two parts that keep their pose
  to each other through a motion (on one joint, or a joint and its child) are not compared mid-motion, and the rest
  are compared in the second part's own frame. Parts whose faces met (a jewel setting under a watch's plate) were passed
  over at the start, by boxes in the scene's axes, and tested mid-turn, where the rounding of the turned pose put some
  of their points inside: turning a whole watch over reported sixteen such pairs. A watch's check is also twice as fast.
- **The budget** was unchanged by these fixes: the global script was 72,178 of 72,192 bytes gzipped (the figure's
  elements are now made by one helper, for the room the labels and the ground take).
- **One default changes: a glide with no `ms`** (`fig.view()`, a guided step) now takes 500 ms to 1.6 s, worked out
  from the move (its turn, its zoom, how far the target goes), with cubic easing, the distance gliding in log (a zoom from
  a whole cell to one protein no longer rushes its end) and a far move pulling back a little on the way; it was 600 ms,
  quadratic. `{ ms: 600 }` keeps the old timing. A step's camera, taking apart and cut now glide together, over the
  step's `ms`, else the page's `step(i, { ms })`, else the camera's. A step's `focus` frames parts where its motions put
  them (a sequence's stage done), not where they rest.
- **`onStep` is told every step change, with who made it:** `onStep(index, step, by)`, `by` being `'reader'` (the
  panel's Back and Next), `'page'` (`fig.step()`) or `'tour'`; `<lk3d-figure>`'s `lk3d-step` event carries `by` too. A
  page's `fig.step()` was not told before; a settled step, a state set back with `set()` and the step at mount are still
  not. **`onChange`'s cause gains `'tour'`** (between `'motion'` and `'page'`): a TypeScript switch over `ChangeCause`
  that is exhaustive must add it. `fig.quietly(fn)` runs the page's own code as lk3d's callbacks are run, so what it
  changes is not page input (a tour does not pause for it); every function the page gives `mount` and every `fig.tick`
  is run so.
- **Add-ons join through `LK3D.use(name, api, needs)`,** which checks the host's names an add-on needs against
  `LK3D.hostNames` (the names every figure lends its add-ons) and refuses, naming them, on a core too old for it: "lk3d-NAME
  needs the host's frame: load lk3d 0.8.0 or later". `<lk3d-figure>` elements refused for want of an add-on are drawn once
  it joins, as they were for the models add-on. `hostVersion` stays 1, and the 0.7.0 live add-on keeps working.
- **The budget goes from 70.5 KB to 70.9 KB** (72,601 bytes) gzipped, by the user's decision of 2026-11-23 (23
  November 2026): the core may grow to at most 74.5 KB over the two lk3d 0.8.0 and 0.9.0 releases, each raise to the code's
  measured need, at most 72.9 KB after 0.8.0: 70.9 KB for the add-on host (72,598 bytes), then 71.1 KB (72,806 bytes) for the scene format's sequences, steps' times and the engine's own check of them (72,716 bytes), then 71.3 KB (73,011 bytes) for sequences as motions and the story add-on's hooks (72,996 bytes), then 71.5 KB (73,216 bytes) for paced play and settled steps (73,210 bytes), then 71.7 KB (73,420 bytes) for fading (73,340 bytes), then 71.9 KB (73,625 bytes) for camera glides and the motion-aware box (73,619 bytes), then 72.3 KB (74,035 bytes) for motions that are alternatives and clips (73,987 bytes), then 72.5 KB (74,240 bytes) for the reader hook and the page-input pause (74,210 bytes), then **72.6 KB** (74,342 bytes) for the tour's panel at phone width and the reader hook's rules (74,298 bytes).

## 0.7.0 (23 November 2026)

Nothing a page or a scene already does changes. The card comes with the live add-on, `dist/lk3d-live.min.js`, which a
page that loads lk3d as a script loads after it (`card: true` without it is refused, naming it); an ES module has it
built in. `LK3D.version` stays 3.

- **A card over the stage** (`mount(el, scene, { card: true })`, the live add-on): the part the reader chooses, on the
  right (a sheet at the bottom below 620 px): a line over its name (the scene's `part.card.eyebrow`), its name, its
  note, rows of values the page fills (`fig.card({ rows })`, merged with what it gave before, dropped when the reader
  chooses or lets go, or the page chooses another part) and where it comes from (`part.card.source`). Its × and Escape let the part go (`onPick(null)`) and give
  the keys back to the canvas; nothing holds the focus. It follows the figure's colours, its themes and looks; its
  text is kept as safe as a note.
- **A label's second line** (`fig.tagText(id, text)`): a smaller line under the part's name, for a live value; the
  label grows to hold it and labels keep clear of each other with it.
- **The scene format:** a part's `card` (`eyebrow`, `source`).
- **The budget.** Both budgets are unchanged: the global script holds the label's second line and `fig.card` (72,071
  of 72,192 bytes gzipped); the card itself goes in the live add-on (4,092 of 4,096 bytes).
- **The examples:** the AC generator shows its parts on the card, the rotor's and the lamp's live values on it and
  under their labels.

## 0.6.0 (23 November 2026)

Nothing a page or a scene already does changes. In TypeScript, a handle's value is now `number | [number, number]` (a
plane handle's is a pair): a page that does arithmetic on `onHandle`'s value narrows it first (`typeof v === 'number'`).
Surfaces and arrows come with a new add-on, `dist/lk3d-live.min.js`, which a page that loads lk3d as a script loads
after it; an ES module has them built in. `LK3D.version` stays 3.

- **Hits** (`fig.hit(x, y | event, { plane, surfaces, minAlpha })`, `fig.ray(x, y)`): the part or surface under a
  point, the point, the face's normal facing the eye, the distance along the ray, and on a cut face the cut plane's
  point and normal; or where the ray meets a plane the page names.
- **The page's own drags** (`onPress`, `onDrag`, `onRelease`): a page takes a gesture, so the view does not turn and a
  touch does not scroll the page; other pointers wait.
- **Turning a part from the page** (`set({ move: { id: { by, turn: { axis, angle, center } } } })`): turned about a
  point of it, then shifted in the scene's axes; labels, picking, the cut, framing and a handle's frame follow.
- **Colour ramps** for balls the page places: 2 to 4 stops or a ramp's name, banded or blended (`smooth`), following
  the page from light to dark.
- **Plane handles** (`handle: { plane: { axes, center, names } }`): a place in a plane, its value `[u, v]`, held and
  snapped per axis, two range inputs for the keyboard and screen readers, refused by `validate` with axes not at right
  angles or a number for a pair.
- **Surfaces** (`fig.surface`, the live add-on): heights the page writes on a grid drawn as one smooth, two-sided mesh,
  refilled in place, tones along a ramp; found by `hit`, read by `heightAt`, a smaller grid in the 2D fallback. A
  256 × 256 surface reshaped every frame costs lk3d 3.3 ms a frame on the reference laptop.
- **Arrows** (`fig.arrows`, the live add-on): lines with a cone at each tip.
- **The examples:** a pendulum's period, and a ripple tank, built on all of it.
- **Fixed:** lines a page added to a figure still waiting for its first WebGL context (far off screen, on a page whose
  eight contexts were taken) made it fall back to 2D when it got one. Whatever a page adds is now given to each new or
  restored context, and to the 2D fallback. Picking in the 2D fallback no longer treats parts as cut away.
- **The budget.** The global script's budget goes from 68 KB to **70.5 KB** (72,192 bytes) gzipped, by the user's
  decision of 22 November 2026: hits, the page's own drags, turned parts, colour ramps and plane handles go in the
  core; surfaces and arrows go in the live add-on (budget 4 KB).
- Sizes: the global script 180.7 KB (70.0 KB gzipped: 71,678 bytes, against 72,192), the live add-on 5.8 KB (2.9 KB
  gzipped: 3,016 bytes).
- **Still open before release:** the check on a real phone (a bob and P dragged without scrolling the page; Chromium's
  touch emulation passes); and the Linux pictures of the new reference scenes (ramp, arrows, surface, plane-handle),
  which come from CI's "update" run: until then the image tests fail on Linux.

## 0.5.0 (23 November 2026)

Nothing a page or a scene already does changes. A scene that draws a molecule whose bonds are far from their atoms'
covalent radii, or an atom with too many or too few bonds, now fails `lk3d check`, as the examples' BF3 did: it drew
each bond as two half-rods, small molecules of their own; it is one molecule again, drawn in the same colours.

- **Molecules checked by chemistry** (`lk3d check`, `lk3d/lint`): each bond against the sum of its two atoms' covalent
  radii for its order (Pyykkö and co-workers: single and double 2009, triple 2005), within 20 % (real bonds stray both
  ways: BF3's B–F is 12 % short, H2O2's O–O 17 % long); each atom's bond orders against its element's usual valences,
  an ion's atom counted as the element with as many electrons (`charge`, new: N⁺ as C, O⁻ as F); an atom with no bond
  in a bonded molecule. Reported at its place (`parts[i].shapes[j].molecule.bonds[b]`). `check.molecule` excuses a
  drawing made of atoms that is not a molecule, by part or by shape, and a name that matches no molecule shape is
  refused. The summary names the elements it could not check (`unchecked`).
- **`lk3d/measure`**: sizes, distances, gaps between surfaces, angles, counts of pieces or parts, numbers read from the
  scene and sums of these, measured on the scene as built (at rest, or at a guided step), each with its error: how far
  the value may be from the shapes the scene describes, worked out from each round shape's own segment counts (0 for
  atoms, reads and counts). For a page or a tool that compares a figure with the numbers its text states; lessonkit's
  measured claims use it. `expect`'s `size` now measures the posed part's vertices, as `measure` does, not its box
  turned. A stdin mode for other tools.
- **`lk3d render`** writes `NAME-render.json` beside its pictures: each one's file, caption, look, pose and the renderer
  that drew it (`webgl2`, `webgl` or `2d`), which it also prints.
- The API-surface test records what each module subpath exports.
- Sizes: unchanged, 174.1 KB (67.4 KB gzipped): the new code is in tools, not the engine.

## 0.4.0 (22 November 2026)

Nothing a page or a scene already does changes, except two small things: `fig.section.second` is `null`, not left out,
when there is no second plane; and what is chosen is said aloud through one queue with descriptions, so its words
arrive a moment later (at most one message a second).

- **Parts placed by what they rest on** (`place`): `{ "on": "pillar" }`, `{ "alignedWith": "shaft", "axes": ["y",
"z"] }`, `{ "against": "body", "side": "-x", "gap": 0 }`, `under`, `in`, and an `offset`. `npx lk3d place
scene.json` writes each placed part's `at` into the file (only those numbers change; a second run changes nothing);
  `resolvePlace` (`lk3d/place`) does it for a scene a script makes; `lk3d check` refuses an `at` its `place` no longer
  gives, a cycle, an unknown part and an axis fixed twice. The engine reads only `at`. The generator example places
  eight of its parts, each exactly where it was.
- **A left and a right as one part and its mirror** (`"mirrorOf": "wing-l", "plane": "x"`): the other's shapes, look,
  label point and explode path, reflected, faces outward. Refused, with a sentence, where it would have its own shapes
  or place, mirror a mirror, a part with a handle or a liquid's part. An engine before 0.4.0 draws a mirror part as
  nothing. The turned-copy warning now suggests it.
- **The figure's state**: `fig.state()` is what the reader can change, as one plain object (where a glide is going, while
  it glides), and `fig.set(state)` puts it back, its step first. `onChange(state, cause)` (and `<lk3d-figure>`'s
  `lk3d-change`) says each change and who made it: the reader, the page or a playing motion. `lock` (and `fig.lock`,
  and the element's `lock` attribute) stops the reader changing what the page depends on; a locked control stays,
  says it is locked and does nothing. `LK3D.encodeState` and `decodeState` carry a state in a link; the playground's
  Share links use them, and links it made before still open. The element takes a `state` attribute and keeps its
  state across a remount (a new locale, say).
- **The figure in words**: `fig.describe()`, the D key from anywhere in the figure, or the controls' Describe: its title,
  taken apart, the cut, see-through, the step, and the scene's own sentences (`describe`: `"The sky has turned {value}°
from where it started."`), in English and Vietnamese. After a change the reader makes, only what changed is said.
  `lk3d render` writes each picture's description beside it (`NAME-LOOK-POSE.txt`).
- **Accessibility shown**: axe-core runs on every example and the playground in the image tests (no serious or critical
  violation; it found two contrast faults, fixed). [docs/accessibility.md](docs/accessibility.md) sets out the tasks to
  try with each screen reader.
- **For agents**: `npx lk3d skill install` (and `skill pack`); `llms.txt` and `llms-full.txt` in the package and on the
  site; the schema at `https://xoai.github.io/lk3d/schema/1/scene.schema.json`, now its `$id` (the old address still
  works).
- **The glTF export keeps the guided steps**: each an animation (its pose and which parts show, at time 0, by
  `KHR_node_visibility` and `KHR_animation_pointer`), with the title, alt text and notes as XMP. Khronos's validator
  finds no error.
- **`fig.picture()`**: a PNG of the figure as drawn, in WebGL or 2D, on screen or not. [Recipes](docs/recipes.md): a
  story told as the reader scrolls, printing each step, a state in a link.
- **The gallery**: every example opens in the playground from the examples' index; the terrain, gauge and circuit
  scenes are files of their own (checked for the first time: the terrain's blocks now meet at their fault, and the
  gauge's needle sits on its dial); the playground checks a scene with a model file again once the model is read.
- **The size budget is raised from 67 to 68 KB, and frozen there** (a written decision, as the budget rule asks: the
  maintainer's, 21 November 2026). 0.3.0 left 3 KB under 67 KB by moving the glTF reader out; 0.4.0 spends it on what
  a page asks of a figure: its state, saved and set back, locked against the reader and carried in a link (about 2 KB),
  and the figure in words for screen readers in English and Vietnamese (about 0.9 KB, the sentences 0.2 KB of it).
  Trimming the code further saved 3 B (gzip already takes the repetition out), so the choice was between the ceiling
  and leaving out parts of the release; the ceiling was raised by 1 KB.
- Sizes: the global script 174.1 KB, 67.4 KB gzipped; the models add-on 3.9 KB and the exporter 2.9 KB gzipped. No
  change in speed against 0.3.0 (`test/bench/ab.mjs`).
- Still to do by hand: the skill's evals' pass rate (`npm run evals` grades a folder of agent answers; none were
  graded for this release), the screen reader matrix (every cell not tested yet) and a low-end Android phone.

## 0.3.0 (21 November 2026)

- **A page that shows a glTF model loads one more script.** The glTF reader left the global script for an add-on,
  `dist/lk3d-models.min.js` (`lk3d/bundle-models`), loaded after `dist/lk3d.min.js`. A scene with a model is refused by
  name until it comes (`this scene draws glTF models (skull): load dist/lk3d-models.min.js after dist/lk3d.min.js`), and
  an `<lk3d-figure>` refused so is drawn once it does (the add-on after the core: loaded first, it says so). Pages that import lk3d as a
  module, `lk3d check`, `render` and `export` keep the reader. `LK3D.version` is 3. The global script went from 66.6 to
  63.6 KB gzipped; the add-on is 3.9 KB, borrowing the core's matrices.
- **The size budget is frozen at 67 KB** (it was raised from 57 three times in November): a raise needs a decision
  written here. Each add-on has a budget of its own (models 5 KB, exporter 3 KB), all checked by `npm run size`, and
  `node build.mjs --table` writes `docs/size.md`: what each source file adds.
- **`expect`: what the scene says must be true**, proved by `lk3d check`: a part `inside` another (at rest and as the
  motions move), `touches` it (their surfaces meet: a post standing inside a cage of bars touches none of them),
  `clear` of it (at rest, on the way apart, as the motions move), `above` it by a gap, its `size` along an axis, `seen`
  in a step (not hidden, not cut away, among the step's labels). A name may be a group: as the first, each of its
  parts; as the second, the box round all of them (for `touches`, any of its parts). Each failing item is reported at
  `expect[i]` with what was found and how to fix it.
- **Warnings**: the check may warn as well as fail, and `lk3d check` exits 0 on warnings alone. The first: two parts of
  the same shapes, one turned 180° from the other, that are not symmetric across the plane the turn flips, a left and a
  right made as the same hand (`"scale": [-1, 1, 1]` makes a mirror image; `check.mirror: [{pair, reason}]` says why
  not).
- **`lk3d render --sheet`**: every picture on one contact sheet, and `NAME-sheet.md`, the questions to answer looking at
  it, made from the scene (each step, each dimension, what `expect` says is seen, parts resting on one other); `--names`
  adds a picture with every part labelled by its id. The lint's result gains `contacts` (which parts' surfaces each meets at rest).
- **"Hangs in the air" goes by surfaces**, as `touches` does: a part within another's bounds but meeting no surface
  (a ball hung inside a cage of bars) is caught. It caught the flow example's fan, whose blades stopped short of the
  spinner; they now reach it.
- **`validate` reads a key whose value is `undefined` as absent**, as JSON does (`{ ...scene, expect: undefined }`
  validates).
- **A speed gate**: `test/bench/ab.mjs` compares this build with the published one, round after round, and flags a
  metric only when it is slower in a paired t-test and by more than 15 %; the `bench` workflow runs it nightly.
- **The public surface is recorded** (`test/api-surface.json`): a change to `LK3D`, a figure's methods, the element or
  the scene's keys fails a test until it is recorded in the same commit.
- **Examples**: an armillary sphere (`examples/armillary.html`, made by `examples/armillary.mjs`), set for Hà Nội's
  latitude, with guided steps, the sky's daily turn and six expectations.
- A scene may say its schema (`"$schema"`). `npm run evals -- DIR` grades a folder of agent answers against the skill's
  evals and prints the pass rate.
- **The skill's evals**: not graded for this release (no set of agent answers was made). **Still to measure**: a
  low-end Android phone (`docs/performance.md`).

## 0.2.1 (11 November 2026)

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
