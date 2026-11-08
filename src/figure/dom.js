// @ts-check
// A figure's elements (the stage, the canvas's words for screen readers, the list of parts, the overlays for labels
// and their leader lines, the hint, the mark, the scale, the credits) and the info box with what is said aloud. Owns
// stage_, leaderSvg_, tagLayer_, hint_, scaleEl_, namedParts_ and showInfo_; reads host_, canvas_, spec_, opts_,
// built_, state_ and words_, and calls part_.

// a part's name and note as HTML: plain text, keeping only bare b, i, em, strong, sub, sup and br (scenes may come
// from anyone; character references are kept, they cannot run anything)
/** @param {unknown} s */
export const safeHTML = (s) =>
  String(s ?? '')
    .replace(/&(?!#?\w+;)/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/&lt;(\/?)(b|i|em|strong|sub|sup|br) ?\/?&gt;/gi, '<$1$2>');

// the same as plain text (what a label is measured by and a screen reader names)
/** @param {unknown} s */
export const plainText = (s) => {
  const d = document.createElement('div');
  d.innerHTML = safeHTML(s);
  return d.textContent;
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
      const e = document.createElement(tag);
      e.className = 'lk3d-sr';
      if (text) e.textContent = text;
      return e;
    },
    uid = 'lk3d-' + ++mounted,
    keys = forReaders('p', c.words_.keys),
    said = forReaders('p'),
    named = (c.namedParts_ = c.built_.parts.filter((p) => p.name));
  keys.id = uid + '-keys';
  c.canvas_.setAttribute('aria-describedby', keys.id);
  said.setAttribute('aria-live', 'polite');
  const list = forReaders('ul');
  list.setAttribute('aria-label', c.words_.parts);
  for (const p of named) {
    const li = document.createElement('li');
    li.textContent = plainText(p.name) + (p.note ? ': ' + plainText(p.note) : '');
    list.append(li);
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
  const scaleEl = (c.scaleEl_ = c.spec_.scale ? document.createElement('div') : null);
  if (scaleEl) {
    scaleEl.className = 'lk3d-scale';
    scaleEl.innerHTML =
      (c.spec_.scale.bar ? '<span class="lk3d-bar-line"></span><span class="lk3d-bar-label"></span>' : '') +
      (c.spec_.scale.note ? '<span class="lk3d-note"></span>' : '');
    if (c.spec_.scale.bar) scaleEl.querySelector('.lk3d-bar-label').textContent = c.spec_.scale.bar.label;
    if (c.spec_.scale.note) scaleEl.querySelector('.lk3d-note').textContent = c.spec_.scale.note;
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
      const web = /^https?:\/\//i.test(url),
        a = /** @type {HTMLAnchorElement} */ (document.createElement(web ? 'a' : 'span'));
      a.textContent = text;
      if (web) {
        a.href = url;
        a.target = '_blank';
        a.rel = 'noopener';
      }
      return a;
    };
    if (c.spec_.author) credit.append('© ', link(c.spec_.author, c.spec_.url));
    if (c.spec_.license) credit.append((c.spec_.author ? ', ' : '') + c.spec_.license);
    if (whose && models.length) credit.append('. ');
    if (models.length) credit.append(c.words_.credit);
    models.forEach(([name, m], k) => {
      if (k) credit.append('; ');
      credit.append(
        link(m.title || name, m.url),
        `, ${m.author}, ${m.license}` + (m.source === 'ai' ? c.words_.ai : ''),
      );
    });
    c.host_.append(credit);
  }

  // the info box: the part chosen, else the one under the pointer. why: 'pick' (the reader chose a part: onPick),
  // 'hover' (the pointer moved onto or off a part: onHover), or nothing (a page's own select(), the first picture)
  c.showInfo_ = (why) => {
    const id = c.state_.selected || c.state_.hover,
      p = c.part_(id);
    if (c.opts_.info)
      c.opts_.info.innerHTML = p
        ? `<b>${safeHTML(p.name)}</b>${p.note ? ' ' + safeHTML(p.note) : ''}`
        : safeHTML(c.opts_.infoIdle);
    if (why === 'pick') said.textContent = p ? plainText(p.name) + (p.note ? ': ' + plainText(p.note) : '') : '';
    const callback = why === 'pick' ? c.opts_.onPick : why === 'hover' ? c.opts_.onHover : null;
    if (callback) callback(why === 'hover' ? c.part_(c.state_.hover) || null : p || null);
  };
}
