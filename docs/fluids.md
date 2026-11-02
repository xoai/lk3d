# Liquids and gases

lk3d moves liquids and gases by the laws a teacher writes on the board, worked out for the vessels the scene draws:
not a fluid simulation, but each quantity the reader sees (a level, a flow, a stream's width, a piston's height)
computed from its law and the vessel's own shape. The laws are pure functions (`src/fluids.js`), shared by the engine
and `lk3d check`, and each is tested against its closed form.

| Law                                               | What it moves                                                                                                      |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Volume and level by the vessel's shape            | a liquid's surface: the volume below a height is the sum of the frustums between the inside's points, and inverted |
| Settling by density                               | liquids in one vessel stack, the densest at the bottom; an outlet takes the bottom one first                       |
| Torricelli: Q = c<sub>d</sub>·πa²·√(2gH)          | what pours through an open outlet of bore a, H below the surface (c<sub>d</sub> 0.6: a sharp-edged hole)           |
| A projectile, and continuity: r²·v stays the same | the falling stream: leaving at √(2gH), it curves down under g and narrows as it speeds up                          |
| The ideal gas: pV = nRT                           | the height a free piston rests at over n moles at T kelvin, under the pressure outside and the piston's own weight |
| A buoyant plume (Morton, Taylor and Turner)       | rising warm air or smoke: its radius grows about 0.12 a unit of height, its speed falls as height<sup>−1/3</sup>   |

Lengths are in scene units; the scene's `unit` (`mm`, `cm`, `dm`, `m`, `km`; `m` if not given) says what one is, so
g = 9.81 m/s² and R = 8.314 J/(mol·K) are the real ones. Volumes are scene units cubed (cm³ in a scene in cm). Time
runs with the figure's clock (`timeScale` slows it), and every rate is the law's at that moment.

## In a scene

```json
{
  "unit": "cm",
  "parts": [
    { "id": "funnel", "name": "Funnel", "material": "glass", "opacity": 0.3, "shapes": [ … ] },
    { "id": "beaker", "name": "Beaker", "material": "glass", "opacity": 0.3, "shapes": [ … ] },
    { "id": "water", "name": "Water", "color": "#5a9be0", "opacity": 0.85 },
    { "id": "water-below", "name": "Water poured", "color": "#5a9be0", "opacity": 0.85 }
  ],
  "vessels": [
    {
      "id": "f",
      "part": "funnel",
      "inside": [[9, 0.25], [12, 0.25], [14, 0.6], [17, 2.4], [19, 2.6]],
      "outlet": { "radius": 0.2, "tip": [0, 9, 0], "valve": "tap" }
    },
    { "id": "b", "part": "beaker", "inside": [[0.2, 3], [7, 3]] }
  ],
  "liquids": [
    { "part": "water", "in": "f", "volume": 30, "into": "water-below" },
    { "part": "water-below", "in": "b", "volume": 10 }
  ]
}
```

- A **vessel** is a part (its glass) and its inside: the radius at each height up its upright axis, from the bottom
  to the brim, inside the glass. An outlet's stem belongs to the inside, so it fills as it pours.
- A **liquid** is a part with no shapes of its own (its name, note, colour, opacity, label and picking work as for any
  part): lk3d makes its body, filling its vessel to the level its volume gives. `density` (1) stacks liquids in one
  vessel; `into` names the liquid it becomes in the vessel below when its vessel pours.
- An **outlet** pours while it is open: by its `valve`, a motion whose range runs from shut to open (the reader turns
  the stopcock), or by the page (`fig.vessel(id).set({ open: 1 })`). `tip` is where the stream leaves, `dir` which way
  (down by default; sideways for a hole in a tank's side, and the stream curves as a projectile does).
- A **gas** fills its vessel up to its piston: `n` moles at `T` kelvin, `p` pascals outside (101 325), the piston's
  `mass` in kilograms. The piston is set on the gas wherever the scene drew it, and eases to where the law puts it
  when the page heats the gas or adds to it (quasi-static: no bouncing).

## From the page

```js
fig.liquid('water').volume; // cm³ now
fig.liquid('water').level; // its surface's height in the scene
fig.vessel('f').flow; // cm³ a second pouring now
fig.vessel('f').set({ open: 0.5 }); // (when no motion opens it)
fig.gas('air').set({ T: 373 }); // heated: the piston rises to where pV = nRT puts it
fig.plume({ at: [0, 1, 0], height: 3, radius: 0.1 }); // warm air rising over a flame, as a stream
```

## Checked

`lk3d check` reports a vessel holding more than its inside takes, one that would overflow if everything that pours
into it came, an inside drawn wider than the vessel's walls (the liquid would go through the glass), and a gas that
would push its piston out of its vessel. The validator checks that every vessel, liquid, motion and part named exists,
and that only a liquid's or a gas's part goes without shapes.

## Limits

- Vessels stand upright (a liquid's surface is level, and its body is turned about the vertical): a tilted flask is not
  a vessel lk3d fills.
- An outlet's flow is Torricelli's, the ideal outflow of a hole; the friction of a long, narrow stem (which slows a
  real burette) is left out.
- A gas is quasi-static: the piston settles where pressure balances, without the oscillation a real one may show.
- Swirls in a stream of air are drawn, not computed: a picture whose speed is the flow's.
