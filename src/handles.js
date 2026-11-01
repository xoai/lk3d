// Handles: parts the reader moves directly with the pointer, held to a rule (as one turns a focus ring, pushes a
// piston, carries a planet along its orbit). The maths here is pure (a pointer ray in, a value out) so it is tested
// without a browser; index.js wires it to the pointer, the keyboard and the page.
//
//   handle: {turn: {axis, center}, min, max, snap, value}   degrees about an axis through center
//   handle: {slide: {axis}, min, max, snap, value}          a distance along an axis from where the part is drawn
//   handle: {along: {path, closed}, min, max, snap, value}  a place on a path, 0 at its start to 1 at its end
import { M, sub, add, mulv, dot, cross, len, norm } from './math.js';

// two directions at right angles to an axis (and to each other)
function frame(axis) {
  const a = norm(axis),
    u = norm(cross(a, Math.abs(a[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
  return { a, u, w: cross(a, u) };
}
// where a ray o + t·d meets the plane through p0 with normal n (null if it runs along the plane or points away)
function hitPlane(o, d, p0, n) {
  const den = dot(d, n);
  if (Math.abs(den) < 1e-9) return null;
  const t = dot(sub(p0, o), n) / den;
  return t > 0 ? add(o, mulv(d, t)) : null;
}
// the angle (degrees) around the axis of the point the ray points at, in the plane at right angles to the axis
function turnAngle(o, d, h) {
  const { a, u, w } = frame(h.turn.axis),
    c = h.turn.center || [0, 0, 0];
  let p = hitPlane(o, d, c, a);
  if (!p) {
    // seen edge-on: use the point of the ray nearest the axis instead
    const t = -dot(sub(o, c), d);
    p = add(o, mulv(d, t));
  }
  const r = sub(p, c);
  return (Math.atan2(dot(r, w), dot(r, u)) * 180) / Math.PI;
}
// how far along the axis (through `origin`) the ray passes closest to it
function slideAt(o, d, h, origin) {
  const a = norm(h.slide.axis),
    dn = norm(d),
    w0 = sub(o, origin),
    b = dot(dn, a),
    den = 1 - b * b;
  if (den < 1e-6) return null; // the ray runs along the axis: no way to read a position
  return (dot(a, w0) - b * dot(dn, w0)) / den;
}
// the path as cumulative lengths, and a point at a fraction u (0..1) of its length
function measure(path, closed) {
  const P = closed ? [...path, path[0]] : path,
    L = [0];
  for (let k = 1; k < P.length; k++) L.push(L[k - 1] + len(sub(P[k], P[k - 1])));
  return { P, L, total: L[L.length - 1] || 1 };
}
function pointAt(m, u) {
  const s = Math.max(0, Math.min(1, u)) * m.total;
  let k = 1;
  while (k < m.L.length - 1 && m.L[k] < s) k++;
  const t = (s - m.L[k - 1]) / (m.L[k] - m.L[k - 1] || 1);
  return add(m.P[k - 1], mulv(sub(m.P[k], m.P[k - 1]), t));
}
// the fraction of the path nearest a screen point, given the path's points already on screen (screen[k] = [x, y])
function nearestAlong(m, screen, x, y) {
  let best = Infinity,
    u = 0;
  for (let k = 1; k < screen.length; k++) {
    const a = screen[k - 1],
      b = screen[k];
    if (!a || !b) continue;
    const ab = [b[0] - a[0], b[1] - a[1]],
      l2 = ab[0] * ab[0] + ab[1] * ab[1] || 1;
    const t = Math.max(0, Math.min(1, ((x - a[0]) * ab[0] + (y - a[1]) * ab[1]) / l2));
    const dx = a[0] + ab[0] * t - x,
      dy = a[1] + ab[1] * t - y,
      dd = dx * dx + dy * dy;
    if (dd < best) {
      best = dd;
      u = (m.L[k - 1] + t * (m.L[k] - m.L[k - 1])) / m.total;
    }
  }
  return u;
}
// an angle step folded into (−180, 180], so dragging round and round keeps adding up
const unwrap = (da) => ((da + 540) % 360) - 180;
// a value held to the handle's range and snapped to its steps (a closed path wraps instead of stopping)
function hold(h, v) {
  if (h.along && h.along.closed && h.min == null && h.max == null) v = ((v % 1) + 1) % 1;
  if (h.snap) v = Math.round(v / h.snap) * h.snap;
  if (h.min != null) v = Math.max(h.min, v);
  if (h.max != null) v = Math.min(h.max, v);
  return v;
}
// the movement a handle at value v gives its parts (relative to where they are drawn, at the handle's first value)
function matrix(h, v, m) {
  if (h.turn) {
    const c = h.turn.center || [0, 0, 0],
      ang = ((v - (h.value ?? 0)) * Math.PI) / 180;
    return M.mul(M.trans(c), M.mul(rotAxis(h.turn.axis, ang), M.trans(mulv(c, -1))));
  }
  if (h.slide) return M.trans(mulv(norm(h.slide.axis), v - (h.value ?? 0)));
  if (h.along) return M.trans(sub(pointAt(m, v), pointAt(m, h.value ?? 0)));
  return M.id();
}
function rotAxis(axis, a) {
  // a rotation by a about any axis (Rodrigues)
  const [x, y, z] = norm(axis),
    c = Math.cos(a),
    s = Math.sin(a),
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
