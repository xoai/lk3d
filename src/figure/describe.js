// @ts-check
// The figure in words (fig.describe(), the D key, the controls' Describe): its title, taken apart or put together, the
// cut, see-through, the step, and the scene's own sentences (scene.describe: one per motion, handle, liquid or gas,
// {value} its number as the locale writes it). Said through the figure's live region (say_, dom.js); after a change,
// the sentences that changed, when the reader made it (not the step's, which the steps' panel says, nor a handle's,
// which its input says). In the 2D fallback there is no cut, so none is said. Owns sentences_ and saidChange_; reads
// spec_, state_, words_, built_, stepAt_, handles_ and fluids_.
/** @param {import('./context').Ctx} c */
export function makeDescribe(c) {
  const w = c.words_,
    own = c.spec_.describe || {},
    steps = c.spec_.steps || [],
    apart = c.built_.parts.some((part) => part.explode.some((v) => v)),
    number = (/** @type {number} */ v) => String(+v.toFixed(2)).replace('.', w.decimal);
  /** @returns {[string, string][]} [kind, sentence] */
  c.sentences_ = () => {
    const s = c.state_,
      out = [],
      add = (/** @type {string} */ kind, /** @type {any} */ text) => text && out.push([kind, text]),
      normal = s.section.normal,
      axis = [0, 1, 2].find((k) => Math.abs(normal[k]) > 0.999),
      step = steps[c.stepAt_],
      fluids = c.fluids_;
    add('title', c.spec_.title && c.spec_.title.replace(/\.?$/, '.'));
    if (apart) add('apart', s.explode > 0.5 ? w.saidApart : w.saidTogether);
    if (s.cut && c.renderer_.kind !== '2d')
      add(
        'cut',
        s.section.second ? w.saidQuarter : axis == null ? w.saidSlant : w.saidCut.replace('{axis}', 'xyz'[axis]),
      );
    if (s.xray) add('xray', w.saidXray);
    if (step)
      add(
        'step',
        w.stepOf.replace('{n}', String(c.stepAt_ + 1)).replace('{count}', String(steps.length)) +
          (step.title ? ': ' + step.title.replace(/\.?$/, '.') : '.'),
      );
    for (const [id, text] of Object.entries(own)) {
      const grip = c.handles_.find((each) => each.part.id === id),
        fluid = fluids && [...fluids.liquids, ...fluids.gases].find((each) => each.part === id),
        value = grip ? grip.value : (s.motion[id] ?? (fluid ? (fluid.T ?? fluid.volume) : null));
      if (value != null && typeof text === 'string')
        add(grip ? 'handle' : 'own', text.replace('{value}', number(value)));
    }
    return out;
  };
  // (what was last said or seen: a change says only the sentences that are new)
  let last = new Set();
  c.saidChange_ = (byReader) => {
    const now = c.sentences_(),
      fresh = now.filter(([kind, text]) => kind !== 'step' && kind !== 'handle' && !last.has(text));
    last = new Set(now.map(([, text]) => text));
    if (byReader && fresh.length) c.say_(fresh.map(([, text]) => text).join(' '));
  };
}
