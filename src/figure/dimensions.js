// @ts-check
// Dimensions on the figure, as on a technical drawing (the scene's `dimensions`): a length between two points, with
// extension lines out to a dimension line, arrows and its value; an angle at a vertex, an arc with arrows and its value
// in degrees. A point may ride on a part ({part, at}), so a length to a moving part changes as it moves; the value is
// worked out from the points as shown (in the scene's unit), unless the scene gives its text. Drawn after each picture
// over the canvas, an SVG path and an HTML value each, changed only where they moved; listed for screen readers with
// their values. Which show: the scene's own (not hidden), or the ones a step or the page names (state_.dimensions).
// Owns placeDimensions_; reads spec_, built_, state_, words_, host_, leaderSvg_ and tagLayer_, and calls part_ and project_.
import { M, sub, add, mulv, len, norm, dot } from '../math.js';

/** @param {import('./context').Ctx} c */
export function makeDimensions(c) {
  const dimensions = (c.spec_.dimensions || []).filter((dimension) => dimension && typeof dimension === 'object');
  c.placeDimensions_ = () => {};
  if (!dimensions.length) return;
  const forReaders = document.createElement('ul');
  forReaders.className = 'lk3d-sr';
  forReaders.setAttribute('aria-label', c.words_.dimensions);
  c.host_.append(forReaders);
  const drawn = dimensions.map((dimension) => {
    const path = /** @type {SVGPathElement} */ (document.createElementNS('http://www.w3.org/2000/svg', 'path')),
      value = document.createElement('div'),
      item = document.createElement('li');
    path.setAttribute('class', 'lk3d-dim');
    value.className = 'lk3d-dimtext';
    value.setAttribute('aria-hidden', 'true');
    c.leaderSvg_.append(path);
    c.tagLayer_.append(value);
    forReaders.append(item);
    return { dimension, path, value, item, d: '', at: '', text: '', shown: true };
  });

  // a point as shown: [x, y, z], or one a part carries, through the part's matrix; null where that part is out of sight
  /** @param {any} point */
  const placed = (point) => {
    if (Array.isArray(point)) return point;
    const part = point && c.part_(point.part);
    return part && !part.hidden ? M.pt(part.matrix, point.at) : null;
  };
  // a value in words: three significant figures (or the scene's digits), the locale's decimal mark, the unit
  /** @param {number} number @param {number | undefined} digits */
  const METRES = { mm: 0.001, cm: 0.01, dm: 0.1, m: 1, km: 1000 };
  const say = (number, digits) =>
    (digits == null ? String(+number.toPrecision(3)) : number.toFixed(digits)).replace('.', c.words_.decimal);
  // an arrowhead at the stage point tip, pointing along direction (from the inside of the line to the tip)
  /** @param {number[]} tip @param {number[]} along */
  const arrow = (tip, along) => {
    const length = Math.hypot(along[0], along[1]) || 1,
      [x, y] = [along[0] / length, along[1] / length],
      side = (sign) => [tip[0] - 7 * (x * 0.91 - sign * y * 0.42), tip[1] - 7 * (y * 0.91 + sign * x * 0.42)];
    const [a, b] = [side(1), side(-1)];
    return `M${a[0].toFixed(1)} ${a[1].toFixed(1)}L${tip[0].toFixed(1)} ${tip[1].toFixed(1)}L${b[0].toFixed(1)} ${b[1].toFixed(1)}`;
  };
  /** @param {number[][]} points */
  const line = (points) => 'M' + points.map((point) => `${point[0].toFixed(1)} ${point[1].toFixed(1)}`).join('L');

  c.placeDimensions_ = () => {
    const wanted = c.state_.dimensions;
    for (const each of drawn) {
      const dimension = each.dimension,
        named = wanted ? dimension.id != null && wanted.includes(dimension.id) : !dimension.hidden;
      let d = '',
        /** @type {number[] | null} */
        at = null,
        text = '';
      if (named && dimension.angle) {
        const [a, vertex, b] = dimension.angle.map(placed);
        if (a && vertex && b) {
          const u = sub(a, vertex),
            w = sub(b, vertex),
            theta = Math.acos(Math.max(-1, Math.min(1, dot(norm(u), norm(w))))),
            radius = dimension.radius ?? Math.min(len(u), len(w)) / 3,
            // (points along the arc, from one arm to the other: a slerp, or a half turn round a side when straight)
            arc = Array.from({ length: 17 }, (_, k) => {
              const t = k / 16,
                s = Math.sin(theta) || 1e-6;
              return add(
                vertex,
                mulv(add(mulv(norm(u), Math.sin((1 - t) * theta) / s), mulv(norm(w), Math.sin(t * theta) / s)), radius),
              );
            }).map((point) => c.project_(point));
          if (theta > 1e-3 && theta < Math.PI - 1e-3 && arc.every(Boolean)) {
            const onStage = /** @type {number[][]} */ (arc);
            d =
              line(onStage) +
              arrow(onStage[0], sub(onStage[0], onStage[1])) +
              arrow(onStage[16], sub(onStage[16], onStage[15]));
            const ends = [c.project_(vertex), c.project_(a), c.project_(b)];
            if (dimension.arms && ends.every(Boolean)) {
              const [v, p, q] = /** @type {number[][]} */ (ends);
              d += line([p, v, q]);
            }
            const middle = add(vertex, mulv(norm(add(norm(u), norm(w))), radius * 1.35));
            at = c.project_(middle);
            text = dimension.text ?? say((theta * 180) / Math.PI, dimension.digits ?? (theta < 0.17 ? 1 : 0)) + '°';
          }
        }
      } else if (named) {
        const from = placed(dimension.from),
          to = placed(dimension.to);
        if (from && to) {
          const offset = dimension.offset || [0, 0, 0],
            [a, b, a2, b2] = [from, to, add(from, offset), add(to, offset)].map((point) => c.project_(point));
          if (a && b && a2 && b2) {
            if (len(offset) > 0)
              for (const [object, onLine] of [
                [a, a2],
                [b, b2],
              ]) {
                // (an extension line: a small gap at the object, past the dimension line a little)
                const along = sub(onLine, object),
                  pixels = Math.hypot(along[0], along[1]) || 1,
                  step = mulv(along, 1 / pixels);
                d += line([add(object, mulv(step, 3)), add(onLine, mulv(step, 5))]);
              }
            d += line([a2, b2]) + arrow(a2, sub(a2, b2)) + arrow(b2, sub(b2, a2));
            at = mulv(add(a2, b2), 0.5);
            const unit = dimension.unit || c.spec_.unit,
              // (in the scene's unit, or converted to the dimension's own)
              factor = dimension.unit && c.spec_.unit ? METRES[c.spec_.unit] / METRES[dimension.unit] : 1;
            text = dimension.text ?? say(len(sub(to, from)) * factor, dimension.digits) + (unit ? ' ' + unit : '');
          }
        }
      }
      const show = !!(d && at);
      if (show !== each.shown) {
        each.path.style.display = each.value.style.display = show ? '' : 'none';
        each.shown = show;
      }
      if (!show || !at) continue;
      if (d !== each.d) each.path.setAttribute('d', (each.d = d));
      const place = `translate(${at[0].toFixed(1)}px, ${at[1].toFixed(1)}px) translate(-50%, -50%)`;
      if (place !== each.at) each.value.style.transform = each.at = place;
      if (text !== each.text) {
        each.value.textContent = each.text = text;
        each.item.textContent = (dimension.name ? dimension.name + ': ' : '') + text;
      }
    }
  };
}
