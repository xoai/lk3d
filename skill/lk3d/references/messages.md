# What the checks say, and what to do

`lk3d check` first checks the format (every field, every shape, the scene's own references), then the geometry.
Format problems come with the path of the field (`parts[3].shapes[1].box`); fix them first, since the geometry is
only checked on a scene in the right form. **A misspelt field on a part is not reported** (a page may keep its own
data there): `colour` for `color`, `explod` for `explode` are silently ignored, so look at the pictures.

## Format (lk3d/validate)

| It says                                         | It means                                                  | Fix                                                                                      |
| ----------------------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `a shape is exactly one of: lathe, cylinder, …` | the shape has no kind, two kinds, or an unknown one       | one kind per shape (`{ "box": … }`, `{ "lathe": … }`); the kinds are in the shapes guide |
| `three numbers [x, y, z]` on `box`              | a box needs three sizes                                   | `"box": [x, y, z]`                                                                       |
| `moves "X", which is no part or group`          | a handle carries a part that does not exist               | the id or group of a real part                                                           |
| `"X" is used by two parts`                      | two parts with one id                                     | ids are unique; a shared name goes in `group`                                            |
| `model "X" is not under the scene's models`     | a `model` shape names a model the scene does not list     | add it under `models` with its file, licence, author and source                          |
| `should be 1` on `lk3d`                         | the scene says a format version this engine does not read | `"lk3d": 1`, or a newer lk3d                                                             |

## Geometry (lk3d/lint)

| It says                                                                                   | It means                                                                                                             | Fix                                                                                                                                                                                                                          |
| ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `A and B run into each other when taken apart (… % of one inside the other, … % at rest)` | on the way to their `explode` places, one passes through the other: the reader sees parts sliding through each other | give one of them a path that is clear (along the axis, sideways, towards the reader), or split a casing in halves; only when it is meant (two pictures of one thing, shown in turn), `check: {allow: [[A, B]]}`              |
| `A touches no other part and hangs in the air`                                            | its bounds touch no part and it is above the lowest part                                                             | rest it on something (a bracket, a post, the base); a part meant to float (a planet, a molecule beside another, a cell across a gap) goes under `check: {float: [A]}`, or `float: true` for a whole scene of floating things |
| `the label of A points inside B when taken apart`                                         | the label's leader line ends inside another solid part, where no one sees it                                         | `"label": [x, y, z]` on A's visible surface; or B see-through (`xray`, `opacity`) if it should be                                                                                                                            |
| `the model X: no file …`                                                                  | a model's file is not beside the scene, the page or the working folder                                               | the right `file`, or the model's `data` (base64)                                                                                                                                                                             |

## Render

| It says                        | It means                                                     | Fix                                                                                                            |
| ------------------------------ | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `lk3d render needs Playwright` | no headless browser to draw with                             | `npm i -D playwright && npx playwright install chromium`; if you cannot, say the figure was not checked by eye |
| `errors: …` after a picture    | the page threw while drawing                                 | read the message: usually a shape's numbers (a path of one point, a radius of 0)                               |
| a picture with nothing in it   | the camera is not on the model, or the model is tiny or huge | `view: {target, dist}`; keep the model about 1–10 units across                                                 |
