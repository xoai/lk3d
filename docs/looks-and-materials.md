# Looks and materials

## Two looks

| Look                   | WebGL 2                                                                                                                                                                                                                                                                                                                        | WebGL 1                                                    |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| `ink` (default): drawn | three bands of coloured-pencil shading, hatching in the shade, cross-hatching in creases (ambient occlusion), a hatched shadow on the paper, ink outlines, paper grain                                                                                                                                                         | the same, with a soft contact shadow instead of a cast one |
| `studio`: realistic    | physically based materials (the lighting model of Google's Filament: GGX, correlated Smith visibility, Schlick Fresnel) lit by a studio environment the engine generates and prefilters on the GPU (no image to download), soft cast shadows, ambient occlusion, a glow around glowing parts, Khronos PBR Neutral tone mapping | the same materials with an analytic sky                    |

The Canvas 2D fallback draws flat shading with coarser shapes; labels, picking and handles still work. The reader
switches looks with the built-in button; `style` sets the first. The studio environment and the glow are made only
when first needed, and their shaders compile in the background where the browser can.

## Materials

`metal`, `steel`, `copper`, `gold`, `plastic`, `rubber`, `paint` (the default), `glass`, `magnet`, `matte`, `wood`,
and for the sciences `tissue`, `membrane`, `skin`, `bone`, `rock`, `soil`, `ice`, `water`, `gas`. Soft ones (tissue,
membrane, skin, gas, a little bone and ice) let light wrap round into the shade and glow faintly at the rim, as light
passing into soft matter does. `color` is the drawn look's colour, `studioColor` the studio look's; `opacity` makes a
part see-through; `xray: true` makes it see-through with the "See through" control.

## The studio look's detail (WebGL 2)

- **Surface detail**, at no cost in data: `surface: { kind, scale, strength }`, with `kind` one of `brushed` (streaks
  along x), `knurl` (a diamond grip round x), `ribs` (grooves round x), `grain` (rock, wood), `skin` (cells,
  membranes), `cast` (sandy cast metal); `scale` is bumps per unit, `strength` 0.3 to 1. A height in the part's own
  coordinates bends the normals through its screen derivatives; parts without a surface pay nothing.
- **Glass that bends the light**: `refract: 1` on a `material: 'glass'` part (0 to 2; a lens 1, a bulb 0.6). The
  picture behind the glass is copied once per frame and sampled where the surface sends it.
- **Environments**: `env: 'studio'` (default), `'warm'` or `'night'` (a dim, cool sky).

The drawn look, WebGL 1 and the 2D fallback draw without these.

## Honest scale

A scene drawn to scale can show a bar that keeps its true length as the reader zooms, `scale: { bar: { length: 0.5,
label: '5 µm' } }`; a scene that is not to scale can say so on the stage, `scale: { note: 'Not to scale' }`; or both.
