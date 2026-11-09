// Small vector and 4x4 matrix helpers (column-major, as WebGL wants them).
const D2R = Math.PI / 180;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mulv = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => {
  const length = len(a) || 1;
  return [a[0] / length, a[1] / length, a[2] / length];
};

// v turned by the rotation that takes the direction a to the direction b (both unit length): a frame carried round a
// bend without twisting (Rodrigues' formula). Going straight on or doubling back, v stays as it is (a turn of 180° is
// taken about v itself, at right angles to a).
const carry = (v, a, b) => {
  const scaledAxis = cross(a, b),
    sin = len(scaledAxis),
    cos = dot(a, b);
  if (sin < 1e-9) return v;
  const axis = mulv(scaledAxis, 1 / sin);
  return add(add(mulv(v, cos), mulv(cross(axis, v), sin)), mulv(axis, dot(axis, v) * (1 - cos)));
};

const M = {
  id: () => {
    const m = new Float32Array(16);
    m[0] = m[5] = m[10] = m[15] = 1;
    return m;
  },
  // (into out when given: a matrix reused, no garbage)
  mul(a, b, out = new Float32Array(16)) {
    for (let column = 0; column < 4; column++)
      for (let row = 0; row < 4; row++) {
        out[column * 4 + row] =
          a[row] * b[column * 4] +
          a[4 + row] * b[column * 4 + 1] +
          a[8 + row] * b[column * 4 + 2] +
          a[12 + row] * b[column * 4 + 3];
      }
    return out;
  },
  persp(fovY, aspect, near, far) {
    const focal = 1 / Math.tan(fovY / 2),
      m = new Float32Array(16);
    m[0] = focal / aspect;
    m[5] = focal;
    m[10] = (far + near) / (near - far);
    m[11] = -1;
    m[14] = (2 * far * near) / (near - far);
    return m;
  },
  ortho(left, right, bottom, top, near, far) {
    const m = M.id();
    m[0] = 2 / (right - left);
    m[5] = 2 / (top - bottom);
    m[10] = -2 / (far - near);
    m[12] = -(right + left) / (right - left);
    m[13] = -(top + bottom) / (top - bottom);
    m[14] = -(far + near) / (far - near);
    return m;
  },
  look(eye, target, up) {
    const z = norm(sub(eye, target)),
      x = norm(cross(up, z)),
      y = cross(z, x),
      m = M.id();
    m[0] = x[0];
    m[4] = x[1];
    m[8] = x[2];
    m[1] = y[0];
    m[5] = y[1];
    m[9] = y[2];
    m[2] = z[0];
    m[6] = z[1];
    m[10] = z[2];
    m[12] = -dot(x, eye);
    m[13] = -dot(y, eye);
    m[14] = -dot(z, eye);
    return m;
  },
  trans(offset) {
    const m = M.id();
    m[12] = offset[0];
    m[13] = offset[1];
    m[14] = offset[2];
    return m;
  },
  rotX(angle) {
    const m = M.id(),
      cos = Math.cos(angle),
      sin = Math.sin(angle);
    m[5] = cos;
    m[6] = sin;
    m[9] = -sin;
    m[10] = cos;
    return m;
  },
  rotY(angle) {
    const m = M.id(),
      cos = Math.cos(angle),
      sin = Math.sin(angle);
    m[0] = cos;
    m[2] = -sin;
    m[8] = sin;
    m[10] = cos;
    return m;
  },
  rotZ(angle) {
    const m = M.id(),
      cos = Math.cos(angle),
      sin = Math.sin(angle);
    m[0] = cos;
    m[1] = sin;
    m[4] = -sin;
    m[5] = cos;
    return m;
  },
  scale(factors) {
    const m = M.id();
    m[0] = factors[0];
    m[5] = factors[1];
    m[10] = factors[2];
    return m;
  },
  // translate · rotate (x, then y, then z, degrees) · scale
  trs(offset, rotation, scale) {
    let m = M.trans(offset || [0, 0, 0]);
    if (rotation)
      m = M.mul(
        m,
        M.mul(
          M.rotZ((rotation[2] || 0) * D2R),
          M.mul(M.rotY((rotation[1] || 0) * D2R), M.rotX((rotation[0] || 0) * D2R)),
        ),
      );
    if (scale != null) m = M.mul(m, M.scale(typeof scale === 'number' ? [scale, scale, scale] : scale));
    return m;
  },
  invert(m) {
    const a = m,
      out = new Float32Array(16);
    const b00 = a[0] * a[5] - a[1] * a[4],
      b01 = a[0] * a[6] - a[2] * a[4],
      b02 = a[0] * a[7] - a[3] * a[4],
      b03 = a[1] * a[6] - a[2] * a[5];
    const b04 = a[1] * a[7] - a[3] * a[5],
      b05 = a[2] * a[7] - a[3] * a[6],
      b06 = a[8] * a[13] - a[9] * a[12],
      b07 = a[8] * a[14] - a[10] * a[12];
    const b08 = a[8] * a[15] - a[11] * a[12],
      b09 = a[9] * a[14] - a[10] * a[13],
      b10 = a[9] * a[15] - a[11] * a[13],
      b11 = a[10] * a[15] - a[11] * a[14];
    let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
    if (!det) return M.id();
    det = 1 / det;
    out[0] = (a[5] * b11 - a[6] * b10 + a[7] * b09) * det;
    out[1] = (a[2] * b10 - a[1] * b11 - a[3] * b09) * det;
    out[2] = (a[13] * b05 - a[14] * b04 + a[15] * b03) * det;
    out[3] = (a[10] * b04 - a[9] * b05 - a[11] * b03) * det;
    out[4] = (a[6] * b08 - a[4] * b11 - a[7] * b07) * det;
    out[5] = (a[0] * b11 - a[2] * b08 + a[3] * b07) * det;
    out[6] = (a[14] * b02 - a[12] * b05 - a[15] * b01) * det;
    out[7] = (a[8] * b05 - a[10] * b02 + a[11] * b01) * det;
    out[8] = (a[4] * b10 - a[5] * b08 + a[7] * b06) * det;
    out[9] = (a[1] * b08 - a[0] * b10 - a[3] * b06) * det;
    out[10] = (a[12] * b04 - a[13] * b02 + a[15] * b00) * det;
    out[11] = (a[9] * b02 - a[8] * b04 - a[11] * b00) * det;
    out[12] = (a[5] * b07 - a[4] * b09 - a[6] * b06) * det;
    out[13] = (a[0] * b09 - a[1] * b07 + a[2] * b06) * det;
    out[14] = (a[13] * b01 - a[12] * b03 - a[14] * b00) * det;
    out[15] = (a[8] * b03 - a[9] * b01 + a[10] * b00) * det;
    return out;
  },
  pt(m, p) {
    return [
      m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
      m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
      m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
    ];
  },
  dir(m, v) {
    return [
      m[0] * v[0] + m[4] * v[1] + m[8] * v[2],
      m[1] * v[0] + m[5] * v[1] + m[9] * v[2],
      m[2] * v[0] + m[6] * v[1] + m[10] * v[2],
    ];
  },
  // a point through a view-projection: screen pixels, or null if behind the eye
  project(viewProjection, p, width, height) {
    const m = viewProjection,
      x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
      y = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
      w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
    return w <= 0 ? null : [((x / w) * 0.5 + 0.5) * width, (1 - ((y / w) * 0.5 + 0.5)) * height, w];
  },
};
function rgb(hex) {
  const digits = String(hex || '#999').replace('#', ''),
    full =
      digits.length === 3
        ? digits
            .split('')
            .map((digit) => digit + digit)
            .join('')
        : digits;
  return [
    parseInt(full.slice(0, 2), 16) / 255,
    parseInt(full.slice(2, 4), 16) / 255,
    parseInt(full.slice(4, 6), 16) / 255,
  ];
}
export { D2R, M, sub, add, mulv, dot, cross, len, norm, carry, rgb };
