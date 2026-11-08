# Contributing to lk3d

Thank you for helping. lk3d explains objects with small, accessible, data-driven 3D figures; changes that keep it
small, fast and readable are the most welcome. Open an issue first for anything large (a new kind of shape, a new
backend), so we can agree on the design before you write it.

## Setting up

lk3d is developed in the lessonkit repository (github.com/xoai/lessonkit) and published from `packages/lk3d`. Its
own repository, github.com/xoai/lk3d, is that folder with its history, kept in step from lessonkit after each change
there (`git remote add lk3d git@github.com:xoai/lk3d.git` once; then, from lessonkit's root,
`git push origin main && git subtree push --prefix=packages/lk3d lk3d main`). Maintainers make changes in lessonkit, not
in lk3d's repository: a commit made there would not come back, and the next push would be refused.

Pull requests to github.com/xoai/lk3d are welcome all the same. Base them on its `main`; they are reviewed there but not
merged with GitHub's button. A maintainer brings each one through lessonkit, so its lessons check it too, and pushes it
back; its own commits reach lk3d's `main` unchanged, and GitHub marks it merged. From lessonkit's root:

```sh
git fetch lk3d pull/N/head                                   # the pull request, N its number
git subtree merge --prefix=packages/lk3d FETCH_HEAD -m "lk3d: pull request #N (title)"
# check it as any change here (npm test, the image tests, ./lk test --templates, the lessons), then
git push origin main && git subtree push --prefix=packages/lk3d lk3d main
```

The first time, `git subtree merge` refuses ("unrelated histories"): lessonkit's history does not yet record which of
its commits lk3d's are. Record it once with `git subtree split --prefix=packages/lk3d --rejoin` (one empty merge
commit in lessonkit; lk3d itself does not change), then merge.

To work on it:

```sh
cd packages/lk3d
npm install
npx playwright install chromium firefox webkit   # for the image tests
```

## Before you send a change

```sh
npm test               # geometry, models, handles, motions, joints, fluids, the checks, the CLI, the skill, locales
npm run typecheck      # the sources (checkJs: tsconfig.json), the TypeScript types, and the scenes against them
npm run size           # fails if the bundle is over its budget (BUDGET_KB in build.mjs, gzipped)
npm run lint           # ESLint and Prettier (npm run format fixes the formatting)
npm run test:visual    # reference scenes compared with stored pictures
```

- **A change to what is drawn** fails the image tests on purpose. Look at the new pictures in `test-results/`, and if
  they are right, make them again with `npm run test:visual -- --update-snapshots` and include them. Pictures differ
  between browsers and platforms, so each keeps its own (`test/visual/baselines/<browser>-<platform>/`). Stored today:
  Chromium and Firefox on macOS; Chromium, Firefox and WebKit on Linux. WebKit is skipped on macOS 14 and older
  (Playwright cannot drive its build there). The CI workflow is `.github/workflows/ci.yml`, run in this public
  repository on Linux in all three browsers (lessonkit runs only the quick checks). A change that changes pictures
  changes the Linux ones too: run the workflow by hand with "update" ticked, download the "baselines" artifact into
  `test/visual/baselines/`, look at the pictures and commit them; until then its image tests fail.
- **A new shape, material, surface or environment** goes into the schema too (`schema/scene.schema.json`): a test
  checks that the schema names exactly what the engine draws. Then `npm run docs` makes the scene-format reference and
  the shape pictures again, and `npm run types` the scene's TypeScript types (`scene.d.ts`, generated from the schema:
  never edit it by hand; a test fails when it is out of date).
- **A new option or method** goes into `index.d.ts` (the page API, written by hand) and `docs/api.md`.
- **Words on the screen** go into every locale (`src/locales/`); a test checks they have the same keys.
- **Speed**: for anything on the drawing path, run the benchmark before and after (lessonkit's
  `node lessonkit/js/bench.cjs`) and say what it measured.
- Keep the engine free of any one site's specifics: pages adapt it through options, `LK3D.defaults`, locales and CSS
  variables.

## Style

Plain JavaScript (ES modules), no runtime dependencies. Comments say why, in plain English. Names say what things are.
Each module starts with a line or two saying what it owns and what it reads from others.

A mounted figure is made of parts in `src/figure/` (the map: `docs/design.md`, "A mounted figure"), each a function
`makeX(c)` given the figure's context `c`: what only a part uses stays in its closure; what others read or call goes on
`c`, as a field whose name ends in `_` (declared in `src/figure/context.d.ts`), and nothing else may end in `_`
(`build.mjs` renames those fields short). So, like locals, they cost nothing: name them plainly (`c.renderer_`, not
`c.R_`). The properties of parts, batches, frames and other objects are kept as written, so there a short name still
saves bytes; say what a terse one holds in a comment. Read shared things as `c.state_.x`, `c.built_.parts`,
`c.kick_()`, not through local copies: the bundle gzips smaller so. A new part goes into `mount()` (`src/index.js`) where its elements,
listeners and timers belong, and its import with the others, in the same order. The sources are type-checked as
JavaScript (`npm run typecheck`): JSDoc where the checker cannot tell, the scene's types from `scene.d.ts`
(`/** @param {import('../scene').Scene} spec */`).
