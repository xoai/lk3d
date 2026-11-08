// The built-in controls under a figure: take apart (a slider and a button), cut open, see through, show all labels,
// go round the looks, and the four views. They act through the figure's own API (fig.set, fig.view), so a page that
// passes `controls: false` and builds its own buttons gets exactly the same behaviour.
export function controls({ el, fig, state, words, btnClass, explodable, cuttable, seeThrough, tweenExplode, motions }) {
  const bar = document.createElement('div');
  bar.className = 'lk3d-bar';
  /** @param {string} label @param {string} title @param {() => void} fn @param {HTMLElement} [into] */
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

  // a slider with its words before it, added to into (if given); built element by element, as its words and range may
  // come from the scene
  /** @param {HTMLElement | null} [into] */
  const slider = (words, label, min, max, step, value, into = bar) => {
    const r = document.createElement('label'),
      s = document.createElement('span'),
      input = document.createElement('input');
    r.className = 'lk3d-range';
    s.textContent = words;
    Object.assign(input, { type: 'range', min, max, step, value });
    input.setAttribute('aria-label', label);
    r.append(s, input);
    if (into) into.append(r);
    return input;
  };

  // taking apart: a slider for how far, and a button that goes all the way out or back
  const apartSlider = slider(words.apart, words.apartLabel, 0, 1, 0.01, 0, explodable ? bar : null);
  apartSlider.addEventListener('input', () => fig.set({ explode: +apartSlider.value }));
  const apart = explodable
    ? button(words.takeApart, words.takeApartTitle, () => tweenExplode(state.explode > 0.5 ? 0 : 1))
    : null;

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
    const b = button(words.play, mo.name, () => (m.playing ? m.stop() : m.play()));
    const sync = () => {
      input.value = m.value;
      b.textContent = m.playing ? words.pause : words.play;
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
      words.cut,
      words.cutTitle,
      () => fig.set({ cut: !state.cut }),
      () => state.cut,
    );
  if (seeThrough)
    toggle(
      words.xray,
      words.xrayTitle,
      () => fig.set({ xray: !state.xray }),
      () => state.xray,
    );
  toggle(
    words.labels,
    words.labelsTitle,
    () => fig.set({ labels: state.labels === 'all' ? 'auto' : 'all' }),
    () => state.labels === 'all',
  );
  // the look: one button that goes round the three, naming the one it goes to next
  const LOOKS = ['pen', 'studio', 'ink'],
    next = () => LOOKS[(LOOKS.indexOf(state.style) + 1) % LOOKS.length];
  const look = button(words[next()], words.styleTitle, () => fig.set({ style: next() }));

  // the views
  const views = document.createElement('span');
  views.className = 'lk3d-views';
  for (const n of ['front', 'side', 'top', 'home']) button(words[n], '', () => fig.view(n), views);
  bar.append(views);
  el.append(bar);

  // kept in step when the page takes the model apart, cuts it, or changes the look itself
  return {
    motion(id) {
      for (const [k, sync] of moves) if (k === id) sync();
    },
    explode(v) {
      apartSlider.value = v;
      if (apart) apart.textContent = v > 0.5 ? words.putTogether : words.takeApart;
    },
    style() {
      look.textContent = words[next()];
      for (const s of toggles) s();
    },
  };
}
