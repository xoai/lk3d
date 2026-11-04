# Contributing to lk3d

Thank you for helping. lk3d explains objects with small, accessible, data-driven 3D figures; changes that keep it
small, fast and readable are the most welcome. Open an issue first for anything large (a new kind of shape, a new
backend), so we can agree on the design before you write it.

## Setting up

lk3d is developed in the lessonkit repository (github.com/xoai/lessonkit) and published from `packages/lk3d`. Its
own repository, github.com/xoai/lk3d, is that folder with its history, kept in step from lessonkit after each change
there (`git remote add lk3d git@github.com:xoai/lk3d.git` once; then, from lessonkit's root,
`git push origin main && git subtree push --prefix=packages/lk3d lk3d main`). Make changes in lessonkit, not in lk3d's
repository: a commit made there would not come back.

To work on it:

```sh
cd packages/lk3d
npm install
npx playwright install chromium firefox webkit   # for the image tests
```

## Before you send a change

```sh
npm test               # geometry, models, handles, motions, joints, fluids, the checks, the CLI, the skill, locales
npm run typecheck      # the TypeScript types (update index.d.ts with the API)
npm run size           # fails if the bundle is over its budget (BUDGET_KB in build.mjs, gzipped)
npm run lint           # ESLint and Prettier (npm run format fixes the formatting)
npm run test:visual    # reference scenes compared with stored pictures
```

- **A change to what is drawn** fails the image tests on purpose. Look at the new pictures in `test-results/`, and if
  they are right, make them again with `npm run test:visual -- --update-snapshots` and include them. Pictures differ
  between browsers and platforms, so each keeps its own (`test/visual/baselines/<browser>-<platform>/`). Stored today:
  Chromium and Firefox on macOS only. WebKit is skipped on macOS 14 and older (Playwright cannot drive its build
  there). The CI workflow is lessonkit's `.github/workflows/lk3d.yml` (it runs on Linux, in all three browsers); its
  Linux pictures are not stored yet: run it by hand with "update" ticked, download the "baselines" artifact into
  `test/visual/baselines/`, look at the pictures and commit them. Until then its image tests fail.
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
