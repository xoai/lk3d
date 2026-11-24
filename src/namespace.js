// @ts-check
// The LK3D object: the page API's entry (index.js puts mount on it) and the settings every figure reads live, so a
// page may change them at any time (defaults, locales, themes, reduce, and toGLB, set by the exporter).
import { buildScene, flatten, useModels, modelsMissing, modelsError } from './geometry.js';
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
  // for tests and tools: the geometry a scene makes, without a page (each part also as one plain geometry, g);
  // maxTriangles: the most triangles it may have (10 million)
  /** @param {import('../scene').Scene} spec @param {number} [quality] @param {number} [maxTriangles] */
  build(spec, quality = 1, maxTriangles) {
    const missing = modelsMissing(spec);
    if (missing) throw modelsError(missing);
    const built = buildScene(spec, quality, maxTriangles);
    for (const part of built.parts)
      Object.defineProperty(part, 'g', {
        get() {
          return this._flat || (this._flat = flatten(this));
        },
      });
    return built;
  },
  safeHTML,
  // the glTF reader, given by the models add-on (dist/lk3d-models.min.js) or the ES module (models.js); core.js wraps it
  // so that figures refused for want of it are drawn again
  useModels,
  version: 3, // (the page API's version: it goes up when a page's own code must change; 3: models need the add-on)
  // the version of what the core lends the live add-on (surfaces, arrows): an add-on made for another refuses to run
  hostVersion: 1,
  // every name a figure lends its add-ons (additions.js, c.lent_), known before any figure exists: LK3D.use checks an
  // add-on's needs against it when the add-on loads (a unit test keeps the two the same)
  hostNames: (
    'hostVersion M kick renderer add remove upload instances refill part rod unit outlines ramp tone dark taken ' +
    'triangles maxTriangles gone stage words html chosen letGo steps stepAt goToStep view frame cancelView motions ' +
    'setMotion playMotion stopMotion playing towards locked panel say cleanups rule animate explode state parts spec given'
  ).split(' '),
  // (for lk3d's own tests and tools, and the models add-on, which takes its matrices from here; not part of the API)
  M,
  refreshFrom,
};
export default LK3D;
