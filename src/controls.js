// The built-in controls under a figure: take apart (a slider and a button), cut open (and, while it is, where the cut
// is: a slider), see through, show all labels, go round the looks, and the four views. They act through the figure's own API (fig.set, fig.view), so a page that
// passes `controls: false` and builds its own buttons gets exactly the same behaviour.
export function controls({
  el,
  fig,
  state,
  words,
  buttonClass,
  explodable,
  cuttable,
  seeThrough,
  tweenExplode,
  motions,
  cutRange,
  moveCut,
}) {
  const bar = document.createElement('div');
  bar.className = 'lk3d-bar';
  /** @param {string} label @param {string} title @param {() => void} onClick @param {HTMLElement} [into] */
  const button = (label, title, onClick, into = bar) => {
    const element = document.createElement('button');
    element.type = 'button';
    element.className = buttonClass;
    element.textContent = label;
    if (title) element.title = title;
    element.addEventListener('click', onClick);
    into.append(element);
    return element;
  };

  // a slider with its words before it, added to into (if given); built element by element, as its words and range may
  // come from the scene
  /** @param {HTMLElement | null} [into] */
  const slider = (text, label, min, max, step, value, into = bar) => {
    const row = document.createElement('label'),
      caption = document.createElement('span'),
      input = document.createElement('input');
    row.className = 'lk3d-range';
    caption.textContent = text;
    Object.assign(input, { type: 'range', min, max, step, value });
    input.setAttribute('aria-label', label);
    row.append(caption, input);
    if (into) into.append(row);
    return input;
  };

  // taking apart: a slider for how far, and a button that goes all the way out or back
  const apartSlider = slider(words.apart, words.apartLabel, 0, 1, 0.01, 0, explodable ? bar : null);
  apartSlider.addEventListener('input', () => fig.set({ explode: +apartSlider.value }));
  const apartButton = explodable
    ? button(words.takeApart, words.takeApartTitle, () => tweenExplode(state.explode > 0.5 ? 0 : 1))
    : null;

  // each named motion: a slider along its range, and a button that plays it or stops it
  const motionSyncs = motions.map((motion) => {
    const player = fig.motion(motion.id),
      [min, max] = motion.range.map(Number),
      input = slider(motion.name, motion.name, min, max, (max - min) / 200, player.value);
    input.addEventListener('input', () => {
      const value = +input.value; // (read first: stopping puts the slider back where the motion is)
      player.stop();
      player.set(value);
    });
    const playButton = button(words.play, motion.name, () => (player.playing ? player.stop() : player.play()));
    const sync = () => {
      input.value = player.value;
      playButton.textContent = player.playing ? words.pause : words.play;
    };
    sync();
    return [motion.id, sync];
  });

  // toggles: each shows it is on (aria-pressed for screen readers), also when the page turns it on itself
  const toggles = [];
  const toggle = (label, title, flip, isOn) => {
    const element = button(label, title, flip),
      sync = () => {
        element.classList.toggle('on', isOn());
        element.setAttribute('aria-pressed', String(isOn()));
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
  // where the cut is, while it is on (unless the scene fixes it): a slider across the parts it cuts, from one end to
  // the other (the same as dragging the cut face; the keys move it too)
  if (cuttable && moveCut) {
    const cutSlider = slider(words.cutAt, words.cutAtLabel, 0, 1, 0.005, 0),
      row = /** @type {HTMLElement} */ (cutSlider.parentElement);
    cutSlider.addEventListener('input', () => {
      const [from, to] = cutRange();
      moveCut(from + (to - from) * +cutSlider.value);
    });
    const sync = () => {
      row.hidden = !state.cut;
      const [from, to] = cutRange();
      cutSlider.value = String((state.section.offset - from) / (to - from || 1));
    };
    toggles.push(sync);
    sync();
  }
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
  const lookButton = button(words[next()], words.styleTitle, () => fig.set({ style: next() }));

  // the views
  const views = document.createElement('span');
  views.className = 'lk3d-views';
  for (const view of ['front', 'side', 'top', 'home']) button(words[view], '', () => fig.view(view), views);
  bar.append(views);
  el.append(bar);

  // kept in step when the page takes the model apart, cuts it, or changes the look itself
  return {
    motion(id) {
      for (const [motionId, sync] of motionSyncs) if (motionId === id) sync();
    },
    explode(value) {
      apartSlider.value = value;
      if (apartButton) apartButton.textContent = value > 0.5 ? words.putTogether : words.takeApart;
    },
    style() {
      lookButton.textContent = words[next()];
      for (const sync of toggles) sync();
    },
  };
}
