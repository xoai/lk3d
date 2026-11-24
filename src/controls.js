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
  locked,
  asReader,
  say,
  stageWords,
}) {
  const bar = document.createElement('div');
  bar.className = 'lk3d-bar';
  // what the page may lock against the reader: each control's kind, and the control (seen, focusable, inert, said to
  // be locked); every control acts as the reader (onChange's cause)
  /** @type {[string, HTMLElement, string][]} */
  const lockable = [];
  /** @template {HTMLElement} T @param {string} what @param {T} element @returns {T} */
  const gate = (what, element) => {
    lockable.push([what, element, element.title]);
    // (a locked slider does not move: neither by keys nor by the pointer)
    for (const type of ['keydown', 'pointerdown'])
      element.addEventListener(type, (event) => {
        if (locked(what) && !(event instanceof KeyboardEvent && event.key === 'Tab')) event.preventDefault();
      });
    return element;
  };
  const act = (what, fn) => asReader(() => locked(what) || fn());
  /** @param {string} label @param {string} title @param {() => void} onClick @param {HTMLElement} [into]
   * @param {boolean} [changes] whether it changes the figure (as the reader: onChange's cause) */
  const button = (label, title, onClick, into = bar, changes = true) => {
    const element = document.createElement('button');
    element.type = 'button';
    element.className = buttonClass;
    element.textContent = label;
    if (title) element.title = title;
    element.addEventListener('click', changes ? asReader(onClick) : onClick);
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
  const apartSlider = gate('explode', slider(words.apart, words.apartLabel, 0, 1, 0.01, 0, explodable ? bar : null));
  apartSlider.addEventListener(
    'input',
    act('explode', () => fig.set({ explode: +apartSlider.value })),
  );
  const apartButton = explodable
    ? gate(
        'explode',
        button(
          words.takeApart,
          words.takeApartTitle,
          () => locked('explode') || tweenExplode(state.explode > 0.5 ? 0 : 1),
        ),
      )
    : null;

  // each named motion: a slider along its range, and a button that plays it or stops it. Motions of a group (one plays
  // at a time) share one labelled row of toggle buttons and one slider, for the one last chosen
  /** @type {Map<string, any>} */
  const groups = new Map();
  const motionSyncs = motions.map((motion) => {
    const player = fig.motion(motion.id),
      [min, max] = motion.range.map(Number);
    let shared = motion.group && groups.get(motion.group);
    if (motion.group && !shared) {
      const row = document.createElement('div');
      row.setAttribute('role', 'group');
      row.setAttribute('aria-label', motion.group);
      bar.append(row);
      groups.set(motion.group, (shared = { row, chosen: motion }));
    }
    const input =
      shared?.input ||
      gate('motions', slider(motion.name, motion.name, min, max, (max - min) / 200, player.value, shared?.row));
    if (shared) shared.input = input;
    if (!shared || shared.chosen === motion)
      input.addEventListener(
        'input',
        act('motions', () => {
          const chosen = shared ? fig.motion(shared.chosen.id) : player,
            value = +input.value; // (read first: stopping puts the slider back where the motion is)
          chosen.stop();
          chosen.set(value);
        }),
      );
    const playButton = gate(
      'motions',
      button(
        shared ? motion.name : words.play,
        motion.name,
        () => {
          if (shared) {
            // (the slider now this motion's)
            shared.chosen = motion;
            Object.assign(input, { min, max, step: (max - min) / 200 });
            input.setAttribute('aria-label', motion.name);
          }
          locked('motions') || (player.playing ? player.stop() : player.play());
        },
        shared?.row,
      ),
    );
    const sync = () => {
      if (!shared || shared.chosen === motion) input.value = player.value;
      // (a sequence's slider says its stage: "3 of 8: Chóp")
      if (motion.stages) input.setAttribute('aria-valuetext', stageWords(motion, words.stageText));
      if (shared) playButton.setAttribute('aria-pressed', String(player.playing));
      else playButton.textContent = player.playing ? words.pause : words.play;
    };
    sync();
    return [motion.id, sync];
  });

  // toggles: each shows it is on (aria-pressed for screen readers), also when the page turns it on itself
  const toggles = [];
  const toggle = (label, title, flip, isOn, what) => {
    const element = button(label, title, () => (what && locked(what)) || flip());
    if (what) gate(what, element);
    const sync = () => {
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
      () => fig.set({ cut: state.cut ? 0 : 1 }), // (a cut half swept in: off)
      () => !!state.cut,
      'cut',
    );
  // where the cut is, while it is on (unless the scene fixes it): a slider across the parts it cuts, from one end to
  // the other (the same as dragging the cut face; the keys move it too)
  if (cuttable && moveCut) {
    const cutSlider = gate('cut', slider(words.cutAt, words.cutAtLabel, 0, 1, 0.005, 0)),
      row = /** @type {HTMLElement} */ (cutSlider.parentElement);
    cutSlider.addEventListener(
      'input',
      act('cut', () => {
        const [from, to] = cutRange();
        moveCut(from + (to - from) * +cutSlider.value);
      }),
    );
    const sync = () => {
      row.style.display = state.cut ? '' : 'none'; // (not the hidden attribute: the row's own display would win)
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
      'xray',
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
  // the figure in words, said aloud (as the D key does): saying it changes nothing, so it is not the reader's change
  button(words.describe, words.describeTitle, () => say(fig.describe()), bar, false);

  // the views
  const views = document.createElement('span');
  views.className = 'lk3d-views';
  for (const view of ['front', 'side', 'top', 'home'])
    gate(
      'camera',
      button(words[view], '', () => locked('camera') || fig.view(view), views),
    );
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
    // the page's lock changed: each locked control said to be so (and a slider put back where the figure is)
    lock() {
      for (const [what, element, title] of lockable) {
        const on = locked(what);
        element.classList.toggle('lk3d-locked', on);
        if (on) element.setAttribute('aria-disabled', 'true');
        else element.removeAttribute('aria-disabled');
        element.title = on ? words.locked : title;
      }
      this.explode(state.explode);
      for (const sync of toggles) sync();
      for (const [id] of motionSyncs) this.motion(id);
    },
  };
}
