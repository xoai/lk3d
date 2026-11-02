# Scene format

A scene is plain data (JSON, or anything that becomes it). This page is generated from
[`schema/scene.schema.json`](../schema/scene.schema.json) by `npm run docs`; the validator (`lk3d/validate`) checks
exactly these rules, plus unique part ids, handles that move parts that exist, and shapes that name a listed model.
A shape takes only the fields listed for it (a misspelt one is an error). A scene and a part may carry fields not listed here, which lk3d ignores: a page may keep its own data in a scene.

## Scene

A 3D figure as data: parts made of shapes, each with a name and a note, that the reader turns, takes apart, cuts open and moves. Other fields are allowed (a page's own data).

| Field              | Type                                                            | Meaning                                                                                                                                                                                                                                                                                      |
| ------------------ | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lk3d`             | `1`                                                             | The version of this format the scene is written in (1). Optional; a later engine that changes the format reads older versions.                                                                                                                                                               |
| `w`                | number > 0                                                      | The stage's width in proportion to h (16 by default).                                                                                                                                                                                                                                        |
| `h`                | number > 0                                                      | The stage's height in proportion to w (10 by default).                                                                                                                                                                                                                                       |
| `narrow`           | string                                                          | The stage's proportions on a narrow screen, e.g. "1 / 0.9".                                                                                                                                                                                                                                  |
| `title`            | string                                                          | What the figure shows; also the canvas's label when alt is not given.                                                                                                                                                                                                                        |
| `alt`              | string                                                          | A description of the model for screen readers.                                                                                                                                                                                                                                               |
| `style`            | `"ink"` \| `"studio"` \| `"pen"`                                | The first look: pen (near-white, thin lines; the default), studio (realistic) or ink (drawn).                                                                                                                                                                                                |
| `theme`            | `"light"` \| `"dark"` \| `"blueprint"` \| `"sepia"` \| `"auto"` | The colours of the page behind the model, its lines and words (auto: light or dark, as the reader's system is set). None: each look's own.                                                                                                                                                   |
| `env`              | `"studio"` \| `"warm"` \| `"night"`                             | The studio look's environment.                                                                                                                                                                                                                                                               |
| `view`             | object                                                          | The first camera.                                                                                                                                                                                                                                                                            |
| `edges`            | boolean                                                         | Lines where a part's faces meet at an angle: drawn in the pen look unless false; true draws them in every look.                                                                                                                                                                              |
| `check`            | object                                                          | What the geometry check (lk3d check, lk3d/lint) is to excuse, by name: what the scene means on purpose.                                                                                                                                                                                      |
| `ground`           | boolean                                                         | A shadow under the model (true by default).                                                                                                                                                                                                                                                  |
| `section`          | `false` or object                                               | The cut: a plane, or false to offer none.                                                                                                                                                                                                                                                    |
| `motions`          | list of object                                                  | Parts that move together as one value goes along a range: a piston's stroke as the crank turns, a sleeve sliding back, a valve opening. Set or played by the page (fig.motion(id)) and, when named, by the reader (a slider and a play button); run through its range by the geometry check. |
| `scale`            | object                                                          | Honest scale: a bar that keeps its true length as the view zooms, and/or a note saying what is not to scale.                                                                                                                                                                                 |
| `models`           | map of name → object                                            | glTF 2.0 models (.glb) by name, for {model: name} shapes.                                                                                                                                                                                                                                    |
| `parts` (required) | list of object                                                  | The parts of the model, each a list of shapes with a name and a note.                                                                                                                                                                                                                        |

## Part

| Field               | Type                                                                                                                                                                                                                                                            | Meaning                                                                                                                      |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `id` (required)     | string                                                                                                                                                                                                                                                          | Unique in the scene.                                                                                                         |
| `name`              | string                                                                                                                                                                                                                                                          | Its label.                                                                                                                   |
| `note`              | string                                                                                                                                                                                                                                                          | Shown when the part is pointed at (may hold simple HTML).                                                                    |
| `group`             | string                                                                                                                                                                                                                                                          | Parts of one group move, hide and are framed together (set({hide}), focus, a handle's moves).                                |
| `material`          | `"metal"` \| `"steel"` \| `"copper"` \| `"gold"` \| `"plastic"` \| `"rubber"` \| `"paint"` \| `"glass"` \| `"magnet"` \| `"matte"` \| `"wood"` \| `"tissue"` \| `"membrane"` \| `"skin"` \| `"bone"` \| `"rock"` \| `"soil"` \| `"ice"` \| `"water"` \| `"gas"` | How it reflects light in the studio look (and how much light wraps round into it, for soft materials).                       |
| `color`             | colour "#rrggbb"                                                                                                                                                                                                                                                | Its colour in the drawn look.                                                                                                |
| `studioColor`       | colour "#rrggbb"                                                                                                                                                                                                                                                | Its colour in the studio look (default: color).                                                                              |
| `glow`              | colour "#rrggbb"                                                                                                                                                                                                                                                | The colour it glows when the page lights it (set({glow})).                                                                   |
| `cut`               | `false`                                                                                                                                                                                                                                                         | false: the part stays whole when the model is cut open (a stand, a frame, a base).                                           |
| `edges`             | boolean                                                                                                                                                                                                                                                         | Whether its edges are drawn (by default yes, except on soft shapes: models, blobs, trees, terrain, scatter, molecules, DNA). |
| `accent`            | boolean                                                                                                                                                                                                                                                         | Keeps its full colour in the pen look (where other parts are near-white).                                                    |
| `opacity`           | number ≥ 0 ≤ 1                                                                                                                                                                                                                                                  | Always see-through: 1 is solid (glass about 0.35).                                                                           |
| `xray`              | boolean                                                                                                                                                                                                                                                         | Becomes see-through with the "See through" control.                                                                          |
| `hidden`            | boolean                                                                                                                                                                                                                                                         | Not drawn at first (set({hide}) changes it).                                                                                 |
| `explode`           | [x, y, z]                                                                                                                                                                                                                                                       | Where it moves to when the model is taken apart.                                                                             |
| `at`                | [x, y, z]                                                                                                                                                                                                                                                       | Moves the whole part.                                                                                                        |
| `rot`               | [x, y, z]                                                                                                                                                                                                                                                       | Turns the whole part (degrees about x, y, z).                                                                                |
| `scale`             | [x, y, z]                                                                                                                                                                                                                                                       | Stretches the whole part.                                                                                                    |
| `label`             | `false` or [number, number, number]                                                                                                                                                                                                                             | Where its leader line points, or false for no label.                                                                         |
| `spin`              | object                                                                                                                                                                                                                                                          | Turns with the figure's spin angle, set({spin}): about an axis through center, ratio times as fast.                          |
| `handle`            | object                                                                                                                                                                                                                                                          | The reader moves this part with the pointer or the keys.                                                                     |
| `surface`           | object                                                                                                                                                                                                                                                          | Fine surface detail in the studio look (WebGL 2): kind, bumps per unit, strength (0.3 to 1).                                 |
| `refract`           | number > 0 ≤ 2                                                                                                                                                                                                                                                  | Glass that bends what is behind it (studio look, WebGL 2): 1 for a lens.                                                     |
| `shapes` (required) | list of object                                                                                                                                                                                                                                                  | What the part is made of: one or more shapes.                                                                                |

refract is for a glass part (material: glass).

## Shape

Exactly one kind per shape (see [shapes](shapes.md) for each kind's parameters and a picture), plus placement:

| Field    | Type                               | Meaning                                                                                                      |
| -------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `at`     | [x, y, z]                          | Where the shape is, in the part.                                                                             |
| `rot`    | [x, y, z]                          | Turned (degrees about x, y, z).                                                                              |
| `scale`  | [number, number, number] or number | Stretched: [x, y, z], or one number for all three.                                                           |
| `color`  | colour "#rrggbb"                   | Its own colour (vertex colours), over the part's.                                                            |
| `detail` | number > 0                         | More or less detail than the figure's quality: 0.5 for a shape repeated hundreds of times, 2 for a close-up. |
| `repeat` | integer ≥ 1 or object              | Copies around an axis (x unless axis says): n of them, step degrees apart (360 / n) from start (0).          |
| `node`   | string                             | With model: one node of the model (and what is under it).                                                    |
| `closed` | boolean                            | lathe: a closed outline (a ring; a sector's is closed unless false); tube: a loop.                           |
| `mirror` | boolean                            | lathe: flipped along x.                                                                                      |
| `smooth` | boolean                            | lathe: normals blended across the profile's corners, for a curved surface (by default its edges stay crisp). |
| `from`   | number                             | lathe: the angle about x where a sector starts, degrees (0).                                                 |
| `to`     | number                             | lathe: the angle about x where a sector ends, degrees (360); its two sides are closed flat.                  |
| `seg`    | integer ≥ 3                        | lathe, cylinder, sphere: segments around (lathe and cylinder 48, sphere 32; 8 for a tiny bead).              |
| `r`      | number > 0                         | tube: its radius (0.02).                                                                                     |

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
| `url`     | string                                          | Where it comes from (the credit links to it).                                                                                                          |
| `source`  | `"scan"` \| `"dataset"` \| `"artist"` \| `"ai"` | Where it comes from: a scan of a real specimen, a scientific dataset, an artist's model, or made by AI (then called an illustration under the figure). |

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
