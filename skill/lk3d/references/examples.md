# Examples, smallest to fullest

Read the one closest to your figure before writing yours. The pages are in lk3d's `examples/` folder (in the
repository; `npm run examples` serves them), their scenes in `examples/scenes/`.

| Example                                   | Parts                          | What it shows how to do                                                                               |
| ----------------------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `gauge.html`: a pressure gauge            | 6                              | a handle that turns between stops, read out for screen readers                                        |
| `circuit.html`: current in a circuit      | 6                              | particles along a closed path, faster with the voltage                                                |
| `skull.html`: a fossil skull              | 4                              | a textured glTF scan with its licence, author and source; a caliper the reader moves                  |
| `flow.html`: air through a ducted fan     | 4                              | flow streaks with colour ramps, `amount` and `speed` from a throttle, slow motion, themes             |
| `lens.html`: a converging lens on a bench | 8                              | handles along a bench, rays drawn with `lines`, glass that bends light, a true scale bar              |
| `solar.html`: the inner Solar System      | 9                              | handles along orbits, a night environment, `check.float` for planets                                  |
| `terrain.html`: rock layers               | few                            | `terrain` with tilted layers and a fault                                                              |
| `molecules.html`: molecules               | 12                             | CPK colours to one scale; two pictures of each molecule shown in turn (`hide`, `check.allow`)         |
| `generator.html`: an AC generator         | 14                             | take apart, cut open, see through the casing, a rotor turned by hand, a lamp that glows               |
| `cell.html`: an animal cell               | 17 parts, 600+ shapes placed   | the shapes for the sciences: `shell`, `scatter`, `extrude`; a true scale bar                          |
| `looks.html`                              | (the generator)                | the same scene in the three looks and the themes                                                      |
| [the turbofan](example/turbofan.json)     | 34 parts, 1 200+ shapes placed | **the full example**: a machine on a ground-run stand, cut open, built the way the skill says (below) |

## The turbofan, built as the skill says

`example/turbofan.json` is the jet engine of lessonkit's lesson `dong-co-phan-luc`, with its words in English. It
was rebuilt by following this skill. It shows:

- **Sizing:** an inline figure at the top of its range: 34 parts, more than 1 200 shapes placed (blade rows,
  bolt circles), agreed before starting.
- **Setting:** the engine hangs from a test frame (four posts, cross beams, a long beam) through a pylon and a load
  cell, over a base plate on feet with bolts. The stand has `cut: false`, so it stays whole when the engine is cut open.
- **Structure:**
  - each stage is its own part: fan, low- and high-pressure compressor rotors and stators, combustor and fuel ring,
    high- and low-pressure turbines, turbine stators, two nested shafts, exhaust nozzle and cone;
  - casings carry flanges with bolt circles.
- **Taking apart without collisions:** rotor and stator rows alternate, so no casing or stator ring can leave as a
  whole without passing through a rotor. As in a real engine, the casings, the stator rows, the combustor and the fuel
  ring are split into a near half and a far half (lathe sectors `from`/`to`, rows repeated over half a turn) that move
  apart sideways (±z), while the spools stay on the axis. `lk3d check` reports no collisions.
- **Inside by default:** the page turns the cut on at the start (`set({cut: true})`); the section plane removes the
  near half.
- **Look:** pen with an orthographic camera, the fan as the accent; the page adds flow streaks, cool at the intake and
  hot at the exhaust, which the cut also trims.

Check it, and draw it:

```
npx lk3d check references/example/turbofan.json
npx lk3d render references/example/turbofan.json --looks pen,ink --poses rest,apart --ortho
```
