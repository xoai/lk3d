// @ts-check
// The frame loop: a frame drawn only when something changed (kick_) or moves, the canvas's size and resolution
// (adaptive while frames come late), the screen's refresh, things moved on along paths by the clock (travel_), and
// watching size, visibility and the screen's density. Owns width_ and height_ (the stage's size), kick_, markDirty_,
// sizeCanvas_, drawNow_ and travel_ (and dpr_, resolution_ and refreshMs_ for stats); reads nearly everything else, to
// draw it, and empties labelWidths_ when the layout changes.
import { sub, add, norm } from '../math.js';
import { ramp } from '../flow.js';
import { clock, awake, refreshFrom } from '../clock.js';
import * as changed from '../changed.js';
import LK3D from '../namespace.js';

// ---- drawing, only when something changed. Resolution drops while frames come late and comes back once they are on
// time again. "Late" is measured against this screen's own refresh, measured at start: browsers may run animation at
// 30 Hz (Chrome on iOS does, measured), and there a 33 ms frame is on time, not slow.
/** @param {import('./context').Ctx} c @returns {() => void} what watches the figure's size and visibility, started last */
export function makeLoop(c) {
  // the order parts are drawn in: parts that share a geometry one after another (the GPU then binds it once for them)
  const geoIndex = new Map(),
    drawOrder = c.built_.parts
      .map((p, k) => [
        p,
        geoIndex.get(p.batches[0]?.geo) ?? geoIndex.set(p.batches[0]?.geo, geoIndex.size).get(p.batches[0]?.geo),
        k,
      ])
      .sort((a, b) => a[1] - b[1] || a[2] - b[2])
      .map(([p]) => p);
  c.width_ = 1;
  c.height_ = 1;
  let dpr = (c.dpr_ = 1),
    resolution = (c.resolution_ = 1);
  // drawn while on screen (the IntersectionObserver says) and while the page is shown (the tab is in front): two
  // separate facts, so coming back to the tab does not wake a figure that is scrolled away
  let dirty = true,
    onScreen = true,
    pageShown = !document.hidden,
    visible = pageShown;
  let raf = 0, // (the frame asked for, 0 if none)
    lastFrame = 0, // (when the last moving frame was drawn; 0 after a still one)
    late = 0, // (frames that came late lately, and on time in a row: they lower and raise the resolution)
    onTime = 0,
    fullResTimer = 0,
    refresh = (c.refreshMs_ = 16.7);
  function measureRefresh() {
    // twenty frame intervals; see refreshFrom
    const stamps = [];
    const onFrame = (t) => {
      stamps.push(t);
      if (stamps.length < 21) requestAnimationFrame(onFrame);
      else {
        c.refreshMs_ = refresh = refreshFrom(stamps.slice(1).map((x, i) => x - stamps[i]));
        c.stats_.refreshMs = +refresh.toFixed(1);
      }
    };
    requestAnimationFrame(onFrame);
  }
  measureRefresh();
  c.kick_ = () => {
    dirty = true;
    if (!raf && visible && !c.destroyed_) raf = requestAnimationFrame(frame);
  };
  function resize() {
    const narrow = c.host_.clientWidth < 560,
      ar = narrow ? c.spec_.narrow || '1 / 0.9' : `${c.spec_.w || 16} / ${c.spec_.h || 10}`;
    if (c.stage_.style.aspectRatio !== ar) c.stage_.style.aspectRatio = ar;
    c.dpr_ = dpr = Math.min(c.opts_.maxDpr || 3, window.devicePixelRatio || 1);
    const r = c.stage_.getBoundingClientRect();
    c.width_ = Math.max(1, r.width);
    c.height_ = Math.max(1, r.height);
    c.labelWidths_ = {}; // labels change size with the layout (smaller on a phone)
    if (c.sizeCanvas_() && visible && !c.destroyed_ && c.stats_.firstFrameMs != null) {
      cancelAnimationFrame(raf);
      raf = 0;
      dirty = true;
      frame(performance.now());
    } else c.kick_();
  }
  c.sizeCanvas_ = () => {
    // true if the size changed (which clears the canvas: the caller draws again at once)
    const w = Math.round(c.width_ * dpr * resolution),
      h = Math.round(c.height_ * dpr * resolution),
      out = c.drawCanvas_;
    if (c.canvas_.width === w && c.canvas_.height === h && out.width === w) return false;
    c.canvas_.width = w;
    c.canvas_.height = h;
    if (out !== c.canvas_) {
      out.width = w;
      out.height = h;
    }
    return true;
  };
  /** @type {MediaQueryList | null} */
  let dprQuery = null; // a move to a screen of another density changes devicePixelRatio but not the layout
  const watchDpr = () => {
    if (dprQuery) dprQuery.removeEventListener('change', onDpr);
    dprQuery = matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    dprQuery.addEventListener('change', onDpr);
  };
  const onDpr = () => {
    watchDpr();
    resize();
  };
  /** @type {number | null} */
  let movedAt = null; // (the clock's time when liquids, gases and paths were last moved on; null: nothing to move on from)
  // Things that run along paths (particles, flows, streams): while the clock runs, moved on by each frame's time; while
  // it is stopped, where their speed puts them at the clock's time: the value at an anchor plus speed × time since it.
  // The anchor is time 0 (or the last frame the clock ran), and moves to the last time drawn when the speed or the
  // time scale changes, or the page moves the thing itself. So one time is one picture, however the clock got there
  // (each thing's anchor: t and v, the time and the value there; r, the rate it was made for (speed × time scale); at
  // and w, the time and the value last drawn)
  const anchors = new WeakMap();
  // thing[key] moved on: true if it moved
  c.travel_ = (thing, key, speed, t, dt, wrap) => {
    const was = thing[key],
      r = speed * c.state_.timeScale;
    let anchor = anchors.get(thing);
    if (!anchor) anchors.set(thing, (anchor = { t: 0, v: was, r, at: 0, w: was }));
    let v;
    if (clock.speed) v = was + speed * dt;
    else {
      if (anchor.r !== r || anchor.w !== was) Object.assign(anchor, { t: anchor.at, v: was, r });
      v = anchor.v + (r * (t - anchor.t)) / 1000;
    }
    if (wrap) v %= wrap;
    if (clock.speed) Object.assign(anchor, { t, v, r });
    anchor.at = t;
    anchor.w = v;
    if (v === was) return false;
    thing[key] = v;
    return true;
  };
  /** @param {number} now */
  function frame(now) {
    raf = 0;
    if (c.destroyed_) return;
    let moving = false;
    const t = clock.now(); // (now, the frame's own time, still judges whether frames come late)
    for (const a of c.animations_) {
      if (a(t)) moving = true;
      else c.animations_.delete(a);
    } // a tick runs while it returns true
    // particles along paths run at the speed the page gave them (never backwards: a clock set back is not a frame).
    // A clock stepped by hand moves things on by the whole step; one that runs, by at most 50 ms a frame (not a leap
    // after a hidden tab)
    const still = !clock.speed,
      dt = movedAt == null ? 0 : Math.max(0, Math.min(still ? 1e9 : 0.05, (t - movedAt) / 1000)) * c.state_.timeScale;
    let flowing = false;
    if (c.fluids_ && c.fluidStep_(dt)) flowing = true; // (liquids pour and gases settle by their laws)
    // (all of it stands still for a reader who asked for less motion; a flow with nothing to show does not move; with
    // the clock stopped, each is placed for the clock's time, and draws again only if that moved it: see travel_)
    if (!LK3D.reduce)
      for (const X of c.particles_.concat(c.flows_, c.streams_))
        if (X.go && X.visible && (X.amount ?? X.density ?? 1) > 0 && (X.speed || still) && (X.go(t, dt) || !still))
          flowing = true;
    movedAt = flowing || still ? t : null;
    moving = moving || flowing;
    if ((dirty || moving) && !c.contextLost_) {
      // adaptive resolution: if moving frames keep coming late, draw fewer pixels until things are still again
      // (not before the first picture has been up for a second: compiling and the first slices of background work are
      // not a sign that this device draws too slowly)
      if (
        lastFrame &&
        moving &&
        c.opts_.adaptive !== false &&
        c.stats_.firstFrameMs != null &&
        now - c.mountedAt_ > c.stats_.firstFrameMs + 1000
      ) {
        const isLate = now - lastFrame > refresh * 1.5 + 1;
        late = isLate ? late + 1 : Math.max(0, late - 1);
        onTime = isLate ? 0 : onTime + 1;
        if (late > 8 && resolution > 0.55) {
          c.resolution_ = resolution = Math.max(0.55, resolution - 0.15);
          late = 0;
          onTime = 0;
          c.sizeCanvas_();
        } else if (onTime > 120 && resolution < 1) {
          c.resolution_ = resolution = Math.min(1, resolution + 0.15);
          onTime = 0;
          c.sizeCanvas_();
        } // on time for a while: try more pixels
      }
      lastFrame = moving ? now : 0;
      if (resolution < 1) {
        // (full resolution again once still)
        clearTimeout(fullResTimer);
        fullResTimer = setTimeout(() => {
          if (!c.animations_.size) {
            c.resolution_ = resolution = 1;
            c.sizeCanvas_();
            c.kick_();
          }
        }, 350);
      }
      c.camera_();
      const look = c.lookNow_();
      for (const p of c.built_.parts) {
        // a part's matrix, worked out again only when what places it changed: taking apart, its offset, its handle,
        // the spin, its motions' values or the joints' pose (a camera turning thousands of parts costs nothing here)
        changed.start(p.matrixFor || (p.matrixFor = []));
        for (const x of p.offset) changed.put(x);
        changed.put(c.state_.explode);
        changed.put(p.handleOf && p.handleOf.value);
        changed.put(p.spin && c.state_.spin);
        changed.put(p.joint && c.poseVersion_);
        for (const t of p.tracks) changed.put(c.state_.motion[t.mo.id]);
        if (changed.end()) p.m = c.modelMatrix_(p);
        p.drawAlpha = p.hidden ? 0 : c.state_.xray && p.xray ? 0.18 : p.alpha;
        // the pen look's colour: all of it for an accent part, a glowing one or the one chosen, a soft wash otherwise
        // (grey machine parts stay nearly white; coloured ones, an organelle or a layer, still read as their colour)
        p.tint = p.accent || p.id === c.state_.selected || p.emit[0] + p.emit[1] + p.emit[2] > 0.01 ? 1 : 0.4;
      }
      const flows = c.flows_.filter((F) => F.visible && F.amount > 0);
      for (const F of flows.concat(c.streams_)) {
        if (F.update) F.update(F.owner ? F.owner.m : null);
        if (!F.colors || F.dark !== look.dark) {
          F.colors = ramp(F.ramp, look.dark);
          F.dark = look.dark;
        }
      }
      for (const L of c.lines_)
        if (L.dirty) {
          L.place();
          L.dirty = false;
        }
      const shown = c.lines_.length
        ? drawOrder.concat(c.lines_.filter((L) => L.visible && L.part.batches[0].mats.length).map((L) => L.part))
        : drawOrder;
      const box = c.shownBox_(),
        frustum = c.frustum_,
        eye = c.eye_;
      let drawn;
      try {
        drawn = c.renderer_.draw({
          VP: c.viewProj_,
          eye,
          look,
          style: c.state_.style,
          parts: shown,
          flows,
          streams: c.streams_,
          fwd: norm(sub(add(c.state_.target, c.explodeShift_()), eye)),
          edges: c.showEdges_(),
          cut: !!c.state_.cut,
          plane: c.cutPlane_(),
          hatch: c.built_.radius / 80, // (a cap's hatching: lines this far apart on the cut, a few px when the model fills the view)
          hover: c.state_.hover,
          selected: c.state_.selected,
          dpr: dpr * resolution,
          // pixels per unit at unit distance from the eye (shaders divide by it); in ortho the size is the same everywhere
          pxPerUnit: (c.canvas_.height * frustum.d) / (2 * frustum.h),
          viewD: frustum.ortho ? frustum.d : 0,
          tanHalf: frustum.h / frustum.d,
          particles: c.particles_,
          ao: c.aoComplete_,
          shadows: true,
          bounds: box,
          ground:
            c.spec_.ground === false
              ? null
              : {
                  center: [box.center[0], 0, box.center[2]],
                  radius: box.radius * 1.6,
                  y: c.built_.lo[1] - 0.004,
                  contact: c.state_.explode < 0.3 ? 1 - c.state_.explode / 0.3 : 0,
                },
        });
      } catch (e) {
        if (c.renderer_.kind === '2d') throw e;
        c.fallback2d_(e);
        drawn = false;
      }
      if (drawn === false)
        moving = true; // shaders still compiling in the background: try again next frame
      else {
        if (c.keptPicture_) c.keptPicture_.remove(); // (drawn again: the picture kept while the context was given up goes)
        c.placeLabels_();
        dirty = false;
        if (c.stats_.firstFrameMs == null) {
          c.stats_.firstFrameMs = performance.now() - c.mountedAt_;
          if (c.renderer_.prewarm)
            setTimeout(() => {
              if (!c.destroyed_) c.renderer_.prewarm?.(); // (none if WebGL failed meanwhile)
            }, 200);
        }
        c.findEdges_(); // (if the look shows them: after the first picture, never before it)
        c.checkReady_();
      }
    }
    if (moving && visible && !raf) raf = requestAnimationFrame(frame); // one frame pending at most
  }
  // draw the state as it is now, before returning (a tool that screenshots right after setting it); false while the
  // shaders are still compiling (it draws again on the next frame by itself)
  c.drawNow_ = () => {
    if (c.destroyed_) return false;
    cancelAnimationFrame(raf);
    raf = 0;
    dirty = true;
    frame(performance.now());
    return !dirty;
  };
  // drawn in this frame, without asking for another (a glide or a tween, already in the frame loop)
  c.markDirty_ = () => {
    dirty = true;
  };
  c.cleanups_.push(() => {
    cancelAnimationFrame(raf);
    raf = 0;
    clearTimeout(fullResTimer);
  });

  // ---- watching size, visibility and the screen's density (started last, once everything is in place)
  return () => {
    const ro = new ResizeObserver(resize);
    ro.observe(c.stage_);
    const wake = () => {
      const was = visible;
      visible = onScreen && pageShown;
      if (visible && !was) {
        measureRefresh();
        c.kick_();
      }
    };
    const io = new IntersectionObserver(
      (entries) => {
        c.glSlot_.near = onScreen = entries[entries.length - 1].isIntersecting;
        c.glSlot_.seen = performance.now();
        if (onScreen) c.claimGL_();
        wake();
      },
      { rootMargin: '100px' },
    );
    io.observe(c.stage_);
    const onVis = () => {
      pageShown = !document.hidden;
      wake();
    };
    document.addEventListener('visibilitychange', onVis);
    // (woken by the clock stepped or set: liquids and gases move on from where it was, if they had not been moving)
    const woke = (was) => {
      if (movedAt == null && !clock.speed) movedAt = was;
      c.kick_();
    };
    awake.add(woke);
    c.cleanups_.push(() => {
      awake.delete(woke);
      io.disconnect();
      ro.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      dprQuery?.removeEventListener('change', onDpr);
    });
    watchDpr();
    resize();
  };
}
