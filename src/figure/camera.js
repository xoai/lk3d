// @ts-check
// The camera: where it stands and looks (fitted to the stage), the views and their glides, zooming towards a point,
// the cut's plane, boxes round parts, and the ray through a point of the stage. Owns viewProj_, eye_, frustum_,
// baseDist_, explodeShift_, camera_, project_, cutPlane_, cutPlane2_, cutRange_, boxOf_, frame_, shownBox_, rayAt_, zoom_, view_,
// viewAngles_ and cancelView_;
// reads state_, spec_, built_, width_, height_ and animations_, and calls offsetOf_, pickHit_, measure_, markDirty_ and kick_.
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
  c.frustum_ = { distance: 1, halfHeight: 1, ortho: false }; // (for the shaders)
  c.eye_ = [0, 0, 1];
  c.explodeShift_ = () => mulv(c.spec_.view?.explodeShift || [0, 0, 0], c.state_.explode);
  // how far back the camera must stand to show the whole model from the first view, on a stage of this shape (a
  // margin around it): every point of it inside the frame, whatever its proportions and wherever the scene points the
  // camera. Never closer than the scene's own distance: only ever further, so nothing is cut off
  let fitFor = '',
    fit = 1,
    /** @type {number[][] | null} */
    outline = null; // (points of the model at rest, at most 20 000: its shape, not its box, which a round model overfills)
  function outlinePoints() {
    let vertexCount = 0;
    for (const part of c.built_.parts)
      for (const batch of part.batches) vertexCount += batch.mesh.count * batch.placements.length;
    const step = Math.max(1, Math.ceil(vertexCount / 20000)),
      out = [];
    for (const part of c.built_.parts)
      for (const batch of part.batches)
        for (const matrix of batch.placements)
          for (let v = 0; v < batch.mesh.count; v += step)
            out.push(
              M.pt(matrix, [
                batch.mesh.positions[3 * v],
                batch.mesh.positions[3 * v + 1],
                batch.mesh.positions[3 * v + 2],
              ]),
            );
    return out;
  }
  function fitNow(aspect = c.width_ / c.height_) {
    const ortho = c.state_.projection === 'ortho',
      key = aspect + (ortho ? 'o' : 'p');
    if (key === fitFor) return fit;
    fitFor = key;
    const cosPitch = Math.cos(home.pitch),
      back = [cosPitch * Math.sin(home.yaw), Math.sin(home.pitch), cosPitch * Math.cos(home.yaw)],
      right = norm(cross(mulv(back, -1), [0, 1, 0])),
      up = cross(right, mulv(back, -1)),
      tanHalfFov = Math.tan(((c.spec_.view?.fov ?? 35) * D2R) / 2) / 1.08; // (with a margin)
    let need = 0;
    for (const point of (outline ??= outlinePoints())) {
      const fromTarget = sub(point, home.target);
      need = Math.max(
        need,
        (ortho ? 0 : dot(fromTarget, back)) +
          Math.max(Math.abs(dot(fromTarget, up)), Math.abs(dot(fromTarget, right)) / aspect) / tanHalfFov,
      );
    }
    // (and, as before, on a stage squarer than the scene's own proportions (a phone), back far enough for its width)
    return (fit = Math.max(1, (c.spec_.w || 16) / (c.spec_.h || 10) / aspect, need / home.dist));
  }
  // where the camera looks and from how far (as the state holds them: before the fit to the stage, the step back and
  // the shift when taken apart) to frame some parts as they are once taken apart by `explode`: the sphere round them
  // inside the frame, however narrow it is
  c.frame_ = (parts, explode = c.state_.explode) => {
    if (c.width_ <= 1) c.measure_(); // (not laid out yet: a figure just mounted)
    const now = c.state_.explode;
    c.state_.explode = explode;
    const box = c.boxOf_(parts);
    c.state_.explode = now;
    const aspect = c.width_ > 1 && c.height_ > 1 ? c.width_ / c.height_ : (c.spec_.w || 16) / (c.spec_.h || 10),
      tanHalf = (Math.tan(((c.spec_.view?.fov ?? 35) * D2R) / 2) * Math.min(1, aspect)) / 1.08, // (with a margin)
      distance = c.state_.projection === 'ortho' ? box.radius / tanHalf : box.radius / Math.sin(Math.atan(tanHalf));
    return {
      target: sub(box.center, mulv(c.spec_.view?.explodeShift || [0, 0, 0], explode)),
      dist: distance / fitNow(aspect) / (1 + (c.spec_.view?.explodeZoom ?? 0.5) * explode),
    };
  };
  c.camera_ = () => {
    const width = c.width_,
      height = c.height_,
      cosPitch = Math.cos(c.state_.pitch),
      distance = c.state_.dist * fitNow() * (1 + (c.spec_.view?.explodeZoom ?? 0.5) * c.state_.explode),
      target = add(c.state_.target, c.explodeShift_());
    // orthographic: parallel lines stay parallel; framed as the perspective camera frames the point looked at. Its depth
    // range always holds the whole model, however close the reader zooms (only the frustum shrinks)
    const fov = (c.spec_.view?.fov ?? 35) * D2R,
      halfHeight = distance * Math.tan(fov / 2),
      ortho = c.state_.projection === 'ortho',
      reach = c.built_.radius * (2 + c.state_.explode * 2); // (the model's size, taken apart)
    const eye = (c.eye_ = add(target, [
      distance * cosPitch * Math.sin(c.state_.yaw),
      distance * Math.sin(c.state_.pitch),
      distance * cosPitch * Math.cos(c.state_.yaw),
    ]));
    c.frustum_ = { distance, halfHeight, ortho };
    c.viewProj_ = M.mul(
      ortho
        ? M.ortho(
            (-halfHeight * width) / height,
            (halfHeight * width) / height,
            -halfHeight,
            halfHeight,
            Math.min(-distance * 4, distance - reach * 3),
            Math.max(distance * 10, distance + reach * 3),
          )
        : M.persp(fov, width / height, Math.max(0.01, distance / 50), distance * 10),
      M.look(eye, target, [0, 1, 0]),
    );
  };
  // the cut's plane [n, -offset]: what lies on the side its normal points to is cut away. A cut between 0 and 1 is how
  // far the plane has swept, from just outside the model as it is now (nothing cut) to the section's own offset
  c.cutPlane_ = () => {
    const normal = norm(c.state_.section.normal),
      to = c.state_.section.offset,
      swept = c.state_.cut === true ? 1 : Math.max(0, Math.min(1, +c.state_.cut || 0));
    let from = -Infinity;
    if (swept < 1) {
      for (const part of c.built_.parts)
        if (part.cut && !part.hidden) {
          const offset = c.offsetOf_(part);
          from = Math.max(
            from,
            dot(
              normal,
              add(
                offset,
                [0, 1, 2].map((axis) => (normal[axis] > 0 ? part.max[axis] : part.min[axis])),
              ),
            ),
          );
        }
      from = Math.max(to, from + c.built_.radius * 0.01);
    }
    return [normal[0], normal[1], normal[2], -(swept < 1 ? from + (to - from) * swept : to)];
  };
  // the second plane of a quarter cut (section.second): what lies beyond both planes is cut away; without one, a
  // plane everything is beyond, so one plane cuts alone
  c.cutPlane2_ = () => {
    const second = c.state_.section.second;
    if (!second) return [0, 0, 0, 1];
    const normal = norm(second.normal || [1, 0, 0]);
    return [normal[0], normal[1], normal[2], -(second.offset || 0)];
  };
  // what is on screen now (for the shadow's reach) and the floor under the assembled model
  c.shownBox_ = () => c.boxOf_(c.built_.parts.filter((part) => part.drawAlpha >= 0.01));
  // the box round some parts where they are now (taken apart, moved)
  c.boxOf_ = (parts) => {
    const min = [1e9, 1e9, 1e9],
      max = [-1e9, -1e9, -1e9];
    for (const part of parts) {
      const offset = c.offsetOf_(part);
      for (let axis = 0; axis < 3; axis++) {
        min[axis] = Math.min(min[axis], part.min[axis] + offset[axis]);
        max[axis] = Math.max(max[axis], part.max[axis] + offset[axis]);
      }
    }
    return { center: mulv(add(min, max), 0.5), radius: len(sub(max, min)) / 2 || 1, min, max };
  };
  // how far along the cut's normal the parts it cuts reach, as they are now: where the plane can go [from, to]
  c.cutRange_ = (second = false) => {
    const normal = norm(second ? (c.state_.section.second || {}).normal || [1, 0, 0] : c.state_.section.normal);
    let from = Infinity,
      to = -Infinity;
    for (const part of c.built_.parts)
      if (part.cut && !part.hidden) {
        const offset = c.offsetOf_(part);
        for (let corner = 0; corner < 8; corner++) {
          const along = dot(
            normal,
            add(
              offset,
              [0, 1, 2].map((axis) => ((corner >> axis) & 1 ? part.max[axis] : part.min[axis])),
            ),
          );
          from = Math.min(from, along);
          to = Math.max(to, along);
        }
      }
    return from <= to ? [from, to] : [-1, 1];
  };
  // a point of the scene on the stage, in CSS pixels (null behind the eye), by the camera as last placed
  c.project_ = (point) => M.project(c.viewProj_, point, c.width_, c.height_);
  c.rayAt_ = (x, y) => {
    // the ray from the eye through a point of the stage: from its point on the near plane (origin), along direction (of length 1)
    c.camera_();
    const inverse = M.invert(c.viewProj_),
      ndcX = (x / c.width_) * 2 - 1,
      ndcY = 1 - (y / c.height_) * 2;
    const nearPoint = M.pt(inverse, [ndcX, ndcY, -1]),
      nearW = inverse[3] * ndcX + inverse[7] * ndcY - inverse[11] + inverse[15],
      farPoint = M.pt(inverse, [ndcX, ndcY, 1]),
      farW = inverse[3] * ndcX + inverse[7] * ndcY + inverse[11] + inverse[15];
    const near = mulv(nearPoint, 1 / nearW),
      far = mulv(farPoint, 1 / farW),
      direction = sub(far, near);
    return { origin: near, direction: mulv(direction, 1 / len(direction)) };
  };

  // ---- zooming: by a factor (more than 1: closer), towards a point of the stage when given, so that what is under
  // the pointer stays under it (the part hit there, else the point on the plane through the target facing the camera)
  const minZoom = c.spec_.view?.minZoom ?? 0.02;
  c.zoom_ = (factor, x, y) => {
    c.cancelView_();
    const dist = Math.max(baseDist * minZoom, Math.min(baseDist * 3, c.state_.dist / factor)),
      ratio = dist / c.state_.dist;
    if (x != null && y != null && ratio !== 1) {
      const { t, origin, direction } = c.pickHit_(x, y, 0.3),
        target = add(c.state_.target, c.explodeShift_()),
        facing = norm(sub(target, c.eye_)),
        under = add(
          origin,
          mulv(direction, Number.isFinite(t) ? t : dot(sub(target, origin), facing) / (dot(direction, facing) || 1)),
        );
      c.state_.target = sub(add(under, mulv(sub(target, under), ratio)), c.explodeShift_());
    }
    c.state_.dist = dist;
    c.kick_();
  };

  // ---- tweening the camera to a view
  // a named view, [yaw, pitch] (degrees), or {yaw, pitch, dist | zoom, target}: any of them, the rest kept; over
  // options.ms milliseconds (600), or at once (0: a page that places the camera itself every frame)
  /** @type {((now: number) => boolean) | null} */
  let viewTween = null;
  c.view_ = (name, options = {}) => {
    if (typeof name === 'string' && !VIEWS[name] && name !== 'home') return; // (a view this engine does not know)
    const isObject = name && typeof name === 'object' && !Array.isArray(name);
    const angles = isObject
      ? [name.yaw ?? c.state_.yaw / D2R, name.pitch ?? c.state_.pitch / D2R]
      : name === 'home'
        ? [home.yaw / D2R, home.pitch / D2R]
        : VIEWS[name] || name;
    const from = { yaw: c.state_.yaw, pitch: c.state_.pitch, dist: c.state_.dist, target: c.state_.target.slice() };
    const to = {
      yaw: angles[0] * D2R,
      pitch: angles[1] * D2R,
      dist: isObject
        ? name.zoom
          ? baseDist / name.zoom
          : (name.dist ?? c.state_.dist)
        : name === 'home'
          ? home.dist
          : c.state_.dist,
      target: isObject ? name.target || c.state_.target : name === 'home' ? home.target : c.state_.target,
    };
    const start = clock.now(),
      ms = LK3D.reduce ? 1 : (options.ms ?? 600);
    // (a glide takes the short way round; a view placed at once keeps the angle the page gave)
    while (ms > 0 && to.yaw - from.yaw > Math.PI) to.yaw -= 2 * Math.PI;
    while (ms > 0 && from.yaw - to.yaw > Math.PI) to.yaw += 2 * Math.PI;
    const tween = (now) => {
      const progress = ms > 0 ? Math.max(0, Math.min(1, (now - start) / ms)) : 1,
        eased = progress < 0.5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) / 2;
      c.state_.yaw = from.yaw + (to.yaw - from.yaw) * eased;
      c.state_.pitch = from.pitch + (to.pitch - from.pitch) * eased;
      c.state_.dist = from.dist + (to.dist - from.dist) * eased;
      c.state_.target = add(from.target, mulv(sub(to.target, from.target), eased));
      c.markDirty_();
      if (progress >= 1) {
        c.animations_.delete(tween);
        return false;
      }
      return true;
    };
    c.cancelView_();
    if (!(ms > 0)) return (tween(start), c.kick_());
    viewTween = tween;
    c.animations_.add(tween);
    c.kick_();
  };
  // a named view's angles (degrees), else where the camera looks now
  c.viewAngles_ = (name) => VIEWS[name] || [c.state_.yaw / D2R, c.state_.pitch / D2R];
  c.cancelView_ = () => {
    if (viewTween) c.animations_.delete(viewTween);
    viewTween = null;
  };
}
