// @ts-check
// The figure's API, what mount returns (index.d.ts: Figure): reading and setting its state, what a page adds,
// handles, motions, liquids and gases, exporting, and destroying it. Owns api_; reads the state and calls the
// functions of every other part of the figure.
import { D2R, M, mulv } from '../math.js';
import { flatten } from '../geometry.js';
import * as HD from '../handles.js';
import * as FX from '../fluids.js';
import { holding } from './backend.js';
import LK3D from '../namespace.js';

/** @param {import('./context').Ctx} c */
export function makeApi(c) {
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
    view: c.view_,
    // zoom by a factor (2: twice as close), towards a point of the stage (x, y in CSS pixels) if given
    zoom: c.zoom_,
    get zoomLevel() {
      return c.baseDist_ / c.state_.dist;
    },
    explode: c.tweenExplode_,
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
    _state: c.state_, // the engine's own state: not an API, it may change
    set(o) {
      if ('explode' in o) c.explodeNow_(o.explode); // (the page's own value wins over a running tween)
      for (const k of ['spin', 'cut', 'labels', 'xray', 'style', 'theme', 'projection']) if (k in o) c.state_[k] = o[k];
      if ('transparent' in o) c.state_.transparent = !!o.transparent;
      if (o.section) c.state_.section = { ...c.state_.section, ...o.section };
      if (o.camera) c.view_(o.camera, { ms: 0 }); // (placed at once: the page's camera wins over a gliding view)
      if ('timeScale' in o) c.state_.timeScale = Math.max(0, +o.timeScale || 0);
      if (c.controls_.style) c.controls_.style(); // (the buttons: the look's name, which toggles are on)
      if (o.move)
        for (const [id, v] of Object.entries(o.move)) {
          const p = c.part_(id);
          if (p) p.offset = v;
        }
      if (o.glow)
        for (const [id, v] of Object.entries(o.glow)) {
          const p = c.part_(id);
          if (p) p.emit = mulv(p.glowColor, v);
        }
      if (o.joints) {
        c.state_.joints = { ...o.joints }; // (each call says all the page sets: a joint not named follows its drive)
        c.poseVersion_++;
      }
      if (o.motion)
        for (const [id, v] of Object.entries(o.motion)) {
          const mo = c.motions_.find((x) => x.id === id);
          if (mo) c.setMotion_(mo, v);
        }
      if (o.hide) {
        for (const p of c.built_.parts) p.hidden = p.hidden0 || o.hide.includes(p.id) || o.hide.includes(p.group);
        c.syncHandleInputs_();
        if (c.built_.parts.find((p) => p.id === c.state_.selected)?.hidden) {
          c.state_.selected = null; // (a part out of sight is not the one chosen)
          c.showInfo_();
        }
      }
      c.kick_();
    },
    particles: c.addParticles_,
    flow: c.addFlow_,
    stream: c.addStream_,
    lines: c.addLines_,
    tick(fn) {
      c.animations_.add(fn);
      c.kick_();
      return () => c.animations_.delete(fn);
    }, // fn(now) returns true while it keeps moving
    pick: c.pickAt_,
    // the figure as glTF 2.0 binary (.glb bytes), posed as it is now (taken apart, moved, its motions and joints);
    // { animate: true } adds each motion as an animation along its range (samples: 120 poses). The exporter is apart
    // from the engine (export.js), set as LK3D.toGLB by importing lk3d/export or loading dist/lk3d-export.min.js
    exportGLB(o = {}) {
      if (!LK3D.toGLB)
        throw new Error('lk3d: exportGLB needs the exporter: load dist/lk3d-export.min.js, or import lk3d/export');
      const now = { ...c.state_.motion },
        animations = [];
      if (o.animate)
        for (const mo of c.motions_) {
          const [a, b] = mo.range,
            n = o.samples ?? 120,
            secs = (b - a) / (mo.speed ?? b - a),
            poses = [];
          for (let k = 0; k <= n; k++) {
            c.state_.motion = { ...now, [mo.id]: a + ((b - a) * k) / n };
            c.poseVersion_++;
            poses.push(new Map(c.built_.parts.map((p) => [p, c.modelMatrix_(p)])));
          }
          animations.push({
            name: mo.name || mo.id,
            times: poses.map((_, k) => (secs * k) / n),
            matrix: (p, k) => poses[k].get(p),
          });
        }
      c.state_.motion = now;
      c.poseVersion_++;
      return LK3D.toGLB(c.built_, {
        matrix: c.modelMatrix_,
        animations,
        unit: c.spec_.unit,
        title: c.spec_.title,
        author: c.spec_.author,
        license: c.spec_.license,
        flatten,
      });
    },
    redraw: c.kick_,
    // draw the state as it is now, before returning (a tool that screenshots right after setting it); false while the
    // shaders are still compiling (it draws again on the next frame by itself)
    drawNow: c.drawNow_,
    // a point of the scene (or of a part, as that part is placed now) on the stage, in CSS pixels; null behind the eye
    project(p, id) {
      const q = id && c.part_(id);
      c.camera_();
      const s = M.project(c.viewProj_, q ? M.pt(c.modelMatrix_(q), p) : p, c.width_, c.height_);
      return s && [s[0], s[1]];
    },
    // a handle's value, read or set by the page (setting it does not call onHandle)
    handle(id) {
      const grip = c.handles_.find((x) => x.part.id === id);
      return (
        grip && {
          get value() {
            return grip.value;
          },
          set(v) {
            c.setHandle_(grip, HD.hold(grip.handle, v), false);
          },
        }
      );
    },
    // the scene's liquids, vessels and gases (fluids.js), read and set by the page; and a buoyant plume of air or gas
    liquid(id) {
      const liquid = c.fluids_ && c.fluids_.liquids.find((x) => x.part === id);
      return (
        liquid && {
          get volume() {
            return liquid.volume;
          },
          // (the height of its surface in the scene)
          get level() {
            const vessel = c.fluids_.vessels.get(liquid.in),
              layer = c.layersIn_(vessel).find((x) => x.l === liquid);
            return layer ? vessel.at[1] + layer.h1 : null;
          },
          set(o) {
            if ('volume' in o) liquid.volume = Math.max(0, +o.volume || 0);
            c.kick_();
          },
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
          set(o) {
            if ('open' in o) vessel.open = Math.max(0, Math.min(1, +o.open || 0));
            c.kick_();
          },
        }
      );
    },
    gas(id) {
      const gas = c.fluids_ && c.fluids_.gases.find((g) => g.part === id);
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
          set(o) {
            for (const k of ['n', 'T', 'p', 'mass']) if (k in o) gas[k] = +o[k];
            c.kick_();
          },
        }
      );
    },
    plume(o) {
      return c.addStream_({ ramp: 'heat', ...o, ...FX.plume(o.at, o.height, o.radius ?? 0.05) });
    },
    // a motion of the scene, set or played by the page: { value, set(v), play(), stop(), playing }
    motion(id) {
      const mo = c.motions_.find((x) => x.id === id);
      return (
        mo && {
          get value() {
            return c.state_.motion[id];
          },
          get playing() {
            return c.playing_.has(id);
          },
          set: (v) => c.setMotion_(mo, v),
          play: () => c.playMotion_(mo),
          stop: () => c.stopMotion_(mo),
        }
      );
    },
    // frame some parts (ids or groups): the camera looks at their middle, from far enough to see them all
    focus(ids, o = {}) {
      const ps = c.built_.parts.filter((p) => ids.includes(p.id) || ids.includes(p.group));
      if (!ps.length) return;
      const b = c.boxOf_(ps);
      c.view_({ ...o, target: b.center, dist: b.radius * 2.6 }, o);
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
        triangles: Math.round(c.built_.parts.reduce((a, p) => a + p.tris, 0)),
        scale: c.resolution_,
        dpr: c.dpr_,
        gpu,
      };
    },
    destroy() {
      c.destroyed_ = true;
      for (const f of c.cleanups_) f(); // (the frame loop, the watchers, the listeners on the document)
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
