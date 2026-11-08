// @ts-check
// What draws a figure: its WebGL context (at most MAX_GL held by the figures of a page), the renderer on it, the 2D
// fallback, and a context given up, lost and restored. Owns renderer_, drawCanvas_, keptPicture_, contextLost_,
// glSlot_, fallback2d_, claimGL_ and gpuName_; reads host_, canvas_, opts_, built_, smallScreen_, spec_, lines_,
// width_ and height_, and calls kick_, drawNow_ and sizeCanvas_.
import { glRenderer } from '../renderer-gl.js';
import { canvasRenderer } from '../renderer-2d.js';

// Browsers keep only so many WebGL contexts (16 in Chrome) and lose the oldest past that. The figures holding one: at
// most MAX_GL, past which a figure coming near the screen takes the context of the one seen least recently (off screen)
const MAX_GL = 8;
/** @type {Set<import('./context').Slot>} */
export const holding = new Set();

/** @param {HTMLCanvasElement} canvas @param {import('./context').Options} opts @returns {any} */
function getContext(canvas, opts) {
  // a stencil buffer (where a cut's plane lies inside a solid: counted there, so its cap is drawn on the plane); the
  // rest as every browser has it by default, which lk3d relies on: antialiased, with alpha (every pass blends
  // premultiplied colour: the page shows through as it should), the drawing buffer not kept, the default GPU (these
  // scenes do not need to wake a laptop's second one)
  const attrs = { stencil: true };
  if (opts.force2d) return null;
  try {
    if (!opts.webgl1) {
      const gl2 = canvas.getContext('webgl2', attrs);
      if (gl2) return gl2;
    }
    return canvas.getContext('webgl', attrs);
  } catch (e) {
    return null;
  }
}

// the WebGL context: made at once (before the scene is built, whose detail depends on it), unless other figures already
// hold the most and this one is far off screen (then when it comes near: see claimGL_). Returns whether WebGL draws, now
// or later, and what makes the renderer once the figure's elements are in place.
/** @param {import('./context').Ctx} c @returns {[boolean, () => void]} */
export function openGL(c) {
  const { host_: host, canvas_: canvas } = c,
    box = host.getBoundingClientRect(),
    deferred = !c.opts_.force2d && holding.size >= MAX_GL && (box.top > innerHeight + 100 || box.bottom < -100);
  let gl = deferred ? null : getContext(canvas, c.opts_);
  return [
    !!(gl || deferred),
    () => {
      const built = c.built_,
        small = c.smallScreen_;
      const glOpts = { shadowSize: small ? 1024 : 2048, env: c.spec_.env, small, onTexture: () => c.kick_() };
      // (until it has a context: draws nothing, and the work done for later waits for it)
      c.renderer_ = { kind: '', draw: () => false, setAO() {}, dispose() {} };
      c.drawCanvas_ = canvas;
      c.keptPicture_ = null;
      c.contextLost_ = false;
      let loseExt = null; // (WEBGL_lose_context: how a context is given up and asked back)
      // a canvas under the WebGL one (which keeps receiving the pointer)
      const canvasUnder = () => {
        const u = document.createElement('canvas');
        u.className = 'lk3d-canvas lk3d-under';
        u.setAttribute('aria-hidden', 'true');
        canvas.before(u);
        return u;
      };
      // if WebGL fails (a shader that does not link, a mesh this GPU cannot index), the 2D fallback draws on a canvas
      // under the WebGL one
      c.fallback2d_ = (err) => {
        console.warn('lk3d: drawing in 2D instead of WebGL:', err.message);
        c.drawCanvas_ = canvasUnder();
        canvas.style.opacity = '0';
        c.renderer_ = canvasRenderer(c.drawCanvas_, built);
        host.dataset.renderer = c.renderer_.kind;
        c.sizeCanvas_();
      };
      // the WebGL renderer on the context, made again when a lost one comes back; true if it could not be made. A
      // context lost meanwhile (taken by the browser) waits to come back too: never the 2D fallback for that
      const makeGL = () => {
        try {
          c.renderer_ = glRenderer(gl, built, glOpts);
          host.dataset.renderer = c.renderer_.kind;
          loseExt = gl.getExtension('WEBGL_lose_context');
          holding.add(slot);
        } catch (e) {
          if (!gl || !gl.isContextLost()) c.fallback2d_(e);
          return true;
        }
      };
      // this figure among those holding a context: when it was last seen, whether it is near the screen, and how it
      // gives its context up (its picture kept on a 2D canvas under the WebGL one, so scrolling back is not blank), to
      // be restored when it comes back
      /** @type {import('./context').Slot} */
      const slot = (c.glSlot_ = {
        seen: 0,
        give() {
          holding.delete(slot);
          if (c.contextLost_) return;
          if (c.drawNow_()) {
            const kept = (c.keptPicture_ = canvasUnder());
            kept.width = c.width_;
            kept.height = c.height_;
            kept.getContext('2d').drawImage(canvas, 0, 0, c.width_, c.height_);
          }
          loseExt.loseContext();
        },
      });
      c.claimGL_ = () => {
        if (holding.has(slot) || c.renderer_.kind === '2d') return;
        let oldest = null;
        if (holding.size >= MAX_GL)
          for (const other of holding) if (!other.near && !(oldest && oldest.seen < other.seen)) oldest = other;
        if (oldest) oldest.give();
        if (!gl) {
          gl = getContext(canvas, c.opts_);
          makeGL();
          c.kick_();
        } else if (c.contextLost_ && loseExt) loseExt.restoreContext();
      };
      // (for stats())
      c.gpuName_ = () => {
        let gpu = '';
        try {
          const info = gl.getExtension('WEBGL_debug_renderer_info');
          gpu = gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER);
        } catch {
          // (no WebGL here)
        }
        return gpu;
      };
      if (gl) makeGL();
      else if (!deferred) {
        c.renderer_ = canvasRenderer(canvas, built);
        host.dataset.renderer = c.renderer_.kind;
      }
      canvas.addEventListener('webglcontextlost', (e) => {
        e.preventDefault();
        c.contextLost_ = true;
      });
      canvas.addEventListener('webglcontextrestored', () => {
        c.contextLost_ = false;
        if (c.renderer_.kind === '2d' || makeGL()) return; // (drawing in 2D already, or now)
        // (the lines' buffers were the old context's)
        for (const L of c.lines_) {
          c.renderer_.upload(L.part.batches[0]);
          L.dirty = true;
        }
        c.kick_();
      });
    },
  ];
}
