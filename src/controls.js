// The built-in controls under a figure: take apart (a slider and a button), cut open, see through, show all labels,
// go round the looks, and the four views. They act through the figure's own API (fig.set, fig.view), so a page that
// passes `controls: false` and builds its own buttons gets exactly the same behaviour.
export function controls({ el, fig, st, T, btnClass, explodable, cuttable, seeThrough, tweenExplode, motions }) {
  const bar = document.createElement('div');
  bar.className = 'lk3d-bar';
  const button = (label, title, fn, into = bar) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = btnClass;
    b.textContent = label;
    if (title) b.title = title;
    b.addEventListener('click', fn);
    into.append(b);
    return b;
  };

  // a slider with its words before it; built element by element, as its words and range may come from the scene
  const slider = (words, label, min, max, step, value) => {
    const r = document.createElement('label'),
      s = document.createElement('span'),
      input = document.createElement('input');
    r.className = 'lk3d-range';
    s.textContent = words;
    Object.assign(input, { type: 'range', min, max, step, value });
    input.setAttribute('aria-label', label);
    r.append(s, input);
    return input;
  };

  // taking apart: a slider for how far, and a button that goes all the way out or back
  const exIn = slider(T.apart, T.apartLabel, 0, 1, 0.01, 0);
  exIn.addEventListener('input', () => fig.set({ explode: +exIn.value }));
  if (explodable) bar.append(exIn.parentNode);
  const apart = explodable ? button(T.takeApart, T.takeApartTitle, () => tweenExplode(st.explode > 0.5 ? 0 : 1)) : null;

  // each named motion: a slider along its range, and a button that plays it or stops it
  const moves = motions.map((mo) => {
    const m = fig.motion(mo.id),
      [lo, hi] = mo.range.map(Number),
      input = slider(mo.name, mo.name, lo, hi, (hi - lo) / 200, m.value);
    input.addEventListener('input', () => {
      const v = +input.value; // (read first: stopping puts the slider back where the motion is)
      m.stop();
      m.set(v);
    });
    bar.append(input.parentNode);
    const b = button(T.play, mo.name, () => (m.playing ? m.stop() : m.play()));
    const sync = () => {
      input.value = m.value;
      b.textContent = m.playing ? T.pause : T.play;
    };
    sync();
    return [mo.id, sync];
  });

  // toggles: each shows it is on (aria-pressed for screen readers), also when the page turns it on itself
  const toggles = [];
  const toggle = (label, title, flip, isOn) => {
    const b = button(label, title, flip),
      sync = () => {
        b.classList.toggle('on', isOn());
        b.setAttribute('aria-pressed', String(isOn()));
      };
    toggles.push(sync);
    sync();
  };
  if (cuttable)
    toggle(
      T.cut,
      T.cutTitle,
      () => fig.set({ cut: !st.cut }),
      () => st.cut,
    );
  if (seeThrough)
    toggle(
      T.xray,
      T.xrayTitle,
      () => fig.set({ xray: !st.xray }),
      () => st.xray,
    );
  toggle(
    T.labels,
    T.labelsTitle,
    () => fig.set({ labels: st.labels === 'all' ? 'auto' : 'all' }),
    () => st.labels === 'all',
  );
  // the look: one button that goes round the three, naming the one it goes to next
  const LOOKS = ['pen', 'studio', 'ink'],
    next = () => LOOKS[(LOOKS.indexOf(st.style) + 1) % LOOKS.length];
  const look = button(T[next()], T.styleTitle, () => fig.set({ style: next() }));

  // the views
  const views = document.createElement('span');
  views.className = 'lk3d-views';
  for (const n of ['front', 'side', 'top', 'home']) button(T[n], '', () => fig.view(n), views);
  bar.append(views);
  el.append(bar);

  // kept in step when the page takes the model apart, cuts it, or changes the look itself
  return {
    motion(id) {
      for (const [k, sync] of moves) if (k === id) sync();
    },
    explode(v) {
      exIn.value = v;
      if (apart) apart.textContent = v > 0.5 ? T.putTogether : T.takeApart;
    },
    style() {
      look.textContent = T[next()];
      for (const s of toggles) s();
    },
  };
}
