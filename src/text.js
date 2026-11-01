// How wide a label is, without asking the page layout: canvas text metrics, measured once per label and cached (the
// measure-once idea of pretext), so drawing a frame never forces the page to lay itself out.
let ctx = null;
const cache = new Map(), listeners = new Set();
function textWidth(text, font) {
  const k = font + '\u0000' + text;
  let w = cache.get(k);
  if (w == null) {
    ctx = ctx || (typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1) : document.createElement('canvas')).getContext('2d');
    ctx.font = font; w = ctx.measureText(text).width; cache.set(k, w);
  }
  return w;
}
// widths measured before a web font finished loading are wrong: measure again once it has
if (typeof document !== 'undefined' && document.fonts && document.fonts.addEventListener) {
  document.fonts.addEventListener('loadingdone', () => { cache.clear(); for (const f of listeners) f(); });
}
textWidth.onFontsChanged = (f) => { listeners.add(f); return () => listeners.delete(f); };
export default textWidth;
