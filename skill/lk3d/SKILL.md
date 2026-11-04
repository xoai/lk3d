---
name: lk3d
description: Write lk3d scenes, explorable 3D figures as JSON data (parts made of shapes, each with a name and a note, that a reader turns, takes apart, cuts open and moves by hand), detailed and clean enough to explain a machine, an apparatus or a structure at a glance. Use when asked to make, improve or check a 3D figure, model, diagram or exploded view with lk3d (or lessonkit's scene3d figures).
---

# Make an lk3d figure

An lk3d scene is data: `parts`, each a list of `shapes` (lathe, box, cylinder, tube, blade, sphere, the shapes for the
sciences, glTF models), with a `name`, a `note`, a material, a colour and a path it takes when the model is taken apart.
The engine draws it in three looks (`pen` a clean technical illustration, the default; `studio` realistic; `ink`
drawn), lets the
reader turn, zoom, take apart, cut open and see through, labels the parts, and runs what the page drives (spin, glow,
flow streaks, streams of air or gas, handles). Your job: **a real object, built of many small precise parts, that explains the idea at a
glance, and is right**: every part where it belongs, every number true, nothing that passes through anything.

The references hold the detail: [craft](references/craft.md) (what detailed and clean means, and recipes for parts),
[anti-patterns](references/anti-patterns.md) (each one a mistake we made), [messages](references/messages.md) (what the
checks say and how to fix it), [examples](references/examples.md) (from a few parts to a full machine). The engine's
own guides: [scene format](../../docs/scene-format.md), [shapes](../../docs/shapes.md),
[looks](../../docs/looks-and-materials.md), [handles and lines](../../docs/handles-and-lines.md), [API](../../docs/api.md).

## Tools

- **Check**: `npx lk3d check scene.json` (or `node node_modules/lk3d/bin/lk3d.mjs check …`). The format (every field
  and shape), then the geometry: parts that run into each other while the model is taken apart, parts hanging in the
  air, labels that point inside another part. It prints the scene's size (parts, shapes placed, triangles). It must
  say **no problems** before you hand anything over.
- **Look**: `npx lk3d render scene.json --looks pen,ink --poses rest,apart,cut [--ortho] --out shots/` draws a PNG for
  each look and pose with the real engine (it needs Playwright: `npm i -D playwright && npx playwright install
chromium`). **Open every picture and look at it.** If you cannot render, say plainly that the figure was not checked
  by eye.
- In **lessonkit**: the scene is a `figures:` entry with `figure: scene3d` in `spec.yaml`; `./lk check ID` runs both
  checks, and `./lk preview ID FIGURE --looks pen,ink` draws the pictures into `lessons/ID/build/preview-FIGURE/`.
  Without npm, the tools are in the lessonkit folder (named in this skill's `home.txt`):
  `node packages/lk3d/bin/lk3d.mjs check|render …`.

## 1. Size it, and agree the size

Count the parts before you write anything:

| Kind         | Parts   | When                                                                                              |
| ------------ | ------- | ------------------------------------------------------------------------------------------------- |
| Machine      | 60–120  | a machine or apparatus in a lesson or an article (the usual case)                                 |
| Hero figure  | 120–250 | the subject of a page; **stop and ask** before starting one                                       |
| Small figure | 8–40    | a structure that really has few parts (molecules side by side, Earth's layers, a lens on a bench) |

**A part is the smallest thing a reader would name and point at**: each stage of a compressor, each section of a
casing, each liner, pump, pipe and mount; never a whole module. The jet engine went from 34 parts (each module one
part) to 92 (each stage, section and accessory its own) without one invented piece. Density comes from **structure**,
not texture: flanges, bolt circles, seams, ribs, collars, brackets, pipes. Every part rests on another and has a job.

## 2. Choose the object, as it really is

Explain with **a real object, shown as it is**: the engine itself, cut open; the generator on its own feet; the cell.
Invent it for the idea (never trace a branded product), but **never invent surroundings**: no base plate, test stand
or hanger frame that the object does not have. They hide the object, make the scene larger (so the reader can zoom in
less) and show something no textbook does. The ground under it is the soft shadow the engine draws. Add surroundings
only when they are real **and** part of the explanation: the tyre a pump fills, the slide under a microscope.

Show the inside without a click when the inside is the idea: a `section` and `set({cut: true})` at the start.

Map the idea to the object: which part does the work (the **accent**, `accent: true`, one or two at most), what moves
(spin, handles, `motions` for a mechanism's sequence (a sleeve sliding back), `joints` for linkages (a crank, its piston held by
the rod, the rod aimed at the pin, a cam at half speed: exact, without keys for each part), flow streaks
inside it, streams of air or gas around it, liquids in vessels and gases under pistons that move by their laws
(`vessels`, `liquids`, `gases`: a funnel pouring, a piston rising as the gas is heated)), what is inside (cut open with `section`, see-through casings with `xray`), what comes apart and
in which direction (`explode`).

## 3. Write the parts list before any geometry

A table, written first and shown to the user for a hero figure: `id` (kebab-case), `name` (what the label says),
`note` (one sentence: what it is and what it does), **what it rests on**, its group, how it moves apart. The checks
later prove what this list promises: nothing floats, nothing collides.

## 4. Build in stages, checking each

1. The main body, its big shapes in their true proportions. `check`, `render` the rest pose.
2. Its sections and the structure that holds it together: flanges, seams, mounts. `check`.
3. The parts inside and their details, a group at a time. `check` after each group.
4. Taking apart: give each part an `explode` path **out of** whatever surrounds it (a casing lifts off upwards only
   if nothing inside is in its way: send it along the axis instead). `check` catches collisions on the way out;
   `render --poses apart` shows the result.
5. Labels: every part with a name gets a label; if one points at a hidden place, give the part a `label: [x, y, z]`
   on its visible surface.

Use repeats (`repeat: n` or `{n, step, axis}`) for blades, bolts and ribs: one shape, drawn many times at no extra cost. Keep
every number in scene units with one scale for the whole object, and say what is not to scale (`scale: {note}`).

## 5. Choose the look and the camera

- **`pen`, the default, for almost everything.** For machines and apparatus add `view: {projection: 'ortho'}`, a yaw of
  about −35 to −55° and a pitch of 20–35°, so the face that carries the mechanism points at the reader. Edges are drawn
  where faces meet; mark one or two parts `accent: true` (full colour; the rest keep a soft wash of theirs, so a
  colour-coded cell or a model of atoms still reads).
- **Living and grown forms** (cells, neurons, organs): pen or studio, perspective. Soft shapes get no edge lines.
- `studio` when materials (metal, glass, tissue, a textured scan) are the point; `ink` for a drawn, warmer page.
- A `theme` (`light`, `dark`, `blueprint`, `sepia`) only if the page around it asks for one.
- The object fills about 55–65% of the stage, with air around it.

## 6. Look like a critic, then hand over

Render rest, apart and cut in at least two looks, and at a narrow width (`--width 390`). For each picture ask:
does it read at a glance? Is every part where it should be, resting on something? Does anything pass through
anything? Is every label on its part, none stuck in a corner? Is the accent the thing the idea is about? Zoom into a
detail (the wheel zooms to the pointer, up to 50 times): does it hold up close? Then go
through [anti-patterns](references/anti-patterns.md) once more.

Hand over only when `check` says **no problems** and you have looked at every picture. Say what you checked, what you
could not (no browser: not checked by eye), and what is not to scale. Never fix a check by moving it out of the way:
`check.allow` and `check.float` are for what the scene **means** (two pictures of one molecule shown in turn, planets
that float), each with a reason a reader would accept.
