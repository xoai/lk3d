# Craft: what detailed and clean means

A figure that explains at a glance shares five qualities.

1. **A real object.** The reader names it at once: a pump, a test stand, a microscope, a cell. It is built for the
   idea it explains, in true proportions, and stands somewhere: on a base, a stand, a bench.
2. **Many small, precise parts.** 30–60 for a figure, more for a hero. Every part rests on another part, lines up with
   its neighbours and has a job. Detail comes from structure: feet, flanges, bolt circles, collars, seams, ribs,
   brackets, a ruler strip, a label plate. Never from noise or texture.
3. **Volume.** Parts have real thickness. A plate is a box, not a flat face. A casing is a `lathe` with an inside and an
   outside (`closed: true`), so a cut shows its wall. Rims, steps and chamfers catch the light and, in the pen look,
   get edge lines.
4. **Calm.** One or two accent parts (`accent: true`): the part that does the work, the one the text is about. The
   rest stay plain. Slow, eased motion. Labels only for parts the reader needs to name.
5. **Truth.** Sizes, ratios, speeds and counts come from the source, or the scene says what is not to scale. A model
   made by AI or by an artist is called an illustration, never a specimen.

## Proportions and scale

Pick one unit for the whole object (a metre, a centimetre) and keep every number in it. Write the main dimensions down
before building (an engine's length and fan diameter; a bench's length). A scene that is not to scale says so in
`scale: {note}`; one that is shows `scale: {bar: {length, label}}`.

## Parts, as lk3d recipes

Coordinates are the part's own; `at`, `rot` (degrees) and `scale` place each shape. `repeat: n` (or `{n, step,
start, axis}`) copies a shape round an axis through the part's origin, after placing it: so a bolt at `[x, R, 0]` with
`repeat: 12` makes a bolt circle of radius R round x.

**A base plate on feet**: a slab, four feet, a groove to break the top.

```json
{
  "id": "base",
  "name": "Base plate",
  "note": "carries the whole stand; bolted to the floor at its four feet.",
  "material": "metal",
  "color": "#d9dcdf",
  "shapes": [
    { "box": [3.2, 0.12, 1.6], "at": [0, 0.14, 0] },
    { "box": [3.0, 0.02, 0.04], "at": [0, 0.205, 0.55] },
    { "box": [0.28, 0.08, 0.28], "at": [-1.4, 0.04, -0.62] },
    { "box": [0.28, 0.08, 0.28], "at": [1.4, 0.04, -0.62] },
    { "box": [0.28, 0.08, 0.28], "at": [-1.4, 0.04, 0.62] },
    { "box": [0.28, 0.08, 0.28], "at": [1.4, 0.04, 0.62] }
  ]
}
```

**A flange with a bolt circle** on a body along x:

```json
{ "lathe": [[0.98, 0], [0.98, 0.72], [1.04, 0.72], [1.04, 0]] },
{ "cylinder": { "r": 0.022, "x0": 1.04, "x1": 1.07 }, "at": [0, 0.66, 0], "repeat": 16 }
```

**A body of revolution with steps**: a lathe profile `[x, r]` from one end to the other; each step (a change of
radius at one x) becomes a rim with an edge line. A hollow body: `closed: true` and a profile that goes out along the
outside and back along the inside.

**Blades, vanes, teeth**: one `blade` (or box) repeated: `{"blade": {...}, "repeat": 24}`. Stators and rotors are
separate parts (different colours, different spin), so the eye reads the stages.

**Ribs and seams** on a casing: `torus: [R, r]` rings at the seam positions, or thin `box` ribs repeated round the
axis. A seam runs all the way round; ribs end on a seam or a flange, never in mid-air.

**Posts, rails and a carriage**: boxes and cylinders. Posts stand on the base (their bottom at the base's top), rails
run between posts, a carriage sits on the rails. The check says when a part touches nothing.

**Pipes and cables**: `tube: [[x, y, z], …]` with `r`, from one connection to another, each end on a part. Route
around other parts, not through them.

**A cut-away**: the scene's `section: {normal, offset}` cuts every part on one side of a plane and fills the cut faces.
Pages can start with the cut on (`set({cut: true})`); a figure about the inside should.

## Taking apart

Give each part an `explode` vector (where it goes at full take-apart, in scene units). A part leaves along a path that
is clear: a casing slides off along the axis, not up through the rotors inside it; a lid lifts straight up only if
nothing is above it. Parts that spin keep their place along the axis and move out along it. Check after every change:
`lk3d check` reports any pair that runs into each other on the way out, and `render --poses apart` shows where they
ended.

## Colour and looks

- `color` is the drawn and pen looks' colour; `studioColor` the realistic look's. Use a small palette: greys for
  structure, one colour per group the reader must tell apart, a strong colour for the accent.
- In the pen look every part is near-white except accents, glowing parts and the selected one; vertex colours (atoms)
  keep half. So in pen, **the accent is the message**.
- Materials (`metal`, `paint`, `plastic`, `glass`, `rubber`, `tissue`, …) matter in the studio look; glass may bend
  light (`refract`).

## Motion

The page drives motion: `set({spin})` (degrees) turns parts with `spin`, `glow` lights a part, `flow` runs streaks
of air or blood along paths (`amount` and `speed` follow the page's numbers), handles let the reader turn or slide a
part. Motion follows the true model (a fan's speed from the throttle, a current from the generator's angle), and stops
for a reader who asks for less motion.
