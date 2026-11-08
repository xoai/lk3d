// @ts-check
// Labels and their leader lines (HTML and SVG over the canvas, measured once, moved with transforms), and the scale
// bar. Owns labelWidths_ and placeLabels_ (the frame loop calls it after each picture); reads built_, state_, spec_,
// tagLayer_, leaderSvg_, scaleEl_, lookKey_, width_ and height_, and calls project_, explodeShift_, baseMatrix_ and
// kick_.
import { M, sub, add, mulv, len } from '../math.js';
import textWidth from '../text-width.js';
import { safeHTML, plainText } from './dom.js';

// ---- labels: HTML, so they are crisp, in the page's lettering and readable by screen readers; measured once
// (no layout reads while drawing), moved with transforms only when they actually move
// (a label's element is made the first time it is shown: a model of thousands of parts shows few at a time)
/** @param {import('./context').Ctx} c */
export function makeLabels(c) {
  // each named part's label: its element (once made), where it was last put, whether it shows and is lit
  const tags = [];
  for (const p of c.built_.parts)
    if (p.name && p.label !== false) tags.push({ p, el: null, x: -1, y: -1, shown: false, on: false });
  const elementOf = (tag) => {
    if (!tag.el) {
      const el = (tag.el = document.createElement('div'));
      el.className = 'lk3d-tag';
      el.innerHTML = safeHTML(tag.p.name); // (H<sub>2</sub>O, as in the info box)
      el.dataset.id = tag.p.id;
      el.style.display = 'none';
      c.tagLayer_.append(el);
    }
    return tag.el;
  };
  c.labelWidths_ = {};
  const unhook = textWidth.onFontsChanged(() => {
    c.labelWidths_ = {};
    for (const tag of tags) tag.x = -1;
    c.kick_();
  });
  c.cleanups_.push(unhook);
  // a tag's width: its text measured once in the tag's own font, plus its padding and border, read once per look and
  // layout (they differ on a phone; __box in the widths says they were read since the widths were last emptied); never
  // a layout read while drawing
  const boxByLook = {};
  function widthOf(tag) {
    const lookKey = c.lookKey_,
      widths = c.labelWidths_,
      key = lookKey + tag.p.id;
    if (widths[key] == null) {
      if (!boxByLook[lookKey] || !widths.__box) {
        const cs = getComputedStyle(elementOf(tag)),
          px = (v) => parseFloat(v) || 0;
        boxByLook[lookKey] = {
          font: `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`,
          pad: px(cs.paddingLeft) + px(cs.paddingRight) + px(cs.borderLeftWidth) + px(cs.borderRightWidth) + 1,
          spacing: px(cs.letterSpacing),
        };
        widths.__box = true;
      }
      const box = boxByLook[lookKey];
      const text = (tag.plain ??= plainText(tag.p.name));
      widths[key] = textWidth(text, box.font) + box.spacing * text.length + box.pad;
    }
    return widths[key];
  }
  function scaleBar() {
    // the bar's on-screen length: its scene length, projected at the point the camera looks at
    const bar = c.spec_.scale?.bar;
    if (!c.scaleEl_ || !bar) return;
    const target = add(c.state_.target, c.explodeShift_()),
      across = [Math.cos(c.state_.yaw), 0, -Math.sin(c.state_.yaw)]; // (level, across the view)
    const a = c.project_(target),
      b = c.project_(add(target, mulv(across, bar.length)));
    const px = a && b ? Math.hypot(b[0] - a[0], b[1] - a[1]) : 0;
    /** @type {HTMLElement} */ (c.scaleEl_.firstChild).style.transform = `scaleX(${(px / 100).toFixed(3)})`;
  }
  const show = (tag, on) => {
    if (on !== tag.shown) {
      elementOf(tag).style.display = on ? '' : 'none';
      tag.shown = on;
    }
  };
  // ---- leader lines: a line and a dot for each label shown, made once and kept; a frame changes only the ends that
  // moved and hides the ones it no longer needs (never a rebuild of the SVG, which would make every element again)
  const leaders = [],
    svgEl = (name) => /** @type {SVGElement} */ (document.createElementNS('http://www.w3.org/2000/svg', name));
  /** @param {number} n @param {string} ax @param {string} ay @param {number} ex @param {number} ey */
  function leader(n, ax, ay, ex, ey) {
    // (from the part's anchor a, the dot, to the label's edge e)
    let l = leaders[n];
    if (!l) {
      l = leaders[n] = { line: svgEl('line'), dot: svgEl('circle'), at: '' };
      l.dot.setAttribute('r', '2.2');
      c.leaderSvg_.append(l.line, l.dot);
    }
    const at = `${ax} ${ay} ${ex} ${ey}`;
    if (at === l.at) return;
    if (!l.at) l.line.style.display = l.dot.style.display = '';
    const set = (e, k, v) => e.setAttribute(k, v);
    set(l.line, 'x1', ax);
    set(l.line, 'y1', ay);
    set(l.line, 'x2', ex);
    set(l.line, 'y2', ey);
    set(l.dot, 'cx', ax);
    set(l.dot, 'cy', ay);
    l.at = at;
  }
  c.placeLabels_ = () => {
    scaleBar();
    const W = c.width_,
      H = c.height_;
    // which tags show: 'all'; 'auto' (the part pointed at or chosen, and all of them once the model is well apart);
    // 'none'; or a list of parts and groups (exactly theirs, each shown even where it cannot find a free place)
    const which = c.state_.labels,
      chosen = Array.isArray(which) && ((p) => which.includes(p.id) || which.includes(p.group)),
      wanted = (p) =>
        !p.hidden &&
        p.drawAlpha > 0.05 &&
        (chosen
          ? chosen(p)
          : which === 'all' ||
            p.id === c.state_.hover ||
            p.id === c.state_.selected ||
            (which === 'auto' && c.state_.explode > 0.45));
    const middle = c.project_(add(c.built_.center, c.explodeShift_())) || [W / 2, H / 2];
    const items = [];
    for (const tag of tags) {
      // the part's anchor on the stage, if its label is wanted (a spinning part's label stays put)
      const at =
        which !== 'none' &&
        wanted(tag.p) &&
        c.project_(M.pt(tag.p.spin || tag.p.handleOf?.round ? c.baseMatrix_(tag.p) : tag.p.m, tag.p.anchor));
      if (!at) {
        show(tag, false);
        continue;
      }
      // (a label goes outwards, away from the model's middle)
      let out = [at[0] - middle[0], at[1] - middle[1]];
      const l = Math.hypot(out[0], out[1]);
      out = l < 4 ? [0, -1] : [out[0] / l, out[1] / l];
      items.push({
        tag,
        at,
        x: at[0] + out[0] * 46,
        y: at[1] + out[1] * 34 - 8,
        right: out[0] >= 0,
        first: tag.p.id === c.state_.hover || tag.p.id === c.state_.selected,
        size: len(sub(tag.p.hi, tag.p.lo)),
      });
    }
    // labels placed one by one: the part pointed at or chosen first, then the largest parts; a label that would overlap
    // one already placed tries a line or two up and down, and otherwise waits until the reader points at its part (a
    // model of a hundred parts would bury itself in labels)
    items.sort((u, v) => v.first - u.first || v.size - u.size);
    const placed = [];
    for (const item of items) {
      const tag = item.tag,
        w = widthOf(tag),
        x = Math.round(Math.max(2, Math.min(W - w - 2, item.right ? item.x : item.x - w)));
      /** @type {number | null} */
      let y = null;
      for (const dy of [0, 22, -22, 44, -44]) {
        const tryY = Math.round(Math.max(2, Math.min(H - 22, item.y + dy)));
        if (!placed.some((r) => x < r.x + r.w + 4 && r.x < x + w + 4 && tryY < r.y + 22 && r.y < tryY + 22)) {
          y = tryY;
          break;
        }
      }
      if (y == null && (item.first || chosen)) y = Math.round(Math.max(2, Math.min(H - 22, item.y)));
      show(tag, y != null);
      if (y == null) continue;
      placed.push({ x, y, w });
      if (x !== tag.x || y !== tag.y) {
        tag.el.style.transform = `translate(${x}px, ${y}px)`;
        tag.x = x;
        tag.y = y;
      }
      const on = item.first;
      if (on !== tag.on) {
        tag.el.classList.toggle('on', on);
        tag.on = on;
      }
      leader(placed.length - 1, item.at[0].toFixed(1), item.at[1].toFixed(1), item.right ? x : x + w, y + 11);
    }
    for (let n = placed.length; n < leaders.length && leaders[n].at; n++) {
      const l = leaders[n];
      l.line.style.display = l.dot.style.display = 'none';
      l.at = '';
    }
  };
}
