// @ts-check
// The work done in idle slices after the first picture, a few milliseconds at a time: the trees for picking, the crease
// shading (ambient occlusion) and the pen look's edges; and whether the figure is complete (checkReady_: its `ready`).
// Owns aoComplete_, showEdges_, findEdges_ and checkReady_; reads built_, spec_, opts_, stats_, mountedAt_, renderer_,
// look_, destroyed_, resolveReady_ and api_, and calls bvhOf_ and kick_.
import { sub, len } from '../math.js';
import { edgesOf } from '../geometry.js';
import { aoJob } from '../bvh.js';

/** @param {import('./context').Ctx} c */
export function makeIdle(c) {
  let aoDone = (c.aoComplete_ = false),
    /** @type {any[] | null} */
    edgesLeft = null; // (the batches whose edges are still to find; null until the search begins)
  // the figure is complete once its first picture is up, the trees for picking are built, the crease shading is done
  // (there is none in 2D or with ao: false), no texture is still decoding and its edges are found: checked after each
  // picture and when the trees are done
  c.checkReady_ = () => {
    if (
      c.resolveReady_ &&
      c.stats_.firstFrameMs != null &&
      c.stats_.treesMs != null &&
      (aoDone || c.renderer_.kind === '2d' || c.opts_.ao === false) &&
      !c.renderer_.pending &&
      (!edgesWanted() || (edgesLeft && !edgesLeft.length))
    ) {
      c.resolveReady_(c.api_);
      c.resolveReady_ = null;
    }
  };
  const batches = [];
  for (const p of c.built_.parts) if (!p.fluid) for (const b of p.batches) batches.push(b); // (a fluid's shape changes)

  // ---- the trees for picking first, just after the first picture, so pointing never waits for one
  {
    const todo = batches.slice();
    const build = () => {
      if (c.destroyed_) return;
      const end = performance.now() + 6;
      while (todo.length && performance.now() < end) c.bvhOf_(todo.shift());
      if (todo.length) setTimeout(build, 16);
      else {
        c.stats_.treesMs = performance.now() - c.mountedAt_;
        c.checkReady_();
      }
    };
    setTimeout(build, 30);
  }

  // ---- ambient occlusion: creases and the insides of hollow parts darkened, by rays against the trees, then drawn
  if (c.renderer_.kind !== '2d' && c.opts_.ao !== false) {
    const queue = batches.slice(),
      aoByGeo = new Map();
    /** @type {{ b: any, job: ReturnType<typeof aoJob> } | null} */
    let current = null; // (the batch being shaded, and its job)
    const work = () => {
      if (c.destroyed_) return;
      const end = performance.now() + 6;
      while (performance.now() < end) {
        if (!current) {
          const b = queue.shift();
          if (b && aoByGeo.has(b.geo)) {
            // (a geometry shared by parts alike: its crease shading is the same, made once)
            b.ao = aoByGeo.get(b.geo);
            c.renderer_.setAO(b);
            continue;
          }
          if (!b) {
            c.aoComplete_ = aoDone = true;
            c.stats_.aoMs = performance.now() - c.mountedAt_;
            c.kick_();
            c.checkReady_();
            return;
          }
          if (b.geo.count > 40000) continue; // a very detailed shape: its own folds already read; spare the phone the rays
          const g = b.geo;
          let lo = [1e9, 1e9, 1e9],
            hi = [-1e9, -1e9, -1e9];
          for (let k = 0; k < g.count; k++)
            for (let a = 0; a < 3; a++) {
              lo[a] = Math.min(lo[a], g.p[3 * k + a]);
              hi[a] = Math.max(hi[a], g.p[3 * k + a]);
            }
          // (rays as long as a quarter of the shape, within limits: creases darken, not the whole of a big part)
          const reach = Math.max(0.02, Math.min(len(sub(hi, lo)) * 0.25, c.built_.radius * 0.12));
          current = { b, job: aoJob(g, c.bvhOf_(b), reach) };
        }
        if (current.job.step(Math.max(1, end - performance.now()))) {
          current.b.ao = current.job.out;
          aoByGeo.set(current.b.geo, current.job.out);
          c.renderer_.setAO(current.b);
          current = null;
        }
      }
      setTimeout(work, 16);
    };
    setTimeout(work, 60);
  }

  // ---- edges: drawn in the pen look (and in any look with the scene's edges: true; never with edges: false), found in
  // idle slices once a look needs them (a figure that never shows them never pays for them), drawn as they arrive
  const edgesWanted = () =>
    !!c.renderer_.edges && !!c.look_ && (c.look_.kind === 2 ? c.spec_.edges !== false : c.spec_.edges === true);
  // (drawn once there are some: their search has begun)
  c.showEdges_ = () => !!edgesLeft && edgesWanted();
  const edgesByGeo = new Map(); // (a geometry's edges, for every batch that shares it)
  c.findEdges_ = () => {
    if (!edgesWanted() || edgesLeft) return;
    const todo = (edgesLeft = batches.filter((b) => b.edgy));
    const work = () => {
      if (c.destroyed_) return;
      const end = performance.now() + 6;
      while (todo.length && performance.now() < end) {
        const b = todo.shift();
        b.lines = edgesByGeo.get(b.geo) || edgesOf(b.geo, 40, b.soft);
        edgesByGeo.set(b.geo, b.lines);
        if (b.gl && c.renderer_.edges) c.renderer_.edges(b); // (none if WebGL failed meanwhile: drawn in 2D)
      }
      c.kick_();
      if (todo.length) setTimeout(work, 16);
    };
    setTimeout(work, 30);
  };
}
