# Accessibility

A figure is a canvas, which a screen reader cannot see into, so lk3d gives it words and keys of its own. This page says
what it offers, what is checked by machine on every change, and what people with screen readers have tried (and what
is still to try).

## What a figure offers

- **Keys.** The canvas takes the focus (Tab) and says what its keys do: the arrows turn it, + and − zoom, Page Down and
  Page Up go through its named parts (each said, as a click would choose it), Escape lets go, and **D** describes it.
- **A handle** is also a range input (out of sight): Tab reaches it, its keys move it, and it says its value
  (`aria-valuetext`, or the page's `handleText`).
- **Words.** The part chosen is said aloud; every named part is listed; `describe()` (D, or the controls' Describe) says
  the figure as it is: taken apart, the cut, see-through, the step, and the scene's own sentences. After a change the
  reader makes, only what changed is said. See [the API](api.md#the-figure).
- **The controls** are buttons and sliders with names, and say when they are on (`aria-pressed`). A control the page has
  locked stays in reach, says so (`aria-disabled`, "locked by the page") and does nothing.
- **The page's own drags** (`onPress`) have no keyboard path of their own: a page that lets the reader drag a part
  this way gives the keyboard another, a slider or a button that does the same (the pendulum's angle and Release, the
  ripple tank's point P as a plane handle).
- **Reduced motion.** With `prefers-reduced-motion`, glides and flicks are cut short (`LK3D.reduce`).
- **The tour** (the story add-on) is a button in the steps panel, "Play the steps" (`aria-pressed`), between Back and
  Next; the tour pauses as soon as the reader touches the figure, a key or a control, and never takes the focus. A
  stage of a sequence is said as it begins ("Stage 3 of 8: the spire"), and the end of the tour too; D says where a
  sequence stands, and its slider says the stage.

## Checked on every change

`test/visual/a11y.spec.mjs` runs [axe-core](https://github.com/dequelabs/axe-core) (a dev dependency, never shipped)
on every example page and on the playground, once their figures are drawn, in Chromium: no serious or critical
violation. It runs in lk3d's own CI (`npm run test:visual`).

## Tried by people

What axe cannot judge is whether a screen reader user can work the figure. Each task below is to be tried with each
screen reader and browser, and its result written here: **pass**, **fail** or **partial**, with notes, the date and the
version tried. A failure becomes an issue; its fix is weighed against the bytes left in the engine's budget.

As of 0.5.0 no cell has been tried: it needs each device and a screen reader user, not yet found. Until then, what is
known is only what axe and the tests check, above.

| Task                                   | NVDA + Firefox (Windows) | NVDA + Chrome (Windows) | VoiceOver + Safari (macOS) | VoiceOver (iOS) | TalkBack + Chrome (Android) |
| -------------------------------------- | ------------------------ | ----------------------- | -------------------------- | --------------- | --------------------------- |
| Find a part and hear its name and note | not tested               | not tested              | not tested                 | not tested      | not tested                  |
| Move a handle and hear its value       | not tested               | not tested              | not tested                 | not tested      | not tested                  |
| Go through the guided steps            | not tested               | not tested              | not tested                 | not tested      | not tested                  |
| Cut the model open and take it apart   | not tested               | not tested              | not tested                 | not tested      | not tested                  |
| Hear the description (D, Describe)     | not tested               | not tested              | not tested                 | not tested      | not tested                  |
| Meet a control the page has locked     | not tested               | not tested              | not tested                 | not tested      | not tested                  |
| Play the steps, pause by touching      | not tested               | not tested              | not tested                 | not tested      | not tested                  |

A page to try them on: [the generator example](../examples/generator.html) (handles, steps, the cut, taking apart, a
lock).
