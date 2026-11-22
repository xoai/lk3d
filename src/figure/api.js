// @ts-check
// The figure's API, what mount returns (index.d.ts: Figure): reading and setting its state, what a page adds,
// handles, motions, liquids and gases, exporting, and destroying it. Owns api_; reads the state and calls the
// functions of every other part of the figure.
import { D2R, M, mulv, len } from '../math.js';
import { flatten } from '../geometry.js';
import * as HD from '../handles.js';
import * as FX from '../fluids.js';
import { holding } from './backend.js';
import LK3D from '../namespace.js';

/** @param {import('./context').Ctx} c */
export function makeApi(c) {
  // (a change the page makes: onChange is told it was the page's)
  const byPage =
    (fn) =>
    (...args) => {
      c.mark_('page');
      return fn(...args);
    };
  // what set() changes besides a state's step and the keys state.js sets
  const set = (changes) => {
    if ('explode' in changes) c.explodeNow_(changes.explode); // (the page's own value wins over a running tween)
    if ('cut' in changes) c.cutNow_(changes.cut); // (the page's own value wins over a step's sweep)
    for (const key of ['spin', 'labels', 'xray', 'style', 'theme', 'projection', 'dimensions'])
      if (key in changes) c.state_[key] = changes[key];
    if ('transparent' in changes) c.state_.transparent = !!changes.transparent;
    if (changes.section) c.state_.section = { ...c.state_.section, ...changes.section };
    if (changes.camera) c.view_(changes.camera, { ms: 0 }); // (placed at once: the page's camera wins over a gliding view)
    if ('timeScale' in changes) c.state_.timeScale = Math.max(0, +changes.timeScale || 0);
    if (c.controls_.style) c.controls_.style(); // (the buttons: the look's name, which toggles are on)
    // the page's move of a part: a shift, or { by, turn } (a turn about a point of the part at rest, then the shift in
    // the scene's axes); each replaces the last
    if (changes.move)
      for (const [id, move] of Object.entries(changes.move)) {
        const part = c.part_(id);
        if (!part) continue;
        const turn = Array.isArray(move) ? null : move.turn;
        if (turn && !(Number.isFinite(+turn.angle) && len(turn.axis || [0, 0, 0]) > 0))
          throw new Error(`lk3d: move.${id}.turn needs a finite angle and an axis that is not zero`);
        part.offset = Array.isArray(move) ? move : move.by || [0, 0, 0];
        part.turn = turn && { axis: turn.axis, angle: +turn.angle, center: turn.center || [0, 0, 0] };
      }
    if (changes.glow)
      for (const [id, strength] of Object.entries(changes.glow)) {
        const part = c.part_(id);
        if (part) part.emission = mulv(part.glowColor, strength);
      }
    if (changes.joints) {
      c.state_.joints = { ...changes.joints }; // (each call says all the page sets: a joint not named follows its drive)
      c.poseVersion_++;
    }
    if (changes.motion)
      for (const [id, value] of Object.entries(changes.motion)) {
        const motion = c.motions_.find((each) => each.id === id);
        if (motion) c.setMotion_(motion, value);
      }
    if (changes.hide) {
      for (const part of c.built_.parts)
        part.hidden = part.hiddenByScene || changes.hide.includes(part.id) || changes.hide.includes(part.group);
      c.syncHandleInputs_();
      if (c.built_.parts.find((part) => part.id === c.state_.selected)?.hidden) {
        c.state_.selected = null; // (a part out of sight is not the one chosen)
        c.showInfo_();
      }
    }
  };
  const api = (c.api_ = {
    get renderer() {
      return c.renderer_.kind;
    },
    get hifi() {
      return c.renderer_.hifi;
    },
    parts: c.built_.parts,
    // resolves once the figure is complete: the first picture, the crease shading, every texture and model
    ready: c.ready_,
    view: byPage(c.view_),
    // zoom by a factor (2: twice as close), towards a point of the stage (x, y in CSS pixels) if given
    zoom: byPage(c.zoom_),
    get zoomLevel() {
      return c.baseDist_ / c.state_.dist;
    },
    explode: byPage(c.tweenExplode_),
    // where the camera is (degrees and scene units), the part chosen, the labels and look in use
    camera() {
      return {
        yaw: c.state_.yaw / D2R,
        pitch: c.state_.pitch / D2R,
        dist: c.state_.dist,
        target: c.state_.target.slice(),
      };
    },
    get selected() {
      return c.state_.selected;
    },
    select(id) {
      c.mark_('page');
      c.state_.selected = id ?? null;
      c.showInfo_();
      c.kick_();
    },
    get labels() {
      return c.state_.labels;
    },
    get style() {
      return c.state_.style;
    },
    get theme() {
      return c.state_.theme;
    },
    get timeScale() {
      return c.state_.timeScale;
    },
    // the cut's plane now: where the scene, a step, the page or the reader put it (second: a quarter cut's, or null)
    get section() {
      return c.stateOf_().section;
    },
    // what the reader can change, as one plain object (or where it is going, while it glides): set() takes it back
    state: () => c.stateOf_(),
    // the figure in words, as a screen reader hears it (D): describe.js
    describe: () =>
      c
        .sentences_()
        .map(([, text]) => text)
        .join(' '),
    // what the reader may not change from now on (the page's own calls still may)
    lock(list) {
      c.lock_ = new Set(list || []);
      if (c.controls_.lock) c.controls_.lock();
      c.syncHandleInputs_();
      c.syncSteps_();
    },
    _state: c.state_, // the engine's own state: not an API, it may change
    set(changes) {
      c.mark_('page');
      c.setState_(changes, () => set(changes)); // (a state's step first, then the rest over it: state.js)
      c.kick_();
    },
    particles: c.addParticles_,
    flow: c.addFlow_,
    stream: c.addStream_,
    lines: c.addLines_,
    tick(animation) {
      c.animations_.add(animation);
      c.kick_();
      return () => c.animations_.delete(animation);
    }, // animation(now) returns true while it keeps moving
    pick: c.pickAt_,
    // the figure as glTF 2.0 binary (.glb bytes), posed as it is now (taken apart, moved, its motions and joints);
    // { animate: true } adds each motion as an animation along its range (samples: 120 poses). The exporter is apart
    // from the engine (export.js), set as LK3D.toGLB by importing lk3d/export or loading dist/lk3d-export.min.js
    exportGLB(options = {}) {
      if (!LK3D.toGLB)
        throw new Error('lk3d: exportGLB needs the exporter: load dist/lk3d-export.min.js, or import lk3d/export');
      const motionNow = { ...c.state_.motion },
        animations = [];
      if (options.animate)
        for (const motion of c.motions_) {
          const [from, to] = motion.range,
            samples = options.samples ?? 120,
            seconds = (to - from) / (motion.speed ?? to - from),
            poses = [];
          for (let sample = 0; sample <= samples; sample++) {
            c.state_.motion = { ...motionNow, [motion.id]: from + ((to - from) * sample) / samples };
            c.poseVersion_++;
            poses.push(new Map(c.built_.parts.map((part) => [part, c.modelMatrix_(part)])));
          }
          animations.push({
            name: motion.name || motion.id,
            times: poses.map((_, sample) => (seconds * sample) / samples),
            matrix: (part, sample) => poses[sample].get(part),
          });
        }
      c.state_.motion = motionNow;
      c.poseVersion_++;
      return LK3D.toGLB(c.built_, {
        matrix: c.modelMatrix_,
        animations,
        spec: c.spec_,
        alt: c.spec_.alt,
        // (each guided step's pose, for its animation: the figure posed so a moment, then put back)
        pose(values, explode) {
          const motion = c.state_.motion,
            apart = c.state_.explode;
          c.state_.motion = { ...motion, ...values };
          c.state_.explode = explode;
          c.poseVersion_++;
          const at = new Map(c.built_.parts.map((part) => [part, c.modelMatrix_(part)]));
          c.state_.motion = motion;
          c.state_.explode = apart;
          c.poseVersion_++;
          return (part) => at.get(part);
        },
        unit: c.spec_.unit,
        title: c.spec_.title,
        author: c.spec_.author,
        license: c.spec_.license,
        flatten,
      });
    },
    redraw: c.kick_,
    // a PNG of the figure as drawn now (no HTML labels), as a data URL: drawn first and read at once (WebGL keeps no
    // picture after the frame), waiting while shaders compile; a figure that never had a WebGL context gets one
    picture() {
      const until = performance.now() + 10000; // (a context that never comes back: refused, not waited on forever)
      return new Promise((resolve, reject) => {
        const attempt = () => {
          if (c.destroyed_ || !c.host_.getClientRects().length)
            return reject(new Error('lk3d: picture() of a figure not on the page (hidden, or destroyed)'));
          if (performance.now() > until) return reject(new Error('lk3d: picture(): the figure could not be drawn'));
          if (!c.renderer_.kind) c.claimGL_();
          if (c.renderer_.kind && c.drawNow_()) resolve(c.drawCanvas_.toDataURL('image/png'));
          else setTimeout(attempt, 30);
        };
        attempt();
      });
    },
    // draw the state as it is now, before returning (a tool that screenshots right after setting it); false while the
    // shaders are still compiling (it draws again on the next frame by itself)
    drawNow: c.drawNow_,
    // a point of the scene (or of a part, as that part is placed now) on the stage, in CSS pixels; null behind the eye
    project(point, id) {
      const part = id && c.part_(id);
      c.camera_();
      const onStage = M.project(c.viewProj_, part ? M.pt(c.modelMatrix_(part), point) : point, c.width_, c.height_);
      return onStage && [onStage[0], onStage[1]];
    },
    // a handle's value, read or set by the page (setting it does not call onHandle)
    handle(id) {
      const grip = c.handles_.find((each) => each.part.id === id);
      return (
        grip && {
          get value() {
            return grip.value;
          },
          set: byPage((value) => c.setHandle_(grip, HD.hold(grip.handle, value), false)),
        }
      );
    },
    // the scene's liquids, vessels and gases (fluids.js), read and set by the page; and a buoyant plume of air or gas
    liquid(id) {
      const liquid = c.fluids_ && c.fluids_.liquids.find((each) => each.part === id);
      return (
        liquid && {
          get volume() {
            return liquid.volume;
          },
          // (the height of its surface in the scene)
          get level() {
            const vessel = c.fluids_.vessels.get(liquid.in),
              layer = c.layersIn_(vessel).find((each) => each.liquid === liquid);
            return layer ? vessel.at[1] + layer.top : null;
          },
          set: byPage((changes) => {
            if ('volume' in changes) liquid.volume = Math.max(0, +changes.volume || 0);
            c.kick_();
          }),
        }
      );
    },
    vessel(id) {
      const vessel = c.fluids_ && c.fluids_.vessels.get(id);
      return (
        vessel && {
          get open() {
            return vessel.outlet ? c.openOf_(vessel) : 0;
          },
          // (what pours out now, in scene units cubed a second)
          get flow() {
            return vessel.flow || 0;
          },
          set: byPage((changes) => {
            if ('open' in changes) vessel.open = Math.max(0, Math.min(1, +changes.open || 0));
            c.kick_();
          }),
        }
      );
    },
    gas(id) {
      const gas = c.fluids_ && c.fluids_.gases.find((each) => each.part === id);
      return (
        gas && {
          get height() {
            return c.gasHeights_.get(id);
          },
          get n() {
            return gas.n;
          },
          get T() {
            return gas.T;
          },
          set: byPage((changes) => {
            for (const key of ['n', 'T', 'p', 'mass']) if (key in changes) gas[key] = +changes[key];
            c.kick_();
          }),
        }
      );
    },
    plume(options) {
      return c.addStream_({
        ramp: 'heat',
        ...options,
        ...FX.plume(options.at, options.height, options.radius ?? 0.05),
      });
    },
    // a motion of the scene, set or played by the page: { value, set(v), play(), stop(), playing }
    motion(id) {
      const motion = c.motions_.find((each) => each.id === id);
      return (
        motion && {
          get value() {
            return c.state_.motion[id];
          },
          get playing() {
            return c.playing_.has(id);
          },
          set: byPage((value) => c.setMotion_(motion, value)),
          play: byPage(() => c.playMotion_(motion)),
          stop: byPage(() => c.stopMotion_(motion)),
        }
      );
    },
    // the scene's guided steps: go to one by its place (from 0) or id ({ ms: 0 }: at once), and which is shown (-1:
    // none). The figure starts at the first (or mount's opts.step); moving through them does not call onStep
    steps: c.spec_.steps || [],
    step: byPage((which, options) => c.goToStep_(which, options)),
    get currentStep() {
      return c.stepAt_;
    },
    // frame some parts (ids or groups): the camera looks at their middle, from far enough to see them all
    focus(ids, options = {}) {
      c.mark_('page');
      const parts = c.built_.parts.filter((part) => ids.includes(part.id) || ids.includes(part.group));
      if (!parts.length) return;
      c.view_({ ...options, ...c.frame_(parts) }, options);
    },
    get refreshMs() {
      return c.refreshMs_;
    }, // this screen's frame interval as measured (cheap: for a page's own budget)
    // what it costs here: setup, the trees and the crease shading (ms from mounting), the resolution it settled on
    stats() {
      const gpu = c.gpuName_(),
        renderer = c.renderer_;
      return {
        ...c.stats_,
        textures: renderer.pending || 0,
        backend: renderer.kind,
        hifi: renderer.hifi,
        shadows: renderer.shadows,
        parallelCompile: !!renderer.parallel,
        triangles: Math.round(c.built_.parts.reduce((sum, part) => sum + part.triangleCount, 0)),
        scale: c.resolution_,
        dpr: c.dpr_,
        gpu,
      };
    },
    destroy() {
      c.destroyed_ = true;
      for (const cleanup of c.cleanups_) cleanup(); // (the frame loop, the watchers, the listeners on the document)
      c.animations_.clear();
      holding.delete(c.glSlot_);
      c.renderer_.dispose();
      c.host_.innerHTML = '';
      c.host_.classList.remove('lk3d');
      delete c.host_.dataset.renderer;
      if (c.host_.lk3d === api) delete c.host_.lk3d;
      if (c.opts_.info) c.opts_.info.innerHTML = '';
      if (c.resolveReady_) c.resolveReady_(); // (a page awaiting `ready` goes on)
      c.resolveReady_ = null;
    },
  });
}
