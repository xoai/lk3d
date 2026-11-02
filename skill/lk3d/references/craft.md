# Craft: what detailed and clean means

A figure that explains at a glance shares five qualities.

1. **A real object, as it is.** The reader names it at once: a pump, an engine, a microscope, a cell. It is built for
   the idea it explains, in true proportions, with nothing invented around it: no base plate or stand it does not
   have. The soft shadow under it is its ground.
2. **Many small, precise parts.** 60–120 for a machine; each is the smallest thing a reader would name (a stage, a
   casing section, a pump, a mount), never a module. Every part rests on another part, lines up with its neighbours and
   has a job. Detail comes from structure: flanges, bolt circles, collars, seams, ribs, brackets, pipes. Never from
   noise or texture.
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

**A casing in sections**: cut a long casing where the real one is bolted together (an inlet, a fan case, a compressor
case, a combustor case, a turbine case), each section its own part with a flange at the joint. Where rotor and stator
rows alternate inside, split each section and each stator row into two halves (lathe `from`/`to`, a row repeated over
half a turn) that move apart sideways, as split casings do.

**Accessories outside**: a gearbox, pumps, a tank, pipes and a harness on the casing's outside, each resting on it;
pipes end on what they connect. The check says when a part touches nothing.

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
for a reader who asks for less motion. Air or gas outside a machine (the jet leaving a nozzle, the air drawn into an intake, a
plume) is a `stream`: a volume with a radius along its path (an annulus for a bypass duct), filaments that move with
its speed, as thick as `density` says; streaks (`flow`) stay for what runs inside, through a cut.
