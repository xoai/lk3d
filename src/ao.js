// @ts-check
// Crease shading (ambient occlusion: bvh.js aoJob) in a Web Worker, so the page's main thread stays free while it is
// worked out (seconds of rays on a slow phone). One worker for the page, made of lk3d's own script, nothing more to
// ship: the file a <script src> loaded (imported into the worker), or the text of an inline <script> (a built lesson's).
// Marked so (self.lk3dAO), the script answers jobs instead of drawing. Where no worker can be made (lk3d imported as a
// module, a page whose policy forbids one), shadeAway says so and the figure shades in idle slices on the page.
import { buildBVH, aoJob } from './bvh.js';

// (where this script came from: read while it first runs, the only time document.currentScript is this script)
const script =
    typeof document !== 'undefined' ? /** @type {HTMLScriptElement | null} */ (document.currentScript) : null,
  source = script ? (script.src ? `importScripts(${JSON.stringify(script.src)})` : script.textContent) : '';
/** @type {Worker | null} */
let worker = null,
  failed = !source,
  jobs = 0;
const waiting = new Map(); // a job's id → [resolve, reject]

// in the worker: each mesh sent shaded, its shading sent back
export function serveAO() {
  self.onmessage = ({ data }) => {
    const job = aoJob(data.mesh, buildBVH(data.mesh), data.reach);
    job.step(Infinity);
    self.postMessage({ id: data.id, out: job.out }, /** @type {any} */ ([job.out.buffer]));
  };
}

// on the page: a mesh's shading, worked out in the worker (a promise of its Uint8Array), or null where there is none
/** @param {{ positions: Float32Array, normals: Float32Array, indices: any, count: number }} mesh @param {number} reach */
export function shadeAway(mesh, reach) {
  if (failed) return null;
  try {
    if (!worker) {
      worker = new Worker(URL.createObjectURL(new Blob(['self.lk3dAO=1;' + source], { type: 'text/javascript' })));
      worker.onmessage = ({ data }) => {
        const [resolve] = waiting.get(data.id) || [];
        waiting.delete(data.id);
        if (resolve) resolve(data.out);
      };
      // (a worker that cannot load or breaks: its jobs, and every one after, done on the page)
      worker.onerror = (event) => {
        event.preventDefault();
        failed = true;
        for (const [, [, reject]] of waiting) reject(new Error('lk3d: the crease-shading worker stopped'));
        waiting.clear();
        if (worker) worker.terminate();
        worker = null;
      };
    }
    const id = ++jobs,
      { positions, normals, indices, count } = mesh;
    worker.postMessage({ id, mesh: { positions, normals, indices, count }, reach });
    return new Promise((resolve, reject) => waiting.set(id, [resolve, reject]));
  } catch {
    failed = true; // (no Worker, no Blob URLs, or a policy that forbids them)
    return null;
  }
}
