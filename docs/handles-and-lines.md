# Handles and lines

## Handles: parts the reader moves

A part with a `handle` moves under the pointer (mouse, finger or pen), held to one rule:

```js
{ turn: { axis: [1, 0, 0], center: [0, 0, 0] }, min: 0, max: 270, snap: 15, label: 'Focus ring' }   // degrees
{ turn: { axis: [1, 0, 0] }, moves: ['rotor'], label: 'Rotor' }        // no min/max: it goes round and round
{ slide: { axis: [1, 0, 0] }, value: -4.5, min: -5.5, max: -0.3, snap: 0.1, moves: ['stand'] }      // a distance
{ along: { path: [[x, y, z], …], closed: true }, label: 'Earth' }       // a place on a path, 0 to 1 of its length
```

- `value` is where the part is drawn (default 0, or `min`); a slide's value is in scene units along its axis.
- `moves` lists other parts or groups carried with it.
- A pointer that lands on a handle moves it; anywhere else it turns the view. Glass in front does not hide a handle, and
  a small one (a planet, a focal point) is caught within a finger's width.
- Each handle is also a hidden range input: Tab reaches it, the arrow keys move it (a turn without stops goes round and
  round), and a screen reader reads its `label` and its value, worded by the page's `handleText`.

The page hears every move the reader makes and can move a handle itself (that does not call `onHandle` back):

```js
const fig = LK3D.mount(el, scene, {
  onHandle: (id, v) => {
    d = -v * 10;
    redraw();
  },
  handleText: (id, v) => `d = ${-v * 10} cm`,
});
fig.handle('object').set(-3);
```

The engine's handle maths (`src/handles.js`: the pointer ray to an angle, a distance or a place on a path) is pure and
tested in Node. Examples: [the lens](../examples/lens.html), [the gauge](../examples/gauge.html),
[the Solar System](../examples/solar.html), [the generator](../examples/generator.html).

## Lines: rays, field lines, forces

```js
const rays = fig.lines({ count: 6, radius: 0.01, color: '#d99a00', studioColor: '#ffcf66', glow: '#ffb030' });
rays.set(0, [x0, y0, z0], [x1, y1, z1]); // segment k from a to b; set(k, null) hides it
rays.glow(0.8);
rays.clear();
```

Each set of lines is one draw: a unit cylinder drawn once per segment by instancing, with its matrices updated in place.
