// @ts-check
// The story add-on (dist/lk3d-story.min.js, and built into the ES module): sequences, a model taken apart or built
// stage by stage. It expands each of a scene's sequences into the motion the core plays (sequence.js), gives the page
// fig.sequence(id), and holds the rules a sequence brings (join). It reaches a figure only through what the core lends
// (LK3D.hostNames) and its public API; the core (story.core) gives it the clock and reduced motion.
import { expand, pacing, settersOf } from './sequence.js';

/** the host's names this add-on uses: LK3D.use refuses it on a core that lacks one */
export const NEEDS = [
  'motions',
  'setMotion',
  'stopMotion',
  'playing',
  'towards',
  'rule',
  'animate',
  'explode',
  'state',
  'parts',
  'spec',
  'given',
];

const startOf = (/** @type {any} */ motion) => motion.value ?? motion.range[0];

/** a figure's sequences' rules, installed as it mounts: one sequence away from its start at a time; never with explode
 * (taking apart puts every sequence back, a sequence leaving sets explode to 0); while away, it holds the motions that
 * set its parts' joints at their start, and a page's or the reader's call on one of those wins (the sequence goes back
 * first), unless the same set() gives the sequence too
 * @param {any} host */
export function join(host) {
  // (a state's tour: null, or { playing }; set() makes one at the state's step, always paused: a link never plays it)
  host.tours(
    () => (host.tour ? { playing: host.tour.playing } : null),
    (/** @type {any} */ given) => (given ? tour(host).settle() : host.tour?.stop()),
  );
  const motions = host.motions(),
    state = host.state(),
    sequences = motions.filter((/** @type {any} */ motion) => motion.stages);
  if (!sequences.length) return;
  const joints = { byId: new Map((host.spec().joints || []).map((/** @type {any} */ joint) => [joint.id, joint])) },
    away = (/** @type {any} */ motion) => state.motion[motion.id] !== startOf(motion),
    /** @type {Map<any, Set<string>>} each sequence: the motions it holds */
    held = new Map(
      sequences.map((/** @type {any} */ sequence) => [
        sequence,
        new Set(
          host
            .parts()
            .flatMap((/** @type {any} */ part) =>
              part.joint && part.tracks.some((/** @type {any} */ each) => each.motion === sequence)
                ? [...settersOf(joints, part.joint)]
                : [],
            ),
        ),
      ]),
    ),
    /** @type {Map<string, () => void>} motions gliding back to their start: how to stop each */
    glides = new Map();
  let inner = false;
  const set = (/** @type {any} */ motion, /** @type {number} */ value) => {
    inner = true;
    try {
      host.setMotion(motion, value);
    } finally {
      inner = false;
    }
  };
  // a motion back to its start: at once, or gliding there over ms of the clock's time (at once when motion is reduced)
  const back = (/** @type {any} */ motion, ms = 0) => {
    host.stopMotion(motion);
    const from = state.motion[motion.id],
      to = startOf(motion),
      core = story.core,
      start = core.clock.now();
    const step = (/** @type {number} */ now) => {
      const f = ms && !core.reduce ? Math.min(1, (now - start) / ms) : 1;
      set(motion, from + (to - from) * f);
      if (f < 1) return true;
      glides.delete(motion.id);
      return false;
    };
    if (step(start)) glides.set(motion.id, host.animate(step));
  };
  // (a sequence stopped by anyone, a step or the page: its paced play ends, its promise resolved)
  host.stopped((/** @type {any} */ motion) => host.players?.get(motion.id)?.ended());
  host.rule((/** @type {any} */ motion, /** @type {number | undefined} */ value) => {
    // taken apart: every sequence to its start (value: 0, at once; else gliding over that many ms)
    if (!motion) return void held.forEach((_, sequence) => away(sequence) && back(sequence, value));
    if (!inner && glides.has(motion.id)) (glides.get(motion.id)?.(), glides.delete(motion.id));
    if (!motion.stages) {
      const holder = [...held].find(([sequence, ids]) => ids.has(motion.id) && away(sequence))?.[0],
        given = host.given();
      if (!holder) return;
      if (given && holder.id in given) return true; // (the same set() gives the sequence: the motion stays at its start)
      if (value !== startOf(motion)) back(holder); // (played, or set elsewhere: the call wins)
      return;
    }
    if (value === undefined) return !!player(host, motion).play(); // (played: paced, stage by stage; not the core's)
    if (value === startOf(motion)) return;
    if (state.explode && host.towards().explode !== 0) host.explode(0);
    for (const other of motions)
      if (
        other !== motion &&
        (held.has(other) || held.get(motion)?.has(other.id)) &&
        (host.playing().has(other.id) || away(other))
      )
        back(other);
  });
}

// ---- waits on the clock: a hold, a dwell. Never an animation (which draws every frame): checked whenever the clock
// is stepped or set (host.woken), and by a timer for the clock time left at its speed
/** @param {any} host @param {number} at the clock's time @param {() => void} fn */
function waitUntil(host, at, fn) {
  const clock = story.core.clock;
  if (!host.waits) {
    host.waits = new Set();
    host.woken(() => check(host));
  }
  /** @type {any} */
  const wait = { at, fn };
  host.waits.add(wait);
  arm(host, wait);
  check(host);
  return () => (host.waits.delete(wait), clearTimeout(wait.timer));
  function arm(/** @type {any} */ _, /** @type {any} */ w) {
    clearTimeout(w.timer);
    w.timer = setTimeout(() => check(host), clock.speed ? (w.at - clock.now()) / clock.speed + 1 : 250);
  }
}
/** @param {any} host */
function check(host) {
  if (host.gone()) return host.waits.clear();
  const clock = story.core.clock,
    now = clock.now();
  for (const wait of [...host.waits])
    if (now >= wait.at - 1e-6) {
      host.waits.delete(wait);
      clearTimeout(wait.timer);
      wait.fn();
    } else {
      clearTimeout(wait.timer);
      wait.timer = setTimeout(() => check(host), clock.speed ? (wait.at - now) / clock.speed + 1 : 250);
    }
}

/** a sequence's paced player, one a figure and sequence: each stage over its ms, then its hold; a build's first play
 * from its end builds it from nothing; a teardown played at its end plays back; under reduced motion each stage is
 * shown at its end, for its ms and hold, with nothing moving between
 * @param {any} host @param {any} motion */
function player(host, motion) {
  const all = host.players || (host.players = new Map());
  if (all.has(motion.id)) return all.get(motion.id);
  const id = motion.id,
    count = motion.range[1],
    state = host.state(),
    noop = () => true;
  /** @type {any} the play under way: its promise's resolve, and how to cancel what it waits on */
  let run = null;
  const set = (/** @type {number} */ value) => host.setMotion(motion, value);
  const end = () => {
    const done = run;
    if (!done) return;
    run = null;
    done.cancel();
    if (host.playing().get(id) === done.mark) (host.playing().delete(id), host.kick());
    if (done.labels !== undefined) ((state.labels = done.labels), host.kick());
    done.resolve();
  };
  const self = {
    get playing() {
      return !!run && host.playing().get(id) === run.mark;
    },
    stop: () => (run && host.stopMotion(motion), end()),
    ended: () => end(),
    whenDone: () => (run ? run.promise : Promise.resolve()),
    letGo: () => run && (run.follow = false),
    /** @param {{ to?: number, back?: boolean, camera?: boolean }} [o] */
    play(o = {}) {
      host.stopMotion(motion);
      const core = story.core,
        build = motion.value === count;
      let value = state.motion[id],
        to = count;
      if (o.to != null) to = Math.max(0, Math.min(count, +o.to));
      else if (o.back) to = 0;
      else if (value >= count && build) set((value = 0));
      else if (value >= count) to = 0;
      if (state.explode > 0) host.explode(0, 300);
      /** @type {any} */
      // (the camera follows each stage when the stages give a focus or a view, unless the scene or the caller says not,
      // or set() is restoring the play: a link starts no camera move)
      const mine = {
        mark: noop,
        cancel: () => {},
        labels: undefined,
        follow:
          (o.camera ?? true) &&
          motion.camera !== 'none' &&
          !host.given() &&
          motion.stages.some((/** @type {any} */ each) => each.focus || each.view),
      };
      if (!host.following) {
        host.following = true;
        host.touched(() => host.players.forEach((/** @type {any} */ each) => each.letGo()));
      }
      run = mine;
      host.playing().set(id, noop);
      let time = core.clock.now();
      const promise = (mine.promise = new Promise((resolve) => (mine.resolve = resolve)));
      // a stage's part at a time: moving (an animation, unless motion is reduced), then its hold (a wait on the clock)
      const next = () => {
        if (run !== mine) return;
        value = state.motion[id];
        if (Math.abs(value - to) < 1e-9) return end();
        const dir = to > value ? 1 : -1,
          k = dir > 0 ? Math.floor(value + 1e-9) + 1 : Math.ceil(value - 1e-9),
          stop = dir > 0 ? Math.min(k, to) : Math.max(k - 1, to),
          { ms, hold } = motion.holds[k - 1],
          stage = motion.stages[k - 1],
          from = value,
          start = time,
          moved = Math.abs(stop - from) * ms,
          // (a hold after the stage's end, the last stage's too: not after a stop in its middle)
          held = Math.abs(stop - (dir > 0 ? k : k - 1)) < 1e-9 ? hold : 0;
        if (Math.abs(from - (dir > 0 ? k - 1 : k)) < 1e-9) {
          said(host, motion, k, stage);
          if (mine.follow) follow(host, motion, k, stage, core.reduce ? 0 : 0.4 * ms);
        }
        if (stage.labels) {
          if (mine.labels === undefined) mine.labels = state.labels;
          state.labels = [...(Array.isArray(mine.labels) ? mine.labels : []), ...stage.labels];
        }
        const rest = () => {
          set(stop);
          time = start + moved + held;
          host.playing().set(id, (mine.mark = noop));
          mine.cancel = waitUntil(host, time, next);
        };
        if (core.reduce) return rest();
        const step = (/** @type {number} */ now) => {
          if (run !== mine) return false;
          const f = moved ? Math.min(1, (now - start) / moved) : 1;
          if (f >= 1) return (rest(), false);
          set(from + (stop - from) * f);
          return true;
        };
        host.playing().set(id, (mine.mark = step));
        mine.cancel = host.animate(step);
      };
      next();
      return promise;
    },
  };
  all.set(id, self);
  return self;
}

// the words the add-on brings to lk3d's locales (added as it joins, before any figure with sequences mounts): a stage
// said as it plays, on its slider, and in the figure in words (D)
export const WORDS = {
  en: {
    tour: 'Play the steps',
    tourEnd: 'End of the steps',
    readMs: '60', // (a character's reading time, ms: how long a tour stays at a step no dwell gives)
    stageOf: 'Stage {n} of {count}: {title}',
    stageText: '{n} of {count}: {title}',
    saidStage: '{name}: stage {n} of {count}, {title}.',
  },
  vi: {
    tour: 'Tự chạy các bước',
    tourEnd: 'Hết các bước',
    readMs: '60', // (a character's reading time, ms: how long a tour stays at a step no dwell gives)
    stageOf: 'Giai đoạn {n}/{count}: {title}',
    stageText: '{n}/{count}: {title}',
    saidStage: '{name}: giai đoạn {n}/{count}, {title}.',
  },
};

/** a sequence's stage in words, a locale's pattern ({name}, {n}, {count}, {title}): the stage begun at value, from 1
 * @param {any} motion @param {number} value @param {string} pattern */
export function words(motion, value, pattern) {
  const count = motion.range[1],
    n = Math.min(count, Math.max(1, Math.ceil(value - 1e-9))),
    title = motion.stages[n - 1].title;
  return (title ? pattern : pattern.replace(/[:,] \{title\}/, ''))
    .replace('{name}', motion.name || motion.id)
    .replace('{n}', String(n))
    .replace('{count}', String(count))
    .replace('{title}', title);
}

// the camera to a stage as it begins: its view, framing its focus (else its parts) where the stage leaves them, over
// ms (its first 40 %; at once when motion is reduced)
function follow(
  /** @type {any} */ host,
  /** @type {any} */ motion,
  /** @type {number} */ k,
  /** @type {any} */ stage,
  /** @type {number} */ ms,
) {
  if (typeof stage.view === 'string') return host.view(stage.view, { ms });
  const names = stage.focus || stage.parts,
    view = stage.view || {},
    framing = host.frame(
      host.parts().filter((/** @type {any} */ part) => names.includes(part.id) || names.includes(part.group)),
      { [motion.id]: k },
    );
  host.view(
    {
      yaw: view.yaw,
      pitch: view.pitch,
      target: view.target || framing.target,
      dist: view.dist ?? (view.zoom ? undefined : framing.dist),
      zoom: view.zoom,
    },
    { ms },
  );
}

// a stage begun: the page hears it (onStory), and a stage with a title is said (at most once a second, as say_ does)
function said(/** @type {any} */ host, /** @type {any} */ motion, /** @type {number} */ k, /** @type {any} */ stage) {
  // (a page's onStory that throws is logged, once a figure; the play goes on)
  try {
    host.emit({ type: 'stage', sequence: motion.id, stage: k, of: motion.range[1], title: stage.title });
  } catch (error) {
    if (!host.warned) ((host.warned = true), console.error('lk3d: onStory:', error));
  }
  if (stage.title)
    host.say(
      host.words.stageOf
        .replace('{n}', String(k))
        .replace('{count}', String(motion.range[1]))
        .replace('{title}', stage.title),
    );
}

// a page's call on a sequence: page input, pausing a tour, unless lk3d is calling the page (a tick, a callback)
const page = (/** @type {any} */ host) => host.calling() || host.tour?.pause('page');

/** fig.sequence(id): a sequence's handle, over the motion it is expanded into
 * @param {any} host the figure's host @param {any} motion the sequence's motion (expand's) */
export function sequence(host, motion) {
  const paced = player(host, motion),
    state = host.state();
  return {
    get value() {
      return state.motion[motion.id];
    },
    stages: motion.range[1],
    // the stage begun: 3 at 2.5 and at 3.0; 0 at 0
    get stage() {
      return Math.max(0, Math.ceil(state.motion[motion.id] - 1e-9));
    },
    get playing() {
      return paced.playing;
    },
    set: (/** @type {number} */ v) => (page(host), paced.stop(), host.setMotion(motion, v)),
    play: (/** @type {any} */ o) => (page(host), paced.play(o)),
    stop: () => (page(host), paced.stop()),
  };
}

// ---- the tour: the steps played by themselves. Each step: gone to; its glides waited for, and each motion it plays
// that ends (a sequence, a motion played once), and the promise its onStory gave; then its dwell (a wait on the
// clock); then the next. It pauses on the reader's hand, on the page's own input (not inside lk3d's callbacks), when
// the tab hides or the figure stays out of view for a second; Play goes on from where it was
/** fig.tour(options): the figure's tour, made on its first call; fig.tour(false) pauses it
 * @param {any} host @param {any} [options] */
export function tour(host, options) {
  if (options === false) return (host.tour?.pause('page'), host.tour);
  if (host.tour) return host.tour;
  const o = options || {},
    core = story.core,
    all = host.steps(),
    order = (o.steps || all.map((/** @type {any} */ _, /** @type {number} */ k) => k))
      .map(place)
      .filter((/** @type {number} */ k) => k >= 0),
    words = host.words;
  /** @param {any} which a step's place or id */
  function place(which) {
    return typeof which === 'string' ? all.findIndex((/** @type {any} */ step) => step.id === which) : +which;
  }
  let at = Math.max(0, order.indexOf(place(o.from ?? order[0]))),
    playing = false,
    run = 0, // (each play counted: a wait of an earlier one does nothing)
    cancel = () => {},
    held = /** @type {any[]} */ ([]), // (what the step played, stopped by a pause: played again on Play)
    pausedAt = -1;
  // (the Play/Pause button, between Back and Next)
  /** @type {HTMLButtonElement | null} */
  let button = null;
  const nav = host.panel()?.querySelector('.lk3d-step-nav');
  if (nav && o.button !== false) {
    button = document.createElement('button');
    button.type = 'button';
    button.className = nav.firstChild?.className || '';
    button.textContent = words.tour;
    button.setAttribute('aria-pressed', 'false');
    button.addEventListener('click', () => host.locked('steps') || (playing ? self.pause() : self.play()));
    nav.insertBefore(button, nav.lastChild);
  }
  const show = () => button?.setAttribute('aria-pressed', String(playing));
  const tell = (/** @type {any} */ event) => {
    try {
      return Promise.resolve(host.emit(event)).catch(fail);
    } catch (error) {
      return fail(error);
    }
  };
  function fail(/** @type {any} */ error) {
    if (!host.warned) ((host.warned = true), console.error('lk3d: onStory:', error));
  }
  const step = () => all[order[at]];
  // one step of the tour: gone to (unless resuming), waited on, dwelt on
  const go = (/** @type {boolean} */ resume) => {
    const mine = ++run;
    // (the step told first, then gone to: what it plays begins after it)
    const told = resume ? Promise.resolve() : tell({ type: 'step', index: order[at], step: step() });
    if (!resume) {
      host.goToStep(order[at], { by: 'tour' });
      host.mark('tour');
    } else
      for (const motion of held.splice(0))
        host.motions().includes(motion) &&
          (motion.stages ? player(host, motion).play({ camera: false }) : host.playMotion(motion));
    // (the step's glides, and what it plays that ends: a frame-by-frame check while things move, a sequence's own end)
    const still = new Promise((done) => {
      const check = () => {
        if (mine !== run) return false;
        const t = host.towards(),
          moving = t.camera || t.explode != null || t.cut != null,
          busy = [...host.playing().keys()]
            .map((id) => host.motions().find((/** @type {any} */ m) => m.id === id))
            .filter((/** @type {any} */ m) => m && !m.loop);
        if (moving || busy.some((/** @type {any} */ m) => !m.stages)) return true;
        const sequence = busy.find((/** @type {any} */ m) => m.stages);
        if (sequence)
          return (
            player(host, sequence)
              .whenDone()
              .then(() => mine === run && host.animate(check)),
            false
          );
        done(undefined);
        return false;
      };
      if (check()) host.animate(check);
    });
    Promise.all([still, told]).then(() => {
      if (mine !== run) return;
      const s = step(),
        text = `${s.title || ''}${s.text || ''}`.replace(/<[^>]*>/g, ''),
        dwell = o.dwell ?? s.dwell ?? Math.min(15000, Math.max(3000, (+words.readMs || 60) * text.length));
      cancel = waitUntil(host, core.clock.now() + dwell, () => {
        if (mine !== run) return;
        if (at + 1 < order.length || o.loop) {
          at = (at + 1) % order.length;
          go(false);
        } else {
          playing = false;
          show();
          host.mark('tour');
          tell({ type: 'end' });
          host.say(words.tourEnd);
        }
      });
    });
  };
  // a pause: the camera's glide cancelled, what the step plays stopped (to be played again), waits and promises dropped
  const halt = (/** @type {string | null} */ by) => {
    if (!playing) return;
    playing = false;
    pausedAt = at;
    run++;
    cancel();
    host.cancelView();
    held = [];
    for (const id of [...host.playing().keys()]) {
      const motion = host.motions().find((/** @type {any} */ m) => m.id === id);
      if (motion && (all[order[at]].play || []).includes(id)) (held.push(motion), host.stopMotion(motion));
    }
    show();
    if (by) tell({ type: 'pause', by });
  };
  const self = {
    get playing() {
      return playing;
    },
    get at() {
      return order[at];
    },
    play() {
      if (playing) return;
      // (from the step the figure shows, if it is one of the tour's: played on where it stood when paused there)
      const shown = order.indexOf(host.stepAt()),
        resume = shown === at && pausedAt === at;
      if (shown >= 0) at = shown;
      playing = true;
      show();
      go(resume);
    },
    pause: (/** @type {string} */ by = 'page') => halt(by),
    next: () => move(1),
    back: () => move(-1),
    stop() {
      halt(null);
      host.tour = null;
      button?.remove();
    },
    // (made or set back from a state: paused, at the figure's step)
    settle() {
      halt(null);
      at = Math.max(0, order.indexOf(host.stepAt()));
      return self;
    },
  };
  // Back and Next of the tour's own: one step, then paused
  const move = (/** @type {number} */ by) => {
    halt('page');
    at = Math.max(0, Math.min(order.length - 1, at + by));
    host.goToStep(order[at], { by: 'tour' });
  };
  host.tour = self;
  // the reader's hand and the page's input pause it; out of view, hidden, destroyed
  host.touched((/** @type {string} */ kind) => halt(kind === 'page' ? 'page' : 'reader'));
  const hidden = () => document.hidden && halt('hidden');
  document.addEventListener('visibilitychange', hidden);
  let away = 0;
  const watcher =
    typeof IntersectionObserver !== 'undefined' &&
    new IntersectionObserver(
      ([entry]) => {
        clearTimeout(away);
        if (entry.intersectionRatio < 0.2) away = setTimeout(() => halt('hidden'), 1000);
      },
      { threshold: [0, 0.2] },
    );
  if (watcher) watcher.observe(host.stage);
  host.cleanups(() => {
    halt(null);
    document.removeEventListener('visibilitychange', hidden);
    if (watcher) watcher.disconnect();
    clearTimeout(away);
  });
  return self;
}

/** @type {any} (core: the LK3D it joined, set by its entry script) */
export const story = { expand, pacing, sequence, join, words, tour, core: null };
