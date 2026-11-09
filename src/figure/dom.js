// @ts-check
// A figure's elements (the stage, the canvas's words for screen readers, the list of parts, the overlays for labels
// and their leader lines, the hint, the mark, the scale, the credits) and the info box with what is said aloud. Owns
// stage_, leaderSvg_, tagLayer_, hint_, scaleEl_, namedParts_ and showInfo_; reads host_, canvas_, spec_, opts_,
// built_, state_ and words_, and calls part_.

// a part's name and note as HTML: plain text, keeping only bare b, i, em, strong, sub, sup and br (scenes may come
// from anyone; character references are kept, they cannot run anything)
/** @param {unknown} text */
export const safeHTML = (text) =>
  String(text ?? '')
    .replace(/&(?!#?\w+;)/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/&lt;(\/?)(b|i|em|strong|sub|sup|br) ?\/?&gt;/gi, '<$1$2>');

// the same as plain text (what a label is measured by and a screen reader names)
/** @param {unknown} text */
export const plainText = (text) => {
  const holder = document.createElement('div');
  holder.innerHTML = safeHTML(text);
  return holder.textContent;
};

let mounted = 0; // figures mounted on the page (ids for their screen-reader text)

/** @param {import('./context').Ctx} c */
export function makeDom(c) {
  c.host_.classList.add('lk3d');
  c.host_.innerHTML = '';
  const stage = (c.stage_ = document.createElement('div'));
  stage.className = 'lk3d-stage';
  c.canvas_.className = 'lk3d-canvas';
  c.canvas_.tabIndex = 0;
  // for screen readers: a figure worked by keys (arrows turn it, Page Down and Up go through its parts), described by
  // what those keys are; what the reader chooses is said aloud (a live region), and every named part is listed
  c.canvas_.setAttribute('role', 'application');
  c.canvas_.setAttribute('aria-roledescription', c.words_.model);
  c.canvas_.setAttribute('aria-label', c.spec_.alt || c.spec_.title || c.words_.model);
  /** @param {string} tag @param {string} [text] */
  const forReaders = (tag, text) => {
      const element = document.createElement(tag);
      element.className = 'lk3d-sr';
      if (text) element.textContent = text;
      return element;
    },
    uid = 'lk3d-' + ++mounted,
    keys = forReaders('p', c.words_.keys),
    said = forReaders('p'),
    named = (c.namedParts_ = c.built_.parts.filter((part) => part.name));
  keys.id = uid + '-keys';
  c.canvas_.setAttribute('aria-describedby', keys.id);
  said.setAttribute('aria-live', 'polite');
  const list = forReaders('ul');
  list.setAttribute('aria-label', c.words_.parts);
  for (const part of named) {
    const item = document.createElement('li');
    item.textContent = plainText(part.name) + (part.note ? ': ' + plainText(part.note) : '');
    list.append(item);
  }
  const leaderSvg = (c.leaderSvg_ = document.createElementNS('http://www.w3.org/2000/svg', 'svg'));
  leaderSvg.setAttribute('class', 'lk3d-lines');
  const tagLayer = (c.tagLayer_ = document.createElement('div'));
  tagLayer.className = 'lk3d-tags';
  const hint = (c.hint_ = document.createElement('div'));
  hint.className = 'lk3d-hint';
  hint.textContent = matchMedia('(pointer: coarse)').matches ? c.words_.hintTouch : c.words_.hintMouse;
  // the engine's name in the corner of every figure it draws: what drew it, in view with it (a screenshot keeps it)
  const mark = document.createElement('span');
  mark.className = 'lk3d-mark';
  mark.textContent = 'lk3d';
  // the scale, honestly: a bar that keeps its true length as the view zooms, and/or a note ("not to scale")
  const scale = c.spec_.scale,
    scaleEl = (c.scaleEl_ = scale ? document.createElement('div') : null);
  if (scale && scaleEl) {
    scaleEl.className = 'lk3d-scale';
    /** @param {string} className @param {string} [textContent] */
    const span = (className, textContent = '') =>
      Object.assign(document.createElement('span'), { className, textContent });
    if (scale.bar) scaleEl.append(span('lk3d-bar-line'), span('lk3d-bar-label', scale.bar.label));
    if (scale.note) scaleEl.append(span('lk3d-note', scale.note));
  }
  stage.append(c.canvas_, leaderSvg, tagLayer, hint, mark, ...(scaleEl ? [scaleEl] : []));
  c.host_.append(stage, keys, said, ...(named.length ? [list] : []));
  // under the figure: whose it is and on what terms (the scene's author and licence), then the models made by others,
  // their authors and licences (CC BY asks for it)
  const models = Object.entries(c.spec_.models || {}),
    whose = c.spec_.author || c.spec_.license;
  if (whose || models.length) {
    const credit = document.createElement('p');
    credit.className = 'lk3d-credit';
    // (a link only to a web page: not javascript: or data:, whatever the scene says)
    /** @param {string} text @param {string} [url] */
    const link = (text, url) => {
      const web = url !== undefined && /^https?:\/\//i.test(url),
        anchor = /** @type {HTMLAnchorElement} */ (document.createElement(web ? 'a' : 'span'));
      anchor.textContent = text;
      if (web) {
        anchor.href = url;
        anchor.target = '_blank';
        anchor.rel = 'noopener';
      }
      return anchor;
    };
    if (c.spec_.author) credit.append('© ', link(c.spec_.author, c.spec_.url));
    if (c.spec_.license) credit.append((c.spec_.author ? ', ' : '') + c.spec_.license);
    if (whose && models.length) credit.append('. ');
    if (models.length) credit.append(c.words_.credit);
    models.forEach(([name, model], index) => {
      if (index) credit.append('; ');
      credit.append(
        link(model.title || name, model.url),
        `, ${model.author}, ${model.license}` + (model.source === 'ai' ? c.words_.ai : ''),
      );
    });
    c.host_.append(credit);
  }

  // the info box: the part chosen, else the one under the pointer. why: 'pick' (the reader chose a part: onPick),
  // 'hover' (the pointer moved onto or off a part: onHover), or nothing (a page's own select(), the first picture)
  c.showInfo_ = (why) => {
    const id = c.state_.selected || c.state_.hover,
      part = c.part_(id);
    if (c.opts_.info)
      c.opts_.info.innerHTML = part
        ? `<b>${safeHTML(part.name)}</b>${part.note ? ' ' + safeHTML(part.note) : ''}`
        : safeHTML(c.opts_.infoIdle);
    if (why === 'pick')
      said.textContent = part ? plainText(part.name) + (part.note ? ': ' + plainText(part.note) : '') : '';
    const callback = why === 'pick' ? c.opts_.onPick : why === 'hover' ? c.opts_.onHover : null;
    if (callback) callback(why === 'hover' ? c.part_(c.state_.hover) || null : part || null);
  };
}
