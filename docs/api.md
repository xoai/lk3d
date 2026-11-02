# API

```js
// a page: one script tag, the global LK3D
<script src="https://unpkg.com/lk3d/dist/lk3d.min.js"></script>;
// or a module
import LK3D, { mount, build, defaults, locales } from 'lk3d';
```

## mount(el, scene, options) → figure

Draws `scene` ([format](scene-format.md)) in the element `el`, with the built-in controls under it, and returns the
figure. The canvas has `role="img"` and the scene's `alt`; every handle is also a range input for the keyboard and
screen readers.

| Option                     | Default                  | Meaning                                                                                                                                                    |
| -------------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `info`, `infoIdle`         |                          | an element that shows the name and note of the part pointed at (only `b i em strong sub sup br` kept as HTML; the rest as text); what it says when none is |
| `controls`                 | `true`                   | `false`: no built-in buttons (build your own with the figure's methods)                                                                                    |
| `style`                    | scene's, else `'pen'`    | the first look: `'pen'`, `'studio'` or `'ink'`                                                                                                             |
| `theme`                    | scene's, else none       | the colours: `'light'`, `'dark'`, `'blueprint'`, `'sepia'`, `'auto'`, or a name added to `LK3D.themes`                                                     |
| `labels`                   | `'auto'`                 | `'auto'` (on hover and when taken apart), `'all'`, `'none'`                                                                                                |
| `onPick(part)`             |                          | a part (or `null`) chosen by the reader                                                                                                                    |
| `onHandle(id, value)`      |                          | a handle moved by the reader (not by the page's own `handle(id).set`)                                                                                      |
| `handleText(id, value)`    |                          | what a screen reader says for a handle's value, e.g. `` `d = ${v} cm` ``                                                                                   |
| `locale`, `strings`        | `'en'`                   | the language of the built-in words (`'en'`, `'vi'`, or any key of `LK3D.locales`); single words changed                                                    |
| `buttonClass`              | lk3d's own               | the page's class for the built-in buttons                                                                                                                  |
| `quality`                  | 1 (0.6 on small screens) | shape detail                                                                                                                                               |
| `maxDpr`, `adaptive`, `ao` | 3, `true`, `true`        | the highest pixel density; lowering resolution while frames run late; crease shading                                                                       |
| `force2d`, `webgl1`        |                          | for testing: the Canvas 2D fallback, or WebGL 1                                                                                                            |

`LK3D.defaults` (`locale`, `strings`, `buttonClass`) sets these for every figure on a page.

## The figure

|                                                                                                    |                                                                                                                                                                                                                                                                                                                                            |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `set({ spin, explode, cut, xray, labels, style, theme, timeScale, projection, glow, hide, move })` | the spin angle (degrees) of parts with `spin`; how far apart (0 to 1); the cut; see-through casings; labels; the look; the theme (`null`: none); how fast particles and flows run (1; 0.2 for slow motion); `'perspective'` or `'ortho'`; `glow: {id: 0..1}`; `hide: [ids or groups]`; `move: {id: [x, y, z]}` (a part moved by that much) |
| `view(name or [yaw, pitch] or {yaw, pitch, dist, zoom, target})`                                   | glide the camera: `'front'`, `'side'`, `'top'`, `'iso'`, `'home'`; `zoom`: how close (2: twice as close as the whole model)                                                                                                                                                                                                                |
| `zoom(factor, x, y)`, `zoomLevel`                                                                  | zoom by a factor towards a point of the stage (what is under it stays under it), as the wheel and a pinch do; how close the view is (the scene's `view.minZoom`, 0.02 by default, is the limit: 50 times closer)                                                                                                                           |
| `focus([ids or groups], {yaw, pitch})`                                                             | frame those parts                                                                                                                                                                                                                                                                                                                          |
| `explode(0 or 1)`                                                                                  | take apart or put together, animated                                                                                                                                                                                                                                                                                                       |
| `camera()`                                                                                         | `{yaw, pitch, dist, target}` (degrees, scene units)                                                                                                                                                                                                                                                                                        |
| `select(id or null)`, `selected`                                                                   | choose a part (lit, its note shown) without calling `onPick`; the part chosen                                                                                                                                                                                                                                                              |
| `labels`, `style`, `theme`, `timeScale`, `renderer`, `hifi`, `parts`                               | the labels, look, theme and time scale in use; `'webgl2'`, `'webgl1'` or `'2d'`; the studio look's full lighting; the parts as built                                                                                                                                                                                                       |
| `handle(id)`                                                                                       | `{ value, set(v) }` for a part with a handle ([handles](handles-and-lines.md))                                                                                                                                                                                                                                                             |
| `lines({ count, radius, color, studioColor, glow })`                                               | rods between points: `.set(k, a, b)`, `.clear()`, `.glow(v)`, `.remove()`                                                                                                                                                                                                                                                                  |
| `flow({ path or paths, count, speed, amount, length, width, spread, ramp, part, closed })`         | streaks of air, water or blood along paths, coloured by a ramp along them: `.speed`, `.amount` (the share drawn), `.set({…})`, `.remove()` ([flow](handles-and-lines.md#flow))                                                                                                                                                             |
| `stream({ path, radius, speed, density, turbulence, swirl, ramp })`                                | air or gas as a moving volume along a path (a jet, an intake): `.speed`, `.density`, `.set({…})`, `.remove()` ([streams](handles-and-lines.md#streams))                                                                                                                                                                                    |
| `particles({ path, count, color, size, part, closed })`                                            | dots running along a path at `.speed` (negative: backwards); `part`: in that part's coordinates, so they move with it                                                                                                                                                                                                                      |
| `particles({ count, radius, colors })`                                                             | solid balls the page places: write `.pos4` (x, y, z, and 0..1 picking one of three colours), add 1 to `.version`, call `redraw()`; `.resize(n)`                                                                                                                                                                                            |
| `tick(fn)`                                                                                         | call `fn(now)` every frame while it returns true (`now`: the clock's milliseconds); returns a function that removes it                                                                                                                                                                                                                     |
| `ready`                                                                                            | a promise, resolved with the figure once it is complete: the first picture, the crease shading, every texture (for screenshots, print and tools)                                                                                                                                                                                           |
| `redraw()`, `pick(x, y)`, `refreshMs`                                                              | ask for a frame; the part under a point of the canvas; this screen's frame interval                                                                                                                                                                                                                                                        |
| `stats()`                                                                                          | what drawing costs here: setup, first picture, trees, crease shading (ms), triangles, resolution, textures still decoding, GPU                                                                                                                                                                                                             |
| `destroy()`                                                                                        | take the figure down: timers, listeners and the GPU context released                                                                                                                                                                                                                                                                       |

The figure draws only when something changes and pauses while it is off screen. A page's own simulation is better on
its own `requestAnimationFrame`, telling the figure the new state with `set` and `redraw`.

## Other exports

|                                        |                                                                                                                           |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `build(scene, quality)`                | the geometry a scene makes, without a page (tests and tools: each part's `.g` is one plain geometry)                      |
| `locales`, `defaults`                  | the built-in words (`en`, `vi`; add your own) and the page-wide settings                                                  |
| `themes`                               | the colour themes by name (`light`, `dark`, `blueprint`, `sepia`; add your own) ([themes](looks-and-materials.md#themes)) |
| `clock`                                | the time every figure animates by: `clock.speed` (1; 0 stops it), `clock.step(ms)` moves it on (tests and tools)          |
| `format`                               | the version of the scene format this engine reads (1; a scene says its own in `lk3d`)                                     |
| `safeHTML(text)`                       | a part's words as the figure shows them: only `b i em strong sub sup br` kept as HTML                                     |
| `validate(scene)` from `lk3d/validate` | the scene's problems, `[{ path, message }]` ([format](scene-format.md#validating))                                        |

## Theme

Without a [theme](looks-and-materials.md#themes) (which sets them on the stage itself), the figure's colours and
lettering come from CSS variables a page sets on `:root` or any element around the figure:
`--lk3d-ink`, `--lk3d-paper`, `--lk3d-muted`, `--lk3d-accent` (focus), `--lk3d-warn` (the scale note),
`--lk3d-highlight` (pressed buttons), `--lk3d-font` (labels in the drawn look).
