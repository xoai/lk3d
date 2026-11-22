// @ts-check
// The figure's state as one plain object (index.d.ts: FigureState): fig.state() reads it, fig.set() takes it back
// (setState_: the step first, then the rest over it), and onChange is told when it changes and who changed it. A
// change is found by comparing the state with the one last told, once a frame; who made it is marked where it is made:
// the reader (gestures, the built-in controls, the steps' panel, the handles' inputs: asReader_), the page (its own
// calls) or a playing motion (what changes with no mark). While something glides (a step, the camera, taking apart, the
// cut) the state holds where it is going (towards_), so a glide is one change. A drag and a playing motion are told at
// most every 250 ms, and once more when they stop; a set() inside onChange is not told again. lock_ is what the reader
// may not change (each gesture asks locked_ where it starts). Owns towards_, lock_, locked_, asReader_, mark_,
// changeFrame_, stateOf_, setState_ and dragging_; reads state_, built_, handles_, playing_, motions_, fluids_ and
// stepAt_, and calls goToStep_, explodeNow_, view_, setMotion_, playMotion_, stopMotion_, setHandle_ and kick_.
import { D2R } from '../math.js';

// a handle's value as given out: a plane handle's pair copied (the page may change what it is given)
const copy = (/** @type {any} */ value) => (Array.isArray(value) ? [...value] : value);
/** @param {import('./context').Ctx} c */
export function makeState(c) {
  c.towards_ = { explode: null, cut: null, camera: null };
  c.lock_ = new Set(c.opts_.lock || []);
  c.locked_ = (what) => c.lock_.has(what);
  c.dragging_ = false;

  // ---- who changes the figure: the strongest mark since the state was last told (the reader, then the page)
  /** @type {string | null} */
  let by = null,
    /** @type {string | null} */
    marked = null,
    told = '',
    toldAt = 0,
    inside = false,
    later = 0;
  const RANK = { motion: 0, page: 1, reader: 2 };
  c.mark_ = (cause) => {
    const said = by || cause;
    if (!marked || RANK[said] > RANK[marked]) marked = said;
  };
  c.asReader_ = /** @type {any} */ (
    (fn) =>
      (...args) => {
        const was = by;
        by = 'reader';
        try {
          c.mark_('reader');
          return fn(...args);
        } finally {
          by = was;
        }
      }
  );

  // ---- what the reader can change, now (or where it is going)
  const amount = (/** @type {boolean | number} */ cut) => (cut === true ? 1 : Math.max(0, Math.min(1, +cut || 0)));
  c.stateOf_ = () => /** @type {any} */ (stateNow());
  const stateNow = () => {
    const s = c.state_,
      t = c.towards_,
      steps = c.spec_.steps || [],
      at = c.stepAt_,
      second = s.section.second,
      fluids = c.fluids_,
      // (a vessel whose valve is a motion is opened by that motion: the motion's value says it)
      byValve = (vessel) => vessel.outlet.valve && c.motions_.some((motion) => motion.id === vessel.outlet.valve);
    return {
      v: 1,
      step: at >= 0 ? ((steps[at] && steps[at].id) ?? at) : -1,
      explode: t.explode ?? s.explode,
      cut: t.cut ?? amount(s.cut),
      section: {
        normal: [...s.section.normal],
        offset: s.section.offset,
        second: second ? { normal: [...(second.normal || [1, 0, 0])], offset: second.offset || 0 } : null,
      },
      xray: !!s.xray,
      labels: s.labels,
      style: s.style,
      theme: s.theme ?? null,
      camera: t.camera
        ? { ...t.camera, target: t.camera.target.slice() }
        : { yaw: s.yaw / D2R, pitch: s.pitch / D2R, dist: s.dist, target: s.target.slice() },
      motion: { ...s.motion },
      playing: [...c.playing_.keys()],
      handles: Object.fromEntries(c.handles_.map((grip) => [grip.part.id, copy(grip.value)])),
      joints: { ...s.joints },
      selected: s.selected ?? null,
      hide: c.built_.parts.filter((part) => part.hidden && !part.hiddenByScene).map((part) => part.id),
      liquids: Object.fromEntries((fluids ? fluids.liquids : []).map((liquid) => [liquid.part, liquid.volume])),
      vessels: Object.fromEntries(
        (fluids ? [...fluids.vessels.values()] : [])
          .filter((vessel) => vessel.outlet && !byValve(vessel))
          .map((vessel) => [vessel.id, { open: c.openOf_(vessel) }]),
      ),
      gases: Object.fromEntries(
        (fluids ? fluids.gases : []).map((gas) => [
          gas.part,
          { n: gas.n, T: gas.T, ...(gas.p != null && { p: gas.p }), ...(gas.mass != null && { mass: gas.mass }) },
        ]),
      ),
    };
  };

  // ---- the keys of a state that set() takes besides its own (the step first, then the rest over it)
  c.setState_ = (changes, rest) => {
    if ('step' in changes) {
      const step = changes.step;
      if (step === -1 || step == null) c.stepAt_ = -1;
      else c.goToStep_(step, { ms: 0 });
    }
    rest();
    // (each through the API's own: fig.handle(id).set, fig.motion(id).play, fig.liquid(id).set…)
    const api = c.api_,
      each = (list, fn) => list && Object.entries(list).forEach(([id, value]) => fn(id, value));
    each(changes.handles, (id, value) => api.handle(id)?.set(Array.isArray(value) ? value : +value));
    if ('selected' in changes) ((c.state_.selected = changes.selected ?? null), c.showInfo_());
    if (changes.playing)
      for (const motion of c.motions_) {
        const player = api.motion(motion.id);
        if (changes.playing.includes(motion.id) !== player.playing) player[player.playing ? 'stop' : 'play']();
      }
    each(changes.liquids, (id, volume) => api.liquid(id)?.set({ volume }));
    each(changes.vessels, (id, vessel) => api.vessel(id)?.set(vessel || {}));
    each(changes.gases, (id, gas) => api.gas(id)?.set(gas || {}));
  };

  // ---- told once a frame (loop.js), when the state differs from the one last told
  c.changeFrame_ = () => {
    if (inside) return;
    if (marked && !c.dragging_) c.saidChange_(marked === 'reader'); // (the reader's change said in words: describe.js)
    const listen = c.opts_.onChange;
    if (!listen) return void (marked = null);
    const now = JSON.stringify(c.stateOf_());
    if (!told) told = now; // (the first frame: where the figure starts is no change)
    if (now === told) return void (marked = null);
    const cause = marked || 'motion',
      wait = (cause === 'motion' || (cause === 'reader' && c.dragging_) ? 250 : 0) - (performance.now() - toldAt);
    if (wait > 0) {
      if (!later) later = setTimeout(() => ((later = 0), c.kick_()), wait);
      return;
    }
    toldAt = performance.now();
    marked = null;
    inside = true;
    try {
      listen(JSON.parse(now), /** @type {any} */ (cause));
    } finally {
      inside = false;
      told = JSON.stringify(c.stateOf_()); // (a set() inside onChange is part of the change it was told of)
      marked = null;
    }
  };
  c.cleanups_.push(() => clearTimeout(later));
}
