// @ts-check
// The reader's hands on a figure: the pointer (orbit, pan, pinch, hover, pick, grabbing a handle and dragging it),
// the wheel (only once the figure is taken hold of), the keys (turn, zoom, go through the parts), and each handle as
// a range input (its value set by the reader or the page: setHandle_). Owns setHandle_ and syncHandleInputs_; reads
// host_, canvas_, state_, opts_, words_, stage_, hint_, namedParts_, handles_, animations_ and height_, and calls
// pickAt_, rayAt_, project_, baseMatrix_, zoom_, cancelView_, showInfo_, part_, markDirty_ and kick_.
import { M, sub, add, mulv, len } from '../math.js';
import * as HD from '../handles.js';
import { plainText } from './dom.js';
import LK3D from '../namespace.js';

/** @param {number} v */
const mod360 = (v) => ((v % 360) + 360) % 360;
/** @param {number} v the camera's pitch, held short of straight up or down */
const tilt = (v) => Math.max(-1.45, Math.min(1.45, v));

// ---- pointer: orbit, pan, pinch, wheel (only with Ctrl, or once the figure has been clicked), hover and pick
/** @param {import('./context').Ctx} c @returns {() => void} what makes the range inputs, after the built-in controls */
export function makeInput(c) {
  // what a screen reader says for a handle: the page's words (opts.handleText(id, value), e.g. "d = 45 cm"), or the value
  const valueText = (grip) =>
    (c.opts_.handleText && c.opts_.handleText(grip.part.id, grip.value)) ||
    `${+(grip.round ? mod360(grip.value) : grip.value).toFixed(grip.digits)}${grip.handle.unit || (grip.handle.turn ? '°' : '')}`.replace(
      '.',
      c.words_.decimal,
    );
  c.setHandle_ = (grip, v, byReader) => {
    if (!Number.isFinite(v) || v === grip.value) return;
    grip.value = v;
    if (grip.input) {
      grip.input.value = String(grip.round ? mod360(v) : v);
      grip.input.setAttribute('aria-valuetext', valueText(grip));
    }
    c.kick_();
    if (byReader && c.opts_.onHandle) c.opts_.onHandle(grip.part.id, v);
  };
  const pointers = new Map(); // (each pointer down on the canvas → where it was last)
  let drag = null, // ({ pan }: a drag that turns the view, or pans it)
    active = false,
    lastHover = 0,
    moved = 0,
    pinch = 0, // (the fingers' distance apart, last move)
    velocity = [0, 0, 0], // (the last drag's px a frame, x and y, and when)
    wasOnHandle; // (whether the pointer was last over a handle: the cursor shows it)
  // active: the reader has taken hold of the figure (clicked or touched it). Until then the wheel and a finger moved up
  // or down scroll the page (the stage's touch-action, pan-y); then the figure takes every gesture, until a touch elsewhere
  const setActive = (v) => {
    active = v;
    c.host_.classList.toggle('lk3d-active', v);
  };
  const local = (e) => {
    const r = c.canvas_.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  let momentum = null, // (the view still turning after a flick)
    // the handle taken hold of: { grip, id: the pointer's, start: its value then, acc: the angle turned since, last:
    // the angle last seen, s0: where along a slide it was taken, moved: the pixels moved since }
    grab = null;
  // the handle under a point: the part hit, or (for small handles, on touch) one whose middle is within reach
  function handleAt(x, y) {
    if (!c.handles_.length) return null;
    const id = c.pickAt_(x, y, 0.6),
      hit = id && c.part_(id); // a handle is grabbed through glass
    if (hit && hit.handleOf) return hit.handleOf;
    // a small handle (a planet, a focal point) is also caught close by, whatever is in front of it: fingers are wide
    let best = null,
      bestDist = 1e9;
    for (const grip of c.handles_) {
      const p = grip.part;
      if (p.hidden || p.drawAlpha < 0.05) continue;
      const mid = M.pt(p.m, p.center),
        s = c.project_(mid),
        edge = c.project_(add(mid, [len(sub(p.hi, p.lo)) / 2, 0, 0]));
      if (!s) continue;
      const r = edge ? Math.hypot(edge[0] - s[0], edge[1] - s[1]) : 0, // (its size on the stage)
        d = Math.hypot(x - s[0], y - s[1]);
      if (r < 40 && d < r + 16 && d < bestDist) {
        bestDist = d;
        best = grip;
      }
    }
    return best;
  }
  function dragHandle(x, y) {
    const grip = grab.grip,
      h = grip.handle,
      { A, D } = c.rayAt_(x, y),
      // (a handle's frame in the scene now: it moves with taking apart and with offsets, not with its own value)
      base = c.baseMatrix_(grip.part);
    let v = grip.value;
    if (h.turn) {
      const ang = HD.turnAngle(A, D, { turn: { axis: h.turn.axis, center: M.pt(base, h.turn.center || [0, 0, 0]) } });
      if (grab.last == null) grab.last = ang;
      grab.acc += HD.unwrap(ang - grab.last);
      grab.last = ang;
      v = HD.hold(h, grab.start + grab.acc);
    } else if (h.slide) {
      const s = HD.slideAt(A, D, h, M.pt(base, grip.part.center));
      if (s == null) return;
      if (grab.s0 == null) grab.s0 = s;
      v = HD.hold(h, grab.start + (s - grab.s0));
    } else if (h.along) {
      const screen = grip.path.P.map((q) => c.project_(M.pt(base, q)));
      v = HD.hold(h, HD.nearestAlong(grip.path, screen, x, y));
    }
    c.setHandle_(grip, v, true);
  }
  const capture = (id) => {
    try {
      c.canvas_.setPointerCapture(id);
    } catch {
      // (not a pointer the browser tracks: nothing to capture)
    }
  };
  c.canvas_.addEventListener('pointerdown', (e) => {
    c.cancelView_(); // the reader takes over from a gliding view
    if (momentum) {
      c.animations_.delete(momentum); // a grab stops the model
      momentum = null;
    }
    if (!pointers.size) {
      const [x, y] = local(e),
        grip = handleAt(x, y);
      if (grip) {
        // the reader takes hold of a handle: it moves, the view does not
        grab = { grip, id: e.pointerId, start: grip.value, acc: 0, last: null, s0: null, moved: 0 };
        capture(e.pointerId);
        c.canvas_.style.cursor = 'grabbing';
        c.hint_.classList.add('gone');
        setActive(true);
        dragHandle(x, y);
        e.preventDefault();
        return;
      }
    }
    capture(e.pointerId);
    pointers.set(e.pointerId, [e.clientX, e.clientY]);
    moved = 0;
    setActive(true);
    drag = { pan: e.shiftKey || e.button === 2 };
    c.hint_.classList.add('gone');
  });
  c.canvas_.addEventListener('pointermove', (e) => {
    if (grab && e.pointerId === grab.id) {
      const [x, y] = local(e);
      grab.moved += Math.abs(e.movementX || 0) + Math.abs(e.movementY || 0);
      dragHandle(x, y);
      return;
    }
    if (pointers.has(e.pointerId)) {
      const prev = pointers.get(e.pointerId);
      pointers.set(e.pointerId, [e.clientX, e.clientY]);
      const dx = e.clientX - prev[0],
        dy = e.clientY - prev[1];
      moved += Math.abs(dx) + Math.abs(dy);
      if (pointers.size === 2) {
        const [p1, p2] = [...pointers.values()],
          now = Math.hypot(p1[0] - p2[0], p1[1] - p2[1]);
        if (pinch > 0 && now > 0) {
          const r = c.canvas_.getBoundingClientRect();
          c.zoom_(now / pinch, (p1[0] + p2[0]) / 2 - r.left, (p1[1] + p2[1]) / 2 - r.top); // towards the fingers' middle
        }
        pinch = now;
      } else if (drag && drag.pan) {
        const perPx = (c.state_.dist / c.height_) * 1.2, // (scene units a pixel moves the view)
          right = [Math.cos(c.state_.yaw), 0, -Math.sin(c.state_.yaw)],
          up = [
            -Math.sin(c.state_.pitch) * Math.sin(c.state_.yaw),
            Math.cos(c.state_.pitch),
            -Math.sin(c.state_.pitch) * Math.cos(c.state_.yaw),
          ];
        c.state_.target = add(c.state_.target, add(mulv(right, -dx * perPx), mulv(up, dy * perPx)));
      } else {
        c.state_.yaw -= dx * 0.008;
        c.state_.pitch = tilt(c.state_.pitch + dy * 0.008);
        const now = performance.now(),
          dt = Math.max(4, now - (velocity[2] || now - 16.7));
        velocity = [(dx * 16.7) / dt, (dy * 16.7) / dt, now];
      }
      c.kick_();
    } else if (performance.now() - lastHover > 40) {
      // (hovering: what is under the pointer, at most every 40 ms)
      lastHover = performance.now();
      const [x, y] = local(e),
        id = c.pickAt_(x, y);
      const onHandle = id ? !!c.part_(id)?.handleOf : !!handleAt(x, y);
      if (id !== c.state_.hover || onHandle !== wasOnHandle) {
        c.state_.hover = id;
        wasOnHandle = onHandle;
        c.canvas_.style.cursor = onHandle ? 'grab' : id ? 'pointer' : 'grab';
        c.showInfo_('hover');
        c.kick_();
      }
    }
  });
  const end = (e) => {
    if (grab && e.pointerId === grab.id) {
      // let go of a handle; a tap without moving selects the part, as elsewhere
      if (grab.moved < 4 && e.type === 'pointerup') {
        c.state_.selected = grab.grip.part.id === c.state_.selected ? null : grab.grip.part.id;
        c.showInfo_('pick');
      }
      grab = null;
      c.canvas_.style.cursor = 'grab';
      c.kick_();
      return;
    }
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    pinch = 0;
    if (moved < 6 && e.type === 'pointerup') {
      const [x, y] = local(e),
        id = c.pickAt_(x, y);
      c.state_.selected = id && id !== c.state_.selected ? id : null;
      c.showInfo_('pick');
      c.kick_();
    } else if (
      !pointers.size &&
      Math.hypot(velocity[0], velocity[1]) > 2 &&
      performance.now() - velocity[2] < 80 &&
      !LK3D.reduce
    ) {
      // let go while still moving: the view glides on, slowing
      let v = velocity.slice(0, 2).map((x) => Math.max(-30, Math.min(30, x))),
        prev = 0;
      const glide = (now) => {
        const dt = prev ? Math.max(0, Math.min(50, now - prev)) : 16.7;
        prev = now;
        const k = Math.pow(0.9, dt / 16.7),
          f = dt / 16.7;
        v = [v[0] * k, v[1] * k];
        c.state_.yaw -= v[0] * 0.008 * f;
        c.state_.pitch = tilt(c.state_.pitch + v[1] * 0.008 * f);
        c.markDirty_();
        if (Math.hypot(v[0], v[1]) < 0.3) {
          momentum = null;
          return false;
        }
        return true;
      };
      momentum = glide;
      c.animations_.add(glide);
      c.kick_();
    }
    velocity = [0, 0, 0];
    drag = null;
  };
  c.canvas_.addEventListener('pointerup', end);
  c.canvas_.addEventListener('pointercancel', end);
  c.canvas_.addEventListener('pointerleave', () => {
    if (!pointers.size && c.state_.hover) {
      c.state_.hover = null;
      c.showInfo_('hover');
      c.kick_();
    }
  });
  c.canvas_.addEventListener('contextmenu', (e) => e.preventDefault());
  c.canvas_.addEventListener(
    'wheel',
    (e) => {
      if (!(e.ctrlKey || active)) return; // never hijack the page's scrolling
      e.preventDefault();
      const [x, y] = local(e);
      c.zoom_(Math.exp(-e.deltaY * 0.0015), x, y);
    },
    { passive: false },
  );
  const outside = (e) => {
    if (!c.host_.contains(e.target)) setActive(false);
  };
  document.addEventListener('pointerdown', outside);
  c.cleanups_.push(() => document.removeEventListener('pointerdown', outside));
  c.canvas_.addEventListener('keydown', (e) => {
    const turn = { ArrowLeft: [0.12, 0], ArrowRight: [-0.12, 0], ArrowUp: [0, 0.1], ArrowDown: [0, -0.1] }[e.key];
    if (turn) {
      c.cancelView_();
      c.state_.yaw += turn[0];
      c.state_.pitch = tilt(c.state_.pitch + turn[1]);
      c.kick_();
      e.preventDefault();
    }
    const zoom = { '+': 1.15, '=': 1.15, '-': 1 / 1.15 }[e.key];
    if (zoom) c.zoom_(zoom);
    const step = { PageDown: 1, PageUp: -1 }[e.key],
      shown = c.namedParts_.filter((p) => !p.hidden);
    if ((step && shown.length) || (e.key === 'Escape' && c.state_.selected)) {
      const n = shown.length,
        at = shown.findIndex((p) => p.id === c.state_.selected);
      // from none: the first (Page Down) or the last (Page Up); then on round
      c.state_.selected = step ? shown[at < 0 ? (step > 0 ? 0 : n - 1) : (at + step + n) % n].id : null;
      c.showInfo_('pick');
      c.kick_();
      e.preventDefault();
    }
  });
  // each handle also as a range input, visually hidden: Tab reaches it, the arrow keys move it, screen readers read it
  // (made once the built-in controls are in place: after them on the page)
  return () => {
    const stage = c.stage_;
    for (const grip of c.handles_) {
      const h = grip.handle,
        range = document.createElement('input');
      range.type = 'range';
      range.className = 'lk3d-sr';
      const step = h.snap || (h.along ? 0.01 : h.turn ? 1 : ((h.max ?? 1) - (h.min ?? 0)) / 100);
      range.min = String(h.min ?? 0);
      range.max = String(h.max ?? (h.turn ? 360 : 1));
      range.step = String(step);
      grip.digits = Math.max(0, Math.ceil(-Math.log10(step) - 1e-9)); // the value read out to the step's last digit
      range.value = String(grip.value);
      range.setAttribute('aria-label', h.label || plainText(grip.part.name) || grip.part.id);
      range.setAttribute('aria-valuetext', valueText(grip));
      range.addEventListener('input', () =>
        c.setHandle_(
          grip,
          HD.hold(h, grip.round ? grip.value + HD.unwrap(+range.value - mod360(grip.value)) : +range.value),
          true,
        ),
      );
      // (a range input stops at its ends: a handle that goes round and round is turned by its own keys instead)
      if (grip.round)
        range.addEventListener('keydown', (e) => {
          const steps = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1, PageDown: -10, PageUp: 10 }[e.key];
          if (!steps) return;
          e.preventDefault();
          c.setHandle_(grip, HD.hold(h, grip.value + steps * step), true);
        });
      // (focused: the part lights up)
      range.addEventListener('focus', () => {
        if (grip.part.hidden) return;
        c.state_.selected = grip.part.id;
        stage.classList.add('lk3d-kbd');
        c.showInfo_('pick');
        c.kick_();
      });
      range.addEventListener('blur', () => {
        stage.classList.remove('lk3d-kbd');
      });
      grip.input = range;
      c.host_.append(range);
    }
    // a hidden part's handle is out of reach of the keyboard too: out of the Tab order and of what screen readers read
    (c.syncHandleInputs_ = () => {
      for (const { part: p, input } of c.handles_) {
        if (p.hidden) input.blur();
        input.disabled = input.hidden = !!p.hidden;
      }
    })();
  };
}
