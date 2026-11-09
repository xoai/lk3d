// How wide a label is, without asking the page layout: canvas text metrics, measured once per label and cached (the
// measure-once idea of pretext), so drawing a frame never forces the page to lay itself out.
/** @type {CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null} */
let context = null;
const cache = new Map(),
  listeners = new Set();
function textWidth(text, font) {
  const key = font + '\u0000' + text;
  let width = cache.get(key);
  if (width == null) {
    context ||=
      (typeof OffscreenCanvas !== 'undefined' && new OffscreenCanvas(1, 1).getContext('2d')) ||
      document.createElement('canvas').getContext('2d');
    if (!context) return 8 * text.length; // (nothing to measure with: about 8 px a letter, not kept)
    context.font = font;
    width = context.measureText(text).width;
    cache.set(key, width);
  }
  return width;
}
// widths measured before a web font finished loading are wrong: measure again once it has
if (typeof document !== 'undefined' && document.fonts && document.fonts.addEventListener) {
  document.fonts.addEventListener('loadingdone', () => {
    cache.clear();
    for (const listener of listeners) listener();
  });
}
textWidth.onFontsChanged = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
export default textWidth;
