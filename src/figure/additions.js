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
  const drop = (list, x, gpu = x) => {
    const k = list.indexOf(x);
    if (k >= 0) list.splice(k, 1);
    if (c.renderer_.release) c.renderer_.release(gpu);
    c.kick_();
  };
  // properties a page sets by assignment (fig.particles(…).speed = 2): setting one draws again, and runs `onSet`
  function live(obj, keys, onSet) {
    for (const k of keys) {
      let v = obj[k];
      Object.defineProperty(obj, k, {
        enumerable: true,
        get: () => v,
        set(x) {
          v = x;
          if (onSet) onSet(k);
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
        pos4: new Float32Array(count * 4),
        visible: true,
        version: 0, // (the page adds one after moving the points: they are sent to the GPU again)
        update() {},
        resize(n) {
          if (n * 4 > points.pos4.length) points.pos4 = new Float32Array(n * 4);
          points.count = n;
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
      pos4: new Float32Array(count * 4),
      visible: true,
      remove: () => drop(c.particles_, points),
    };
    const owner = part ? c.part_(part) : null;
    points.update = () => {
      const m = owner ? owner.m : null;
      for (let i = 0; i < points.count; i++) {
        const p = line.at(((((i / points.count + points.offset) % 1) + 1) % 1) * total),
          w = m ? M.pt(m, p) : p;
        points.pos4[4 * i] = w[0];
        points.pos4[4 * i + 1] = w[1];
        points.pos4[4 * i + 2] = w[2];
        points.pos4[4 * i + 3] = 1;
      }
    };
    points.go = (t, dt) => c.travel_(points, 'offset', total ? points.speed / total : 0, t, dt);
    live(points, ['speed', 'visible', 'offset']);
    c.particles_.push(points);
    c.kick_();
    return points;
  };

  // ---- flows: streaks along paths (flow.js), moved on in the frame loop; the page sets how fast and how many
  c.addFlow_ = (o) => {
    const flow = makeFlow(o);
    flow.owner = o.part ? c.part_(o.part) : null;
    flow.go = (t, dt) => c.travel_(flow, 'dist', flow.speed, t, dt);
    const forPage = {
      set(o) {
        for (const k of ['speed', 'amount', 'length', 'width', 'spread', 'opacity', 'visible', 'ramp'])
          if (k in o) flow[k] = o[k];
        flow.colors = null; // (the ramp's colours, worked out again for the look in use)
        c.kick_();
      },
      remove: () => drop(c.flows_, flow),
    };
    // speed, amount and visible also as properties: setting one draws again
    for (const k of ['speed', 'amount', 'visible'])
      Object.defineProperty(forPage, k, {
        get: () => flow[k],
        set(v) {
          forPage.set({ [k]: v });
        },
      });
    c.flows_.push(flow);
    c.kick_();
    return forPage;
  };

  // ---- streams: air or gas as a volume moving along a path (stream.js; drawn by the GPU). Where there is no WebGL,
  // streaks along the same path stand in for it
  c.addStream_ = (o) => {
    if (c.renderer_.kind === '2d') {
      // (without WebGL: streaks along the same path, as many as the stream is dense)
      const streaks = c.addFlow_({
        ...o,
        paths: [o.path],
        count: 120,
        spread: typeof o.radius === 'number' ? o.radius : 0.1,
      });
      const set = streaks.set;
      streaks.set = (q) => set('density' in q ? { ...q, amount: Math.min(1, q.density) } : q);
      Object.defineProperty(streaks, 'density', {
        get: () => streaks.amount,
        set(v) {
          streaks.set({ density: v });
        },
      });
      if (o.density != null) streaks.set({ density: o.density });
      return streaks;
    }
    const stream = makeStream(o);
    stream.go = (t, dt) => c.travel_(stream, 'phase', stream.speed, t, dt, 3000); // (kept small for the GPU's precision)
    const forPage = {
      set(o) {
        for (const k of ['speed', 'density', 'turbulence', 'swirl', 'visible', 'ramp']) if (k in o) stream[k] = o[k];
        stream.colors = null;
        c.kick_();
      },
      remove: () => drop(c.streams_, stream),
    };
    for (const k of ['speed', 'density', 'visible'])
      Object.defineProperty(forPage, k, {
        get: () => stream[k],
        set(v) {
          forPage.set({ [k]: v });
        },
      });
    c.streams_.push(stream);
    c.kick_();
    return forPage;
  };

  // ---- lines: rods between points the page sets (rays of light, field lines, forces), drawn by instancing one
  // cylinder, so a hundred rays cost one draw; they are shaded, outlined and can glow like any part
  /** @param {{ count?: number, radius?: number, color?: string, studioColor?: string, glow?: string | null }} [o] */
  c.addLines_ = ({ count = 8, radius = 0.01, color = '#ffcc55', studioColor, glow = null } = {}) => {
    const unit = buildShape({ cylinder: { r: 1, x0: 0, x1: 1 } }, 0.5).geo,
      /** @type {{ geo: any, mats: (number[] | Float32Array)[], out: any, dynamic: boolean }} */
      b = { geo: unit, mats: [], out: outlineNormals(unit), dynamic: true };
    const part = {
      id: '__lines' + c.lines_.length,
      name: '',
      note: '',
      label: false,
      batches: [b],
      color: rgb(color),
      studioColor: rgb(studioColor || color),
      mat: [0.1, 0.4, 0],
      material: 'paint',
      surf: [0, 0, 0],
      refract: 0,
      alpha: 1,
      drawAlpha: 1,
      emit: [0, 0, 0],
      glowColor: rgb(glow || color),
      explode: [0, 0, 0],
      offset: [0, 0, 0],
      lo: [0, 0, 0],
      hi: [0, 0, 0],
      center: [0, 0, 0],
      m: M.id(),
      hidden: false,
      cut: true,
      tris: 0,
      tint: 1, // (rays and forces keep all their colour in the pen look)
    };
    const segs = new Array(count).fill(null);
    const L = {
      part,
      visible: true,
      dirty: true,
      radius,
      set(k, a, e, r) {
        if (k >= 0 && k < segs.length) {
          segs[k] = a && e ? [a, e, r] : null;
          L.dirty = true;
          c.kick_();
        }
      },
      clear() {
        segs.fill(null);
        L.dirty = true;
        c.kick_();
      },
      glow(v) {
        part.emit = mulv(part.glowColor, v);
        c.kick_();
      },
      remove: () => drop(c.lines_, L, b),
      place() {
        // each segment: the unit cylinder along x, stretched to the segment and thinned to the radius
        b.mats = segs
          .filter(Boolean)
          .filter(([a, e]) => len(sub(e, a)) > 1e-9)
          .map(([a, e, own]) => {
            const d = sub(e, a),
              l = len(d),
              x = mulv(d, 1 / l),
              up = Math.abs(x[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
            const z = norm(cross(x, up)),
              y = cross(z, x),
              r = own ?? L.radius;
            return [
              x[0] * l,
              x[1] * l,
              x[2] * l,
              0,
              y[0] * r,
              y[1] * r,
              y[2] * r,
              0,
              z[0] * r,
              z[1] * r,
              z[2] * r,
              0,
              a[0],
              a[1],
              a[2],
              1,
            ];
          });
        if (c.renderer_.instances) c.renderer_.instances(b);
      },
    };
    if (c.renderer_.upload) c.renderer_.upload(b);
    live(L, ['radius', 'visible'], (k) => {
      if (k === 'radius') L.dirty = true;
    });
    c.lines_.push(L);
    c.kick_();
    return L;
  };
}
