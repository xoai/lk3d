// @ts-check
// Labels and their leader lines (HTML and SVG over the canvas, measured once, moved with transforms), and the scale
// bar. Owns labelWidths_ and placeLabels_ (the frame loop calls it after each picture); reads built_, state_, spec_,
// tagLayer_, leaderSvg_, scaleEl_, lookKey_, width_ and height_, and calls project_, cutPlane_, explodeShift_, baseMatrix_ and
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
  for (const part of c.built_.parts)
    if (part.name && part.label !== false) tags.push({ part, element: null, x: -1, y: -1, shown: false, lit: false });
  const elementOf = (tag) => {
    if (!tag.element) {
      const element = (tag.element = document.createElement('div'));
      element.className = 'lk3d-tag';
      element.innerHTML = safeHTML(tag.part.name); // (H<sub>2</sub>O, as in the info box)
      element.dataset.id = tag.part.id;
      element.style.display = 'none';
      c.tagLayer_.append(element);
    }
    return tag.element;
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
      key = lookKey + tag.part.id;
    if (widths[key] == null) {
      if (!boxByLook[lookKey] || !widths.__box) {
        const style = getComputedStyle(elementOf(tag)),
          pixels = (value) => parseFloat(value) || 0;
        boxByLook[lookKey] = {
          font: `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`,
          pad:
            pixels(style.paddingLeft) +
            pixels(style.paddingRight) +
            pixels(style.borderLeftWidth) +
            pixels(style.borderRightWidth) +
            1,
          spacing: pixels(style.letterSpacing),
        };
        widths.__box = true;
      }
      const box = boxByLook[lookKey];
      const text = (tag.plain ??= plainText(tag.part.name));
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
    const start = c.project_(target),
      end = c.project_(add(target, mulv(across, bar.length)));
    const barPixels = start && end ? Math.hypot(end[0] - start[0], end[1] - start[1]) : 0;
    /** @type {HTMLElement} */ (c.scaleEl_.firstChild).style.transform = `scaleX(${(barPixels / 100).toFixed(3)})`;
  }
  const show = (tag, visible) => {
    if (visible !== tag.shown) {
      elementOf(tag).style.display = visible ? '' : 'none';
      tag.shown = visible;
    }
  };
  // ---- leader lines: a line and a dot for each label shown, made once and kept; a frame changes only the ends that
  // moved and hides the ones it no longer needs (never a rebuild of the SVG, which would make every element again)
  const leaders = [],
    svgElement = (name) => /** @type {SVGElement} */ (document.createElementNS('http://www.w3.org/2000/svg', name));
  /** @param {number} index @param {string} anchorX @param {string} anchorY @param {number} edgeX @param {number} edgeY */
  function placeLeader(index, anchorX, anchorY, edgeX, edgeY) {
    // (from the part's anchor, the dot, to the label's edge)
    let leader = leaders[index];
    if (!leader) {
      leader = leaders[index] = { line: svgElement('line'), dot: svgElement('circle'), at: '' };
      leader.dot.setAttribute('r', '2.2');
      c.leaderSvg_.append(leader.line, leader.dot);
    }
    const at = `${anchorX} ${anchorY} ${edgeX} ${edgeY}`;
    if (at === leader.at) return;
    if (!leader.at) leader.line.style.display = leader.dot.style.display = '';
    const set = (element, name, value) => element.setAttribute(name, value);
    set(leader.line, 'x1', anchorX);
    set(leader.line, 'y1', anchorY);
    set(leader.line, 'x2', edgeX);
    set(leader.line, 'y2', edgeY);
    set(leader.dot, 'cx', anchorX);
    set(leader.dot, 'cy', anchorY);
    leader.at = at;
  }
  c.placeLabels_ = () => {
    scaleBar();
    const width = c.width_,
      height = c.height_;
    // which tags show: 'all'; 'auto' (the part pointed at or chosen, and all of them once the model is well apart);
    // 'none'; or a list of parts and groups (exactly theirs, each shown even where it cannot find a free place)
    const which = c.state_.labels,
      chosen = Array.isArray(which) && ((part) => which.includes(part.id) || which.includes(part.group)),
      wanted = (part) =>
        !part.hidden &&
        part.drawAlpha > 0.05 &&
        (chosen
          ? chosen(part)
          : which === 'all' ||
            part.id === c.state_.hover ||
            part.id === c.state_.selected ||
            (which === 'auto' && c.state_.explode > 0.45));
    const middle = c.project_(add(c.built_.center, c.explodeShift_())) || [width / 2, height / 2];
    const items = [],
      plane = c.state_.cut ? c.cutPlane_() : null;
    for (const tag of tags) {
      // the part's anchor on the stage, if its label is wanted (a spinning part's label stays put), and not cut away
      // (a label pointing at nothing once the cut has passed its place)
      const anchor = M.pt(
          tag.part.spin || tag.part.handleOf?.round ? c.baseMatrix_(tag.part) : tag.part.matrix,
          tag.part.anchor,
        ),
        cutAway =
          plane && tag.part.cut && plane[0] * anchor[0] + plane[1] * anchor[1] + plane[2] * anchor[2] + plane[3] > 0;
      const at = which !== 'none' && wanted(tag.part) && !cutAway && c.project_(anchor);
      if (!at) {
        show(tag, false);
        continue;
      }
      // (a label goes outwards, away from the model's middle)
      let out = [at[0] - middle[0], at[1] - middle[1]];
      const length = Math.hypot(out[0], out[1]);
      out = length < 4 ? [0, -1] : [out[0] / length, out[1] / length];
      items.push({
        tag,
        at,
        x: at[0] + out[0] * 46,
        y: at[1] + out[1] * 34 - 8,
        right: out[0] >= 0,
        first: tag.part.id === c.state_.hover || tag.part.id === c.state_.selected,
        size: len(sub(tag.part.max, tag.part.min)),
      });
    }
    // labels placed one by one: the part pointed at or chosen first, then the largest parts; a label that would overlap
    // one already placed tries a line or two up and down, and otherwise waits until the reader points at its part (a
    // model of a hundred parts would bury itself in labels)
    items.sort((a, b) => b.first - a.first || b.size - a.size);
    const placed = [];
    for (const item of items) {
      const tag = item.tag,
        labelWidth = widthOf(tag),
        x = Math.round(Math.max(2, Math.min(width - labelWidth - 2, item.right ? item.x : item.x - labelWidth)));
      /** @type {number | null} */
      let y = null;
      for (const dy of [0, 22, -22, 44, -44]) {
        const tryY = Math.round(Math.max(2, Math.min(height - 22, item.y + dy)));
        if (
          !placed.some(
            (other) =>
              x < other.x + other.width + 4 &&
              other.x < x + labelWidth + 4 &&
              tryY < other.y + 22 &&
              other.y < tryY + 22,
          )
        ) {
          y = tryY;
          break;
        }
      }
      if (y == null && (item.first || chosen)) y = Math.round(Math.max(2, Math.min(height - 22, item.y)));
      show(tag, y != null);
      if (y == null) continue;
      placed.push({ x, y, width: labelWidth });
      if (x !== tag.x || y !== tag.y) {
        tag.element.style.transform = `translate(${x}px, ${y}px)`;
        tag.x = x;
        tag.y = y;
      }
      const lit = item.first;
      if (lit !== tag.lit) {
        tag.element.classList.toggle('on', lit);
        tag.lit = lit;
      }
      placeLeader(
        placed.length - 1,
        item.at[0].toFixed(1),
        item.at[1].toFixed(1),
        item.right ? x : x + labelWidth,
        y + 11,
      );
    }
    for (let index = placed.length; index < leaders.length && leaders[index].at; index++) {
      const leader = leaders[index];
      leader.line.style.display = leader.dot.style.display = 'none';
      leader.at = '';
    }
  };
}
