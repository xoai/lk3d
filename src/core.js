// @ts-check
// lk3d: a small engine for explorable 3D diagrams (global LK3D, or import it). A scene is data (JSON, or YAML in a
// lessonkit spec): parts made of shapes, each with a name and a note, a group, a material, how it moves apart, whether
// it spins. schema/scene.schema.json describes the format; docs/design.md how the engine works.
//
//   const s = LK3D.mount(el, FIG.generator, { info: $('#info') });
//   s.set({ spin: angle, glow: { lamp: 0.8 }, move: { piston: [0, -0.2, 0] } });  s.particles({ path, count, color }).speed = v;
//   const gas = s.particles({ count, radius, colors }); write gas.positionsAndColors (x, y, z, colour 0..1) and call s.redraw()
//   a part with a handle (turn, slide, along) is moved by the reader's pointer or keys: opts.onHandle(id, value);
//   s.handle(id).set(v);  const rays = s.lines({ count, radius, color, glow }); rays.set(k, [x, y, z], [x, y, z])
//   const air = s.flow({ paths, count, ramp: 'cool', spread }); air.set({ speed, amount })   streaks along paths
//
// Backends, best first: WebGL 2 (physically based materials lit by a generated studio environment, soft shadows,
// creases shaded by ambient occlusion, glow), WebGL 1 (the same scene, simpler light), Canvas 2D (flat shading).
// It draws only when something changes, pauses off screen, lowers its resolution while frames are slow and moving,
// and never reads from the page layout or the GPU while drawing: labels are measured once, picking casts rays on the CPU.
//
// mount() composes a figure from its parts in src/figure/, each owning one subsystem and sharing the figure's state
// through one context object (figure/context.d.ts: Ctx), made here and passed to each in turn.

// the figure's parts, in the order mount makes them (the bundle keeps this order; it gzips smaller so)
import { openGL } from './figure/backend.js';
import { makePose } from './figure/pose.js';
import { makeLiquids } from './figure/liquids.js';
import { makeCamera } from './figure/camera.js';
import { makeDom, safeHTML } from './figure/dom.js';
import { makeLoop } from './figure/loop.js';
import { makeLook } from './figure/look.js';
import { makeLabels } from './figure/labels.js';
import { makeDimensions } from './figure/dimensions.js';
import { makePick } from './figure/pick.js';
import { makeIdle } from './figure/idle.js';
import { makeInput } from './figure/input.js';
import { makeAdditions } from './figure/additions.js';
import { makeApi } from './figure/api.js';
import { makeState } from './figure/state.js';
import { makeDescribe } from './figure/describe.js';
import { encodeState, decodeState } from './statecodec.js';
import { makeSteps } from './figure/steps.js';
import { M, D2R } from './math.js';
import { buildFitting, useModels, modelsMissing, modelsError } from './geometry.js';
import { guard } from './guard.js';
import { css } from './stylesheet.js';
import { controls } from './controls.js';
import { clock, refreshFrom } from './clock.js';
import LK3D, { FORMAT } from './namespace.js';
import en from './locales/en.js';
import { defineElement, retry } from './element.js';
import { serveAO } from './ao.js';

let warned = false;

// Draws a scene in `el` and returns the figure's API. Its parts, made in this order (the order its elements, listeners
// and timers are made in): the WebGL context · where parts are (pose) · liquids and gases · the camera · the elements ·
// the renderer (WebGL 2 or 1, else Canvas 2D) · the frame loop · the look · labels · picking and the idle work (trees,
// crease shading, edges) · the pointer, keys and handles · what a page adds · the API · the built-in controls
// (controls.js) · handles as range inputs · guided steps · watching size, visibility and the screen's density.
/**
 * @param {HTMLElement & { lk3d?: any }} el
 * @param {import('../scene').Scene} spec
 * @param {import('./figure/context').Options} [opts]
 */
function mount(el, spec, opts = {}) {
  // a scene may come from anyone: refused with a sentence naming the place before anything is built or drawn, by the
  // engine's guard (guard.js), or by the full rules when the page gives them (opts.validate: lk3d/validate's validate)
  const problem = (opts.validate || guard)(spec)[0];
  if (problem) throw new Error(`lk3d: ${problem.path || 'the scene'}: ${problem.message}`);
  // a scene that draws glTF models, on a page without the reader (the global script alone): refused, naming them and
  // the add-on to load, before anything on the page is touched
  const missing = modelsMissing(spec);
  if (missing) throw modelsError(missing);
  // a scene with sequences needs the story add-on (dist/lk3d-story.min.js), which expands each into a motion: refused,
  // naming it, without it (an element is drawn once it joins)
  const story = LK3D.story;
  if (spec.sequences?.length && !story) {
    const error = new Error('lk3d: this scene has sequences: load dist/lk3d-story.min.js after dist/lk3d.min.js');
    /** @type {any} */ (error).addOn = 'story';
    throw error;
  }
  css();
  if (el.lk3d) el.lk3d.destroy(); // (mounting again on the same element replaces the figure there)
  if ((spec.lk3d || 0) > FORMAT && !warned) {
    warned = true;
    console.warn(`lk3d: this scene is written for format ${spec.lk3d}; this engine reads ${FORMAT}`);
  }
  // the words on the page (opts.locale, else LK3D.defaults.locale, else English; opts.strings change single ones), and
  // the class of the built-in buttons (opts.buttonClass, e.g. a page's own button style; else lk3d's plain one)
  const defaults = LK3D.defaults,
    words = { ...(LK3D.locales[opts.locale || defaults.locale] || en), ...defaults.strings, ...opts.strings };
  const pageButtonClass = opts.buttonClass ?? defaults.buttonClass,
    buttonClass = 'lk3d-btn ' + (pageButtonClass || 'lk3d-plain');
  const mountedAt = performance.now(),
    stats = { setupMs: 0, firstFrameMs: null, treesMs: null, aoMs: null, refreshMs: null, aoWorker: false };
  const state = {
    style: opts.style || spec.style || 'pen',
    theme: opts.theme || spec.theme || null,
    transparent: !!opts.transparent, // (no page behind the model: the canvas clear, the stage with no background)
    timeScale: 1,
    projection: spec.view?.projection || 'perspective',
    explode: 0,
    spin: 0,
    cut: false,
    section: { normal: [0, 0, 1], offset: 0, ...spec.section }, // (the cut's plane: the scene's, moved by the page)
    labels: opts.labels || 'auto',
    dimensions: null, // (the dimensions shown: null, the scene's own; or a step's or the page's, by id)
    xray: false,
    yaw: (spec.view?.yaw ?? -35) * D2R,
    pitch: (spec.view?.pitch ?? 18) * D2R,
    dist: 1,
    target: [0, 0, 0],
    hover: null,
    selected: null,
    motion: {}, // each motion's value (motion.js)
    joints: {}, // a joint's value set by the page, over its drive (joints.js)
  };
  // (resolved once the figure is complete: see checkReady_ in figure/idle.js)
  let resolveReady;
  const ready = new Promise((resolve) => (resolveReady = resolve));
  const smallScreen = Math.min(screen.width, screen.height) < 700;
  /** @type {import('./figure/context').Ctx} (filled in by the parts below) */
  const c = /** @type {any} */ ({
    host_: el,
    spec_: spec,
    opts_: opts,
    words_: words,
    state_: state,
    stats_: stats,
    mountedAt_: mountedAt,
    ready_: ready,
    resolveReady_: resolveReady,
    destroyed_: false,
    smallScreen_: smallScreen,
    canvas_: document.createElement('canvas'),
    animations_: new Set(),
    controls_: {}, // the built-in controls' hooks (filled in below, once the figure's API exists)
    // the scene's motions, and its sequences as the motions they are (story.js expands them: sequence.js)
    motions_: [...(spec.motions || []), ...(spec.sequences || []).map((sequence) => story.expand(sequence, spec))],
    particles_: [],
    flows_: [],
    streams_: [],
    additions_: [],
    cleanups_: [],
  });
  const [webgl, makeBackend] = openGL(c);
  // without WebGL the 2D fallback sorts every triangle on the CPU, so it gets coarser shapes
  // and at most so many triangles: a million where memory is small (a phone's screen, or what the browser says it has),
  // so a heavy scene is drawn coarser (down to a quarter of its detail) or refused rather than taking the tab down;
  // elsewhere 10 million (2 million a part)
  c.maxTriangles_ = opts.maxTriangles ?? (smallScreen || /** @type {any} */ (navigator).deviceMemory < 4 ? 1e6 : 1e7);
  c.built_ = buildFitting(spec, (opts.quality ?? (smallScreen ? 0.6 : 1)) * (webgl ? 1 : 0.5), c.maxTriangles_);
  const built = c.built_;
  c.part_ = (id) => built.parts.find((part) => part.id === id);
  makeState(c);
  makePose(c);
  makeLiquids(c);
  makeCamera(c);
  makeDom(c);
  makeDescribe(c);
  makeBackend();
  const startWatching = makeLoop(c);
  makeLook(c);
  makeLabels(c);
  makeDimensions(c);
  makePick(c);
  makeIdle(c);
  const makeHandleInputs = makeInput(c);
  makeAdditions(c);
  makeApi(c);
  const api = (el.lk3d = c.api_);
  // ---- the built-in controls (controls.js), unless the page makes its own
  if (opts.controls !== false) {
    Object.assign(
      c.controls_,
      controls({
        el,
        fig: api,
        state,
        words,
        buttonClass,
        tweenExplode: c.tweenExplode_,
        explodable: built.parts.some((part) => part.explode.some((offset) => offset !== 0)),
        motions: c.motions_.filter((motion) => motion.name),
        cuttable: spec.section !== false && c.renderer_ && c.renderer_.kind !== '2d',
        cutRange: c.cutRange_,
        moveCut: spec.section && spec.section.fixed ? null : c.moveCut_,
        seeThrough: built.parts.some((part) => part.xray),
        locked: c.locked_,
        asReader: c.asReader_,
        say: c.say_,
      }),
    );
  }
  makeHandleInputs();
  if (story) story.join(c.lent_); // (the sequences' rules, story.js)
  // ---- guided steps (the scene's steps): their panel under the stage, and the first one (opts.step) set at once
  makeSteps(c, buttonClass);
  c.goToStep_(opts.step ?? 0, { ms: 0 });
  if (c.controls_.lock) c.controls_.lock(); // (what the page locked at mount: opts.lock)
  c.syncSteps_();
  c.saidChange_(false); // (what is seen at the start: a change says only what is new)
  startWatching();
  c.showInfo_();
  stats.setupMs = performance.now() - mountedAt;
  return api;
}

LK3D.mount = mount;
LK3D.encodeState = encodeState; // (a figure's state as text for a link, and back: statecodec.js)
LK3D.decodeState = decodeState;
// the reader given (by the models add-on): figures refused for want of it are drawn again
LK3D.useModels = (/** @type {any} */ reader) => {
  useModels(reader);
  if (reader) retry('models');
};
// an add-on joins: the host's names it needs are checked against this core's (a newer add-on on an older core is
// refused, naming what it lacks), then it is LK3D[name], and the figures refused for want of it are drawn
LK3D.use = (/** @type {string} */ name, /** @type {any} */ api, /** @type {string[]} */ needs = []) => {
  const missing = needs.filter((need) => !LK3D.hostNames.includes(need));
  if (missing.length) throw new Error(`lk3d-${name} needs the host's ${missing.join(', ')}: load lk3d 0.8.0 or later`);
  LK3D[name] = api;
  retry(name);
};
if (typeof window !== 'undefined') window.LK3D = LK3D;
defineElement(mount, decodeState); // <lk3d-figure>, for pages that write no script
// (this script run as the page's crease-shading worker, ao.js: it answers its jobs and draws nothing)
if (typeof self !== 'undefined' && /** @type {any} */ (self).lk3dAO) serveAO();
export default LK3D;
export const { build, reduce, version, locales, defaults, themes, format } = LK3D; // (the same objects: setting defaults here sets them for LK3D; reduce is read once, at load)
export { mount, M, refreshFrom, clock, safeHTML };
