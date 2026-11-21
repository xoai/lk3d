# Recipes

Things a page often wants from a figure, each a few lines on top of [the API](api.md).

## A story told as the reader scrolls

Each block of text names the guided step it is about (`data-step`, the step's id); as a block scrolls into the middle
of the screen, the figure goes to that step. The figure stays in view beside the text (`position: sticky`).

```html
<div class="story">
  <div id="fig" style="position: sticky; top: 10vh; height: 80vh"></div>
  <section data-step="whole">The machine as a whole…</section>
  <section data-step="rotor">Inside, the rotor turns…</section>
</div>
<script>
  const fig = LK3D.mount(document.getElementById('fig'), scene, { steps: false });
  // (read each time, not once: the reader may change it while the page is open; LK3D.reduce is read at load)
  const still = matchMedia('(prefers-reduced-motion: reduce)');
  const watch = new IntersectionObserver(
    (entries) => {
      for (const entry of entries)
        if (entry.isIntersecting) fig.step(entry.target.dataset.step, { ms: still.matches ? 0 : 900 });
    },
    { rootMargin: '-45% 0px -45% 0px' }, // (the block crossing the middle of the screen)
  );
  for (const block of document.querySelectorAll('[data-step]')) watch.observe(block);
</script>
```

`steps: false` leaves out the steps' own panel: the text is the panel. `fig.step` does not call `onStep`.

## Printing each step

A printed page has no figure to turn, so print a picture of each step instead. `fig.picture()` resolves with a PNG
(a data URL) of the figure as drawn: draw them ahead of time, when the page is idle, since the browser's `beforeprint`
cannot wait for a picture. HTML labels (the part names on the stage) are not in the picture.

```js
async function stepPictures(fig) {
  const kept = fig.state(), // (put back afterwards: the reader's own view)
    pictures = [];
  for (let k = 0; k < fig.steps.length; k++) {
    fig.step(k, { ms: 0 });
    pictures.push(await fig.picture());
  }
  fig.set(kept);
  return pictures; // each into an <img> that only print shows: @media print { .lk3d { display: none } }
}
requestIdleCallback(() => stepPictures(fig).then(show));
```

`picture()` works in WebGL and in the 2D fallback, and for a figure that has not been on screen yet (it makes its
drawing context first); it rejects for a figure the page hides (`display: none`).

## A state in a link

`fig.state()` is what the reader has done (the step, the camera, taken apart, the cut, the handles…), and
`LK3D.encodeState` makes it text for a link:

```js
share.onclick = async () => {
  history.replaceState(null, '', '#state=' + (await LK3D.encodeState(fig.state())));
};
const shared = new URLSearchParams(location.hash.slice(1)).get('state');
if (shared) fig.set(await LK3D.decodeState(shared));
```

The same text goes in an element's attribute: `<lk3d-figure src="…" state="…">`. To keep a page's own record of
what the reader did, `onChange(state, cause)` says each change and who made it. See
[the figure's state](api.md#the-figures-state).
