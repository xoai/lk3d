# Size

What each source file adds to the global script, `dist/lk3d.min.js`: 170.9 KB minified and 66.2 KB
gzipped, against a budget of 67 KB (frozen: see [performance](performance.md#size)). Made by
`node build.mjs --size --table`. The minified bytes are exact; the gzipped share is an estimate (gzip compresses the
whole script, not each file): the file's share of the minified bytes, of the gzipped total.

| File | Minified | Gzipped (estimate) | Share |
| ---- | -------: | -----------------: | ----: |
| `src/renderer-gl.js` | 32.3 KB | 12.5 KB | 18.9 % |
| `src/shaders.js` | 19.3 KB | 7.5 KB | 11.3 % |
| `src/geometry.js` | 16.7 KB | 6.5 KB | 9.8 % |
| `src/science.js` | 10.1 KB | 3.9 KB | 5.9 % |
| `src/figure/input.js` | 7.9 KB | 3.1 KB | 4.6 % |
| `src/stylesheet.js` | 5.8 KB | 2.3 KB | 3.4 % |
| `src/figure/camera.js` | 4.7 KB | 1.8 KB | 2.8 % |
| `src/figure/loop.js` | 4.6 KB | 1.8 KB | 2.7 % |
| `src/figure/api.js` | 4.1 KB | 1.6 KB | 2.4 % |
| `src/figure/additions.js` | 3.4 KB | 1.3 KB | 2.0 % |
| `src/figure/labels.js` | 3.3 KB | 1.3 KB | 1.9 % |
| `src/flow.js` | 3.3 KB | 1.3 KB | 1.9 % |
| `src/renderer-2d.js` | 3.2 KB | 1.3 KB | 1.9 % |
| `src/math.js` | 3.2 KB | 1.2 KB | 1.9 % |
| `src/element.js` | 2.9 KB | 1.1 KB | 1.7 % |
| `src/controls.js` | 2.8 KB | 1.1 KB | 1.6 % |
| `src/figure/steps.js` | 2.7 KB | 1.1 KB | 1.6 % |
| `src/bvh.js` | 2.7 KB | 1.0 KB | 1.6 % |
| `src/figure/dom.js` | 2.7 KB | 1.0 KB | 1.6 % |
| `src/figure/dimensions.js` | 2.6 KB | 1.0 KB | 1.5 % |
| `src/stream.js` | 2.4 KB | 0.9 KB | 1.4 % |
| `src/figure/liquids.js` | 2.2 KB | 0.9 KB | 1.3 % |
| `src/fluids.js` | 2.2 KB | 0.9 KB | 1.3 % |
| `src/figure/state.js` | 2.2 KB | 0.9 KB | 1.3 % |
| `src/figure/look.js` | 2.1 KB | 0.8 KB | 1.2 % |
| `src/core.js` | 2.1 KB | 0.8 KB | 1.2 % |
| `src/figure/pose.js` | 2.1 KB | 0.8 KB | 1.2 % |
| `src/guard.js` | 2.0 KB | 0.8 KB | 1.2 % |
| `src/handles.js` | 1.9 KB | 0.7 KB | 1.1 % |
| `src/figure/idle.js` | 1.9 KB | 0.7 KB | 1.1 % |
| `src/figure/backend.js` | 1.7 KB | 0.7 KB | 1.0 % |
| `src/joints.js` | 1.7 KB | 0.6 KB | 1.0 % |
| `src/locales/vi.js` | 1.7 KB | 0.6 KB | 1.0 % |
| `src/figure/pick.js` | 1.2 KB | 0.5 KB | 0.7 % |
| `src/locales/en.js` | 1.0 KB | 0.4 KB | 0.6 % |
| `src/ao.js` | 0.9 KB | 0.3 KB | 0.5 % |
| `src/statecodec.js` | 0.8 KB | 0.3 KB | 0.5 % |
| `src/motion.js` | 0.7 KB | 0.3 KB | 0.4 % |
| `src/text-width.js` | 0.5 KB | 0.2 KB | 0.3 % |
| `src/clock.js` | 0.5 KB | 0.2 KB | 0.3 % |
| `src/namespace.js` | 0.4 KB | 0.2 KB | 0.3 % |
| `src/stepstate.js` | 0.3 KB | 0.1 KB | 0.2 % |
| `src/changed.js` | 0.1 KB | 0.1 KB | 0.1 % |
