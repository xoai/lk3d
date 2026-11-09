// @ts-check
// What a page adds to a figure: particles (along paths, or placed by the page), flows (streaks, flow.js),
// streams (volumes the GPU marches, stream.js; streaks without WebGL) and lines (rods between points). Owns
// addParticles_, addFlow_, addStream_ and addLines_ (the lists themselves are particles_, flows_, streams_ and lines_,
// which the frame loop moves on and draws); reads renderer_, and calls part_, travel_ and kick_.
import { M, sub, mulv, len, norm, cross, rgb } from '../math.js';
import { buildShape, outlineNormals } from '../geometry.js';
import { pathOf, makeFlow } from '../flow.js';
import { makeStream } from '../stream.js';

/** @param {import('./context').Ctx} c */
export function makeAdditions(c) {
  // a thing the page added, removed: out of its list, and what it held on the GPU let go
  const drop = (list, thing, gpu = thing) => {
    const index = list.indexOf(thing);
    if (index >= 0) list.splice(index, 1);
    if (c.renderer_.release) c.renderer_.release(gpu);
    c.kick_();
  };
  // properties a page sets by assignment (fig.particles(…).speed = 2): setting one draws again, and runs `onSet`
  function live(obj, keys, onSet) {
    for (const key of keys) {
      let value = obj[key];
      Object.defineProperty(obj, key, {
        enumerable: true,
        get: () => value,
        set(newValue) {
          value = newValue;
          if (onSet) onSet(key);
          c.kick_();
        },
      });
    }
    return obj;
  }

  // ---- particles: points moving along paths (air, current, blood), whose speed the page sets; or, without a path,
  // points the page places itself (molecules of a gas: solid balls of a radius in scene units, in one of the three
  // `colors` by the fourth number of each point: below 0.35, up to 0.65, above)
  c.addParticles_ = ({
    path,
    count = 30,
    color = '#ffd25a',
    size = 7,
    part = null,
    closed = false,
    radius = 0,
    colors = null,
  }) => {
    if (!path) {
      const points = {
        solid: true,
        radius,
        ramp: (colors || [color, color, color]).map(rgb),
        count,
        positionsAndColors: new Float32Array(count * 4),
        visible: true,
        version: 0, // (the page adds one after moving the points: they are sent to the GPU again)
        update() {},
        resize(newCount) {
          if (newCount * 4 > points.positionsAndColors.length)
            points.positionsAndColors = new Float32Array(newCount * 4);
          points.count = newCount;
        },
        remove: () => drop(c.particles_, points),
      };
      live(points, ['visible', 'radius', 'version', 'count']);
      c.particles_.push(points);
      c.kick_();
      return points;
    }
    const line = pathOf(path, closed),
      total = line.total;
    /** @type {any} */
    const points = {
      color: rgb(color),
      size,
      speed: 0,
      offset: 0,
      count,
      part,
      positionsAndColors: new Float32Array(count * 4),
      visible: true,
      remove: () => drop(c.particles_, points),
    };
    const owner = part ? c.part_(part) : null;
    points.update = () => {
      const ownerMatrix = owner ? owner.matrix : null;
      for (let i = 0; i < points.count; i++) {
        const onPath = line.at(((((i / points.count + points.offset) % 1) + 1) % 1) * total),
          world = ownerMatrix ? M.pt(ownerMatrix, onPath) : onPath;
        points.positionsAndColors[4 * i] = world[0];
        points.positionsAndColors[4 * i + 1] = world[1];
        points.positionsAndColors[4 * i + 2] = world[2];
        points.positionsAndColors[4 * i + 3] = 1;
      }
    };
    points.go = (time, dt) => c.travel_(points, 'offset', total ? points.speed / total : 0, time, dt);
    live(points, ['speed', 'visible', 'offset']);
    c.particles_.push(points);
    c.kick_();
    return points;
  };

  // ---- flows: streaks along paths (flow.js), moved on in the frame loop; the page sets how fast and how many
  c.addFlow_ = (options) => {
    const flow = makeFlow(options);
    flow.owner = options.part ? c.part_(options.part) : null;
    flow.go = (time, dt) => c.travel_(flow, 'travelled', flow.speed, time, dt);
    const forPage = {
      set(changes) {
        for (const key of ['speed', 'amount', 'length', 'width', 'spread', 'opacity', 'visible', 'ramp'])
          if (key in changes) flow[key] = changes[key];
        flow.colors = null; // (the ramp's colours, worked out again for the look in use)
        c.kick_();
      },
      remove: () => drop(c.flows_, flow),
    };
    // speed, amount and visible also as properties: setting one draws again
    for (const key of ['speed', 'amount', 'visible'])
      Object.defineProperty(forPage, key, {
        get: () => flow[key],
        set(value) {
          forPage.set({ [key]: value });
        },
      });
    c.flows_.push(flow);
    c.kick_();
    return forPage;
  };

  // ---- streams: air or gas as a volume moving along a path (stream.js; drawn by the GPU). Where there is no WebGL,
  // streaks along the same path stand in for it
  c.addStream_ = (options) => {
    if (c.renderer_.kind === '2d') {
      // (without WebGL: streaks along the same path, as many as the stream is dense)
      const streaks = c.addFlow_({
        ...options,
        paths: [options.path],
        count: 120,
        spread: typeof options.radius === 'number' ? options.radius : 0.1,
      });
      const setFlow = streaks.set;
      streaks.set = (changes) =>
        setFlow('density' in changes ? { ...changes, amount: Math.min(1, changes.density) } : changes);
      Object.defineProperty(streaks, 'density', {
        get: () => streaks.amount,
        set(value) {
          streaks.set({ density: value });
        },
      });
      if (options.density != null) streaks.set({ density: options.density });
      return streaks;
    }
    const stream = makeStream(options);
    stream.go = (time, dt) => c.travel_(stream, 'phase', stream.speed, time, dt, 3000); // (kept small for the GPU's precision)
    const forPage = {
      set(changes) {
        for (const key of ['speed', 'density', 'turbulence', 'swirl', 'visible', 'ramp'])
          if (key in changes) stream[key] = changes[key];
        stream.colors = null;
        c.kick_();
      },
      remove: () => drop(c.streams_, stream),
    };
    for (const key of ['speed', 'density', 'visible'])
      Object.defineProperty(forPage, key, {
        get: () => stream[key],
        set(value) {
          forPage.set({ [key]: value });
        },
      });
    c.streams_.push(stream);
    c.kick_();
    return forPage;
  };

  // ---- lines: rods between points the page sets (rays of light, field lines, forces), drawn by instancing one
  // cylinder, so a hundred rays cost one draw; they are shaded, outlined and can glow like any part
  /** @param {{ count?: number, radius?: number, color?: string, studioColor?: string, glow?: string | null }} [options] */
  c.addLines_ = ({ count = 8, radius = 0.01, color = '#ffcc55', studioColor, glow = null } = {}) => {
    const unit = buildShape({ cylinder: { r: 1, x0: 0, x1: 1 } }, 0.5).mesh,
      /** @type {{ mesh: any, placements: (number[] | Float32Array)[], outlineNormals: any, dynamic: boolean }} */
      batch = { mesh: unit, placements: [], outlineNormals: outlineNormals(unit), dynamic: true };
    const part = {
      id: '__lines' + c.lines_.length,
      name: '',
      note: '',
      label: false,
      batches: [batch],
      color: rgb(color),
      studioColor: rgb(studioColor || color),
      metalRoughness: [0.1, 0.4, 0],
      material: 'paint',
      surfaceDetail: [0, 0, 0],
      refract: 0,
      alpha: 1,
      drawAlpha: 1,
      emission: [0, 0, 0],
      glowColor: rgb(glow || color),
      explode: [0, 0, 0],
      offset: [0, 0, 0],
      min: [0, 0, 0],
      max: [0, 0, 0],
      center: [0, 0, 0],
      matrix: M.id(),
      hidden: false,
      cut: true,
      triangleCount: 0,
      tint: 1, // (rays and forces keep all their colour in the pen look)
    };
    const segments = new Array(count).fill(null);
    const lines = {
      part,
      visible: true,
      dirty: true,
      radius,
      set(index, start, end, ownRadius) {
        if (index >= 0 && index < segments.length) {
          segments[index] = start && end ? [start, end, ownRadius] : null;
          lines.dirty = true;
          c.kick_();
        }
      },
      clear() {
        segments.fill(null);
        lines.dirty = true;
        c.kick_();
      },
      glow(strength) {
        part.emission = mulv(part.glowColor, strength);
        c.kick_();
      },
      remove: () => drop(c.lines_, lines, batch),
      place() {
        // each segment: the unit cylinder along x, stretched to the segment and thinned to the radius
        batch.placements = segments
          .filter(Boolean)
          .filter(([start, end]) => len(sub(end, start)) > 1e-9)
          .map(([start, end, ownRadius]) => {
            const along = sub(end, start),
              length = len(along),
              x = mulv(along, 1 / length),
              up = Math.abs(x[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
            const z = norm(cross(x, up)),
              y = cross(z, x),
              thickness = ownRadius ?? lines.radius;
            return [
              x[0] * length,
              x[1] * length,
              x[2] * length,
              0,
              y[0] * thickness,
              y[1] * thickness,
              y[2] * thickness,
              0,
              z[0] * thickness,
              z[1] * thickness,
              z[2] * thickness,
              0,
              start[0],
              start[1],
              start[2],
              1,
            ];
          });
        if (c.renderer_.instances) c.renderer_.instances(batch);
      },
    };
    if (c.renderer_.upload) c.renderer_.upload(batch);
    live(lines, ['radius', 'visible'], (key) => {
      if (key === 'radius') lines.dirty = true;
    });
    c.lines_.push(lines);
    c.kick_();
    return lines;
  };
}
