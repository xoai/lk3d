# Security

lk3d runs in the reader's browser and draws scenes it is given, which may come from people you do not trust (a scene
or a model a reader uploads, say). What it promises about such a scene, and what it leaves to the page:

## Safe with any scene

- **No script from the scene.** A part's name and note (in the info box and on its label), and `infoIdle`, go through
  `safeHTML`: everything is escaped except bare `b i em strong sub sup br` tags (no attributes), so they cannot run
  script. Every other word of the scene (the scale's note, credits, the canvas's `alt`, a handle's label) is set as
  text, or as an attribute's value, never as HTML.
- **Links only to web pages.** The scene's `url` and each model's `url` become the link of a credit under the figure
  only when they start with `http://` or `https://` (case aside); anything else (`javascript:`, `data:`) is shown as
  plain text, unlinked. Links open in a new tab with `rel="noopener"`.
- **Nothing fetched.** lk3d makes no network request for a scene. Models are given inside the scene, as base64; a glTF
  file that points outside itself (a buffer or an image in another file, or behind a `uri`, a web address or a `data:`
  URI) is refused.
- **Refused plainly, before anything is built.** `LK3D.mount` (and `build`) refuse a scene they cannot draw by throwing
  an `Error` whose message names the place (`lk3d: parts[2].shapes[0].lathe: has 5000 items; at most 1000`); nothing
  else is thrown while it is built, no `TypeError` from deep inside, no stack overflow. The engine's own guard checks,
  whatever the scene: that it is plain data (finite numbers; no functions; no object that holds itself; at most 32
  deep; lists of at most 100 000 items; at most a million values), that its parts and shapes are lists of objects, and
  that the profiles and outlines it triangulates have at most 1000 points. Building then names the shape it could not
  build.
- **Bounded work and memory.** What a scene asks for is counted before it is built (a count of a billion segments, a
  tree a million levels deep) and again while it is built, so a scene is refused as it reaches its limit, whatever it
  claimed: at most 10 million triangles (2 million a part), and 1 million where memory is small (a screen under 700 px a
  side, or `navigator.deviceMemory` under 4 GB). There a scene over the limit is first built coarser, down to a quarter
  of its detail, then refused. A page sets its own limit with `maxTriangles`.
- **glTF models** (`.glb`) are read with every index, offset, length and count checked against the file before it is
  used, so a count can be no larger than the bytes behind it; nodes must form trees (loops and shared nodes are
  refused, deep chains walked without recursion); indices must name existing vertices; float values must be finite; a
  model's triangles are counted against the limit before its values are read. Embedded images must be PNG, JPEG or
  WebP, at most 8192 pixels a side by their header; the browser decodes them (`createImageBitmap`), and one it cannot
  decode leaves the part its colour.

These are tested by a seeded fuzz suite (`test/trust.test.cjs`: every reference scene and model, changed at random)
and by hostile inputs written by hand.

## Left to the page

- **The full rules.** The guard does not hold the whole scene format (the schema and the cross-references would add a
  tenth to the script's size). A scene that passes it may still be wrong in ways building does not meet: a motion's
  keys, a joint reading a joint that is not there, a handle that slides along no path. Such a scene may then throw a
  JavaScript error (a `TypeError`) as it is mounted, or misbehave when the reader moves the part. For a scene you did
  not write, give the full rules: `LK3D.mount(el, scene, { validate })` with `validate` from `lk3d/validate` (a few
  milliseconds even for a large scene); its first problem is thrown, naming the place.
- **The size of what it is given.** lk3d counts what a scene builds, not the text it arrives as: a scene of 100 MB of
  base64 is held in memory before lk3d sees it. Limit the size of what readers upload.
- **The browser's own decoders.** Images are decoded by the browser, within the size above; a flaw in a browser's image
  decoder is the browser's to fix.
- **The page's own code.** Callbacks (`onPick`, `onHandle`, …) receive parts as lk3d built them, with the scene's own
  words: escape them (or use `LK3D.safeHTML`) before writing them into the page as HTML.

To report a vulnerability, please use the private security advisories of
[github.com/xoai/lk3d](https://github.com/xoai/lk3d) ("Report a vulnerability" on its Security tab) rather than a public
issue. You will get an answer within a week.
