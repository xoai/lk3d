// @ts-check
// Guided steps (the scene's `steps`): the figure explained in order, each step a title and words and a state of the
// figure: where the camera looks, how far apart, the cut, see-through, which labels, parts hidden, a part chosen, the
// motions' values and which play. Going to a step sets all of that, and what a step does not say goes back to the
// figure's start, so a step is the same picture however the reader came to it (the camera moves only when the step
// says where). The reader still turns, takes apart and cuts as they like; the next step sets its own state again.
// Owns goToStep_ and stepAt_; reads spec_, opts_, words_, state_, built_, motions_, controls_ and stage_, and calls
// view_, viewAngles_, frame_, explodeNow_, tweenExplode_, setMotion_, stopMotion_, playMotion_, syncHandleInputs_,
// showInfo_, markDirty_ and kick_.
import { clock } from '../clock.js';
import { startOf } from '../motion.js';
import { safeHTML } from './dom.js';
import LK3D from '../namespace.js';

/** @param {import('./context').Ctx} c @param {string} buttonClass */
export function makeSteps(c, buttonClass) {
  const steps = (c.spec_.steps || []).filter((step) => step && typeof step === 'object');
  c.stepAt_ = -1;
  c.goToStep_ = () => {};
  if (!steps.length) return;

  // ---- the cut, swept in (or out) as the explode and the camera glide, rather than appearing at once
  /** @type {((now: number) => boolean) | null} */
  let cutTween = null;
  /** @param {boolean | number} to @param {number} ms */
  const sweepCut = (to, ms) => {
    if (cutTween) c.animations_.delete(cutTween);
    cutTween = null;
    const amount = (/** @type {boolean | number} */ cut) => (cut === true ? 1 : Math.max(0, Math.min(1, +cut || 0))),
      from = amount(c.state_.cut),
      target = amount(to);
    if (!(ms > 0) || LK3D.reduce || from === target) return void (c.state_.cut = to);
    const start = clock.now();
    const tween = (cutTween = (now) => {
      const progress = Math.max(0, Math.min(1, (now - start) / ms)),
        eased = progress < 0.5 ? 4 * progress * progress * progress : 1 - Math.pow(-2 * progress + 2, 3) / 2;
      c.state_.cut = progress >= 1 ? to : from + (target - from) * eased;
      c.markDirty_();
      if (progress < 1) return true;
      c.animations_.delete(tween);
      cutTween = null;
      if (c.controls_.style) c.controls_.style(); // (the Cut button pressed once the cut is in, not while it sweeps)
      return false;
    });
    c.animations_.add(tween);
  };

  // ---- the panel under the stage: the step's words, and Back and Next (unless the page drives the steps itself)
  const panel = (c.opts_.steps ?? c.opts_.controls) !== false ? document.createElement('div') : null,
    words = document.createElement('div'),
    /** @type {HTMLButtonElement[]} */
    buttons = [];
  if (panel) {
    panel.className = 'lk3d-steps';
    panel.setAttribute('role', 'group');
    panel.setAttribute('aria-label', c.words_.steps);
    words.className = 'lk3d-step';
    words.setAttribute('aria-live', 'polite'); // (each step's words are said aloud as the reader comes to it)
    const nav = document.createElement('span');
    nav.className = 'lk3d-step-nav';
    for (const [label, by] of /** @type {[string, number][]} */ ([
      [c.words_.back, -1],
      [c.words_.next, 1],
    ])) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = buttonClass;
      button.textContent = label;
      // (at the first or last step it says so and does nothing, rather than being disabled: a disabled button would
      // drop the keyboard's focus to the page)
      button.addEventListener('click', () => {
        const to = c.stepAt_ + by;
        if (to < 0 || to >= steps.length) return;
        c.goToStep_(to);
        if (c.opts_.onStep) c.opts_.onStep(to, steps[to]);
      });
      nav.append(button);
      buttons.push(button);
    }
    panel.append(words, nav);
    c.stage_.after(panel);
    // (before the first step, opts.step -1: no words yet, Next goes to the first)
    buttons[0].setAttribute('aria-disabled', 'true');
    buttons[1].setAttribute('aria-disabled', 'false');
  }

  // ---- going to a step: by its place (from 0) or its id; options.ms 0 sets it at once (no glides)
  c.goToStep_ = (which, options = {}) => {
    const index = typeof which === 'string' ? steps.findIndex((step) => step.id === which) : Math.round(+which);
    const step = steps[index];
    if (!step) return;
    c.stepAt_ = index;
    const atOnce = options.ms === 0,
      listed = (/** @type {unknown} */ list) => (Array.isArray(list) ? list : []),
      hidden = listed(step.hide);
    // what shows, and how
    for (const part of c.built_.parts)
      part.hidden = part.hiddenByScene || hidden.includes(part.id) || hidden.includes(part.group);
    c.syncHandleInputs_();
    c.state_.xray = !!step.xray;
    c.state_.labels = step.labels ?? c.opts_.labels ?? 'auto';
    c.state_.section = { normal: [0, 0, 1], offset: 0, ...c.spec_.section, ...step.section };
    const part = step.select != null && c.part_(step.select);
    c.state_.selected = part && !part.hidden ? part.id : null;
    // the motions: each at the step's value, else its start; those the step plays, played from there
    for (const motion of c.motions_) {
      c.stopMotion_(motion);
      c.setMotion_(motion, step.motion?.[motion.id] ?? startOf(motion));
    }
    for (const id of listed(step.play)) {
      const motion = c.motions_.find((each) => each.id === id);
      if (motion) c.playMotion_(motion);
    }
    // taken apart, cut and looked at: glided there together
    const explode = Math.max(0, Math.min(1, +(step.explode ?? 0) || 0));
    if (atOnce) c.explodeNow_(explode);
    else c.tweenExplode_(explode);
    sweepCut(c.spec_.section === false ? false : (step.cut ?? false), atOnce ? 0 : 900);
    const focus = listed(step.focus);
    if (step.view === 'home') c.view_('home', options);
    else if (step.view != null || focus.length) {
      const view = typeof step.view === 'object' && step.view && !Array.isArray(step.view) ? step.view : {},
        [yaw, pitch] = typeof step.view === 'string' ? c.viewAngles_(step.view) : [view.yaw, view.pitch],
        framed = c.built_.parts.filter((each) => focus.includes(each.id) || focus.includes(each.group));
      const framing = framed.length && !view.target ? c.frame_(framed, explode) : null;
      const target = view.target || framing?.target,
        dist = view.dist ?? (view.zoom ? undefined : framing?.dist);
      c.view_({ yaw, pitch, target, dist, zoom: view.zoom }, options);
    }
    if (c.controls_.style) c.controls_.style(); // (the buttons show which toggles are on)
    c.showInfo_();
    if (panel) {
      const count = c.words_.stepOf.replace('{n}', String(index + 1)).replace('{count}', String(steps.length));
      words.innerHTML =
        `<span class="lk3d-step-count">${safeHTML(count)}</span> ` +
        (step.title ? `<b>${safeHTML(step.title)}</b> ` : '') +
        safeHTML(step.text);
      buttons[0].setAttribute('aria-disabled', String(index === 0));
      buttons[1].setAttribute('aria-disabled', String(index === steps.length - 1));
    }
    c.kick_();
  };
}
