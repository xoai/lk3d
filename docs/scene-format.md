# Scene format

A scene is plain data (JSON, or anything that becomes it). This page is generated from
[`schema/scene.schema.json`](../schema/scene.schema.json) by `npm run docs`; the validator (`lk3d/validate`) checks
exactly these rules, plus what they name: unique part, motion and joint ids; handles, motions and joints that move
parts that exist; shapes that name a listed model; liquids and gases in vessels that exist; joints that read joints
and motions that exist, without a loop.
A shape, a motion, a joint, a vessel, a liquid and a gas take only the fields listed for them (a misspelt one is an error). A scene, its view and a part may carry fields not listed here, which lk3d ignores: a page may keep its own data in a scene.

## Scene

A 3D figure as data: parts made of shapes, each with a name and a note, that the reader turns, takes apart, cuts open and moves. Other fields are allowed (a page's own data).

| Field              | Type                                                            | Meaning                                                                                                                                                                                                                                                                                      |
| ------------------ | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lk3d`             | `1`                                                             | The version of this format the scene is written in (1). Optional; a later engine that changes the format reads older versions.                                                                                                                                                               |
| `w`                | number > 0                                                      | The stage's width in proportion to h (16 by default).                                                                                                                                                                                                                                        |
| `h`                | number > 0                                                      | The stage's height in proportion to w (10 by default).                                                                                                                                                                                                                                       |
| `narrow`           | string                                                          | The stage's proportions on a narrow screen, e.g. "1 / 0.9".                                                                                                                                                                                                                                  |
| `title`            | string                                                          | What the figure shows; also the canvas's label when alt is not given.                                                                                                                                                                                                                        |
| `author`           | string                                                          | Who made the figure: credited under it (© author), and written into an exported .glb.                                                                                                                                                                                                        |
| `license`          | string                                                          | The terms the figure is under ("CC BY-NC-ND 4.0", "all rights reserved"): credited under it, after its author, and written into an exported .glb.                                                                                                                                            |
| `url`              | string                                                          | Where the figure comes from: a web address (http or https), which the author's name in the credit links to.                                                                                                                                                                                  |
| `alt`              | string                                                          | A description of the model for screen readers.                                                                                                                                                                                                                                               |
| `style`            | `"ink"` \| `"studio"` \| `"pen"`                                | The first look: pen (near-white, thin lines; the default), studio (realistic) or ink (drawn).                                                                                                                                                                                                |
| `theme`            | `"light"` \| `"dark"` \| `"blueprint"` \| `"sepia"` \| `"auto"` | The colours of the page behind the model, its lines and words (auto: light or dark, as the reader's system is set). None: each look's own.                                                                                                                                                   |
| `env`              | `"studio"` \| `"warm"` \| `"night"`                             | The studio look's environment.                                                                                                                                                                                                                                                               |
| `view`             | object                                                          | The first camera.                                                                                                                                                                                                                                                                            |
| `edges`            | boolean                                                         | Lines where a part's faces meet at an angle: drawn in the pen look unless false; true draws them in every look.                                                                                                                                                                              |
| `check`            | object                                                          | What the geometry check (lk3d check, lk3d/lint) is to excuse, by name: what the scene means on purpose.                                                                                                                                                                                      |
| `ground`           | boolean                                                         | A shadow under the model (true by default).                                                                                                                                                                                                                                                  |
| `section`          | `false` or object                                               | The cut: a plane, or false to offer none. What lies on the side its normal points to, beyond offset along it, is cut away; a page may move it (set({ section }))                                                                                                                             |
| `motions`          | list of object                                                  | Parts that move together as one value goes along a range: a piston's stroke as the crank turns, a sleeve sliding back, a valve opening. Set or played by the page (fig.motion(id)) and, when named, by the reader (a slider and a play button); run through its range by the geometry check. |
| `joints`           | list of object                                                  | Parts posed by how they are joined, not by keys for each: a crank driven by a motion, a piston held by its rod, a rod aimed at the crank pin, a cam that follows at half speed. A joint's value comes from a motion, another joint, a rod, an aim, or the page (set({ joints })).            |
| `scale`            | object                                                          | Honest scale: a bar that keeps its true length as the view zooms, and/or a note saying what is not to scale.                                                                                                                                                                                 |
| `models`           | map of name → object                                            | glTF 2.0 models (.glb) by name, for {model: name} shapes.                                                                                                                                                                                                                                    |
| `unit`             | `"mm"` \| `"cm"` \| `"dm"` \| `"m"` \| `"km"`                   | What one scene unit is (m): the laws of liquids and gases (g, R) are worked out in it.                                                                                                                                                                                                       |
| `vessels`          | list of object                                                  | Parts that hold liquids or a gas: the radius of their inside at each height, and an outlet they pour through.                                                                                                                                                                                |
| `liquids`          | list of object                                                  | Liquids in vessels, drawn by lk3d as bodies that fill their vessel to the level their volume gives; liquids in one vessel stack by density; an open outlet pours by Torricelli's law into the liquid below.                                                                                  |
| `gases`            | list of object                                                  | Gases under a piston: the piston rests where pV = nRT puts it (n moles at T kelvin under p pascals and the piston's weight).                                                                                                                                                                 |
| `parts` (required) | list of object                                                  | The parts of the model, each a list of shapes with a name and a note.                                                                                                                                                                                                                        |

## Part

| Field           | Type                                                                                                                                                                                                                                                            | Meaning                                                                                                                                                         |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id` (required) | string                                                                                                                                                                                                                                                          | Unique in the scene.                                                                                                                                            |
| `name`          | string                                                                                                                                                                                                                                                          | Its label.                                                                                                                                                      |
| `note`          | string                                                                                                                                                                                                                                                          | Shown when the part is pointed at (may hold simple HTML).                                                                                                       |
| `group`         | string                                                                                                                                                                                                                                                          | Parts of one group move, hide and are framed together (set({hide}), focus, a handle's moves).                                                                   |
| `material`      | `"metal"` \| `"steel"` \| `"copper"` \| `"gold"` \| `"plastic"` \| `"rubber"` \| `"paint"` \| `"glass"` \| `"magnet"` \| `"matte"` \| `"wood"` \| `"tissue"` \| `"membrane"` \| `"skin"` \| `"bone"` \| `"rock"` \| `"soil"` \| `"ice"` \| `"water"` \| `"gas"` | How it reflects light in the studio look (and how much light wraps round into it, for soft materials).                                                          |
| `color`         | colour "#rrggbb"                                                                                                                                                                                                                                                | Its colour in the drawn look.                                                                                                                                   |
| `studioColor`   | colour "#rrggbb"                                                                                                                                                                                                                                                | Its colour in the studio look (default: color).                                                                                                                 |
| `glow`          | colour "#rrggbb"                                                                                                                                                                                                                                                | The colour it glows when the page lights it (set({glow})).                                                                                                      |
| `cut`           | `false`                                                                                                                                                                                                                                                         | false: the part stays whole when the model is cut open (a stand, a frame, a base).                                                                              |
| `edges`         | boolean                                                                                                                                                                                                                                                         | Whether its edges are drawn (by default yes, except on soft shapes: models, blobs, trees, terrain, scatter, molecules, DNA).                                    |
| `accent`        | boolean                                                                                                                                                                                                                                                         | Keeps its full colour in the pen look, where other parts get a soft wash of theirs (40 %; vertex colours keep 70 %).                                            |
| `opacity`       | number ≥ 0 ≤ 1                                                                                                                                                                                                                                                  | Always see-through: 1 is solid (glass about 0.35; a part made only of a model's glass, KHR_materials_transmission, is 0.35 and glass unless it says otherwise). |
| `xray`          | boolean                                                                                                                                                                                                                                                         | Becomes see-through with the "See through" control.                                                                                                             |
| `hidden`        | boolean                                                                                                                                                                                                                                                         | Not drawn at first (set({hide}) changes it).                                                                                                                    |
| `explode`       | [x, y, z]                                                                                                                                                                                                                                                       | Where it moves to when the model is taken apart.                                                                                                                |
| `at`            | [x, y, z]                                                                                                                                                                                                                                                       | Moves the whole part.                                                                                                                                           |
| `rot`           | [x, y, z]                                                                                                                                                                                                                                                       | Turns the whole part (degrees about x, y, z).                                                                                                                   |
| `scale`         | [x, y, z]                                                                                                                                                                                                                                                       | Stretches the whole part.                                                                                                                                       |
| `label`         | `false` or [number, number, number]                                                                                                                                                                                                                             | Where its leader line points, or false for no label.                                                                                                            |
| `spin`          | object                                                                                                                                                                                                                                                          | Turns with the figure's spin angle, set({spin}): about an axis through center, ratio times as fast.                                                             |
| `handle`        | object                                                                                                                                                                                                                                                          | The reader moves this part with the pointer or the keys.                                                                                                        |
| `surface`       | object                                                                                                                                                                                                                                                          | Fine surface detail in the studio look (WebGL 2): kind, bumps per unit, strength (0.3 to 1).                                                                    |
| `refract`       | number > 0 ≤ 2                                                                                                                                                                                                                                                  | Glass that bends what is behind it (studio look, WebGL 2): 1 for a lens.                                                                                        |
| `shapes`        | list of object                                                                                                                                                                                                                                                  | What the part is made of: one or more shapes. (none for a liquid's or a gas's part: lk3d makes its body)                                                        |

refract is for a glass part (material: glass).

## Shape

Exactly one kind per shape (see [shapes](shapes.md) for each kind's parameters and a picture), plus placement:

| Field    | Type                               | Meaning                                                                                                                   |
| -------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `at`     | [x, y, z]                          | Where the shape is, in the part.                                                                                          |
| `rot`    | [x, y, z]                          | Turned (degrees about x, y, z).                                                                                           |
| `scale`  | [number, number, number] or number | Stretched: [x, y, z], or one number for all three.                                                                        |
| `color`  | colour "#rrggbb"                   | Its own colour (vertex colours), over the part's; on a textured model, in place of its base colour map (its relief kept). |
| `detail` | number > 0                         | More or less detail than the figure's quality: 0.5 for a shape repeated hundreds of times, 2 for a close-up.              |
| `repeat` | integer ≥ 1 or object              | Copies around an axis (x unless axis says): n of them, step degrees apart (360 / n) from start (0).                       |
| `node`   | string                             | With model: one node of the model (and what is under it).                                                                 |
| `closed` | boolean                            | lathe: a closed outline (a ring; a sector's is closed unless false); tube: a loop.                                        |
| `mirror` | boolean                            | lathe: flipped along x.                                                                                                   |
| `smooth` | boolean                            | lathe: normals blended across the profile's corners, for a curved surface (by default its edges stay crisp).              |
| `from`   | number                             | lathe: the angle about x where a sector starts, degrees (0).                                                              |
| `to`     | number                             | lathe: the angle about x where a sector ends, degrees (360); its two sides are closed flat.                               |
| `seg`    | integer ≥ 3                        | lathe, cylinder, sphere: segments around (lathe and cylinder 48, sphere 32; 8 for a tiny bead).                           |
| `r`      | number > 0                         | tube: its radius (0.02).                                                                                                  |

Kinds: `lathe`, `cylinder`, `box`, `sphere`, `torus`, `tube`, `helix`, `loop`, `ellipsoid`, `capsule`, `blob`, `shell`, `tree`, `molecule`, `dna`, `extrude`, `terrain`, `ring`, `orbit`, `blade`, `scatter`, `model`.

## Handle

The reader moves the part with the pointer or the keys, held to one rule. a handle is exactly one of turn: {axis, center}, slide: {axis} (with min and max), along: {path}.

| Field   | Type           | Meaning                                                                            |
| ------- | -------------- | ---------------------------------------------------------------------------------- |
| `turn`  | object         | Degrees about an axis through center; without min and max it goes round and round. |
| `slide` | object         | A distance along an axis from where the part is drawn.                             |
| `along` | object         | A place on a path, 0 at its start to 1 at its end.                                 |
| `min`   | number         | The least value (degrees, distance or place).                                      |
| `max`   | number         | The greatest value.                                                                |
| `snap`  | number > 0     | Values move in these steps.                                                        |
| `value` | number         | Where the part is drawn (default 0, or min).                                       |
| `label` | string         | What a screen reader calls it.                                                     |
| `unit`  | string         | A unit read out after the value.                                                   |
| `moves` | list of string | Other parts or groups carried with it.                                             |

## Model

| Field     | Type                                            | Meaning                                                                                                                                                |
| --------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `data`    | string                                          | The .glb as base64 (a build tool may fill it in from a file).                                                                                          |
| `file`    | string                                          | The path to the .glb, read into data before the scene is drawn (lk3d check and render, a build tool); the engine itself reads only data.               |
| `title`   | string                                          | Its name in the credit line.                                                                                                                           |
| `author`  | string                                          | Who made it (credited under the figure).                                                                                                               |
| `license` | string                                          | Its licence (credited under the figure).                                                                                                               |
| `url`     | string                                          | Where it comes from: a web address (http or https), which the credit links to.                                                                         |
| `source`  | `"scan"` \| `"dataset"` \| `"artist"` \| `"ai"` | Where it comes from: a scan of a real specimen, a scientific dataset, an artist's model, or made by AI (then called an illustration under the figure). |

## View

The first camera.

| Field          | Type                         | Meaning                                                                                                      |
| -------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `yaw`          | number                       | Degrees round the vertical.                                                                                  |
| `pitch`        | number                       | Degrees up.                                                                                                  |
| `dist`         | number > 0                   | Distance from the target (default: to fit).                                                                  |
| `target`       | [x, y, z]                    | The point looked at (default: the middle).                                                                   |
| `fov`          | number > 0                   | Field of view, degrees (35).                                                                                 |
| `minZoom`      | number > 0                   | How close the reader may zoom, as a share of the distance that fits the whole model (0.02: 50 times closer). |
| `projection`   | `"perspective"` \| `"ortho"` | perspective (the default) or ortho: parallel lines stay parallel, as in a technical illustration.            |
| `explodeZoom`  | number                       | How far the camera steps back when the model is taken apart (0.5).                                           |
| `explodeShift` | [x, y, z]                    | Where the view moves when the model is taken apart.                                                          |

## Motion

Parts that move together as one value goes along a range: a piston's stroke as the crank turns, a sleeve sliding back, a valve opening. Set or played by the page (fig.motion(id)) and, when named, by the reader (a slider and a play button); run through its range by the geometry check. See [motions](handles-and-lines.md#motions-parts-that-move-together).

| Field              | Type             | Meaning                                                                                            |
| ------------------ | ---------------- | -------------------------------------------------------------------------------------------------- |
| `id` (required)    | string           | Unique among the scene's motions: what the page names it by.                                       |
| `name`             | string           | What the reader's slider says (no name: no slider, the page drives it).                            |
| `range` (required) | [number, number] | From and to: degrees of a crank, a fraction from 0 to 1, a time: whatever the keys are written in. |
| `value`            | number           | Where it starts (the start of its range).                                                          |
| `loop`             | boolean          | Played on round and round (a crank), else to its end and back.                                     |
| `speed`            | number > 0       | How far along its range it goes in a second when played (the whole range).                         |
| `tracks`           | list of object   | Parts it moves by keys (none when it only drives joints).                                          |

Each of `tracks`: parts that move one way: moved, turned, or both (moved, then turned). A track moves its parts (move), turns them (turn), or both.

| Field              | Type                                       | Meaning                                                              |
| ------------------ | ------------------------------------------ | -------------------------------------------------------------------- |
| `parts` (required) | list of string                             | Part ids or groups.                                                  |
| `move`             | list of [number, [number, number, number]] | Keys [t, [x, y, z]]: at the motion's value t, moved by [x, y, z].    |
| `turn`             | object                                     | Turned about an axis through center: keys [t, degrees].              |
| `ease`             | boolean                                    | A smooth start and stop at each key (else straight from key to key). |

## Joint

Parts posed by how they are joined, not by keys for each: a crank driven by a motion, a piston held by its rod, a rod aimed at the crank pin, a cam that follows at half speed. A joint's value comes from a motion, another joint, a rod, an aim, or the page (set({ joints })). A joint turns its parts (turn) or slides them (slide). See
[joints](handles-and-lines.md#joints-parts-posed-by-how-they-are-joined).

| Field              | Type             | Meaning                                                                                                                                                              |
| ------------------ | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id` (required)    | string           | Unique among the scene's joints: what the page and other joints name it by.                                                                                          |
| `parts` (required) | list of string   | Part ids or groups it moves (a part on one joint only).                                                                                                              |
| `parent`           | string           | A joint whose movement its parts share first (a rod rides on its piston).                                                                                            |
| `turn`             | object           | It turns its parts: degrees about axis through center.                                                                                                               |
| `slide`            | object           | It slides its parts: scene units along axis.                                                                                                                         |
| `value`            | number           | Its value when nothing drives it (0: as the parts are drawn).                                                                                                        |
| `drive`            | string or object | Its value from a motion: the motion's own value (its id), or scaled or read off keys.                                                                                |
| `follow`           | object           | Its value from another joint's: a gear (ratio), a cam's follower (keys).                                                                                             |
| `rod`              | object           | A slide held by a rod of fixed length (a piston): from at, a point carried by joint, to pin, a point of its own parts; the rod is as long as they are apart at rest. |
| `aim`              | object           | A turn that keeps its parts pointing at at, a point carried by joint (a connecting rod, on its piston, aimed at the crank pin).                                      |

`follow` (and `drive` as an object, with `motion` in place of `joint`):

| Field              | Type                     | Meaning                                                                                                |
| ------------------ | ------------------------ | ------------------------------------------------------------------------------------------------------ |
| `ratio`            | number                   | Its value is the other's times ratio (1), plus offset.                                                 |
| `offset`           | number                   | Added to the scaled value (0).                                                                         |
| `keys`             | list of [number, number] | Keys [the other's value, this joint's value], in order: a cam's lift, a gear train that isn't a ratio. |
| `joint` (required) | string                   | The joint it follows.                                                                                  |

## Vessel

Parts that hold liquids or a gas: the radius of their inside at each height, and an outlet they pour through. See [liquids and gases](fluids.md).

| Field               | Type                         | Meaning                                                                                            |
| ------------------- | ---------------------------- | -------------------------------------------------------------------------------------------------- |
| `id` (required)     | string                       | Its name: what liquids, gases and the page (fig.vessel(id)) call it by.                            |
| `part` (required)   | string                       | The part that is the vessel (its glass).                                                           |
| `at`                | [x, y, z]                    | Where height 0 is, on the vessel's upright axis ([0, 0, 0]).                                       |
| `inside` (required) | list of [number, number ≥ 0] | Its inside, bottom to brim: [height, radius] (an outlet's stem included, so it fills as it pours). |
| `outlet`            | object                       | Where it pours from: a bore at its bottom, the stream leaving at tip.                              |

The `outlet`:

| Field               | Type           | Meaning                                                                                                  |
| ------------------- | -------------- | -------------------------------------------------------------------------------------------------------- |
| `radius` (required) | number > 0     | The bore's radius.                                                                                       |
| `tip` (required)    | [x, y, z]      | Where the stream leaves (in the scene).                                                                  |
| `dir`               | [x, y, z]      | Which way it leaves ([0, -1, 0]: down; sideways for a hole in a tank's side).                            |
| `valve`             | string         | The motion that opens it (its range: shut to open); else the page opens it (fig.vessel(id).set({open})). |
| `cd`                | number > 0 ≤ 1 | How much of the bore the stream fills (0.6, a sharp-edged hole).                                         |

## Liquid

Liquids in vessels, drawn by lk3d as bodies that fill their vessel to the level their volume gives; liquids in one vessel stack by density; an open outlet pours by Torricelli's law into the liquid below.

| Field             | Type       | Meaning                                                                       |
| ----------------- | ---------- | ----------------------------------------------------------------------------- |
| `part` (required) | string     | The part drawn as this liquid (its name, note, colour; lk3d makes its shape). |
| `in` (required)   | string     | The vessel it is in.                                                          |
| `volume`          | number ≥ 0 | How much (scene units cubed: cm³ in a scene in cm).                           |
| `density`         | number > 0 | Its density (1): liquids in one vessel stack, the densest at the bottom.      |
| `into`            | string     | The liquid (in a vessel below) it becomes when its vessel pours.              |

## Gas

Gases under a piston: the piston rests where pV = nRT puts it (n moles at T kelvin under p pascals and the piston's weight).

| Field             | Type       | Meaning                                                                |
| ----------------- | ---------- | ---------------------------------------------------------------------- |
| `part` (required) | string     | The part drawn as this gas.                                            |
| `in` (required)   | string     | Its vessel, upright (a cylinder).                                      |
| `piston`          | string     | The part that rests on it (set on the gas wherever the scene drew it). |
| `n` (required)    | number > 0 | Moles of gas.                                                          |
| `T` (required)    | number > 0 | Temperature, kelvin.                                                   |
| `p`               | number > 0 | Pressure outside, pascals (101325).                                    |
| `mass`            | number ≥ 0 | The piston's mass, kilograms (0): its weight adds to the pressure.     |

## Validating

```js
import { validate } from 'lk3d/validate';
const problems = validate(scene); // [{ path: 'parts[2].handle', message: 'a handle is exactly one of …' }]
```

From a shell: `node node_modules/lk3d/src/validate.js < scene.json` prints one problem per line and exits with 1 if
there are any. Editors that understand JSON Schema complete and check scenes as you type with
`"$schema": "https://unpkg.com/lk3d/schema/scene.schema.json"`.

## Versions

A scene may say which version of this format it is written in: `"lk3d": 1`. The validator refuses a version it does
not know, and a figure warns once when its scene is newer than the engine. When a later version changes the format,
the engine keeps reading the versions before it, and the changelog says how to move a scene forward.
