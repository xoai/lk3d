// @ts-check
// The card over a figure's stage (mount's card option): the part the reader chose, as a panel on the right (a sheet at
// the bottom of a narrow screen): a small line over its name (its group or role), the name, its note, rows of values
// the page fills (fig.card: live numbers), and where it all comes from. Its × and Escape let the part go and give the
// keys back to the canvas; nothing holds the focus in it. Given to the core as LK3D.live.card by the live add-on
// (live-script.js, dist/lk3d-live.min.js) and the ES module (index.js), made with what the figure lends (its host:
// additions.js), never from the figure's own fields; it imports no module of the core.

/** @typedef {any} Host */

// its look, added to the page once: the figure's colours (--lk3d-paper, --lk3d-ink, --lk3d-line under a theme), so it
// follows the page, the figure's theme and, in the realistic look, goes dark as the labels do
const CSS = `
.lk3d-card{position:absolute; top:12px; right:12px; width:min(330px, 46%); max-height:calc(100% - 24px); overflow:auto; box-sizing:border-box; padding:12px 16px; font-size:14px; line-height:1.45;
  background:var(--lk3d-paper, #f7f5ef); color:var(--lk3d-ink, #1d1a1e); border:1px solid var(--lk3d-line, var(--lk3d-ink, #1d1a1e)); border-radius:10px; box-shadow:0 6px 24px #0002}
.lk3d-stage[data-look="studio"]:not([data-theme]) .lk3d-card{background:rgba(14,18,24,.88); color:#eef2f7; border-color:rgba(255,255,255,.3)}
.lk3d-close{position:absolute; top:6px; right:6px; width:30px; height:30px; padding:0; border:0; background:none; color:inherit; font:20px/1 system-ui, sans-serif; cursor:pointer}
.lk3d-close:focus-visible{outline:2px solid var(--lk3d-accent, #2f5fb3)}
.lk3d-eyebrow, .lk3d-source{font-size:.9em; opacity:.72}
.lk3d-title{font-size:1.3em; font-weight:700; line-height:1.3; margin:1px 26px 4px 0}
.lk3d-card dl{margin:.7em 0 .4em} .lk3d-card dd{margin:0 0 0 auto; font-weight:700; text-align:right}
.lk3d-card dl div{display:flex; gap:12px; padding:.35em 0; border-top:1px solid #8884}
@media (max-width:620px){.lk3d-card{top:auto; left:8px; right:8px; bottom:8px; width:auto; max-height:62%; padding:8px 12px; font-size:13px}}
`;

/** @param {Host} host @returns {(added: Record<string, any> | null) => void} the card shown again: the chosen part's
 * own text (its name, its note, its scene card's eyebrow and source) under the page's (added: fig.card's) */
export function card(host) {
  if (!document.getElementById('lk3d-card-css')) {
    const style = document.createElement('style');
    style.id = 'lk3d-card-css';
    style.textContent = CSS;
    document.head.append(style);
  }
  const words = host.words,
    element = document.createElement('section'),
    close = document.createElement('button'),
    box = document.createElement('div');
  element.className = 'lk3d-card';
  element.hidden = true;
  close.className = 'lk3d-close';
  close.textContent = '×';
  close.setAttribute('aria-label', words.close);
  close.onclick = host.letGo;
  // (an on-handler that returns false cancels the key: Tab too)
  element.onkeydown = (event) => {
    if (event.key === 'Escape') host.letGo();
  };
  element.append(box, close); // (the × last: painted over the text, whose faint lines are layers of their own)
  host.stage.append(element);
  let shown = '';
  return (added) => {
    const part = host.chosen(),
      all = { ...part?.card, title: part?.name, body: part?.note, ...added },
      /** @param {string} key */
      line = (key) => (all[key] ? `<div class="lk3d-${key}">${host.html(all[key])}</div>` : ''),
      /** @param {unknown} value (a number with the locale's decimal mark; text as the page wrote it) */
      value = (value) => host.html(typeof value == 'number' ? String(value).replace('.', words.decimal) : value),
      rows = all.rows?.length
        ? `<dl>${all.rows.map(([name, said]) => `<div><dt>${value(name)}</dt><dd>${value(said)}</dd></div>`).join('')}</dl>`
        : '',
      html = part || added ? line('eyebrow') + line('title') + line('body') + rows + line('source') : '';
    // (the same card again changes nothing: a page may set its rows every frame)
    if (html !== shown) {
      box.innerHTML = shown = html;
      element.hidden = !html;
    }
  };
}
