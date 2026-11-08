// @ts-check
// The camera: where it stands and looks (fitted to the stage), the views and their glides, zooming towards a point,
// the cut's plane, boxes round parts, and the ray through a point of the stage. Owns viewProj_, eye_, frustum_,
// baseDist_, explodeShift_, camera_, project_, cutPlane_, boxOf_, shownBox_, rayAt_, zoom_, view_ and cancelView_;
// reads state_, spec_, built_, width_, height_ and animations_, and calls offsetOf_, pickHit_, markDirty_ and kick_.
import { D2R, M, sub, add, mulv, len, norm, cross, dot } from '../math.js';
import { clock } from '../clock.js';
import LK3D from '../namespace.js';

// the named views: [yaw, pitch] in degrees (83°: the most a drag reaches)
/** @type {Record<string, number[]>} */
const VIEWS = { front: [0, 0], side: [-90, 0], top: [0, 83], iso: [-35, 25] };

/** @param {import('./context').Ctx} c */
export function makeCamera(c) {
  const baseDist = (c.baseDist_ = c.spec_.view?.dist ?? c.built_.radius * 2.6);
  c.state_.dist = baseDist;
  c.state_.target = c.spec_.view?.target || c.built_.center.slice();
  const home = { yaw: c.state_.yaw, pitch: c.state_.pitch, dist: c.state_.dist, target: c.state_.target.slice() };

  c.viewProj_ = M.id();
  c.frustum_ = { d: 1, h: 1, ortho: false }; // (the camera's distance and half-height, for the shaders)
  c.eye_ = [0, 0, 1];
  c.explodeShift_ = () => mulv(c.spec_.view?.explodeShift || [0, 0, 0], c.state_.explode);
  // how far back the camera must stand to show the whole model from the first view, on a stage of this shape (a
  // margin around it): every point of it inside the frame, whatever its proportions and wherever the scene points the
  // camera. Never closer than the scene's own distance: only ever further, so nothing is cut off
  let fitFor = '',
    fit = 1,
    outline = null; // (points of the model at rest, at most 20 000: its shape, not its box, which a round model overfills)
  function outlinePoints() {
    let n = 0;
    for (const p of c.built_.parts) for (const b of p.batches) n += b.geo.count * b.mats.length;
    const step = Math.max(1, Math.ceil(n / 20000)),
      out = [];
    for (const p of c.built_.parts)
      for (const b of p.batches)
        for (const m of b.mats)
          for (let v = 0; v < b.geo.count; v += step)
            out.push(M.pt(m, [b.geo.p[3 * v], b.geo.p[3 * v + 1], b.geo.p[3 * v + 2]]));
    return out;
  }
  function fitNow() {
    const W = c.width_,
      H = c.height_,
      ortho = c.state_.projection === 'ortho',
      key = W / H + (ortho ? 'o' : 'p');
    if (key === fitFor) return fit;
    fitFor = key;
    const cp = Math.cos(home.pitch),
      back = [cp * Math.sin(home.yaw), Math.sin(home.pitch), cp * Math.cos(home.yaw)],
      right = norm(cross(mulv(back, -1), [0, 1, 0])),
      up = cross(right, mulv(back, -1)),
      t = Math.tan(((c.spec_.view?.fov ?? 35) * D2R) / 2) / 1.08;
    let need = 0;
    for (const q of (outline ??= outlinePoints())) {
      const v = sub(q, home.target);
      need = Math.max(
        need,
        (ortho ? 0 : dot(v, back)) + Math.max(Math.abs(dot(v, up)), Math.abs(dot(v, right)) / (W / H)) / t,
      );
    }
    // (and, as before, on a stage squarer than the scene's own proportions (a phone), back far enough for its width)
    return (fit = Math.max(1, (c.spec_.w || 16) / (c.spec_.h || 10) / (W / H), need / home.dist));
  }
  c.camera_ = () => {
    const W = c.width_,
      H = c.height_,
      cp = Math.cos(c.state_.pitch),
      d = c.state_.dist * fitNow() * (1 + (c.spec_.view?.explodeZoom ?? 0.5) * c.state_.explode),
      target = add(c.state_.target, c.explodeShift_());
    // orthographic: parallel lines stay parallel; framed as the perspective camera frames the point looked at. Its depth
    // range always holds the whole model, however close the reader zooms (only the frustum shrinks)
    const fov = (c.spec_.view?.fov ?? 35) * D2R,
      h = d * Math.tan(fov / 2),
      ortho = c.state_.projection === 'ortho',
      reach = c.built_.radius * (2 + c.state_.explode * 2); // (the model's size, taken apart)
    const eye = (c.eye_ = add(target, [
      d * cp * Math.sin(c.state_.yaw),
      d * Math.sin(c.state_.pitch),
      d * cp * Math.cos(c.state_.yaw),
    ]));
    c.frustum_ = { d, h, ortho };
    c.viewProj_ = M.mul(
      ortho
        ? M.ortho((-h * W) / H, (h * W) / H, -h, h, Math.min(-d * 4, d - reach * 3), Math.max(d * 10, d + reach * 3))
        : M.persp(fov, W / H, Math.max(0.01, d / 50), d * 10),
      M.look(eye, target, [0, 1, 0]),
    );
  };
  // the cut's plane [n, -offset]: what lies on the side its normal points to is cut away. A cut between 0 and 1 is how
  // far the plane has swept, from just outside the model as it is now (nothing cut) to the section's own offset
  c.cutPlane_ = () => {
    const n = norm(c.state_.section.normal),
      to = c.state_.section.offset,
      k = c.state_.cut === true ? 1 : Math.max(0, Math.min(1, +c.state_.cut || 0));
    let from = -Infinity;
    if (k < 1) {
      for (const p of c.built_.parts)
        if (p.cut && !p.hidden) {
          const o = c.offsetOf_(p);
          from = Math.max(
            from,
            dot(
              n,
              add(
                o,
                [0, 1, 2].map((a) => (n[a] > 0 ? p.hi[a] : p.lo[a])),
              ),
            ),
          );
        }
      from = Math.max(to, from + c.built_.radius * 0.01);
    }
    return [n[0], n[1], n[2], -(k < 1 ? from + (to - from) * k : to)];
  };
  // what is on screen now (for the shadow's reach) and the floor under the assembled model
  c.shownBox_ = () => c.boxOf_(c.built_.parts.filter((p) => p.drawAlpha >= 0.01));
  // the box round some parts where they are now (taken apart, moved)
  c.boxOf_ = (ps) => {
    const lo = [1e9, 1e9, 1e9],
      hi = [-1e9, -1e9, -1e9];
    for (const p of ps) {
      const o = c.offsetOf_(p);
      for (let a = 0; a < 3; a++) {
        lo[a] = Math.min(lo[a], p.lo[a] + o[a]);
        hi[a] = Math.max(hi[a], p.hi[a] + o[a]);
      }
    }
    return { center: mulv(add(lo, hi), 0.5), radius: len(sub(hi, lo)) / 2 || 1, lo, hi };
  };
  // a point of the scene on the stage, in CSS pixels (null behind the eye), by the camera as last placed
  c.project_ = (q) => M.project(c.viewProj_, q, c.width_, c.height_);
  c.rayAt_ = (px, py) => {
    // the ray from the eye through a point of the stage
    c.camera_();
    const inv = M.invert(c.viewProj_),
      nx = (px / c.width_) * 2 - 1,
      ny = 1 - (py / c.height_) * 2;
    const p0 = M.pt(inv, [nx, ny, -1]),
      w0 = inv[3] * nx + inv[7] * ny - inv[11] + inv[15],
      p1 = M.pt(inv, [nx, ny, 1]),
      w1 = inv[3] * nx + inv[7] * ny + inv[11] + inv[15];
    const A = mulv(p0, 1 / w0),
      B = mulv(p1, 1 / w1),
      dir = sub(B, A);
    return { A, D: mulv(dir, 1 / len(dir)) };
  };

  // ---- zooming: by k (more than 1: closer), towards a point of the stage when given, so that what is under the
  // pointer stays under it (the part hit there, else the point on the plane through the target facing the camera)
  const minZoom = c.spec_.view?.minZoom ?? 0.02;
  c.zoom_ = (k, x, y) => {
    c.cancelView_();
    const to = Math.max(baseDist * minZoom, Math.min(baseDist * 3, c.state_.dist / k)),
      ratio = to / c.state_.dist;
    if (x != null && ratio !== 1) {
      const { t, A, D } = c.pickHit_(x, y, 0.3),
        target = add(c.state_.target, c.explodeShift_()),
        n = norm(sub(target, c.eye_)),
        under = add(A, mulv(D, Number.isFinite(t) ? t : dot(sub(target, A), n) / (dot(D, n) || 1)));
      c.state_.target = sub(add(under, mulv(sub(target, under), ratio)), c.explodeShift_());
    }
    c.state_.dist = to;
    c.kick_();
  };

  // ---- tweening the camera to a view
  // a named view, [yaw, pitch] (degrees), or {yaw, pitch, dist | zoom, target}: any of them, the rest kept; over
  // o.ms milliseconds (600), or at once (0: a page that places the camera itself every frame)
  let viewTween = null;
  c.view_ = (name, o = {}) => {
    if (typeof name === 'string' && !VIEWS[name] && name !== 'home') return; // (a view this engine does not know)
    const obj = name && typeof name === 'object' && !Array.isArray(name);
    const angles = obj
      ? [name.yaw ?? c.state_.yaw / D2R, name.pitch ?? c.state_.pitch / D2R]
      : name === 'home'
        ? [home.yaw / D2R, home.pitch / D2R]
        : VIEWS[name] || name;
    const from = { yaw: c.state_.yaw, pitch: c.state_.pitch, dist: c.state_.dist, target: c.state_.target.slice() };
    const to = {
      yaw: angles[0] * D2R,
      pitch: angles[1] * D2R,
      dist: obj
        ? name.zoom
          ? baseDist / name.zoom
          : (name.dist ?? c.state_.dist)
        : name === 'home'
          ? home.dist
          : c.state_.dist,
      target: obj ? name.target || c.state_.target : name === 'home' ? home.target : c.state_.target,
    };
    const t0 = clock.now(),
      ms = LK3D.reduce ? 1 : (o.ms ?? 600);
    // (a glide takes the short way round; a view placed at once keeps the angle the page gave)
    while (ms > 0 && to.yaw - from.yaw > Math.PI) to.yaw -= 2 * Math.PI;
    while (ms > 0 && from.yaw - to.yaw > Math.PI) to.yaw += 2 * Math.PI;
    const tween = (now) => {
      const u = ms > 0 ? Math.max(0, Math.min(1, (now - t0) / ms)) : 1,
        e = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
      c.state_.yaw = from.yaw + (to.yaw - from.yaw) * e;
      c.state_.pitch = from.pitch + (to.pitch - from.pitch) * e;
      c.state_.dist = from.dist + (to.dist - from.dist) * e;
      c.state_.target = add(from.target, mulv(sub(to.target, from.target), e));
      c.markDirty_();
      if (u >= 1) {
        c.animations_.delete(tween);
        return false;
      }
      return true;
    };
    c.cancelView_();
    if (!(ms > 0)) return (tween(t0), c.kick_());
    viewTween = tween;
    c.animations_.add(tween);
    c.kick_();
  };
  c.cancelView_ = () => {
    if (viewTween) c.animations_.delete(viewTween);
    viewTween = null;
  };
}
