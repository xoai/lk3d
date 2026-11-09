// @ts-check
// A figure's liquids and gases (fluids.js): their state, moved on by their laws as time runs (fluidStep_, called by
// the frame loop), and their bodies shaped again when a volume or a height changes. Owns fluids_, gasHeights_,
// layersIn_, openOf_ and fluidStep_; reads spec_, built_, state_, motions_ and renderer_, and calls part_ and addLines_
// (a vessel's falling stream).
import { M, add, mulv, norm } from '../math.js';
import { Mesh, buildShape, outlineNormals, bounds } from '../geometry.js';
import * as FX from '../fluids.js';
import * as changed from '../changed.js';

// A vessel pours through its outlet while its valve is open (Torricelli), into the liquid below, as a falling stream;
// a gas holds its piston where pV = nRT puts it, easing there when the page heats it or adds to it
/** @param {import('./context').Ctx} c */
export function makeLiquids(c) {
  const fluids = (c.fluids_ = c.spec_.liquids || c.spec_.gases ? FX.fluidsOf(c.spec_) : null),
    jets = new Map(), // (a vessel's falling stream, made when it first pours)
    gasHeights = (c.gasHeights_ = new Map()),
    seat = new Map(), // (each piston's lowest point as drawn: it is set on the gas, wherever the scene drew it)
    drawn = new Map(); // (each body's shape as last drawn: drawn again only when it changes)
  let bodyVersion = 0;
  const shapedFor = []; // (the volumes and the gases' heights the bodies were last shaped for)
  if (!fluids) return; // (no fluids: the rest is never called, as fluids_ is null)
  const { shapes, heights } = FX.bodies(fluids);
  for (const [id, height] of heights) gasHeights.set(id, height);
  for (const gas of fluids.gases) {
    const piston = gas.piston && c.part_(gas.piston);
    if (piston) seat.set(gas.part, piston.min[1]);
  }
  for (const [id, shape] of shapes) drawn.set(id, JSON.stringify(shape));
  const colourOf = (id) => (c.spec_.parts.find((part) => part.id === id) || {}).color || '#7fb3e4';
  // a liquid's or a gas's body drawn for its new shape: a batch of its own, sent to the GPU again
  function reshape(part, shape) {
    const renderer = c.renderer_;
    if (part.batches[0] && renderer.release) renderer.release(part.batches[0]);
    part.batches = [];
    part.triangleCount = 0;
    if (!shape) return;
    const built = buildShape(shape, c.built_.quality),
      mesh = new Mesh();
    mesh.add(built.mesh, built.placements[0]);
    const batch = {
      mesh,
      placements: [M.id()],
      outlineNormals: outlineNormals(mesh),
      dynamic: true,
      version: ++bodyVersion,
    };
    if (renderer.upload) renderer.upload(batch);
    part.batches = [batch];
    part.triangleCount = mesh.indices.length / 3;
    ({ min: part.min, max: part.max } = bounds(mesh));
    part.center = mulv(add(part.min, part.max), 0.5);
    if (!Array.isArray(part.label)) part.anchor = [part.center[0], part.max[1], part.center[2]]; // (its label: its surface)
  }
  // a vessel's liquids, stacked, and the height (in the scene) of the top one's surface
  c.layersIn_ = (vessel) =>
    FX.stack(
      vessel.inside,
      fluids.liquids.filter((liquid) => liquid.in === vessel.id && liquid.volume > 0),
    );
  const surface = (vessel, layers = c.layersIn_(vessel)) =>
    vessel.at[1] + (layers.length ? layers[layers.length - 1].top : vessel.inside[0][0]);
  // how far open a vessel's outlet is: its valve's motion along its range, or what the page set
  c.openOf_ = (vessel) => {
    const valve = vessel.outlet.valve && c.motions_.find((motion) => motion.id === vessel.outlet.valve);
    return valve
      ? (c.state_.motion[valve.id] - valve.range[0]) / (valve.range[1] - valve.range[0])
      : (vessel.open ?? 0);
  };
  // moves them on by `elapsed` seconds; true while anything still moves
  c.fluidStep_ = (elapsed) => {
    let busy = false;
    // (a long step, the clock stepped by hand, in slices of at most 50 ms: each pours at the head it starts with; the
    // stream and the bodies are drawn once, after the last)
    for (let slices = Math.min(1200, Math.ceil(elapsed / 0.05 - 1e-9)) || 1, i = slices, dt = elapsed / slices; i--;) {
      for (const vessel of fluids.vessels.values()) {
        const outlet = vessel.outlet;
        if (!outlet) continue;
        const layers = c.layersIn_(vessel),
          open = c.openOf_(vessel),
          head = surface(vessel, layers) - outlet.tip[1], // (from the surface down to where the stream leaves)
          outflow = layers.length && open > 0 ? open * FX.outflow(outlet.radius, head, fluids.g, outlet.cd) : 0, // (volume/s)
          jet = jets.get(vessel.id);
        vessel.flow = outflow;
        if (!outflow) {
          if (jet) jet.clear();
          continue;
        }
        busy = true;
        // the bottom layer goes first, into the liquid it becomes below
        const from = layers[0].liquid,
          to = from.into && fluids.liquids.find((liquid) => liquid.part === from.into),
          poured = Math.min(from.volume, outflow * dt);
        from.volume -= poured;
        if (to) to.volume += poured;
        if (i) continue;
        // the stream: out of the tip at √(2g·head), as wide as the open bore lets it, falling to the surface below
        const below = to && fluids.vessels.get(to.in),
          points = FX.jet(
            outlet.tip,
            mulv(norm(outlet.dir || [0, -1, 0]), Math.sqrt(2 * fluids.g * head)),
            outlet.radius * Math.sqrt((outlet.cd ?? 0.6) * open),
            fluids.g,
            below ? surface(below) : c.built_.min[1],
          );
        const stream =
          jet || jets.set(vessel.id, c.addLines_({ count: 12, color: colourOf(from.part) })).get(vessel.id);
        for (let k = 0; k + 1 < points.length; k++)
          stream.set(k, points[k].slice(0, 3), points[k + 1].slice(0, 3), (points[k][3] + points[k + 1][3]) / 2);
      }
      for (const gas of fluids.gases) {
        const vessel = fluids.vessels.get(gas.in),
          target = FX.pistonHeight(vessel.inside, gas.n, gas.T, gas.p, gas.mass, fluids.unitsPerMetre),
          height = gasHeights.get(gas.part),
          // (quasi-static: it eases to where the law puts it, without bouncing)
          eased =
            Math.abs(target - height) < 1e-6 * (1 + Math.abs(target))
              ? target
              : height + (target - height) * (1 - Math.exp(-dt / 0.3));
        if (eased !== target || height !== target) busy = true;
        gasHeights.set(gas.part, eased);
        const piston = gas.piston && c.part_(gas.piston);
        if (piston) piston.offset = [0, vessel.at[1] + eased - seat.get(gas.part), 0];
      }
    }
    // the bodies whose shape changed, drawn again (only when a volume or a height changed, not every frame)
    changed.start(shapedFor);
    for (const liquid of fluids.liquids) changed.put(liquid.volume);
    for (const height of gasHeights.values()) changed.put(height);
    if (changed.end())
      for (const [id, shape] of FX.bodies(fluids, gasHeights).shapes) {
        const key = JSON.stringify(shape);
        if (drawn.get(id) !== key) {
          drawn.set(id, key);
          reshape(c.part_(id), shape);
        }
      }
    return busy;
  };
}
