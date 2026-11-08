// @ts-check
// A figure's liquids and gases (fluids.js): their state, moved on by their laws as time runs (fluidStep_, called by
// the frame loop), and their bodies shaped again when a volume or a height changes. Owns fluids_, gasHeights_,
// layersIn_, openOf_ and fluidStep_; reads spec_, built_, state_, motions_ and renderer_, and calls part_ and addLines_
// (a vessel's falling stream).
import { M, add, mulv, norm } from '../math.js';
import { Geo, buildShape, outlineNormals, bounds } from '../geometry.js';
import * as FX from '../fluids.js';
import * as changed from '../changed.js';

// A vessel pours through its outlet while its valve is open (Torricelli), into the liquid below, as a falling stream;
// a gas holds its piston where pV = nRT puts it, easing there when the page heats it or adds to it
/** @param {import('./context').Ctx} c */
export function makeLiquids(c) {
  const FL = (c.fluids_ = c.spec_.liquids || c.spec_.gases ? FX.fluidsOf(c.spec_) : null),
    jets = new Map(), // (a vessel's falling stream, made when it first pours)
    gasHeights = (c.gasHeights_ = new Map()),
    seat = new Map(), // (each piston's lowest point as drawn: it is set on the gas, wherever the scene drew it)
    drawn = new Map(); // (each body's shape as last drawn: drawn again only when it changes)
  let bodyVersion = 0;
  const shapedFor = []; // (the volumes and the gases' heights the bodies were last shaped for)
  if (FL) {
    const { out, heights } = FX.bodies(FL);
    for (const [id, h] of heights) gasHeights.set(id, h);
    for (const gas of FL.gases) {
      const piston = gas.piston && c.part_(gas.piston);
      if (piston) seat.set(gas.part, piston.lo[1]);
    }
    for (const [id, shape] of out) drawn.set(id, JSON.stringify(shape));
  }
  const colourOf = (id) => (c.spec_.parts.find((p) => p.id === id) || {}).color || '#7fb3e4';
  // a liquid's or a gas's body drawn for its new shape: a batch of its own, sent to the GPU again
  function reshape(p, shape) {
    const renderer = c.renderer_;
    if (p.batches[0] && renderer.release) renderer.release(p.batches[0]);
    p.batches = [];
    p.tris = 0;
    if (!shape) return;
    const s = buildShape(shape, c.built_.q),
      g = new Geo();
    g.add(s.geo, s.mats[0]);
    const b = { geo: g, mats: [M.id()], out: outlineNormals(g), dynamic: true, ver: ++bodyVersion };
    if (renderer.upload) renderer.upload(b);
    p.batches = [b];
    p.tris = g.i.length / 3;
    ({ lo: p.lo, hi: p.hi } = bounds(g));
    p.center = mulv(add(p.lo, p.hi), 0.5);
    if (!Array.isArray(p.label)) p.anchor = [p.center[0], p.hi[1], p.center[2]]; // (its label: its surface)
  }
  // a vessel's liquids, stacked, and the height (in the scene) of the top one's surface
  c.layersIn_ = (v) =>
    FX.stack(
      v.inside,
      FL.liquids.filter((l) => l.in === v.id && l.volume > 0),
    );
  const surface = (v, layers = c.layersIn_(v)) =>
    v.at[1] + (layers.length ? layers[layers.length - 1].h1 : v.inside[0][0]);
  // how far open a vessel's outlet is: its valve's motion along its range, or what the page set
  c.openOf_ = (v) => {
    const mo = v.outlet.valve && c.motions_.find((x) => x.id === v.outlet.valve);
    return mo ? (c.state_.motion[mo.id] - mo.range[0]) / (mo.range[1] - mo.range[0]) : (v.open ?? 0);
  };
  // moves them on by `elapsed` seconds; true while anything still moves
  c.fluidStep_ = (elapsed) => {
    let busy = false;
    // (a long step, the clock stepped by hand, in slices of at most 50 ms: each pours at the head it starts with; the
    // stream and the bodies are drawn once, after the last)
    for (let n = Math.min(1200, Math.ceil(elapsed / 0.05 - 1e-9)) || 1, i = n, dt = elapsed / n; i--;) {
      for (const v of FL.vessels.values()) {
        const o = v.outlet;
        if (!o) continue;
        const layers = c.layersIn_(v),
          open = c.openOf_(v),
          H = surface(v, layers) - o.tip[1], // (the head: from the surface down to where the stream leaves)
          Q = layers.length && open > 0 ? open * FX.outflow(o.radius, H, FL.g, o.cd) : 0, // (the outflow, volume/s)
          jet = jets.get(v.id);
        v.flow = Q;
        if (!Q) {
          if (jet) jet.clear();
          continue;
        }
        busy = true;
        // the bottom layer goes first, into the liquid it becomes below
        const from = layers[0].l,
          to = from.into && FL.liquids.find((l) => l.part === from.into),
          dv = Math.min(from.volume, Q * dt);
        from.volume -= dv;
        if (to) to.volume += dv;
        if (i) continue;
        // the stream: out of the tip at √(2gH), as wide as the open bore lets it, falling to the surface below
        const below = to && FL.vessels.get(to.in),
          pts = FX.jet(
            o.tip,
            mulv(norm(o.dir || [0, -1, 0]), Math.sqrt(2 * FL.g * H)),
            o.radius * Math.sqrt((o.cd ?? 0.6) * open),
            FL.g,
            below ? surface(below) : c.built_.lo[1],
          );
        const stream = jet || jets.set(v.id, c.addLines_({ count: 12, color: colourOf(from.part) })).get(v.id);
        for (let k = 0; k + 1 < pts.length; k++)
          stream.set(k, pts[k].slice(0, 3), pts[k + 1].slice(0, 3), (pts[k][3] + pts[k + 1][3]) / 2);
      }
      for (const gas of FL.gases) {
        const v = FL.vessels.get(gas.in),
          to = FX.pistonHeight(v.inside, gas.n, gas.T, gas.p, gas.mass, FL.m),
          h = gasHeights.get(gas.part),
          // (quasi-static: it eases to where the law puts it, without bouncing)
          eased = Math.abs(to - h) < 1e-6 * (1 + Math.abs(to)) ? to : h + (to - h) * (1 - Math.exp(-dt / 0.3));
        if (eased !== to || h !== to) busy = true;
        gasHeights.set(gas.part, eased);
        const piston = gas.piston && c.part_(gas.piston);
        if (piston) piston.offset = [0, v.at[1] + eased - seat.get(gas.part), 0];
      }
    }
    // the bodies whose shape changed, drawn again (only when a volume or a height changed, not every frame)
    changed.start(shapedFor);
    for (const l of FL.liquids) changed.put(l.volume);
    for (const h of gasHeights.values()) changed.put(h);
    if (changed.end())
      for (const [id, shape] of FX.bodies(FL, gasHeights).out) {
        const key = JSON.stringify(shape);
        if (drawn.get(id) !== key) {
          drawn.set(id, key);
          reshape(c.part_(id), shape);
        }
      }
    return busy;
  };
}
