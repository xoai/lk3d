# Size

What each source file adds to the global script, `dist/lk3d.min.js`: 184.7 KB minified and 71.9 KB
gzipped, against a budget of 71.9 KB (frozen: see [performance](performance.md#size)). Made by
`node build.mjs --size --table`. The minified bytes are exact; the gzipped share is an estimate (gzip compresses the
whole script, not each file): the file's share of the minified bytes, of the gzipped total.

| File | Minified | Gzipped (estimate) | Share |
| ---- | -------: | -----------------: | ----: |
| `src/renderer-gl.js` | 33.3 KB | 12.9 KB | 18.0 % |
| `src/shaders.js` | 19.3 KB | 7.5 KB | 10.5 % |
| `src/geometry.js` | 16.7 KB | 6.5 KB | 9.0 % |
| `src/science.js` | 10.1 KB | 3.9 KB | 5.5 % |
| `src/figure/input.js` | 9.3 KB | 3.6 KB | 5.0 % |
| `src/stylesheet.js` | 6.0 KB | 2.3 KB | 3.3 % |
| `src/figure/api.js` | 5.8 KB | 2.3 KB | 3.2 % |
| `src/figure/camera.js` | 5.1 KB | 2.0 KB | 2.8 % |
| `src/figure/additions.js` | 5.1 KB | 2.0 KB | 2.8 % |
| `src/figure/loop.js` | 4.9 KB | 1.9 KB | 2.6 % |
| `src/figure/labels.js` | 4.0 KB | 1.6 KB | 2.2 % |
| `src/flow.js` | 3.7 KB | 1.4 KB | 2.0 % |
| `src/renderer-2d.js` | 3.3 KB | 1.3 KB | 1.8 % |
| `src/math.js` | 3.2 KB | 1.2 KB | 1.7 % |
| `src/element.js` | 3.0 KB | 1.2 KB | 1.6 % |
| `src/controls.js` | 2.9 KB | 1.1 KB | 1.6 % |
| `src/figure/dom.js` | 2.9 KB | 1.1 KB | 1.6 % |
| `src/figure/steps.js` | 2.8 KB | 1.1 KB | 1.5 % |
| `src/bvh.js` | 2.7 KB | 1.1 KB | 1.5 % |
| `src/figure/dimensions.js` | 2.6 KB | 1.0 KB | 1.4 % |
| `src/core.js` | 2.6 KB | 1.0 KB | 1.4 % |
| `src/figure/pose.js` | 2.5 KB | 1.0 KB | 1.3 % |
| `src/stream.js` | 2.4 KB | 0.9 KB | 1.3 % |
| `src/figure/pick.js` | 2.4 KB | 0.9 KB | 1.3 % |
| `src/figure/state.js` | 2.4 KB | 0.9 KB | 1.3 % |
| `src/locales/vi.js` | 2.3 KB | 0.9 KB | 1.2 % |
| `src/figure/liquids.js` | 2.2 KB | 0.9 KB | 1.2 % |
| `src/fluids.js` | 2.2 KB | 0.9 KB | 1.2 % |
| `src/handles.js` | 2.2 KB | 0.8 KB | 1.2 % |
| `src/guard.js` | 2.1 KB | 0.8 KB | 1.1 % |
| `src/figure/look.js` | 2.1 KB | 0.8 KB | 1.1 % |
| `src/figure/idle.js` | 1.9 KB | 0.7 KB | 1.0 % |
| `src/figure/backend.js` | 1.7 KB | 0.7 KB | 0.9 % |
| `src/joints.js` | 1.7 KB | 0.7 KB | 0.9 % |
| `src/locales/en.js` | 1.4 KB | 0.6 KB | 0.8 % |
| `src/figure/describe.js` | 1.2 KB | 0.5 KB | 0.7 % |
| `src/ao.js` | 0.9 KB | 0.3 KB | 0.5 % |
| `src/namespace.js` | 0.8 KB | 0.3 KB | 0.4 % |
| `src/statecodec.js` | 0.8 KB | 0.3 KB | 0.4 % |
| `src/motion.js` | 0.8 KB | 0.3 KB | 0.4 % |
| `src/text-width.js` | 0.5 KB | 0.2 KB | 0.3 % |
| `src/clock.js` | 0.5 KB | 0.2 KB | 0.3 % |
| `src/stepstate.js` | 0.4 KB | 0.2 KB | 0.2 % |
| `src/changed.js` | 0.1 KB | 0.1 KB | 0.1 % |
