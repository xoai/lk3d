// @ts-check
// The reader's hands on a figure: the pointer (orbit, pan, pinch, hover, pick, grabbing a handle and dragging it),
// the wheel (only once the figure is taken hold of), the keys (turn, zoom, go through the parts), and each handle as
// a range input (its value set by the reader or the page: setHandle_), and the cut moved by the reader (its face
// dragged, or the built-in slider: moveCut_). Owns setHandle_, syncHandleInputs_, cutMovable_ and moveCut_; reads
// host_, canvas_, spec_, state_, opts_, words_, stage_, hint_, namedParts_, handles_, animations_, controls_ and
// height_, and calls pickAt_, pickHit_, rayAt_, project_, cutPlane_, cutRange_, baseMatrix_, zoom_, cancelView_,
// showInfo_, part_, markDirty_ and kick_.
import { M, sub, add, mulv, len, cross, norm } from '../math.js';
import * as HD from '../handles.js';
import { plainText } from './dom.js';
import LK3D from '../namespace.js';

/** @param {number} degrees */
const mod360 = (degrees) => ((degrees % 360) + 360) % 360;
/** @param {number} pitch the camera's pitch, held short of straight up or down */
const tilt = (pitch) => Math.max(-1.45, Math.min(1.45, pitch));

// ---- pointer: orbit, pan, pinch, wheel (only with Ctrl, or once the figure has been clicked), hover and pick
/**
 * @typedef {{ grip: import('./context').Grip, id: number, start: any, turned: number, lastAngle: number | null,
 *   slideStart: number | null, planeStart?: number[] | null, moved: number }} Grab
 */
/** @param {import('./context').Ctx} c @returns {() => void} what makes the range inputs, after the built-in controls */
export function makeInput(c) {
  // what a screen reader says for a handle's input: the page's words (opts.handleText(id, value, axis), e.g. "d = 45 cm";
  // axis 0 or 1 for a plane handle's two inputs), or the number the input stands for
  const copy = (value) => (Array.isArray(value) ? [...value] : value); // (a plane handle's pair: never the handle's own)
  const of = (grip, axis) => (axis == null ? (grip.round ? mod360(grip.value) : grip.value) : grip.value[axis]);
  const valueText = (grip, axis, digits) =>
    (c.opts_.handleText && c.opts_.handleText(grip.part.id, copy(grip.value), axis ?? undefined)) ||
    `${+of(grip, axis).toFixed(digits)}${grip.handle.unit || (grip.handle.turn ? '°' : '')}`.replace(
      '.',
      c.words_.decimal,
    );
  c.setHandle_ = (grip, value, byReader) => {
    // (a plane handle's pair: finite, and compared by its numbers)
    const pair = Array.isArray(value);
    if (
      !(pair ? value.every(Number.isFinite) : Number.isFinite(value)) ||
      (pair ? value[0] === grip.value[0] && value[1] === grip.value[1] : value === grip.value)
    )
      return;
    grip.value = value;
    for (const [input, axis, digits] of grip.inputs || []) {
      input.value = String(of(grip, axis));
      input.setAttribute('aria-valuetext', valueText(grip, axis, digits));
    }
    if (byReader) c.mark_('reader');
    c.kick_();
    if (byReader && c.opts_.onHandle) c.opts_.onHandle(grip.part.id, pair ? [value[0], value[1]] : value);
  };
  const pointers = new Map(); // (each pointer down on the canvas → where it was last)
  /** @type {{ pan: boolean } | null} */
  let drag = null, // ({ pan }: a drag that turns the view, or pans it)
    active = false,
    lastHover = 0,
    moved = 0,
    pinch = 0, // (the fingers' distance apart, last move)
    velocity = [0, 0, 0], // (the last drag's px a frame, x and y, and when)
    wasOnHandle, // (whether the pointer was last over a handle: the cursor shows it)
    /** @type {number | null} */
    pressed = null; // (the pointer whose gesture the page took, with onPress: the figure leaves it alone)
  // active: the reader has taken hold of the figure (clicked or touched it). Until then the wheel and a finger moved up
  // or down scroll the page (the stage's touch-action, pan-y); then the figure takes every gesture, until a touch elsewhere
  const setActive = (on) => {
    active = on;
    c.host_.classList.toggle('lk3d-active', on);
  };
  const local = (event) => {
    const rect = c.canvas_.getBoundingClientRect();
    return [event.clientX - rect.left, event.clientY - rect.top];
  };
  /** @type {((now: number) => boolean) | null} */
  let momentum = null, // (the view still turning after a flick)
    // the handle taken hold of: { grip, id: the pointer's, start: its value then, turned: the angle turned since,
    // lastAngle, slideStart: where along a slide it was taken, moved: the pixels moved since }
    /** @type {Grab | null} */
    grab = null;
  // the handle under a point: the part hit, or (for small handles, on touch) one whose middle is within reach
  function handleAt(x, y) {
    if (!c.handles_.length) return null;
    const id = c.pickAt_(x, y, 0.6),
      hit = id && c.part_(id); // a handle is grabbed through glass
    if (hit && hit.handleOf) return hit.handleOf;
    // a small handle (a planet, a focal point) is also caught close by, whatever is in front of it: fingers are wide
    /** @type {import('./context').Grip | null} */
    let best = null,
      bestDist = 1e9;
    for (const grip of c.handles_) {
      const part = grip.part;
      if (part.hidden || part.drawAlpha < 0.05) continue;
      const middle = M.pt(part.matrix, part.center),
        onStage = c.project_(middle),
        edge = c.project_(add(middle, [len(sub(part.max, part.min)) / 2, 0, 0]));
      if (!onStage) continue;
      const size = edge ? Math.hypot(edge[0] - onStage[0], edge[1] - onStage[1]) : 0, // (its size on the stage)
        distance = Math.hypot(x - onStage[0], y - onStage[1]);
      if (size < 40 && distance < size + 16 && distance < bestDist) {
        bestDist = distance;
        best = grip;
      }
    }
    return best;
  }
  /** @param {Grab} grab @param {number} x @param {number} y */
  function dragHandle(grab, x, y) {
    const grip = grab.grip,
      handle = grip.handle,
      { origin, direction } = c.rayAt_(x, y),
      // (a handle's frame in the scene now: it moves with taking apart and with offsets, not with its own value)
      base = c.baseMatrix_(grip.part);
    let value = grip.value;
    if (handle.turn) {
      // (its axis and centre in the scene now: turned with the part, by the page's turn)
      const angle = HD.turnAngle(origin, direction, {
        turn: { axis: M.dir(base, handle.turn.axis), center: M.pt(base, handle.turn.center || [0, 0, 0]) },
      });
      if (grab.lastAngle == null) grab.lastAngle = angle;
      grab.turned += HD.unwrap(angle - grab.lastAngle);
      grab.lastAngle = angle;
      value = HD.hold(handle, grab.start + grab.turned);
    } else if (handle.plane) {
      // (the plane through its centre, spanned by its axes, both turned with the part; seen edge-on: it holds)
      const at = HD.planeAt(
        origin,
        direction,
        handle.plane.axes.map((/** @type {number[]} */ axis) => M.dir(base, axis)),
        M.pt(base, handle.plane.center || grip.part.center),
      );
      if (at) {
        if (!grab.planeStart) grab.planeStart = at;
        value = HD.hold(handle, [
          grab.start[0] + at[0] - grab.planeStart[0],
          grab.start[1] + at[1] - grab.planeStart[1],
        ]);
      }
    } else if (handle.slide) {
      const along = HD.slideAt(
        origin,
        direction,
        { slide: { axis: M.dir(base, handle.slide.axis) } },
        M.pt(base, grip.part.center),
      );
      if (along == null) return;
      if (grab.slideStart == null) grab.slideStart = along;
      value = HD.hold(handle, grab.start + (along - grab.slideStart));
    } else if (handle.along) {
      const onStage = grip.path.points.map((point) => c.project_(M.pt(base, point)));
      value = HD.hold(handle, HD.nearestAlong(grip.path, onStage, x, y));
    }
    c.setHandle_(grip, value, true);
  }
  // ---- the cut moved by the reader: its face taken hold of and dragged along the plane's normal (unless the scene
  // fixes it: section.fixed). A drag reads depth by the normal's direction on the stage, or by up and down where the
  // cut face is seen nearly face on (the normal pointing at the eye has no direction on the stage)
  c.cutMovable_ = () =>
    !c.locked_('cut') &&
    !!c.state_.cut &&
    c.spec_.section !== false &&
    !c.spec_.section?.fixed &&
    c.renderer_.kind !== '2d';
  // (second: the quarter cut's other plane, section.second, moved instead)
  c.moveCut_ = (offset, second = false) => {
    const section = c.state_.section,
      [from, to] = c.cutRange_(second),
      held = Math.max(from, Math.min(to, offset));
    if (held === (second ? (section.second || {}).offset : section.offset)) return;
    c.mark_('reader');
    c.state_.section = second
      ? { ...section, second: { ...section.second, offset: held } }
      : { ...section, offset: held };
    if (c.controls_.style) c.controls_.style(); // (the slider follows)
    c.kick_();
    if (c.opts_.onSection) c.opts_.onSection(c.api_.section);
  };
  /** @type {{ id: number, x: number, y: number, from: number, along: number[], moved: number, part: string, second: boolean } | null} */
  let cutting = null;
  /** @param {number} x @param {number} y */
  function cutAt(x, y) {
    if (!c.cutMovable_()) return null;
    const hit = c.pickHit_(x, y);
    if (!hit.onCut || !hit.id) return null;
    // (the face taken hold of: where the ray crosses the cut, pick.js)
    const crossed = c.cutCrossing_(hit.origin, hit.direction);
    if (!crossed) return null;
    const { point, plane, second } = crossed,
      normal = plane.slice(0, 3),
      across = norm(cross(normal, Math.abs(normal[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0])),
      here = c.project_(point),
      deeper = c.project_(add(point, normal)),
      aside = c.project_(add(point, across));
    if (!here || !deeper || !aside) return null;
    const perUnit = Math.hypot(aside[0] - here[0], aside[1] - here[1]); // (pixels a scene unit, across the cut)
    let along = [deeper[0] - here[0], deeper[1] - here[1]];
    if (Math.hypot(along[0], along[1]) < 0.3 * perUnit) along = [0, -perUnit];
    const section = c.state_.section;
    return {
      x,
      y,
      from: second ? (section.second || {}).offset || 0 : section.offset,
      along,
      moved: 0,
      part: hit.id,
      second,
    };
  }
  const capture = (pointerId) => {
    try {
      c.canvas_.setPointerCapture(pointerId);
    } catch {
      // (not a pointer the browser tracks: nothing to capture)
    }
  };
  // the page's own drags (onPress, onDrag, onRelease): what is under the pointer, as fig.hit gives it
  const pageHit = (event) => {
    const [x, y] = local(event);
    return c.hit_(x, y);
  };
  // (a touch the page took: its scrolling stopped where it starts, which pointer events alone cannot do while the stage
  // lets the page scroll, touch-action pan-y; only with onPress, so other figures scroll the page as ever. On the stage,
  // not the canvas: Chrome treats a listener under the labels' layers, pointer-events none, as passive)
  if (c.opts_.onPress)
    c.stage_.addEventListener(
      'touchstart',
      (event) => {
        if (pressed != null) event.preventDefault();
      },
      { passive: false },
    );
  c.canvas_.addEventListener('pointerdown', (event) => {
    if (pressed != null) return; // (the page holds a gesture: other pointers wait)
    if (!c.locked_('camera')) c.cancelView_(); // the reader takes over from a gliding view (unless the page locked it)
    if (momentum) {
      c.animations_.delete(momentum); // a grab stops the model
      momentum = null;
    }
    if (
      !pointers.size &&
      !grab &&
      !cutting && // (a handle or the cut held by another finger: theirs, not the page's)
      c.opts_.onPress &&
      (event.pointerType !== 'mouse' || event.button === 0) &&
      c.opts_.onPress(pageHit(event), event) === true
    ) {
      // the page takes the gesture: the view, the handles and the cut stay as they are
      pressed = event.pointerId;
      capture(event.pointerId);
      c.hint_.classList.add('gone');
      setActive(true);
      event.preventDefault();
      return;
    }
    if (!pointers.size) {
      const [x, y] = local(event),
        grip = c.locked_('handles') ? null : handleAt(x, y),
        cut = grip ? null : cutAt(x, y);
      if (cut) {
        // the reader takes hold of the cut face: the plane moves, the view does not
        cutting = { ...cut, id: event.pointerId };
        c.dragging_ = true; // (onChange told every 250 ms while it moves)
        capture(event.pointerId);
        c.canvas_.style.cursor = 'grabbing';
        c.hint_.classList.add('gone');
        setActive(true);
        event.preventDefault();
        return;
      }
      if (grip) {
        // the reader takes hold of a handle: it moves, the view does not
        c.dragging_ = true;
        grab = {
          grip,
          id: event.pointerId,
          start: grip.value,
          turned: 0,
          lastAngle: null,
          slideStart: null,
          planeStart: null,
          moved: 0,
        };
        capture(event.pointerId);
        c.canvas_.style.cursor = 'grabbing';
        c.hint_.classList.add('gone');
        setActive(true);
        dragHandle(grab, x, y);
        event.preventDefault();
        return;
      }
    }
    capture(event.pointerId);
    pointers.set(event.pointerId, [event.clientX, event.clientY]);
    moved = 0;
    setActive(true);
    drag = { pan: event.shiftKey || event.button === 2 };
    c.dragging_ = !c.locked_('camera'); // (onChange told at most every 250 ms, and once more when the view stops)
    c.hint_.classList.add('gone');
  });
  c.canvas_.addEventListener('pointermove', (event) => {
    if (pressed != null) {
      if (event.pointerId === pressed && c.opts_.onDrag) c.opts_.onDrag(pageHit(event), event);
      return;
    }
    if (cutting && event.pointerId === cutting.id) {
      const [x, y] = local(event),
        dx = x - cutting.x,
        dy = y - cutting.y,
        along = cutting.along;
      cutting.moved = Math.max(cutting.moved, Math.abs(dx) + Math.abs(dy));
      c.moveCut_(
        cutting.from + (dx * along[0] + dy * along[1]) / (along[0] * along[0] + along[1] * along[1]),
        cutting.second,
      );
      return;
    }
    if (grab && event.pointerId === grab.id) {
      const [x, y] = local(event);
      grab.moved += Math.abs(event.movementX || 0) + Math.abs(event.movementY || 0);
      dragHandle(grab, x, y);
      return;
    }
    if (pointers.has(event.pointerId)) {
      const prev = pointers.get(event.pointerId);
      pointers.set(event.pointerId, [event.clientX, event.clientY]);
      const dx = event.clientX - prev[0],
        dy = event.clientY - prev[1];
      moved += Math.abs(dx) + Math.abs(dy);
      if (c.locked_('camera')) return; // (locked by the page: the view stays; a tap still chooses a part)
      c.mark_('reader');
      if (pointers.size === 2) {
        const [first, second] = [...pointers.values()],
          apart = Math.hypot(first[0] - second[0], first[1] - second[1]);
        if (pinch > 0 && apart > 0) {
          const rect = c.canvas_.getBoundingClientRect();
          c.zoom_(apart / pinch, (first[0] + second[0]) / 2 - rect.left, (first[1] + second[1]) / 2 - rect.top); // towards the fingers' middle
        }
        pinch = apart;
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
      const [x, y] = local(event),
        hit = c.pickHit_(x, y),
        id = hit.id;
      // (a handle, or a cut face the reader may move: grabbed, not chosen)
      const onHandle = (id ? !!c.part_(id)?.handleOf : !!handleAt(x, y)) || (hit.onCut && c.cutMovable_());
      if (id !== c.state_.hover || onHandle !== wasOnHandle) {
        c.state_.hover = id;
        wasOnHandle = onHandle;
        c.canvas_.style.cursor = onHandle ? 'grab' : id ? 'pointer' : 'grab';
        c.showInfo_('hover');
        c.kick_();
      }
    }
  });
  const end = (event) => {
    if (pressed != null) {
      if (event.pointerId !== pressed) return;
      pressed = null;
      if (c.opts_.onRelease) c.opts_.onRelease(pageHit(event), event);
      return;
    }
    if (cutting && event.pointerId === cutting.id) {
      // let go of the cut; a tap without moving chooses the part, as elsewhere
      if (cutting.moved < 4 && event.type === 'pointerup') {
        c.state_.selected = cutting.part === c.state_.selected ? null : cutting.part;
        c.showInfo_('pick');
      }
      c.mark_('reader');
      c.dragging_ = false;
      cutting = null;
      c.canvas_.style.cursor = 'grab';
      c.kick_();
      return;
    }
    if (grab && event.pointerId === grab.id) {
      // let go of a handle; a tap without moving selects the part, as elsewhere
      if (grab.moved < 4 && event.type === 'pointerup') {
        c.state_.selected = grab.grip.part.id === c.state_.selected ? null : grab.grip.part.id;
        c.showInfo_('pick');
      }
      c.mark_('reader');
      c.dragging_ = false;
      grab = null;
      c.canvas_.style.cursor = 'grab';
      c.kick_();
      return;
    }
    if (!pointers.has(event.pointerId)) return;
    pointers.delete(event.pointerId);
    pinch = 0;
    c.mark_('reader');
    if (!pointers.size) c.dragging_ = false; // (a flick below keeps it, until the view stops)
    if (moved < 6 && event.type === 'pointerup') {
      const [x, y] = local(event),
        id = c.pickAt_(x, y);
      c.state_.selected = id && id !== c.state_.selected ? id : null;
      c.showInfo_('pick');
      c.kick_();
    } else if (
      !pointers.size &&
      !c.locked_('camera') &&
      Math.hypot(velocity[0], velocity[1]) > 2 &&
      performance.now() - velocity[2] < 80 &&
      !LK3D.reduce
    ) {
      // let go while still moving: the view glides on, slowing
      let speed = velocity.slice(0, 2).map((component) => Math.max(-30, Math.min(30, component))),
        prev = 0;
      const glide = (now) => {
        const dt = prev ? Math.max(0, Math.min(50, now - prev)) : 16.7;
        prev = now;
        const slowing = Math.pow(0.9, dt / 16.7),
          frames = dt / 16.7;
        speed = [speed[0] * slowing, speed[1] * slowing];
        c.state_.yaw -= speed[0] * 0.008 * frames;
        c.state_.pitch = tilt(c.state_.pitch + speed[1] * 0.008 * frames);
        c.markDirty_();
        if (Math.hypot(speed[0], speed[1]) < 0.3) {
          momentum = null;
          c.dragging_ = false; // (the view has stopped: onChange told once more)
          c.mark_('reader');
          return false;
        }
        return true;
      };
      c.dragging_ = true;
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
    (event) => {
      if (!(event.ctrlKey || active) || c.locked_('camera')) return; // never hijack the page's scrolling
      event.preventDefault();
      c.mark_('reader');
      const [x, y] = local(event);
      c.zoom_(Math.exp(-event.deltaY * 0.0015), x, y);
    },
    { passive: false },
  );
  const outside = (event) => {
    if (!c.host_.contains(event.target)) setActive(false);
  };
  document.addEventListener('pointerdown', outside);
  c.cleanups_.push(() => document.removeEventListener('pointerdown', outside));
  c.canvas_.addEventListener('keydown', (event) => {
    const turn = { ArrowLeft: [0.12, 0], ArrowRight: [-0.12, 0], ArrowUp: [0, 0.1], ArrowDown: [0, -0.1] }[event.key],
      camera = !c.locked_('camera');
    if (turn || event.key.startsWith('Page') || event.key === 'Escape') c.mark_('reader'); // (D, and others, change nothing)
    if (turn && camera) {
      c.cancelView_();
      c.state_.yaw += turn[0];
      c.state_.pitch = tilt(c.state_.pitch + turn[1]);
      c.kick_();
      event.preventDefault();
    }
    const zoom = { '+': 1.15, '=': 1.15, '-': 1 / 1.15 }[event.key];
    if (zoom && camera) (c.mark_('reader'), c.zoom_(zoom));
    const step = { PageDown: 1, PageUp: -1 }[event.key],
      shown = c.namedParts_.filter((part) => !part.hidden);
    if ((step && shown.length) || (event.key === 'Escape' && (c.state_.selected || c.added_))) {
      const count = shown.length,
        at = shown.findIndex((part) => part.id === c.state_.selected);
      // from none: the first (Page Down) or the last (Page Up); then on round
      c.state_.selected = step ? shown[at < 0 ? (step > 0 ? 0 : count - 1) : (at + step + count) % count].id : null;
      c.showInfo_('pick');
      c.kick_();
      event.preventDefault();
    }
  });
  // each handle also as a range input, visually hidden: Tab reaches it, the arrow keys move it, screen readers read it
  // (made once the built-in controls are in place: after them on the page)
  return () => {
    const stage = c.stage_;
    for (const grip of c.handles_) {
      const handle = grip.handle,
        plane = handle.plane,
        w = c.words_;
      grip.inputs = [];
      // one range input for each number the handle holds: a plane handle's two, along each of its axes
      for (const axis of plane ? [0, 1] : [null]) {
        const range = document.createElement('input'),
          end = (/** @type {any} */ v, /** @type {number} */ fallback) => (axis == null ? v : v?.[axis]) ?? fallback;
        range.type = 'range';
        range.className = 'lk3d-sr';
        const min = end(handle.min, plane ? -1 : 0),
          max = end(handle.max, handle.turn ? 360 : 1),
          step = handle.snap || (handle.along ? 0.01 : handle.turn ? 1 : (max - min) / 100);
        range.min = String(min);
        range.max = String(max);
        range.step = String(step);
        const digits = Math.max(0, Math.ceil(-Math.log10(step) - 1e-9)); // the value read out to the step's last digit
        range.value = String(of(grip, axis));
        const label = handle.label || plainText(grip.part.name) || grip.part.id;
        // (a plane's axis: its name, or "along x" for an axis along x, y or z, else "first direction" or "second")
        let name = label;
        if (plane) {
          const k = /** @type {number} */ (axis),
            direction = plane.axes[k].map(Math.abs),
            along = direction.findIndex((v) => v > 0.999 * Math.hypot(...direction));
          name = w.planeAxis
            .replace('{label}', label)
            .replace(
              '{axis}',
              plane.names?.[k] ||
                w[['alongX', 'alongY', 'alongZ', 'firstAxis', 'secondAxis'][along < 0 ? 3 + k : along]],
            );
        }
        range.setAttribute('aria-label', name);
        range.setAttribute('aria-valuetext', valueText(grip, axis, digits));
        range.addEventListener('input', () => {
          // (locked by the page: the input goes back to where the handle is)
          if (c.locked_('handles')) return void (range.value = String(of(grip, axis)));
          const v = +range.value;
          c.setHandle_(
            grip,
            HD.hold(
              handle,
              plane
                ? axis
                  ? [grip.value[0], v]
                  : [v, grip.value[1]]
                : grip.round
                  ? grip.value + HD.unwrap(v - mod360(grip.value))
                  : v,
            ),
            true,
          );
        });
        // (locked: its keys do nothing, but it keeps the focus, and Tab still leaves it)
        range.addEventListener('keydown', (event) => {
          // (D still says the figure: it changes nothing)
          if (c.locked_('handles') && !/^(Tab|d|D)$/.test(event.key))
            (event.stopImmediatePropagation(), event.preventDefault());
        });
        // (a range input stops at its ends: a handle that goes round and round is turned by its own keys instead)
        if (grip.round)
          range.addEventListener('keydown', (event) => {
            const steps = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1, PageDown: -10, PageUp: 10 }[
              event.key
            ];
            if (!steps) return;
            event.preventDefault();
            c.setHandle_(grip, HD.hold(handle, grip.value + steps * step), true);
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
        grip.inputs.push([range, axis, digits]);
        c.host_.append(range);
      }
    }
    // a hidden part's handle is out of reach of the keyboard too: out of the Tab order and of what screen readers read
    (c.syncHandleInputs_ = () => {
      const locked = c.locked_('handles');
      for (const { part, inputs } of c.handles_)
        for (const [input] of inputs || []) {
          if (part.hidden) input.blur();
          input.disabled = input.hidden = !!part.hidden;
          if (locked) input.setAttribute('aria-disabled', 'true');
          else input.removeAttribute('aria-disabled');
          input.title = locked ? c.words_.locked : '';
        }
    })();
  };
}
