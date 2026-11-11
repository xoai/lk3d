// @ts-check
// The work done in idle slices after the first picture, a few milliseconds at a time: the trees for picking, the crease
// shading (ambient occlusion) and the pen look's edges; and whether the figure is complete (checkReady_: its `ready`).
// Owns aoComplete_, showEdges_, findEdges_ and checkReady_ (the crease shading in the page's worker: ao.js); reads built_, spec_, opts_, stats_, mountedAt_, renderer_,
// look_, destroyed_, resolveReady_ and api_, and calls bvhOf_ and kick_.
import { sub, len } from '../math.js';
import { edgesOf } from '../geometry.js';
import { aoJob } from '../bvh.js';
import { shadeAway } from '../ao.js';

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
  for (const part of c.built_.parts) if (!part.fluid) for (const batch of part.batches) batches.push(batch); // (a fluid's shape changes)

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

  // ---- ambient occlusion: creases and the insides of hollow parts darkened, by rays against each shape's tree, then
  // drawn. Each shape is sent to the page's worker (ao.js) as it comes up, and drawn when its shading comes back; where
  // there is no worker (or it stops), shaded here in idle slices, a few milliseconds at a time
  if (c.renderer_.kind !== '2d' && c.opts_.ao !== false) {
    const queue = batches.slice(),
      aoByMesh = new Map(),
      away = new Map(); // a mesh in the worker → the batches waiting for its shading
    /** @type {{ batch: any, job: ReturnType<typeof aoJob> } | null} */
    let current = null, // (the batch being shaded here, and its job)
      working = false;
    const shaded = (batch, out) => {
      batch.ao = out;
      aoByMesh.set(batch.mesh, out);
      c.renderer_.setAO(batch);
    };
    const finish = () => {
      if (aoDone || queue.length || current || away.size) return;
      c.aoComplete_ = aoDone = true;
      c.stats_.aoMs = performance.now() - c.mountedAt_;
      c.kick_();
      c.checkReady_();
    };
    const work = () => {
      working = false;
      if (c.destroyed_) return;
      const end = performance.now() + 6;
      while (performance.now() < end) {
        if (!current) {
          const batch = queue.shift();
          if (!batch) return finish();
          if (aoByMesh.has(batch.mesh)) {
            // (a mesh shared by parts alike: its crease shading is the same, made once)
            shaded(batch, aoByMesh.get(batch.mesh));
            continue;
          }
          if (away.has(batch.mesh)) {
            away.get(batch.mesh).push(batch);
            continue;
          }
          if (batch.mesh.count > 40000) continue; // a very detailed shape: its own folds already read; spare the phone the rays
          const mesh = batch.mesh;
          let lo = [1e9, 1e9, 1e9],
            hi = [-1e9, -1e9, -1e9];
          for (let vertex = 0; vertex < mesh.count; vertex++)
            for (let axis = 0; axis < 3; axis++) {
              lo[axis] = Math.min(lo[axis], mesh.positions[3 * vertex + axis]);
              hi[axis] = Math.max(hi[axis], mesh.positions[3 * vertex + axis]);
            }
          // (rays as long as a quarter of the shape, within limits: creases darken, not the whole of a big part)
          const reach = Math.max(0.02, Math.min(len(sub(hi, lo)) * 0.25, c.built_.radius * 0.12)),
            inWorker = shadeAway(mesh, reach);
          if (inWorker) {
            away.set(mesh, [batch]);
            inWorker.then(
              (out) => {
                if (c.destroyed_) return;
                c.stats_.aoWorker = true;
                for (const each of away.get(mesh)) shaded(each, out);
                away.delete(mesh);
                c.kick_();
                finish();
              },
              () => {
                // (the worker stopped: its batches shaded here)
                queue.push(...away.get(mesh));
                away.delete(mesh);
                start();
              },
            );
            continue;
          }
          current = { batch, job: aoJob(mesh, c.bvhOf_(batch), reach) };
        }
        if (current.job.step(Math.max(1, end - performance.now()))) {
          shaded(current.batch, current.job.out);
          current = null;
        }
      }
      start(16);
    };
    const start = (ms = 0) => {
      if (!working) setTimeout(work, ms);
      working = true;
    };
    start(60);
  }

  // ---- edges: drawn in the pen look (and in any look with the scene's edges: true; never with edges: false), found in
  // idle slices once a look needs them (a figure that never shows them never pays for them), drawn as they arrive
  const edgesWanted = () =>
    !!c.renderer_.edges && !!c.look_ && (c.look_.kind === 2 ? c.spec_.edges !== false : c.spec_.edges === true);
  // (drawn once there are some: their search has begun)
  c.showEdges_ = () => !!edgesLeft && edgesWanted();
  const edgesByMesh = new Map(); // (a mesh's edges, for every batch that shares it)
  c.findEdges_ = () => {
    if (!edgesWanted() || edgesLeft) return;
    const todo = (edgesLeft = batches.filter((batch) => batch.drawsEdges));
    const work = () => {
      if (c.destroyed_) return;
      const end = performance.now() + 6;
      while (todo.length && performance.now() < end) {
        const batch = todo.shift();
        batch.lines = edgesByMesh.get(batch.mesh) || edgesOf(batch.mesh, 40, batch.soft);
        edgesByMesh.set(batch.mesh, batch.lines);
        if (batch.gpu && c.renderer_.edges) c.renderer_.edges(batch); // (none if WebGL failed meanwhile: drawn in 2D)
      }
      c.kick_();
      if (todo.length) setTimeout(work, 16);
    };
    setTimeout(work, 30);
  };
}
