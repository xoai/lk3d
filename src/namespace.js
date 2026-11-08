// @ts-check
// The LK3D object: the page API's entry (index.js puts mount on it) and the settings every figure reads live, so a
// page may change them at any time (defaults, locales, themes, reduce, and toGLB, set by the exporter).
import { buildScene, flatten } from './geometry.js';
import { M } from './math.js';
import { clock, refreshFrom } from './clock.js';
import { safeHTML } from './figure/dom.js';
import { THEMES } from './figure/look.js';
import en from './locales/en.js';
import vi from './locales/vi.js';

export const FORMAT = 1; // the version of the scene format this engine reads (a scene's "lk3d" field)

/** @type {any} (index.d.ts types it for pages) */
const LK3D = {
  mount: null, // (index.js: here first, as it always was)
  clock,
  format: FORMAT,
  locales: { en, vi },
  themes: THEMES,
  // settings for every figure on the page (a site sets them once): locale, strings, buttonClass
  defaults: { locale: 'en', strings: {}, buttonClass: '' },
  reduce: typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches,
  // for tests and tools: the geometry a scene makes, without a page (each part also as one plain geometry, g); most:
  // the most triangles it may have (10 million)
  /** @param {import('../scene').Scene} spec @param {number} [q] @param {number} [most] */
  build(spec, q = 1, most) {
    const S = buildScene(spec, q, most);
    for (const p of S.parts)
      Object.defineProperty(p, 'g', {
        get() {
          return this._g || (this._g = flatten(this));
        },
      });
    return S;
  },
  safeHTML,
  version: 2, // (the page API's version: it goes up when a page's own code must change)
  // (for lk3d's own tests and tools; not part of the API)
  M,
  refreshFrom,
};
export default LK3D;
