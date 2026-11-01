# Contributing to lk3d

Thank you for helping. lk3d explains objects with small, accessible, data-driven 3D figures; changes that keep it
small, fast and readable are the most welcome. Open an issue first for anything large (a new kind of shape, a new
backend), so we can agree on the design before you write it.

## Setting up

lk3d is developed in the lessonkit repository and published from `packages/lk3d`:

```sh
cd packages/lk3d
npm install
npx playwright install chromium firefox webkit   # for the image tests
```

## Before you send a change

```sh
npm test               # geometry, models, handles, the validator, the locales
npm run typecheck      # the TypeScript types (update index.d.ts with the API)
npm run size           # the bundle stays within 40 KB gzipped
npm run lint           # ESLint and Prettier (npm run format fixes the formatting)
npm run test:visual    # reference scenes compared with stored pictures
```

- **A change to what is drawn** fails the image tests on purpose. Look at the new pictures in `test-results/`, and if
  they are right, make them again with `npm run test:visual -- --update-snapshots` and include them. Pictures differ
  between platforms: Linux pictures come from the CI workflow (run it by hand with "update").
- **A new shape, material, surface or environment** goes into the schema too (`schema/scene.schema.json`): a test
  checks that the schema names exactly what the engine draws. Then `npm run docs` makes the scene-format reference and
  the shape pictures again.
- **A new option or method** goes into `index.d.ts` and `docs/api.md`.
- **Words on the screen** go into every locale (`src/locales/`); a test checks they have the same keys.
- **Speed**: for anything on the drawing path, run the benchmark before and after (lessonkit's
  `node lessonkit/js/bench.cjs`) and say what it measured.
- Keep the engine free of any one site's specifics: pages adapt it through options, `LK3D.defaults`, locales and CSS
  variables.

## Style

Plain JavaScript (ES modules), no runtime dependencies. Comments say why, in plain English. Names say what things are.
