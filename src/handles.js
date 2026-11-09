// Handles: parts the reader moves directly with the pointer, held to a rule (as one turns a focus ring, pushes a
// piston, carries a planet along its orbit). The maths here is pure (a pointer ray in, a value out) so it is tested
// without a browser; figure/pose.js places the parts by it, and figure/input.js wires it to the pointer, the keyboard
// and the page.
//
//   handle: {turn: {axis, center}, min, max, snap, value}   degrees about an axis through center
//   handle: {slide: {axis}, min, max, snap, value}          a distance along an axis from where the part is drawn
//   handle: {along: {path, closed}, min, max, snap, value}  a place on a path, 0 at its start to 1 at its end
import { M, sub, add, mulv, dot, cross, len, norm } from './math.js';

// two directions at right angles to an axis (and to each other)
function frame(axis) {
  const unitAxis = norm(axis),
    first = norm(cross(unitAxis, Math.abs(unitAxis[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
  return { axis: unitAxis, first, second: cross(unitAxis, first) };
}
// where a ray origin + t·direction meets the plane through planePoint with the given normal (null if it runs along
// the plane or points away)
function hitPlane(origin, direction, planePoint, normal) {
  const denominator = dot(direction, normal);
  if (Math.abs(denominator) < 1e-9) return null;
  const t = dot(sub(planePoint, origin), normal) / denominator;
  return t > 0 ? add(origin, mulv(direction, t)) : null;
}
// the angle (degrees) around the axis of the point the ray points at, in the plane at right angles to the axis
function turnAngle(rayOrigin, rayDirection, handle) {
  const { axis, first, second } = frame(handle.turn.axis),
    center = handle.turn.center || [0, 0, 0];
  let point = hitPlane(rayOrigin, rayDirection, center, axis);
  if (!point) {
    // seen edge-on: use the point of the ray nearest the axis instead
    const t = -dot(sub(rayOrigin, center), rayDirection);
    point = add(rayOrigin, mulv(rayDirection, t));
  }
  const fromCenter = sub(point, center);
  return (Math.atan2(dot(fromCenter, second), dot(fromCenter, first)) * 180) / Math.PI;
}
// how far along the axis (through `origin`) the ray passes closest to it
function slideAt(rayOrigin, rayDirection, handle, origin) {
  const axis = norm(handle.slide.axis),
    direction = norm(rayDirection),
    fromOrigin = sub(rayOrigin, origin),
    cosine = dot(direction, axis),
    denominator = 1 - cosine * cosine;
  if (denominator < 1e-6) return null; // the ray runs along the axis: no way to read a position
  return (dot(axis, fromOrigin) - cosine * dot(direction, fromOrigin)) / denominator;
}
// the path as cumulative lengths, and a point at a fraction (0..1) of its length
function measure(path, closed) {
  const points = closed ? [...path, path[0]] : path,
    lengths = [0];
  for (let k = 1; k < points.length; k++) lengths.push(lengths[k - 1] + len(sub(points[k], points[k - 1])));
  return { points, lengths, total: lengths[lengths.length - 1] || 1 };
}
function pointAt(path, fraction) {
  const distance = Math.max(0, Math.min(1, fraction)) * path.total;
  let segment = 1;
  while (segment < path.lengths.length - 1 && path.lengths[segment] < distance) segment++;
  const along = (distance - path.lengths[segment - 1]) / (path.lengths[segment] - path.lengths[segment - 1] || 1);
  return add(path.points[segment - 1], mulv(sub(path.points[segment], path.points[segment - 1]), along));
}
// the fraction of the path nearest a screen point, given the path's points already on screen (screen[k] = [x, y])
function nearestAlong(path, screen, x, y) {
  let bestDistance2 = Infinity,
    fraction = 0;
  for (let k = 1; k < screen.length; k++) {
    const start = screen[k - 1],
      end = screen[k];
    if (!start || !end) continue;
    const segment = [end[0] - start[0], end[1] - start[1]],
      length2 = segment[0] * segment[0] + segment[1] * segment[1] || 1;
    const along = Math.max(0, Math.min(1, ((x - start[0]) * segment[0] + (y - start[1]) * segment[1]) / length2));
    const dx = start[0] + segment[0] * along - x,
      dy = start[1] + segment[1] * along - y,
      distance2 = dx * dx + dy * dy;
    if (distance2 < bestDistance2) {
      bestDistance2 = distance2;
      fraction = (path.lengths[k - 1] + along * (path.lengths[k] - path.lengths[k - 1])) / path.total;
    }
  }
  return fraction;
}
// an angle step folded into (−180, 180], so dragging round and round keeps adding up
const unwrap = (angleStep) => ((angleStep + 540) % 360) - 180;
// a value held to the handle's range and snapped to its steps (a closed path wraps instead of stopping)
function hold(handle, value) {
  if (handle.along && handle.along.closed && handle.min == null && handle.max == null) value = ((value % 1) + 1) % 1;
  if (handle.snap) value = Math.round(value / handle.snap) * handle.snap;
  if (handle.min != null) value = Math.max(handle.min, value);
  if (handle.max != null) value = Math.min(handle.max, value);
  return value;
}
// the movement a handle at a value gives its parts (relative to where they are drawn, at the handle's first value)
function matrix(handle, value, path) {
  if (handle.turn) {
    const center = handle.turn.center || [0, 0, 0],
      angle = ((value - (handle.value ?? 0)) * Math.PI) / 180;
    return M.mul(M.trans(center), M.mul(rotAxis(handle.turn.axis, angle), M.trans(mulv(center, -1))));
  }
  if (handle.slide) return M.trans(mulv(norm(handle.slide.axis), value - (handle.value ?? 0)));
  if (handle.along) return M.trans(sub(pointAt(path, value), pointAt(path, handle.value ?? 0)));
  return M.id();
}
function rotAxis(axis, angle) {
  // a rotation by an angle about any axis (Rodrigues; c and s its cosine and sine, t = 1 − c)
  const [x, y, z] = norm(axis),
    c = Math.cos(angle),
    s = Math.sin(angle),
    t = 1 - c;
  return [
    t * x * x + c,
    t * x * y + s * z,
    t * x * z - s * y,
    0,
    t * x * y - s * z,
    t * y * y + c,
    t * y * z + s * x,
    0,
    t * x * z + s * y,
    t * y * z - s * x,
    t * z * z + c,
    0,
    0,
    0,
    0,
    1,
  ];
}

export { frame, hitPlane, turnAngle, slideAt, measure, pointAt, nearestAlong, unwrap, hold, matrix, rotAxis };
