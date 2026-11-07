// lk3d: a small engine for explorable 3D diagrams (global LK3D, or import it). A scene is data (JSON, or YAML in a
// lessonkit spec): parts made of shapes, each with a name and a note, a group, a material, how it moves apart, whether
// it spins. schema/scene.schema.json describes the format; docs/design.md how the engine works.
//
//   const s = LK3D.mount(el, FIG.generator, { info: $('#info') });
//   s.set({ spin: angle, glow: { lamp: 0.8 }, move: { piston: [0, -0.2, 0] } });  s.particles({ path, count, color }).speed = v;
//   const gas = s.particles({ count, radius, colors }); write gas.pos4 (x, y, z, colour 0..1) and call s.redraw()
//   a part with a handle (turn, slide, along) is moved by the reader's pointer or keys: opts.onHandle(id, value);
//   s.handle(id).set(v);  const rays = s.lines({ count, radius, color, glow }); rays.set(k, [x, y, z], [x, y, z])
//   const air = s.flow({ paths, count, ramp: 'cool', spread }); air.set({ speed, amount })   streaks along paths
//
// Backends, best first: WebGL 2 (physically based materials lit by a generated studio environment, soft shadows,
// creases shaded by ambient occlusion, glow), WebGL 1 (the same scene, simpler light), Canvas 2D (flat shading).
// It draws only when something changes, pauses off screen, lowers its resolution while frames are slow and moving,
// and never reads from the page layout or the GPU while drawing: labels are measured once, picking casts rays on the CPU.
import { D2R, M, sub, add, mulv, len, norm, cross, dot, rgb } from './math.js';
import { Geo, buildScene, flatten, buildShape, outlineNormals, edgesOf, bounds } from './geometry.js';
import { buildBVH, intersect, aoJob } from './bvh.js';
import { glRenderer } from './renderer-gl.js';
import { canvasRenderer } from './renderer-2d.js';
import { css } from './style.js';
import textWidth from './text.js';
import * as HD from './handles.js';
import { controls } from './controls.js';
import { pathOf, makeFlow, ramp } from './flow.js';
import { makeStream } from './stream.js';
import { tracksOf, motionMatrix, startOf } from './motion.js';
import { jointsOf, jointOf, solve as solveJoints } from './joints.js';
import * as FX from './fluids.js';
import en from './locales/en.js';
import vi from './locales/vi.js';
const mod360 = (v) => ((v % 360) + 360) % 360;

// the sun: one light for every look, for shading and for shadows alike, fixed in the scene (it stays where it is as the
// reader turns the model, as a real one would): high, from the right and in front of the usual first view, so it also
// lights what a cut opens. A look only changes how the light and its shadow are drawn
const SUN = norm([0.45, 0.8, 0.55]);

// The looks: ink (drawn: coloured pencil, hatching, ink outlines), studio (realistic) and pen (near-white solids in a few
// close tones, thin grey lines, colour only for accents). kind is what the renderers branch on.
const LOOKS = {
  ink: {
    kind: 0,
    bg: 'transparent',
    ink: [0.114, 0.102, 0.118],
    cap: [0.95, 0.86, 0.62],
    paper: [0.97, 0.96, 0.93], // (the grain's paper, the hatched shadow's pencil)
    shade: [0.11, 0.1, 0.12],
    label: 'ink',
  },
  studio: {
    kind: 1,
    bg: 'radial-gradient(ellipse at 50% 35%, #2a3240 0%, #12161d 70%, #0b0e13 100%)',
    ink: [0, 0, 0],
    cap: [0.93, 0.55, 0.25],
    shade: [0, 0, 0],
    dark: true,
    label: 'studio',
  },
  pen: {
    kind: 2,
    bg: '#fbfbfa',
    ink: [0.5, 0.52, 0.55],
    cap: [0.95, 0.62, 0.42],
    label: 'pen',
  },
};
// Colour themes (LK3D.themes; a page may add its own). A theme sets the page behind the model, the lines, the words
// on the stage (as the figure's --lk3d-* variables) and the pen look's solids and ground. With none, the drawn and
// studio looks keep their own colours; the pen look takes light.
const THEMES = {
  light: {
    bg: '#fbfbfa',
    line: '#80858c',
    ink: '#2b2e33',
    paper: '#ffffff',
    muted: '#7d828a',
    warn: '#c0392b',
    highlight: '#ffd9a8',
    solid: '#f3f2ef',
    shadow: '#4a4f57',
    dark: false,
  },
  dark: {
    bg: '#16181c',
    line: '#8d939b',
    ink: '#e8eaed',
    paper: '#22252b',
    muted: '#9aa0a8',
    warn: '#ff9b7a',
    highlight: '#7a4b1c',
    solid: '#cfd2d6',
    shadow: '#000000',
    dark: true,
  },
  blueprint: {
    bg: '#1c3d6b',
    line: '#c9dcf2',
    ink: '#eef5ff',
    paper: '#24497c',
    muted: '#a9c2e2',
    warn: '#ffd08a',
    highlight: '#3d6aa6',
    solid: '#4b74a8',
    shadow: '#0b1f3d',
    dark: true,
  },
  sepia: {
    bg: '#f2e8d5',
    line: '#8a6c4d',
    ink: '#3d2c1c',
    paper: '#f8f0e1',
    muted: '#8a7560',
    warn: '#a8402a',
    highlight: '#e8c991',
    solid: '#efe4cf',
    shadow: '#4d3520',
    dark: false,
  },
};
// the studio look's other environments (env: warm | night), behind the model
const BGS = {
  warm: 'radial-gradient(ellipse at 50% 35%, #3b3128 0%, #1a1511 70%, #0e0b09 100%)',
  night: 'radial-gradient(ellipse at 50% 30%, #18213a 0%, #0a0e1a 70%, #05070d 100%)',
};

// The screen's refresh as this page gets it, from a run of frame intervals: their median (frame timestamps jitter, so
// the shortest interval can be far below the real one: 5 ms at 60 Hz on an iPhone, measured), snapped to the nearest
// common screen rate. 30 Hz counts: some browsers run animation at 30 (Chrome on iOS does, measured).
const RATES = [144, 120, 90, 75, 60, 50, 30].map((hz) => 1000 / hz);
function refreshFrom(gaps) {
  const g = gaps.filter((x) => x > 2 && x < 200).sort((a, b) => a - b);
  if (g.length < 5) return 1000 / 60;
  const med = g[Math.floor(g.length / 2)];
  return RATES.reduce((best, r) => (Math.abs(r - med) < Math.abs(best - med) ? r : best), RATES[0]);
}

// One clock for every figure: animation reads it, not the frame's own timestamp, so a test or a tool can slow time or
// stop it and step it (LK3D.clock.speed = 0; LK3D.clock.step(100)) and draw every transition frame by frame, or set
// it to a time (clock.set(ms), backwards too: a video seeking its own timeline)
const awake = new Set(); // the figures on the page, woken when the clock is stepped or set
let clockT = 0,
  wall = 0,
  speed = 1;
const clock = {
  now() {
    const w = performance.now();
    clockT += (w - (wall || w)) * speed;
    wall = w;
    return clockT;
  },
  get speed() {
    return speed;
  },
  set speed(v) {
    clock.now();
    speed = Math.max(0, +v || 0);
  },
  step(ms) {
    clock.set(clock.now() + ms);
  },
  set(ms) {
    const was = clock.now();
    clockT = +ms || 0;
    for (const k of awake) k(was);
  },
};

// a part's name and note as HTML: plain text, keeping only bare b, i, em, strong, sub, sup and br (scenes may come
// from anyone; character references are kept, they cannot run anything)
const safeHTML = (s) =>
  String(s ?? '')
    .replace(/&(?!#?\w+;)/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/&lt;(\/?)(b|i|em|strong|sub|sup|br) ?\/?&gt;/gi, '<$1$2>');

// the same as plain text (what a label is measured by and a screen reader names)
const plainText = (s) => {
  const d = document.createElement('div');
  d.innerHTML = safeHTML(s);
  return d.textContent;
};

const FORMAT = 1; // the version of the scene format this engine reads (a scene's "lk3d" field)
let warned = false;

function context(cv, opts) {
  const attrs = {
    antialias: true,
    alpha: true, // (every pass blends premultiplied colour: the page shows through as it should)
    preserveDrawingBuffer: false,
    powerPreference: 'default', // these scenes do not need to wake a laptop's second GPU
  };
  if (opts.force2d) return null;
  try {
    if (!opts.webgl1) {
      const g = cv.getContext('webgl2', attrs);
      if (g) return g;
    }
    return cv.getContext('webgl', attrs) || cv.getContext('experimental-webgl', attrs);
  } catch (e) {
    return null;
  }
}

// Draws a scene in `el` and returns the figure's API. One closure holds the figure's state; its sections, in order:
//   the words and buttons · state · the elements (canvas, labels, hint, scale, credits) · the renderer (WebGL 2 or 1,
//   else Canvas 2D) · camera · drawing (only when something changed; adaptive resolution) · labels · picking (rays
//   against bounding-volume trees, bvh.js) · ambient occlusion (in idle slices) · pointer and handles (handles.js) ·
//   particles · lines · views and taking apart · the page's handle (the API) · the built-in controls (controls.js) ·
//   handles as range inputs (keyboard, screen readers) · watching size, visibility and the screen's density.
// the named views: [yaw, pitch] in degrees (83°: the most a drag reaches)
const VIEWS = { front: [0, 0], side: [-90, 0], top: [0, 83], iso: [-35, 25] };

function mount(el, spec, opts = {}) {
  css();
  if (el.lk3d) el.lk3d.destroy(); // (mounting again on the same element replaces the figure there)
  if (spec.lk3d > FORMAT && !warned && typeof console !== 'undefined') {
    warned = true;
    console.warn(`lk3d: this scene is written for format ${spec.lk3d}; this engine reads ${FORMAT}`);
  }
  // the words on the page (opts.locale, else LK3D.defaults.locale, else English; opts.strings change single ones), and
  // the class of the built-in buttons (opts.buttonClass, e.g. a page's own button style; else lk3d's plain one)
  const D = LK3D.defaults,
    T = { ...(LK3D.locales[opts.locale || D.locale] || en), ...D.strings, ...opts.strings };
  const own = opts.buttonClass ?? D.buttonClass,
    btnClass = 'lk3d-btn ' + (own || 'lk3d-plain');
  const t0 = performance.now(),
    stats = { setupMs: 0, firstFrameMs: null, treesMs: null, aoMs: null, refreshMs: null };
  const st = {
    style: opts.style || spec.style || 'pen',
    theme: opts.theme || spec.theme || null,
    transparent: !!opts.transparent, // (no page behind the model: the canvas clear, the stage with no background)
    timeScale: 1,
    projection: spec.view?.projection || 'perspective',
    explode: 0,
    spin: 0,
    cut: false,
    section: { normal: [0, 0, 1], offset: 0, ...spec.section }, // (the cut's plane: the scene's, moved by the page)
    labels: opts.labels || 'auto',
    xray: false,
    yaw: (spec.view?.yaw ?? -35) * D2R,
    pitch: (spec.view?.pitch ?? 18) * D2R,
    dist: 1,
    target: [0, 0, 0],
    hover: null,
    selected: null,
    motion: {}, // each motion's value (motion.js)
    joints: {}, // a joint's value set by the page, over its drive (joints.js)
  };
  // the figure is complete once its first picture is up, the trees for pointing are built, the crease shading is done
  // (there is none in 2D or with ao: false), no texture is still decoding and its edges are found: checked after each
  // picture and when the trees are done
  let done;
  const ready = new Promise((r) => (done = r));
  const settle = () => {
    if (
      done &&
      stats.firstFrameMs != null &&
      stats.treesMs != null &&
      (aoDone || R.kind === '2d' || opts.ao === false) &&
      !R.pending &&
      (!edgesWanted() || (edgeTodo && !edgeTodo.length))
    ) {
      done(api);
      done = null;
    }
  };
  const small = Math.min(screen.width, screen.height) < 700;
  const cv = document.createElement('canvas');
  const gl = context(cv, opts);
  // without WebGL the 2D fallback sorts every triangle on the CPU, so it gets coarser shapes
  const q = (opts.quality ?? (small ? 0.6 : 1)) * (gl ? 1 : 0.5);
  const S = buildScene(spec, q);
  // handles: parts the reader moves directly (and the parts each one carries with it)
  const handles = [];
  for (const p of S.parts)
    if (p.handle) {
      const h = p.handle,
        parts = [p, ...S.parts.filter((q) => q !== p && (h.moves || []).some((k) => k === q.id || k === q.group))];
      const hd = {
        p,
        h,
        v: HD.hold(h, h.value ?? 0), // (a first value outside the range: at its end from the start, not on the first drag)
        parts,
        m: h.along ? HD.measure(h.along.path, h.along.closed) : null,
        input: null,
        round: !!h.turn && h.min == null && h.max == null,
      }; // a turn with no stops (a rotor): it goes round and round
      handles.push(hd);
      for (const q of parts) q.handleOf = hd;
    }
  // motions: what moves each part, and where each motion starts
  const motions = spec.motions || [];
  for (const mo of motions) st.motion[mo.id] = startOf(mo);
  for (const p of S.parts) p.tracks = tracksOf(motions, p);
  // joints (joints.js): parts posed by how they are joined; their matrices worked out once for each set of values
  const J = jointsOf(spec);
  for (const p of S.parts) p.joint = jointOf(J, p);
  let poseKey = null,
    pose = null;
  const jointMatrix = (p) => {
    const k = JSON.stringify([st.motion, st.joints]);
    if (k !== poseKey) {
      pose = solveJoints(J, motions, st.motion, st.joints);
      poseKey = k;
    }
    return pose.matrix.get(p.joint.id);
  };

  // ---- liquids and gases (fluids.js): their state, moved on by their laws as time runs (fluidStep, in the frame loop).
  // A vessel pours through its outlet while its valve is open (Torricelli), into the liquid below, as a falling stream;
  // a gas holds its piston where pV = nRT puts it, easing there when the page heats it or adds to it
  const FL = spec.liquids || spec.gases ? FX.fluidsOf(spec) : null,
    jets = new Map(), // (a vessel's falling stream, made when it first pours)
    gasH = new Map(),
    seat = new Map(), // (each piston's lowest point as drawn: it is set on the gas, wherever the scene drew it)
    drawn = new Map(); // (each body's shape as last drawn: drawn again only when it changes)
  let fluidVer = 0;
  if (FL) {
    const { out, heights } = FX.bodies(FL);
    for (const [k, h] of heights) gasH.set(k, h);
    for (const x of FL.gases) {
      const pp = x.piston && S.parts.find((p) => p.id === x.piston);
      if (pp) seat.set(x.part, pp.lo[1]);
    }
    for (const [k, sh] of out) drawn.set(k, JSON.stringify(sh));
  }
  const colourOf = (id) => (spec.parts.find((p) => p.id === id) || {}).color || '#7fb3e4';
  // a liquid's or a gas's body drawn for its new shape: a batch of its own, sent to the GPU again
  function reshape(p, shape) {
    if (p.batches[0] && R.release) R.release(p.batches[0]);
    p.batches = [];
    p.tris = 0;
    if (!shape) return;
    const s = buildShape(shape, q),
      g = new Geo();
    g.add(s.geo, s.mats[0]);
    const b = { geo: g, mats: [M.id()], out: outlineNormals(g), dynamic: true, ver: ++fluidVer };
    if (R.upload) R.upload(b);
    p.batches = [b];
    p.tris = g.i.length / 3;
    ({ lo: p.lo, hi: p.hi } = bounds(g));
    p.center = mulv(add(p.lo, p.hi), 0.5);
    if (!Array.isArray(p.label)) p.anchor = [p.center[0], p.hi[1], p.center[2]]; // (its label: its surface)
  }
  // a vessel's liquids, stacked, and the height (in the scene) of the top one's surface
  const layersIn = (v) =>
    FX.stack(
      v.inside,
      FL.liquids.filter((l) => l.in === v.id && l.volume > 0),
    );
  const surface = (v, L = layersIn(v)) => v.at[1] + (L.length ? L[L.length - 1].h1 : v.inside[0][0]);
  // how far open a vessel's outlet is: its valve's motion along its range, or what the page set
  const openOf = (v) => {
    const mo = v.outlet.valve && motions.find((x) => x.id === v.outlet.valve);
    return mo ? (st.motion[mo.id] - mo.range[0]) / (mo.range[1] - mo.range[0]) : (v.open ?? 0);
  };
  function fluidStep(DT) {
    let busy = false;
    // (a long step, the clock stepped by hand, in slices of at most 50 ms: each pours at the head it starts with; the
    // stream and the bodies are drawn once, after the last)
    for (let n = Math.min(1200, Math.ceil(DT / 0.05 - 1e-9)) || 1, i = n, dt = DT / n; i--;) {
      for (const v of FL.vessels.values()) {
        const o = v.outlet;
        if (!o) continue;
        const L = layersIn(v),
          open = openOf(v),
          H = surface(v, L) - o.tip[1], // (the head: from the surface down to where the stream leaves)
          Q = L.length && open > 0 ? open * FX.outflow(o.radius, H, FL.g, o.cd) : 0,
          J = jets.get(v.id);
        v.flow = Q;
        if (!Q) {
          if (J) J.clear();
          continue;
        }
        busy = true;
        // the bottom layer goes first, into the liquid it becomes below
        const from = L[0].l,
          to = from.into && FL.liquids.find((l) => l.part === from.into),
          dv = Math.min(from.volume, Q * dt);
        from.volume -= dv;
        if (to) to.volume += dv;
        if (i) continue;
        // the stream: out of the tip at √(2gH), as wide as the open bore lets it, falling to the surface below
        const w = to && FL.vessels.get(to.in),
          pts = FX.jet(
            o.tip,
            mulv(norm(o.dir || [0, -1, 0]), Math.sqrt(2 * FL.g * H)),
            o.radius * Math.sqrt((o.cd ?? 0.6) * open),
            FL.g,
            w ? surface(w) : S.lo[1],
          );
        const K = J || jets.set(v.id, addLines({ count: 12, color: colourOf(from.part) })).get(v.id);
        for (let k = 0; k + 1 < pts.length; k++)
          K.set(k, pts[k].slice(0, 3), pts[k + 1].slice(0, 3), (pts[k][3] + pts[k + 1][3]) / 2);
      }
      for (const x of FL.gases) {
        const v = FL.vessels.get(x.in),
          to = FX.pistonHeight(v.inside, x.n, x.T, x.p, x.mass, FL.m),
          h = gasH.get(x.part),
          // (quasi-static: it eases to where the law puts it, without bouncing)
          nh = Math.abs(to - h) < 1e-6 * (1 + Math.abs(to)) ? to : h + (to - h) * (1 - Math.exp(-dt / 0.3));
        if (nh !== to || h !== to) busy = true;
        gasH.set(x.part, nh);
        const pp = x.piston && S.parts.find((p) => p.id === x.piston);
        if (pp) pp.offset = [0, v.at[1] + nh - seat.get(x.part), 0];
      }
    }
    // the bodies whose shape changed, drawn again
    for (const [id, sh] of FX.bodies(FL, gasH).out) {
      const k = JSON.stringify(sh);
      if (drawn.get(id) !== k) {
        drawn.set(id, k);
        reshape(
          S.parts.find((p) => p.id === id),
          sh,
        );
      }
    }
    return busy;
  }
  // the order parts are drawn in: parts that share a geometry one after another (the GPU then binds it once for them)
  const geoId = new Map(),
    drawOrder = S.parts
      .map((p, k) => [
        p,
        geoId.get(p.batches[0]?.geo) ?? geoId.set(p.batches[0]?.geo, geoId.size).get(p.batches[0]?.geo),
        k,
      ])
      .sort((a, b) => a[1] - b[1] || a[2] - b[2])
      .map(([p]) => p);
  const baseDist = spec.view?.dist ?? S.radius * 2.6;
  st.dist = baseDist;
  st.target = spec.view?.target || S.center.slice();
  const home = { yaw: st.yaw, pitch: st.pitch, dist: st.dist, target: st.target.slice() };

  // ---- the elements: a canvas, an overlay for labels and their leader lines, optional controls
  el.classList.add('lk3d');
  el.innerHTML = '';
  const stage = document.createElement('div');
  stage.className = 'lk3d-stage';
  cv.className = 'lk3d-canvas';
  cv.tabIndex = 0;
  cv.setAttribute('role', 'img');
  cv.setAttribute('aria-label', spec.alt || spec.title || T.model);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'lk3d-lines');
  const tags = document.createElement('div');
  tags.className = 'lk3d-tags';
  const hint = document.createElement('div');
  hint.className = 'lk3d-hint';
  hint.textContent = matchMedia('(pointer: coarse)').matches ? T.hintTouch : T.hintMouse;
  // the engine's name in the corner of every figure it draws: what drew it, in view with it (a screenshot keeps it)
  const mark = document.createElement('span');
  mark.className = 'lk3d-mark';
  mark.textContent = 'lk3d';
  // the scale, honestly: a bar that keeps its true length as the view zooms, and/or a note ("not to scale")
  const scaleEl = spec.scale ? document.createElement('div') : null;
  if (scaleEl) {
    scaleEl.className = 'lk3d-scale';
    scaleEl.innerHTML =
      (spec.scale.bar ? '<span class="lk3d-bar-line"></span><span class="lk3d-bar-label"></span>' : '') +
      (spec.scale.note ? '<span class="lk3d-note"></span>' : '');
    if (spec.scale.bar) scaleEl.querySelector('.lk3d-bar-label').textContent = spec.scale.bar.label;
    if (spec.scale.note) scaleEl.querySelector('.lk3d-note').textContent = spec.scale.note;
  }
  stage.append(cv, svg, tags, hint, mark, ...(scaleEl ? [scaleEl] : []));
  el.append(stage);
  // under the figure: whose it is and on what terms (the scene's author and licence), then the models made by others,
  // their authors and licences (CC BY asks for it)
  const credits = Object.entries(spec.models || {}),
    whose = spec.author || spec.license;
  if (whose || credits.length) {
    const c = document.createElement('p');
    c.className = 'lk3d-credit';
    // (a link only to a web page: not javascript: or data:, whatever the scene says)
    const link = (text, url) => {
      const web = /^https?:\/\//i.test(url),
        a = document.createElement(web ? 'a' : 'span');
      a.textContent = text;
      if (web) {
        a.href = url;
        a.target = '_blank';
        a.rel = 'noopener';
      }
      return a;
    };
    if (spec.author) c.append('© ', link(spec.author, spec.url));
    if (spec.license) c.append((spec.author ? ', ' : '') + spec.license);
    if (whose && credits.length) c.append('. ');
    if (credits.length) c.append(T.credit);
    credits.forEach(([name, m], k) => {
      if (k) c.append('; ');
      c.append(link(m.title || name, m.url), `, ${m.author}, ${m.license}` + (m.source === 'ai' ? T.ai : ''));
    });
    el.append(c);
  }

  // the renderer; if WebGL fails here (a shader that does not link, a mesh this GPU cannot index), the 2D fallback
  // draws on a second canvas under this one, which keeps receiving the pointer
  const rOpts = { shadowSize: small ? 1024 : 2048, env: spec.env, small, onTexture: () => kick() };
  let R,
    out = cv;
  const fallback2d = (err, size = true) => {
    if (typeof console !== 'undefined') console.warn('lk3d: drawing in 2D instead of WebGL:', err && err.message);
    out = document.createElement('canvas');
    out.className = 'lk3d-canvas lk3d-under';
    out.setAttribute('aria-hidden', 'true');
    cv.style.opacity = '0';
    cv.before(out);
    R = canvasRenderer(out, S);
    el.dataset.renderer = R.kind;
    if (size) sizeCanvas();
  };
  try {
    R = gl ? glRenderer(gl, S, rOpts) : canvasRenderer(cv, S);
    el.dataset.renderer = R.kind;
  } catch (e) {
    fallback2d(e, false);
  }
  cv.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    lost = true;
  });
  cv.addEventListener('webglcontextrestored', () => {
    lost = false;
    if (R && R.kind === '2d') return; // (already drawing on the 2D canvas)
    try {
      R = glRenderer(gl, S, rOpts);
    } catch {
      fallback2d();
      return;
    }
    for (const p of S.parts)
      for (const b of p.batches) {
        if (b.ao) R.setAO(b);
        if (b.lines) R.edges(b);
      }
    for (const L of lines) {
      R.upload(L.part.batches[0]);
      L.dirty = true;
    }
    kick();
  });
  let lost = false,
    dead = false;

  // ---- camera
  let VP = M.id(),
    view3 = { d: 1, h: 1, ortho: false }, // (the camera's distance and half-height, for the shaders)
    eye = [0, 0, 1],
    W = 1,
    H = 1,
    dpr = 1,
    scale = 1;
  const shift = () => mulv(spec.view?.explodeShift || [0, 0, 0], st.explode);
  // how far back the camera must stand to show the whole model from the first view, on a stage of this shape (a
  // margin around it): every point of it inside the frame, whatever its proportions and wherever the scene points the
  // camera. Never closer than the scene's own distance: only ever further, so nothing is cut off
  let fitFor = '',
    fit = 1,
    outline = null; // (points of the model at rest, at most 20 000: its shape, not its box, which a round model overfills)
  function outlinePoints() {
    let n = 0;
    for (const p of S.parts) for (const b of p.batches) n += b.geo.count * b.mats.length;
    const step = Math.max(1, Math.ceil(n / 20000)),
      out = [];
    for (const p of S.parts)
      for (const b of p.batches)
        for (const m of b.mats)
          for (let v = 0; v < b.geo.count; v += step)
            out.push(M.pt(m, [b.geo.p[3 * v], b.geo.p[3 * v + 1], b.geo.p[3 * v + 2]]));
    return out;
  }
  function fitNow() {
    const ortho = st.projection === 'ortho',
      key = W / H + (ortho ? 'o' : 'p');
    if (key === fitFor) return fit;
    fitFor = key;
    const cp = Math.cos(home.pitch),
      back = [cp * Math.sin(home.yaw), Math.sin(home.pitch), cp * Math.cos(home.yaw)],
      right = norm(cross(mulv(back, -1), [0, 1, 0])),
      up = cross(right, mulv(back, -1)),
      t = Math.tan(((spec.view?.fov ?? 35) * D2R) / 2) / 1.08;
    let need = 0;
    for (const q of (outline ??= outlinePoints())) {
      const v = sub(q, home.target);
      need = Math.max(
        need,
        (ortho ? 0 : dot(v, back)) + Math.max(Math.abs(dot(v, up)), Math.abs(dot(v, right)) / (W / H)) / t,
      );
    }
    // (and, as before, on a stage squarer than the scene's own proportions (a phone), back far enough for its width)
    return (fit = Math.max(1, (spec.w || 16) / (spec.h || 10) / (W / H), need / home.dist));
  }
  function camera() {
    const cp = Math.cos(st.pitch),
      d = st.dist * fitNow() * (1 + (spec.view?.explodeZoom ?? 0.5) * st.explode),
      tgt = add(st.target, shift());
    // orthographic: parallel lines stay parallel; framed as the perspective camera frames the point looked at. Its depth
    // range always holds the whole model, however close the reader zooms (only the frustum shrinks)
    const fov = (spec.view?.fov ?? 35) * D2R,
      h = d * Math.tan(fov / 2),
      ortho = st.projection === 'ortho',
      R = S.radius * (2 + st.explode * 2);
    eye = add(tgt, [d * cp * Math.sin(st.yaw), d * Math.sin(st.pitch), d * cp * Math.cos(st.yaw)]);
    view3 = { d, h, ortho };
    VP = M.mul(
      ortho
        ? M.ortho((-h * W) / H, (h * W) / H, -h, h, Math.min(-d * 4, d - R * 3), Math.max(d * 10, d + R * 3))
        : M.persp(fov, W / H, Math.max(0.01, d / 50), d * 10),
      M.look(eye, tgt, [0, 1, 0]),
    );
  }
  function model(p) {
    let m = M.trans(add(mulv(p.explode, st.explode), p.offset));
    if (p.tracks.length) m = M.mul(m, motionMatrix(p.tracks, st.motion));
    if (p.joint) m = M.mul(m, jointMatrix(p));
    if (p.handleOf) m = M.mul(m, HD.matrix(p.handleOf.h, p.handleOf.v, p.handleOf.m));
    if (p.spin) {
      const a = st.spin * D2R * (p.spin.ratio ?? 1),
        c = p.spin.center || [0, 0, 0];
      const r = p.spin.axis === 'y' ? M.rotY(a) : p.spin.axis === 'z' ? M.rotZ(a) : M.rotX(a);
      m = M.mul(m, M.mul(M.trans(c), M.mul(r, M.trans(mulv(c, -1)))));
    }
    return m;
  }
  // the cut's plane [n, -offset]: what lies on the side its normal points to is cut away. A cut between 0 and 1 is how
  // far the plane has swept, from just outside the model as it is now (nothing cut) to the section's own offset
  const plane = () => {
    const n = norm(st.section.normal),
      to = st.section.offset,
      k = st.cut === true ? 1 : Math.max(0, Math.min(1, +st.cut || 0));
    let from = -Infinity;
    if (k < 1) {
      for (const p of S.parts)
        if (p.cut && !p.hidden) {
          const o = add(mulv(p.explode, st.explode), p.offset);
          from = Math.max(
            from,
            dot(
              n,
              add(
                o,
                [0, 1, 2].map((a) => (n[a] > 0 ? p.hi[a] : p.lo[a])),
              ),
            ),
          );
        }
      from = Math.max(to, from + S.radius * 0.01);
    }
    return [n[0], n[1], n[2], -(k < 1 ? from + (to - from) * k : to)];
  };
  // what is on screen now (for the shadow's reach) and the floor under the assembled model
  function nowBounds() {
    const lo = [1e9, 1e9, 1e9],
      hi = [-1e9, -1e9, -1e9];
    for (const p of S.parts) {
      if (p.drawAlpha < 0.01) continue;
      const o = add(mulv(p.explode, st.explode), p.offset);
      for (let a = 0; a < 3; a++) {
        lo[a] = Math.min(lo[a], p.lo[a] + o[a]);
        hi[a] = Math.max(hi[a], p.hi[a] + o[a]);
      }
    }
    return { center: mulv(add(lo, hi), 0.5), radius: len(sub(hi, lo)) / 2 || 1, lo, hi };
  }

  // ---- drawing, only when something changed. Resolution drops while frames come late and comes back once they are on
  // time again. "Late" is measured against this screen's own refresh, measured at start: browsers may run animation at
  // 30 Hz (Chrome on iOS does, measured), and there a 33 ms frame is on time, not slow.
  // drawn while on screen (the IntersectionObserver says) and while the page is shown (the tab is in front): two
  // separate facts, so coming back to the tab does not wake a figure that is scrolled away
  let dirty = true,
    onScreen = true,
    pageShown = typeof document === 'undefined' || !document.hidden,
    visible = pageShown;
  let raf = 0,
    lastT = 0,
    slow = 0,
    good = 0,
    idleTimer = 0,
    refresh = 16.7;
  function measureRefresh() {
    // twenty frame intervals; see refreshFrom
    const ts = [];
    const f = (t) => {
      ts.push(t);
      if (ts.length < 21) requestAnimationFrame(f);
      else {
        refresh = refreshFrom(ts.slice(1).map((x, i) => x - ts[i]));
        stats.refreshMs = +refresh.toFixed(1);
      }
    };
    requestAnimationFrame(f);
  }
  measureRefresh();
  const kick = () => {
    dirty = true;
    if (!raf && visible && !dead) raf = requestAnimationFrame(frame);
  };
  function resize() {
    const narrow = el.clientWidth < 560,
      ar = narrow ? spec.narrow || '1 / 0.9' : `${spec.w || 16} / ${spec.h || 10}`;
    if (stage.style.aspectRatio !== ar) stage.style.aspectRatio = ar;
    dpr = Math.min(opts.maxDpr || 3, window.devicePixelRatio || 1);
    const r = stage.getBoundingClientRect();
    W = Math.max(1, r.width);
    H = Math.max(1, r.height);
    widths = {}; // labels change size with the layout (smaller on a phone)
    if (sizeCanvas() && visible && !dead && stats.firstFrameMs != null) {
      cancelAnimationFrame(raf);
      raf = 0;
      dirty = true;
      frame(performance.now());
    } else kick();
  }
  function sizeCanvas() {
    // true if the size changed (which clears the canvas: the caller draws again at once)
    const w = Math.round(W * dpr * scale),
      h = Math.round(H * dpr * scale);
    if (cv.width === w && cv.height === h && out.width === w) return false;
    cv.width = w;
    cv.height = h;
    if (out !== cv) {
      out.width = w;
      out.height = h;
    }
    return true;
  }
  let dprQuery = null; // a move to a screen of another density changes devicePixelRatio but not the layout
  const watchDpr = () => {
    if (typeof matchMedia === 'undefined') return;
    if (dprQuery) dprQuery.removeEventListener('change', onDpr);
    dprQuery = matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    dprQuery.addEventListener('change', onDpr);
  };
  const onDpr = () => {
    watchDpr();
    resize();
  };
  // ---- the look and the theme in use: resolved when either changes (the stage's background and variables with them);
  // the pen look's light is fixed to the camera, so it is worked out every frame
  let look = null,
    lookKey = '';
  const darkQuery = typeof matchMedia !== 'undefined' ? matchMedia('(prefers-color-scheme: dark)') : null;
  const onScheme = () => {
    if (st.theme === 'auto') kick();
  };
  if (darkQuery) darkQuery.addEventListener('change', onScheme);
  function lookNow() {
    const style = LOOKS[st.style] ? st.style : 'pen',
      base = LOOKS[style],
      name =
        st.theme === 'auto'
          ? darkQuery && darkQuery.matches
            ? 'dark'
            : 'light'
          : LK3D.themes[st.theme]
            ? st.theme
            : base.kind === 2
              ? 'light'
              : null,
      key = style + '|' + name + '|' + st.transparent;
    if (key !== lookKey) {
      const Th = name && LK3D.themes[name],
        // a transparent page (the mount's option, or a theme's bg: 'transparent'): nothing painted behind the model, in
        // any look; the theme's lines, solids and words still apply (a video lays the figure over its own picture)
        clear = st.transparent || Th?.bg === 'transparent';
      look = {
        ...base,
        ...(Th && {
          ink: rgb(Th.line),
          paper: rgb(Th.bg === 'transparent' ? Th.paper : Th.bg),
          fill: clear ? null : rgb(Th.bg),
          solid: rgb(Th.solid),
          shade: rgb(Th.shadow),
          dark: Th.dark,
        }),
      };
      lookKey = key;
      stage.style.background = clear ? 'transparent' : Th ? Th.bg : (style === 'studio' && BGS[spec.env]) || base.bg;
      stage.dataset.look = style;
      if (Th) stage.dataset.theme = name;
      else delete stage.dataset.theme;
      for (const k of ['ink', 'line', 'paper', 'muted', 'warn', 'highlight'])
        if (Th) stage.style.setProperty('--lk3d-' + k, Th[k]);
        else stage.style.removeProperty('--lk3d-' + k);
    }
    look.light = SUN;
    return look;
  }
  const anim = new Set();
  let pNow = null; // (the clock's time when liquids and gases were last moved on; null: nothing to move on from)
  // Things that run along paths (particles, flows, streams): while the clock runs, moved on by each frame's time; while
  // it is stopped, where their speed puts them at the clock's time: the value at an anchor plus speed × time since it.
  // The anchor is time 0 (or the last frame the clock ran), and moves to the last time drawn when the speed or the
  // time scale changes, or the page moves the thing itself. So one time is one picture, however the clock got there
  const anchors = new WeakMap();
  function travel(X, key, speed, t, dt, wrap) {
    const was = X[key],
      r = speed * st.timeScale;
    let a = anchors.get(X);
    if (!a) anchors.set(X, (a = { t: 0, v: was, r, at: 0, w: was }));
    let v;
    if (clock.speed) v = was + speed * dt;
    else {
      if (a.r !== r || a.w !== was) Object.assign(a, { t: a.at, v: was, r });
      v = a.v + (r * (t - a.t)) / 1000;
    }
    if (wrap) v %= wrap;
    if (clock.speed) Object.assign(a, { t, v, r });
    a.at = t;
    a.w = v;
    if (v === was) return false;
    X[key] = v;
    return true;
  }
  function frame(now) {
    raf = 0;
    if (dead) return;
    let moving = false;
    const t = clock.now(); // (now, the frame's own time, still judges whether frames come late)
    for (const a of anim) {
      if (a(t)) moving = true;
      else anim.delete(a);
    } // a tick runs while it returns true
    // particles along paths run at the speed the page gave them (never backwards: a clock set back is not a frame).
    // A clock stepped by hand moves things on by the whole step; one that runs, by at most 50 ms a frame (not a leap
    // after a hidden tab)
    const still = !clock.speed,
      pdt = pNow == null ? 0 : Math.max(0, Math.min(still ? 1e9 : 0.05, (t - pNow) / 1000)) * st.timeScale;
    let flowing = false;
    if (FL && fluidStep(pdt)) flowing = true; // (liquids pour and gases settle by their laws)
    // (all of it stands still for a reader who asked for less motion; a flow with nothing to show does not move; with
    // the clock stopped, each is placed for the clock's time, and draws again only if that moved it: see travel)
    if (!LK3D.reduce)
      for (const X of particles.concat(flows, streams))
        if (X.go && X.visible && (X.amount ?? X.density ?? 1) > 0 && (X.speed || still) && (X.go(t, pdt) || !still))
          flowing = true;
    pNow = flowing || still ? t : null;
    moving = moving || flowing;
    if ((dirty || moving) && !lost) {
      // adaptive resolution: if moving frames keep coming late, draw fewer pixels until things are still again
      // (not before the first picture has been up for a second: compiling and the first slices of background work are
      // not a sign that this device draws too slowly)
      if (
        lastT &&
        moving &&
        opts.adaptive !== false &&
        stats.firstFrameMs != null &&
        now - t0 > stats.firstFrameMs + 1000
      ) {
        const late = now - lastT > refresh * 1.5 + 1;
        slow = late ? slow + 1 : Math.max(0, slow - 1);
        good = late ? 0 : good + 1;
        if (slow > 8 && scale > 0.55) {
          scale = Math.max(0.55, scale - 0.15);
          slow = 0;
          good = 0;
          sizeCanvas();
        } else if (good > 120 && scale < 1) {
          scale = Math.min(1, scale + 0.15);
          good = 0;
          sizeCanvas();
        } // on time for a while: try more pixels
      }
      lastT = moving ? now : 0;
      if (scale < 1) {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
          if (!anim.size) {
            scale = 1;
            sizeCanvas();
            kick();
          }
        }, 350);
      }
      camera();
      const look = lookNow();
      for (const p of S.parts) {
        p.m = model(p);
        p.drawAlpha = p.hidden ? 0 : st.xray && p.xray ? 0.18 : p.alpha;
        // the pen look's colour: all of it for an accent part, a glowing one or the one chosen, a soft wash otherwise
        // (grey machine parts stay nearly white; coloured ones, an organelle or a layer, still read as their colour)
        p.tint = p.accent || p.id === st.selected || p.emit[0] + p.emit[1] + p.emit[2] > 0.01 ? 1 : 0.4;
      }
      const fl = flows.filter((F) => F.visible && F.amount > 0);
      for (const F of fl.concat(streams)) {
        if (F.update) F.update(F.owner ? F.owner.m : null);
        if (!F.colors || F.dark !== look.dark) {
          F.colors = ramp(F.ramp, look.dark);
          F.dark = look.dark;
        }
      }
      for (const L of lines)
        if (L.dirty) {
          L.place();
          L.dirty = false;
        }
      const shown = lines.length
        ? drawOrder.concat(lines.filter((L) => L.visible && L.part.batches[0].mats.length).map((L) => L.part))
        : drawOrder;
      const b = nowBounds();
      let drawn;
      try {
        drawn = R.draw({
          VP,
          eye,
          look,
          style: st.style,
          parts: shown,
          flows: fl,
          streams,
          fwd: norm(sub(add(st.target, shift()), eye)),
          edges: !!edgeTodo && edgesWanted(),
          cut: !!st.cut,
          plane: plane(),
          hatch: S.radius / 80, // (a cap's hatching: lines this far apart on the cut, a few px when the model fills the view)
          hover: st.hover,
          selected: st.selected,
          dpr: dpr * scale,
          // pixels per unit at unit distance from the eye (shaders divide by it); in ortho the size is the same everywhere
          pxPerUnit: (cv.height * view3.d) / (2 * view3.h),
          viewD: view3.ortho ? view3.d : 0,
          tanHalf: view3.h / view3.d,
          particles,
          ao: aoDone,
          shadows: true,
          bounds: b,
          ground:
            spec.ground === false
              ? null
              : {
                  center: [b.center[0], 0, b.center[2]],
                  radius: b.radius * 1.6,
                  y: S.lo[1] - 0.004,
                  contact: st.explode < 0.3 ? 1 - st.explode / 0.3 : 0,
                },
        });
      } catch (e) {
        if (R.kind === '2d') throw e;
        fallback2d(e);
        drawn = false;
      }
      if (drawn === false)
        moving = true; // shaders still compiling in the background: try again next frame
      else {
        labels();
        dirty = false;
        if (stats.firstFrameMs == null) {
          stats.firstFrameMs = performance.now() - t0;
          if (R.prewarm)
            setTimeout(() => {
              if (!dead) R.prewarm();
            }, 200);
        }
        if (edgesWanted()) findEdges(); // (after the first picture, never before it)
        settle();
      }
    }
    if (moving && visible && !raf) raf = requestAnimationFrame(frame); // one frame pending at most
  }

  // ---- labels: HTML, so they are crisp, in the page's lettering and readable by screen readers; measured once
  // (no layout reads while drawing), moved with transforms only when they actually move
  // (a label's element is made the first time it is shown: a model of thousands of parts shows few at a time)
  const tagEls = [];
  for (const p of S.parts)
    if (p.name && p.label !== false) tagEls.push({ p, t: null, x: -1, y: -1, shown: false, on: false });
  const tagOf = (i) => {
    if (!i.t) {
      const t = (i.t = document.createElement('div'));
      t.className = 'lk3d-tag';
      t.innerHTML = safeHTML(i.p.name); // (H<sub>2</sub>O, as in the info box)
      t.dataset.id = i.p.id;
      t.style.display = 'none';
      tags.append(t);
    }
    return i.t;
  };
  let widths = {};
  const unhook = textWidth.onFontsChanged(() => {
    widths = {};
    for (const i of tagEls) i.x = -1;
    kick();
  });
  // a tag's width: its text measured once in the tag's own font, plus its padding and border, read once per look and
  // layout (they differ on a phone); never a layout read while drawing
  let tagBox = {};
  function tagWidth(i) {
    const k = lookKey + i.p.id;
    if (widths[k] == null) {
      if (!tagBox[lookKey] || !widths.__box) {
        const cs = getComputedStyle(tagOf(i)),
          px = (v) => parseFloat(v) || 0;
        tagBox[lookKey] = {
          font: `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`,
          pad: px(cs.paddingLeft) + px(cs.paddingRight) + px(cs.borderLeftWidth) + px(cs.borderRightWidth) + 1,
          ls: px(cs.letterSpacing),
        };
        widths.__box = true;
      }
      const t = tagBox[lookKey];
      const text = (i.plain ??= plainText(i.p.name));
      widths[k] = textWidth(text, t.font) + t.ls * text.length + t.pad;
    }
    return widths[k];
  }
  function scaleBar() {
    // the bar's on-screen length: its scene length, projected at the point the camera looks at
    if (!scaleEl || !spec.scale.bar) return;
    const t = add(st.target, shift()),
      r = [Math.cos(st.yaw), 0, -Math.sin(st.yaw)];
    const a = M.project(VP, t, W, H),
      b = M.project(VP, add(t, mulv(r, spec.scale.bar.length)), W, H);
    const px = a && b ? Math.hypot(b[0] - a[0], b[1] - a[1]) : 0;
    scaleEl.firstChild.style.transform = `scaleX(${(px / 100).toFixed(3)})`;
  }
  const show = (i, on) => {
    if (on !== i.shown) {
      tagOf(i).style.display = on ? '' : 'none';
      i.shown = on;
    }
  };
  function labels() {
    scaleBar();
    // which tags show: 'all'; 'auto' (the part pointed at or chosen, and all of them once the model is well apart);
    // 'none'; or a list of parts and groups (exactly theirs, each shown even where it cannot find a free place)
    const L = st.labels,
      chosen = Array.isArray(L) && ((p) => L.includes(p.id) || L.includes(p.group)),
      vis = (p) =>
        !p.hidden &&
        p.drawAlpha > 0.05 &&
        (chosen
          ? chosen(p)
          : L === 'all' || p.id === st.hover || p.id === st.selected || (L === 'auto' && st.explode > 0.45));
    const c = M.project(VP, add(S.center, shift()), W, H) || [W / 2, H / 2];
    const items = [];
    for (const i of tagEls) {
      let on = L !== 'none' && vis(i.p),
        a = null;
      if (on) {
        a = M.project(
          VP,
          M.pt(
            i.p.spin || i.p.handleOf?.round ? M.trans(add(mulv(i.p.explode, st.explode), i.p.offset)) : i.p.m,
            i.p.anchor,
          ),
          W,
          H,
        );
        if (!a) on = false;
      } // a spinning part's label stays put
      if (!on) {
        show(i, false);
        continue;
      }
      let d = [a[0] - c[0], a[1] - c[1]];
      const l = Math.hypot(d[0], d[1]);
      d = l < 4 ? [0, -1] : [d[0] / l, d[1] / l];
      items.push({
        i,
        a,
        x: a[0] + d[0] * 46,
        y: a[1] + d[1] * 34 - 8,
        right: d[0] >= 0,
        first: i.p.id === st.hover || i.p.id === st.selected,
        size: len(sub(i.p.hi, i.p.lo)),
      });
    }
    // labels placed one by one: the part pointed at or chosen first, then the largest parts; a label that would overlap
    // one already placed tries a line or two up and down, and otherwise waits until the reader points at its part (a
    // model of a hundred parts would bury itself in labels)
    items.sort((u, v) => v.first - u.first || v.size - u.size);
    const placed = [];
    let lines = '';
    for (const it of items) {
      const w = tagWidth(it.i),
        x = Math.round(Math.max(2, Math.min(W - w - 2, it.right ? it.x : it.x - w)));
      let y = null;
      for (const dy of [0, 22, -22, 44, -44]) {
        const yy = Math.round(Math.max(2, Math.min(H - 22, it.y + dy)));
        if (!placed.some((r) => x < r.x + r.w + 4 && r.x < x + w + 4 && yy < r.y + 22 && r.y < yy + 22)) {
          y = yy;
          break;
        }
      }
      if (y == null && (it.first || chosen)) y = Math.round(Math.max(2, Math.min(H - 22, it.y)));
      show(it.i, y != null);
      if (y == null) continue;
      placed.push({ x, y, w });
      if (x !== it.i.x || y !== it.i.y) {
        it.i.t.style.transform = `translate(${x}px, ${y}px)`;
        it.i.x = x;
        it.i.y = y;
      }
      const on = it.first;
      if (on !== it.i.on) {
        it.i.t.classList.toggle('on', on);
        it.i.on = on;
      }
      const ex = it.right ? x : x + w,
        ey = y + 11;
      lines += `<line x1="${it.a[0].toFixed(1)}" y1="${it.a[1].toFixed(1)}" x2="${ex}" y2="${ey}"/><circle cx="${it.a[0].toFixed(1)}" cy="${it.a[1].toFixed(1)}" r="2.2"/>`;
    }
    if (lines !== svg.__last) {
      svg.innerHTML = lines;
      svg.__last = lines;
    }
  }

  // ---- picking: a ray from the eye through the pointer, against each part's shapes (bounding-volume trees, built
  // lazily); the nearest hit on a part that is drawn and not cut away
  const trees = new WeakMap(); // (per geometry: parts alike share one tree)
  function bvhOf(b) {
    if (!b.bvh) {
      if (!trees.has(b.geo)) trees.set(b.geo, buildBVH(b.geo));
      b.bvh = trees.get(b.geo);
    }
    return b.bvh;
  }
  function rayAt(px, py) {
    // the ray from the eye through a point of the stage
    camera();
    const inv = M.invert(VP),
      nx = (px / W) * 2 - 1,
      ny = 1 - (py / H) * 2;
    const p0 = M.pt(inv, [nx, ny, -1]),
      w0 = inv[3] * nx + inv[7] * ny - inv[11] + inv[15],
      p1 = M.pt(inv, [nx, ny, 1]),
      w1 = inv[3] * nx + inv[7] * ny + inv[11] + inv[15];
    const A = mulv(p0, 1 / w0),
      B = mulv(p1, 1 / w1),
      dir = sub(B, A);
    return { A, D: mulv(dir, 1 / len(dir)) };
  }
  const pickAt = (px, py, see) => pickHit(px, py, see).id;
  // where the ray A + D t enters a part's box as it is now (its box at rest, moved by its matrix), or Infinity
  function rayBox(A, D, p) {
    const lo = [Infinity, Infinity, Infinity],
      hi = [-Infinity, -Infinity, -Infinity];
    for (let c = 0; c < 8; c++) {
      const w = M.pt(p.m, [c & 1 ? p.hi[0] : p.lo[0], c & 2 ? p.hi[1] : p.lo[1], c & 4 ? p.hi[2] : p.lo[2]]);
      for (let a = 0; a < 3; a++) {
        lo[a] = Math.min(lo[a], w[a]);
        hi[a] = Math.max(hi[a], w[a]);
      }
    }
    let t0 = 0,
      t1 = Infinity;
    for (let a = 0; a < 3; a++) {
      if (!D[a]) {
        if (A[a] < lo[a] || A[a] > hi[a]) return Infinity; // (parallel to this side, and outside it)
        continue;
      }
      const u = (lo[a] - A[a]) / D[a],
        v = (hi[a] - A[a]) / D[a];
      t0 = Math.max(t0, Math.min(u, v));
      t1 = Math.min(t1, Math.max(u, v));
    }
    return t0 <= t1 ? t0 : Infinity;
  }
  function pickHit(px, py, see = 0.3) {
    // parts fainter than `see` let the ray through; the part hit, and where along the ray (A + D t)
    const { A, D } = rayAt(px, py),
      pl = plane();
    let best = Infinity,
      id = null;
    for (const p of S.parts) {
      if (p.drawAlpha < see || rayBox(A, D, p) >= best) continue; // (missed by the ray, or behind a nearer hit)
      for (const b of p.batches)
        for (const im of b.mats) {
          const Wm = M.mul(p.m, im),
            Iv = M.invert(Wm),
            o = M.pt(Iv, A),
            d = M.dir(Iv, D);
          const accept =
            st.cut && p.cut
              ? (t) => {
                  const w = add(A, mulv(D, t));
                  return pl[0] * w[0] + pl[1] * w[1] + pl[2] * w[2] + pl[3] <= 0;
                }
              : null;
          const h = intersect(b.geo, bvhOf(b), o, d, best, false, accept);
          if (h && h.t < best) {
            best = h.t;
            id = p.id;
          }
        }
    }
    return { id, t: best, A, D };
  }

  // ---- zooming: by k (more than 1: closer), towards a point of the stage when given, so that what is under the
  // pointer stays under it (the part hit there, else the point on the plane through the target facing the camera)
  const minZoom = spec.view?.minZoom ?? 0.02;
  function zoom(k, x, y) {
    cancelView();
    const to = Math.max(baseDist * minZoom, Math.min(baseDist * 3, st.dist / k)),
      f = to / st.dist;
    if (x != null && f !== 1) {
      const { t, A, D } = pickHit(x, y, 0.3),
        tgt = add(st.target, shift()),
        n = norm(sub(tgt, eye)),
        P = add(A, mulv(D, Number.isFinite(t) ? t : dot(sub(tgt, A), n) / (dot(D, n) || 1)));
      st.target = sub(add(P, mulv(sub(tgt, P), f)), shift());
    }
    st.dist = to;
    kick();
  }

  // ---- ambient occlusion: creases and the insides of hollow parts darkened, computed a slice at a time after the
  // first picture (a few milliseconds per frame), then drawn
  let aoDone = false;
  const batchesAll = [];
  for (const p of S.parts) if (!p.fluid) for (const b of p.batches) batchesAll.push(b); // (a fluid's shape changes)
  {
    // the intersection trees first, in idle time just after the first picture, so pointing never waits for one
    const todo = batchesAll.slice();
    const build = () => {
      if (dead) return;
      const end = performance.now() + 6;
      while (todo.length && performance.now() < end) bvhOf(todo.shift());
      if (todo.length) setTimeout(build, 16);
      else {
        stats.treesMs = performance.now() - t0;
        settle();
      }
    };
    setTimeout(build, 30);
  }
  if (R.kind !== '2d' && opts.ao !== false) {
    const queue = batchesAll.slice(),
      aoOf = new Map();
    let cur = null;
    const work = () => {
      if (dead) return;
      const end = performance.now() + 6;
      while (performance.now() < end) {
        if (!cur) {
          const b = queue.shift();
          if (b && aoOf.has(b.geo)) {
            // (a geometry shared by parts alike: its crease shading is the same, made once)
            b.ao = aoOf.get(b.geo);
            R.setAO(b);
            continue;
          }
          if (!b) {
            aoDone = true;
            stats.aoMs = performance.now() - t0;
            kick();
            settle();
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
          cur = { b, job: aoJob(g, bvhOf(b), Math.max(0.02, Math.min(len(sub(hi, lo)) * 0.25, S.radius * 0.12))) };
        }
        if (cur.job.step(Math.max(1, end - performance.now()))) {
          cur.b.ao = cur.job.out;
          aoOf.set(cur.b.geo, cur.job.out);
          R.setAO(cur.b);
          cur = null;
        }
      }
      setTimeout(work, 16);
    };
    setTimeout(work, 60);
  }

  // ---- edges: drawn in the pen look (and in any look with the scene's edges: true; never with edges: false), found in
  // idle slices once a look needs them (a figure that never shows them never pays for them), drawn as they arrive
  const edgesWanted = () => !!R.edges && !!look && (look.kind === 2 ? spec.edges !== false : spec.edges === true);
  let edgeTodo = null;
  const linesOf = new Map(); // (a geometry's edges, for every batch that shares it)
  function findEdges() {
    if (edgeTodo) return;
    edgeTodo = batchesAll.filter((b) => b.edgy);
    const work = () => {
      if (dead) return;
      const end = performance.now() + 6;
      while (edgeTodo.length && performance.now() < end) {
        const b = edgeTodo.shift();
        b.lines = linesOf.get(b.geo) || edgesOf(b.geo, 40, b.soft);
        linesOf.set(b.geo, b.lines);
        if (b.gl) R.edges(b);
      }
      kick();
      if (edgeTodo.length) setTimeout(work, 16);
    };
    setTimeout(work, 30);
  }

  // ---- pointer: orbit, pan, pinch, wheel (only with Ctrl, or once the figure has been clicked), hover and pick
  const pts = new Map();
  let drag = null,
    active = false,
    lastPick = 0,
    moved = 0,
    pinch = 0,
    vel = [0, 0, 0];
  const local = (e) => {
    const r = cv.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  let glideFn = null,
    grab = null;
  // the handle under a point: the part hit, or (for small handles, on touch) one whose middle is within reach
  function handleAt(x, y) {
    if (!handles.length) return null;
    const id = pickAt(x, y, 0.6),
      hit = id && S.parts.find((p) => p.id === id); // a handle is grabbed through glass
    if (hit && hit.handleOf) return hit.handleOf;
    // a small handle (a planet, a focal point) is also caught close by, whatever is in front of it: fingers are wide
    let best = null,
      bd = 1e9;
    for (const hd of handles) {
      const p = hd.p;
      if (p.hidden || p.drawAlpha < 0.05) continue;
      const c = M.pt(p.m, p.center),
        s = M.project(VP, c, W, H),
        e = M.project(VP, add(c, [len(sub(p.hi, p.lo)) / 2, 0, 0]), W, H);
      if (!s) continue;
      const r = e ? Math.hypot(e[0] - s[0], e[1] - s[1]) : 0,
        d = Math.hypot(x - s[0], y - s[1]);
      if (r < 40 && d < r + 16 && d < bd) {
        bd = d;
        best = hd;
      }
    }
    return best;
  }
  // a handle's frame in the scene now (it moves with taking apart and with offsets, not with its own value)
  const handleBase = (hd) => M.trans(add(mulv(hd.p.explode, st.explode), hd.p.offset));
  function dragHandle(x, y) {
    const hd = grab.hd,
      h = hd.h,
      { A, D } = rayAt(x, y),
      base = handleBase(hd);
    let v = hd.v;
    if (h.turn) {
      const ang = HD.turnAngle(A, D, { turn: { axis: h.turn.axis, center: M.pt(base, h.turn.center || [0, 0, 0]) } });
      if (grab.last == null) grab.last = ang;
      grab.acc += HD.unwrap(ang - grab.last);
      grab.last = ang;
      v = HD.hold(h, grab.start + grab.acc);
    } else if (h.slide) {
      const s = HD.slideAt(A, D, h, M.pt(base, hd.p.center));
      if (s == null) return;
      if (grab.s0 == null) grab.s0 = s;
      v = HD.hold(h, grab.start + (s - grab.s0));
    } else if (h.along) {
      const screen = hd.m.P.map((q) => M.project(VP, M.pt(base, q), W, H));
      v = HD.hold(h, HD.nearestAlong(hd.m, screen, x, y));
    }
    setHandle(hd, v, true);
  }
  function setHandle(hd, v, byReader) {
    if (!Number.isFinite(v) || v === hd.v) return;
    hd.v = v;
    if (hd.input) {
      hd.input.value = String(hd.round ? mod360(v) : v);
      hd.input.setAttribute('aria-valuetext', valueText(hd));
    }
    kick();
    if (byReader && opts.onHandle) opts.onHandle(hd.p.id, v);
  }
  // what a screen reader says for a handle: the page's words (opts.handleText(id, value), e.g. "d = 45 cm"), or the value
  const valueText = (hd) =>
    (opts.handleText && opts.handleText(hd.p.id, hd.v)) ||
    `${+(hd.round ? mod360(hd.v) : hd.v).toFixed(hd.dp)}${hd.h.unit || (hd.h.turn ? '°' : '')}`.replace('.', T.decimal);
  const capture = (id) => {
    try {
      cv.setPointerCapture(id);
    } catch {
      // (not a pointer the browser tracks: nothing to capture)
    }
  };
  cv.addEventListener('pointerdown', (e) => {
    cancelView(); // the reader takes over from a gliding view
    if (glideFn) {
      anim.delete(glideFn);
      glideFn = null;
    } // a grab stops the model
    if (!pts.size) {
      const [x, y] = local(e),
        hd = handleAt(x, y);
      if (hd) {
        // the reader takes hold of a handle: it moves, the view does not
        grab = { hd, id: e.pointerId, start: hd.v, acc: 0, last: null, s0: null, moved: 0 };
        capture(e.pointerId);
        cv.style.cursor = 'grabbing';
        hint.classList.add('gone');
        active = true;
        dragHandle(x, y);
        e.preventDefault();
        return;
      }
    }
    capture(e.pointerId);
    pts.set(e.pointerId, [e.clientX, e.clientY]);
    moved = 0;
    active = true;
    drag = { pan: e.shiftKey || e.button === 2 };
    hint.classList.add('gone');
  });
  cv.addEventListener('pointermove', (e) => {
    if (grab && e.pointerId === grab.id) {
      const [x, y] = local(e);
      grab.moved += Math.abs(e.movementX || 0) + Math.abs(e.movementY || 0);
      dragHandle(x, y);
      return;
    }
    if (pts.has(e.pointerId)) {
      const prev = pts.get(e.pointerId);
      pts.set(e.pointerId, [e.clientX, e.clientY]);
      const dx = e.clientX - prev[0],
        dy = e.clientY - prev[1];
      moved += Math.abs(dx) + Math.abs(dy);
      if (pts.size === 2) {
        const [p1, p2] = [...pts.values()],
          now = Math.hypot(p1[0] - p2[0], p1[1] - p2[1]);
        if (pinch > 0 && now > 0) {
          const r = cv.getBoundingClientRect();
          zoom(now / pinch, (p1[0] + p2[0]) / 2 - r.left, (p1[1] + p2[1]) / 2 - r.top); // towards the fingers' middle
        }
        pinch = now;
      } else if (drag && drag.pan) {
        const k = (st.dist / H) * 1.2,
          right = [Math.cos(st.yaw), 0, -Math.sin(st.yaw)],
          up = [-Math.sin(st.pitch) * Math.sin(st.yaw), Math.cos(st.pitch), -Math.sin(st.pitch) * Math.cos(st.yaw)];
        st.target = add(st.target, add(mulv(right, -dx * k), mulv(up, dy * k)));
      } else {
        st.yaw -= dx * 0.008;
        st.pitch = Math.max(-1.45, Math.min(1.45, st.pitch + dy * 0.008));
        const now = performance.now(),
          dt = Math.max(4, now - (vel[2] || now - 16.7));
        vel = [(dx * 16.7) / dt, (dy * 16.7) / dt, now];
      }
      kick();
    } else if (performance.now() - lastPick > 40) {
      lastPick = performance.now();
      const [x, y] = local(e),
        id = pickAt(x, y);
      const onHandle = id ? !!S.parts.find((p) => p.id === id)?.handleOf : !!handleAt(x, y);
      if (id !== st.hover || onHandle !== cv._onHandle) {
        st.hover = id;
        cv._onHandle = onHandle;
        cv.style.cursor = onHandle ? 'grab' : id ? 'pointer' : 'grab';
        info('hover');
        kick();
      }
    }
  });
  const end = (e) => {
    if (grab && e.pointerId === grab.id) {
      // let go of a handle; a tap without moving selects the part, as elsewhere
      if (grab.moved < 4 && e.type === 'pointerup') {
        st.selected = grab.hd.p.id === st.selected ? null : grab.hd.p.id;
        info('pick');
      }
      grab = null;
      cv.style.cursor = 'grab';
      kick();
      return;
    }
    if (!pts.has(e.pointerId)) return;
    pts.delete(e.pointerId);
    pinch = 0;
    if (moved < 6 && e.type === 'pointerup') {
      const [x, y] = local(e),
        id = pickAt(x, y);
      st.selected = id && id !== st.selected ? id : null;
      info('pick');
      kick();
    } else if (!pts.size && Math.hypot(vel[0], vel[1]) > 2 && performance.now() - vel[2] < 80 && !LK3D.reduce) {
      // only if still moving when let go
      let v = vel.slice(0, 2).map((x) => Math.max(-30, Math.min(30, x))),
        prev = 0;
      const glide = (now) => {
        const dt = prev ? Math.max(0, Math.min(50, now - prev)) : 16.7;
        prev = now;
        const k = Math.pow(0.9, dt / 16.7),
          f = dt / 16.7;
        v = [v[0] * k, v[1] * k];
        st.yaw -= v[0] * 0.008 * f;
        st.pitch = Math.max(-1.45, Math.min(1.45, st.pitch + v[1] * 0.008 * f));
        dirty = true;
        if (Math.hypot(v[0], v[1]) < 0.3) {
          glideFn = null;
          return false;
        }
        return true;
      };
      glideFn = glide;
      anim.add(glide);
      kick();
    }
    vel = [0, 0, 0];
    drag = null;
  };
  cv.addEventListener('pointerup', end);
  cv.addEventListener('pointercancel', end);
  cv.addEventListener('pointerleave', () => {
    if (!pts.size && st.hover) {
      st.hover = null;
      info('hover');
      kick();
    }
  });
  cv.addEventListener('contextmenu', (e) => e.preventDefault());
  cv.addEventListener(
    'wheel',
    (e) => {
      if (!(e.ctrlKey || active)) return; // never hijack the page's scrolling
      e.preventDefault();
      const [x, y] = local(e);
      zoom(Math.exp(-e.deltaY * 0.0015), x, y);
    },
    { passive: false },
  );
  const outside = (e) => {
    if (!el.contains(e.target)) active = false;
  };
  document.addEventListener('pointerdown', outside);
  cv.addEventListener('keydown', (e) => {
    const k = { ArrowLeft: [0.12, 0], ArrowRight: [-0.12, 0], ArrowUp: [0, 0.1], ArrowDown: [0, -0.1] }[e.key];
    if (k) {
      cancelView();
      st.yaw += k[0];
      st.pitch = Math.max(-1.45, Math.min(1.45, st.pitch + k[1]));
      kick();
      e.preventDefault();
    }
    const z = { '+': 1.15, '=': 1.15, '-': 1 / 1.15 }[e.key];
    if (z) zoom(z);
  });
  // the info box: the part chosen, else the one under the pointer. why: 'pick' (the reader chose a part: onPick),
  // 'hover' (the pointer moved onto or off a part: onHover), or nothing (a page's own select(), the first picture)
  function info(why) {
    const id = st.selected || st.hover,
      p = S.parts.find((x) => x.id === id);
    if (opts.info)
      opts.info.innerHTML = p
        ? `<b>${safeHTML(p.name)}</b>${p.note ? ' ' + safeHTML(p.note) : ''}`
        : safeHTML(opts.infoIdle);
    const cb = why === 'pick' ? opts.onPick : why === 'hover' ? opts.onHover : null;
    if (cb) cb(why === 'hover' ? S.parts.find((x) => x.id === st.hover) || null : p || null);
  }

  // properties a page sets by assignment (fig.particles(…).speed = 2): setting one draws again, and runs `then`
  function live(h, keys, then) {
    for (const k of keys) {
      let v = h[k];
      Object.defineProperty(h, k, {
        enumerable: true,
        get: () => v,
        set(x) {
          v = x;
          if (then) then(k);
          kick();
        },
      });
    }
    return h;
  }

  // ---- particles: points moving along paths (air, current, blood), whose speed the page sets; or, without a path,
  // points the page places itself (molecules of a gas: solid balls of a radius in scene units, in one of the three
  // `colors` by the fourth number of each point: below 0.35, up to 0.65, above)
  const particles = [];
  function addParticles({
    path,
    count = 30,
    color = '#ffd25a',
    size = 7,
    part = null,
    closed = false,
    radius = 0,
    colors = null,
  }) {
    if (!path) {
      const h = {
        solid: true,
        radius,
        ramp: (colors || [color, color, color]).map(rgb),
        count,
        pos4: new Float32Array(count * 4),
        visible: true,
        version: 0, // (the page adds one after moving the points: they are sent to the GPU again)
        update() {},
        resize(n) {
          if (n * 4 > h.pos4.length) h.pos4 = new Float32Array(n * 4);
          h.count = n;
        },
        remove() {
          const k = particles.indexOf(h);
          if (k >= 0) particles.splice(k, 1);
          if (R.release) R.release(h);
          kick();
        },
      };
      live(h, ['visible', 'radius', 'version', 'count']);
      particles.push(h);
      kick();
      return h;
    }
    const line = pathOf(path, closed),
      total = line.total;
    const h = {
      color: rgb(color),
      size,
      speed: 0,
      offset: 0,
      count,
      part,
      pos4: new Float32Array(count * 4),
      visible: true,
      remove() {
        const k = particles.indexOf(h);
        if (k >= 0) particles.splice(k, 1);
        kick();
      },
    };
    const owner = part ? S.parts.find((x) => x.id === part) : null;
    h.update = () => {
      const m = owner ? owner.m : null;
      for (let i = 0; i < h.count; i++) {
        const p = line.at(((((i / h.count + h.offset) % 1) + 1) % 1) * total),
          w = m ? M.pt(m, p) : p;
        h.pos4[4 * i] = w[0];
        h.pos4[4 * i + 1] = w[1];
        h.pos4[4 * i + 2] = w[2];
        h.pos4[4 * i + 3] = 1;
      }
    };
    h.go = (t, dt) => travel(h, 'offset', total ? h.speed / total : 0, t, dt);
    live(h, ['speed', 'visible', 'offset']);
    particles.push(h);
    kick();
    return h;
  }

  // ---- flows: streaks along paths (flow.js), moved on in the frame loop; the page sets how fast and how many
  const flows = [];
  function addFlow(o) {
    const F = makeFlow(o);
    F.owner = o.part ? S.parts.find((x) => x.id === o.part) : null;
    F.go = (t, dt) => travel(F, 'dist', F.speed, t, dt);
    const h = {
      set(o) {
        for (const k of ['speed', 'amount', 'length', 'width', 'spread', 'opacity', 'visible', 'ramp'])
          if (k in o) F[k] = o[k];
        F.colors = null; // (the ramp's colours, worked out again for the look in use)
        kick();
      },
      remove() {
        const k = flows.indexOf(F);
        if (k >= 0) flows.splice(k, 1);
        if (R.release) R.release(F);
        kick();
      },
    };
    // speed, amount and visible also as properties: setting one draws again
    for (const k of ['speed', 'amount', 'visible'])
      Object.defineProperty(h, k, {
        get: () => F[k],
        set(v) {
          h.set({ [k]: v });
        },
      });
    flows.push(F);
    kick();
    return h;
  }

  // ---- streams: air or gas as a volume moving along a path (stream.js; drawn by the GPU). Where there is no WebGL,
  // streaks along the same path stand in for it
  const streams = [];
  function addStream(o) {
    if (R.kind === '2d') {
      // (without WebGL: streaks along the same path, as many as the stream is dense)
      const f = addFlow({ ...o, paths: [o.path], count: 120, spread: typeof o.radius === 'number' ? o.radius : 0.1 });
      const set = f.set;
      f.set = (q) => set('density' in q ? { ...q, amount: Math.min(1, q.density) } : q);
      Object.defineProperty(f, 'density', {
        get: () => f.amount,
        set(v) {
          f.set({ density: v });
        },
      });
      if (o.density != null) f.set({ density: o.density });
      return f;
    }
    const T = makeStream(o);
    T.go = (t, dt) => travel(T, 'phase', T.speed, t, dt, 3000); // (kept small for the GPU's precision)
    const h = {
      set(o) {
        for (const k of ['speed', 'density', 'turbulence', 'swirl', 'visible', 'ramp']) if (k in o) T[k] = o[k];
        T.colors = null;
        kick();
      },
      remove() {
        const k = streams.indexOf(T);
        if (k >= 0) streams.splice(k, 1);
        if (R.release) R.release(T);
        kick();
      },
    };
    for (const k of ['speed', 'density', 'visible'])
      Object.defineProperty(h, k, {
        get: () => T[k],
        set(v) {
          h.set({ [k]: v });
        },
      });
    streams.push(T);
    kick();
    return h;
  }

  // ---- lines: rods between points the page sets (rays of light, field lines, forces), drawn by instancing one
  // cylinder, so a hundred rays cost one draw; they are shaded, outlined and can glow like any part
  const lines = [];
  function addLines({ count = 8, radius = 0.01, color = '#ffcc55', studioColor, glow = null } = {}) {
    const unit = buildShape({ cylinder: { r: 1, x0: 0, x1: 1 } }, 0.5).geo,
      b = { geo: unit, mats: [], out: outlineNormals(unit), dynamic: true };
    const part = {
      id: '__lines' + lines.length,
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
      set(k, a, c, r) {
        if (k >= 0 && k < segs.length) {
          segs[k] = a && c ? [a, c, r] : null;
          L.dirty = true;
          kick();
        }
      },
      clear() {
        segs.fill(null);
        L.dirty = true;
        kick();
      },
      glow(v) {
        part.emit = mulv(part.glowColor, v);
        kick();
      },
      remove() {
        const k = lines.indexOf(L);
        if (k >= 0) lines.splice(k, 1);
        if (R.release) R.release(b);
        kick();
      },
      place() {
        // each segment: the unit cylinder along x, stretched to the segment and thinned to the radius
        b.mats = segs
          .filter(Boolean)
          .filter(([a, c]) => len(sub(c, a)) > 1e-9)
          .map(([a, c, rr]) => {
            const d = sub(c, a),
              l = len(d),
              x = mulv(d, 1 / l),
              up = Math.abs(x[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
            const z = norm(cross(x, up)),
              y = cross(z, x),
              r = rr ?? L.radius;
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
        if (R.instances) R.instances(b);
      },
    };
    if (R.upload) R.upload(b);
    live(L, ['radius', 'visible'], (k) => {
      if (k === 'radius') L.dirty = true;
    });
    lines.push(L);
    kick();
    return L;
  }

  // ---- tweening the camera to a view, and taking apart
  // a named view, [yaw, pitch] (degrees), or {yaw, pitch, dist | zoom, target}: any of them, the rest kept; over
  // o.ms milliseconds (600), or at once (0: a page that places the camera itself every frame)
  function view(name, o = {}) {
    if (typeof name === 'string' && !VIEWS[name] && name !== 'home') return; // (a view this engine does not know)
    const obj = name && typeof name === 'object' && !Array.isArray(name);
    const V = obj
      ? [name.yaw ?? st.yaw / D2R, name.pitch ?? st.pitch / D2R]
      : name === 'home'
        ? [home.yaw / D2R, home.pitch / D2R]
        : VIEWS[name] || name;
    const from = { yaw: st.yaw, pitch: st.pitch, dist: st.dist, target: st.target.slice() };
    const to = {
      yaw: V[0] * D2R,
      pitch: V[1] * D2R,
      dist: obj ? (name.zoom ? baseDist / name.zoom : (name.dist ?? st.dist)) : name === 'home' ? home.dist : st.dist,
      target: obj ? name.target || st.target : name === 'home' ? home.target : st.target,
    };
    const t0 = clock.now(),
      T = LK3D.reduce ? 1 : (o.ms ?? 600);
    // (a glide takes the short way round; a view placed at once keeps the angle the page gave)
    while (T > 0 && to.yaw - from.yaw > Math.PI) to.yaw -= 2 * Math.PI;
    while (T > 0 && from.yaw - to.yaw > Math.PI) to.yaw += 2 * Math.PI;
    const tw = (now) => {
      const u = T > 0 ? Math.max(0, Math.min(1, (now - t0) / T)) : 1,
        e = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
      st.yaw = from.yaw + (to.yaw - from.yaw) * e;
      st.pitch = from.pitch + (to.pitch - from.pitch) * e;
      st.dist = from.dist + (to.dist - from.dist) * e;
      st.target = add(from.target, mulv(sub(to.target, from.target), e));
      dirty = true;
      if (u >= 1) {
        anim.delete(tw);
        return false;
      }
      return true;
    };
    cancelView();
    if (!(T > 0)) return (tw(t0), kick());
    viewTw = tw;
    anim.add(tw);
    kick();
  }
  let viewTw = null,
    explodeTw = null;
  const cancelView = () => {
    if (viewTw) anim.delete(viewTw);
    viewTw = null;
  };
  function setExplode(v) {
    st.explode = Math.max(0, Math.min(1, v));
    if (hooks.explode) hooks.explode(st.explode);
  }
  function tweenExplode(to) {
    const from = st.explode,
      t0 = clock.now(),
      T = LK3D.reduce ? 1 : 900;
    const tw = (now) => {
      const u = Math.max(0, Math.min(1, (now - t0) / T)),
        e = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
      setExplode(from + (to - from) * e);
      dirty = true;
      if (u >= 1) {
        anim.delete(tw);
        explodeTw = null;
        return false;
      }
      return true;
    };
    if (explodeTw) anim.delete(explodeTw);
    explodeTw = tw;
    anim.add(tw);
    kick();
  }

  // ---- motions (motion.js): a value set by the page or the reader, or played: on along its range at its speed (a
  // second a range by default), round again if it loops, else to its end and back the next time it is played
  const playing = new Map(); // a motion's id → its step in the frame loop
  function setMotion(mo, v) {
    const [a, b] = mo.range;
    st.motion[mo.id] = mo.loop ? a + ((((v - a) % (b - a)) + (b - a)) % (b - a)) : Math.max(a, Math.min(b, v));
    if (hooks.motion) hooks.motion(mo.id);
    kick();
  }
  function stopMotion(mo) {
    anim.delete(playing.get(mo.id));
    playing.delete(mo.id);
    if (hooks.motion) hooks.motion(mo.id);
  }
  function playMotion(mo) {
    stopMotion(mo);
    const [a, b] = mo.range,
      back = !mo.loop && st.motion[mo.id] >= b; // (at its end: played back to the start)
    if (LK3D.reduce) return mo.loop || setMotion(mo, back ? a : b); // (no movement: straight to where it goes)
    let last = clock.now();
    const step = (now) => {
      // (the whole of a step of the clock stopped by hand; while it runs, at most 50 ms: not a leap after a hidden tab)
      const dt = Math.max(0, Math.min(clock.speed ? 0.05 : 1e9, (now - last) / 1000)),
        v = st.motion[mo.id] + (back ? -1 : 1) * (mo.speed ?? b - a) * dt * st.timeScale;
      last = now;
      setMotion(mo, v);
      if (!mo.loop && (back ? v <= a : v >= b)) return (stopMotion(mo), false);
      return true;
    };
    playing.set(mo.id, step);
    anim.add(step);
    if (hooks.motion) hooks.motion(mo.id);
    kick();
  }

  const hooks = {}; // the built-in controls' hooks (made below, once the page's handle exists)

  // ---- the page's handle
  const api = {
    get renderer() {
      return R.kind;
    },
    get hifi() {
      return R.hifi;
    },
    parts: S.parts,
    // resolves once the figure is complete: the first picture, the crease shading, every texture and model
    ready,
    view,
    // zoom by a factor (2: twice as close), towards a point of the stage (x, y in CSS pixels) if given
    zoom,
    get zoomLevel() {
      return baseDist / st.dist;
    },
    explode: tweenExplode,
    // where the camera is (degrees and scene units), the part chosen, the labels and look in use
    camera() {
      return { yaw: st.yaw / D2R, pitch: st.pitch / D2R, dist: st.dist, target: st.target.slice() };
    },
    get selected() {
      return st.selected;
    },
    select(id) {
      st.selected = id ?? null;
      info();
      kick();
    },
    get labels() {
      return st.labels;
    },
    get style() {
      return st.style;
    },
    get theme() {
      return st.theme;
    },
    get timeScale() {
      return st.timeScale;
    },
    _state: st, // the engine's own state: not an API, it may change
    set(o) {
      if ('explode' in o) {
        if (explodeTw) anim.delete(explodeTw); // (the page's own value wins over a running tween)
        explodeTw = null;
        setExplode(o.explode);
      }
      for (const k of ['spin', 'cut', 'labels', 'xray', 'style', 'theme', 'projection']) if (k in o) st[k] = o[k];
      if ('transparent' in o) st.transparent = !!o.transparent;
      if (o.section) st.section = { ...st.section, ...o.section };
      if (o.camera) view(o.camera, { ms: 0 }); // (placed at once: the page's camera wins over a gliding view)
      if ('timeScale' in o) st.timeScale = Math.max(0, +o.timeScale || 0);
      if (hooks.style) hooks.style(); // (the buttons: the look's name, which toggles are on)
      if (o.move)
        for (const [id, v] of Object.entries(o.move)) {
          const p = S.parts.find((x) => x.id === id);
          if (p) p.offset = v;
        }
      if (o.glow)
        for (const [id, v] of Object.entries(o.glow)) {
          const p = S.parts.find((x) => x.id === id);
          if (p) p.emit = mulv(p.glowColor, v);
        }
      if (o.joints) st.joints = { ...o.joints }; // (each call says all the page sets: a joint not named follows its drive)
      if (o.motion)
        for (const [id, v] of Object.entries(o.motion)) {
          const mo = motions.find((x) => x.id === id);
          if (mo) setMotion(mo, v);
        }
      if (o.hide) {
        for (const p of S.parts) p.hidden = p.hidden0 || o.hide.includes(p.id) || o.hide.includes(p.group);
        reach();
        if (S.parts.find((p) => p.id === st.selected)?.hidden) {
          st.selected = null; // (a part out of sight is not the one chosen)
          info();
        }
      }
      kick();
    },
    particles: addParticles,
    flow: addFlow,
    stream: addStream,
    lines: addLines,
    tick(fn) {
      anim.add(fn);
      kick();
      return () => anim.delete(fn);
    }, // fn(now) returns true while it keeps moving
    pick: pickAt,
    // the figure as glTF 2.0 binary (.glb bytes), posed as it is now (taken apart, moved, its motions and joints);
    // { animate: true } adds each motion as an animation along its range (samples: 120 poses). The exporter is apart
    // from the engine (export.js), set as LK3D.toGLB by importing lk3d/export or loading dist/lk3d-export.min.js
    exportGLB(o = {}) {
      if (!LK3D.toGLB)
        throw new Error('lk3d: exportGLB needs the exporter: load dist/lk3d-export.min.js, or import lk3d/export');
      const now = { ...st.motion },
        animations = [];
      if (o.animate)
        for (const mo of motions) {
          const [a, b] = mo.range,
            n = o.samples ?? 120,
            secs = (b - a) / (mo.speed ?? b - a),
            poses = [];
          for (let k = 0; k <= n; k++) {
            st.motion = { ...now, [mo.id]: a + ((b - a) * k) / n };
            poses.push(new Map(S.parts.map((p) => [p, model(p)])));
          }
          animations.push({
            name: mo.name || mo.id,
            times: poses.map((_, k) => (secs * k) / n),
            matrix: (p, k) => poses[k].get(p),
          });
        }
      st.motion = now;
      return LK3D.toGLB(S, {
        matrix: model,
        animations,
        unit: spec.unit,
        title: spec.title,
        author: spec.author,
        license: spec.license,
        flatten,
      });
    },
    redraw: kick,
    // draw the state as it is now, before returning (a tool that screenshots right after setting it); false while the
    // shaders are still compiling (it draws again on the next frame by itself)
    drawNow() {
      if (dead) return false;
      cancelAnimationFrame(raf);
      raf = 0;
      dirty = true;
      frame(performance.now());
      return !dirty;
    },
    // a point of the scene (or of a part, as that part is placed now) on the stage, in CSS pixels; null behind the eye
    project(p, id) {
      const q = id && S.parts.find((x) => x.id === id);
      camera();
      const s = M.project(VP, q ? M.pt(model(q), p) : p, W, H);
      return s && [s[0], s[1]];
    },
    // a handle's value, read or set by the page (setting it does not call onHandle)
    handle(id) {
      const hd = handles.find((x) => x.p.id === id);
      return (
        hd && {
          get value() {
            return hd.v;
          },
          set(v) {
            setHandle(hd, HD.hold(hd.h, v), false);
          },
        }
      );
    },
    // the scene's liquids, vessels and gases (fluids.js), read and set by the page; and a buoyant plume of air or gas
    liquid(id) {
      const l = FL && FL.liquids.find((x) => x.part === id);
      return (
        l && {
          get volume() {
            return l.volume;
          },
          // (the height of its surface in the scene)
          get level() {
            const v = FL.vessels.get(l.in),
              s = layersIn(v).find((x) => x.l === l);
            return s ? v.at[1] + s.h1 : null;
          },
          set(o) {
            if ('volume' in o) l.volume = Math.max(0, +o.volume || 0);
            kick();
          },
        }
      );
    },
    vessel(id) {
      const v = FL && FL.vessels.get(id);
      return (
        v && {
          get open() {
            return v.outlet ? openOf(v) : 0;
          },
          // (what pours out now, in scene units cubed a second)
          get flow() {
            return v.flow || 0;
          },
          set(o) {
            if ('open' in o) v.open = Math.max(0, Math.min(1, +o.open || 0));
            kick();
          },
        }
      );
    },
    gas(id) {
      const x = FL && FL.gases.find((g) => g.part === id);
      return (
        x && {
          get height() {
            return gasH.get(id);
          },
          get n() {
            return x.n;
          },
          get T() {
            return x.T;
          },
          set(o) {
            for (const k of ['n', 'T', 'p', 'mass']) if (k in o) x[k] = +o[k];
            kick();
          },
        }
      );
    },
    plume(o) {
      return addStream({ ramp: 'heat', ...o, ...FX.plume(o.at, o.height, o.radius ?? 0.05) });
    },
    // a motion of the scene, set or played by the page: { value, set(v), play(), stop(), playing }
    motion(id) {
      const mo = motions.find((x) => x.id === id);
      return (
        mo && {
          get value() {
            return st.motion[id];
          },
          get playing() {
            return playing.has(id);
          },
          set: (v) => setMotion(mo, v),
          play: () => playMotion(mo),
          stop: () => stopMotion(mo),
        }
      );
    },
    // frame some parts (ids or groups): the camera looks at their middle, from far enough to see them all
    focus(ids, o = {}) {
      const ps = S.parts.filter((p) => ids.includes(p.id) || ids.includes(p.group));
      if (!ps.length) return;
      const lo = [1e9, 1e9, 1e9],
        hi = [-1e9, -1e9, -1e9];
      for (const p of ps) {
        const d = add(mulv(p.explode, st.explode), p.offset);
        for (let a = 0; a < 3; a++) {
          lo[a] = Math.min(lo[a], p.lo[a] + d[a]);
          hi[a] = Math.max(hi[a], p.hi[a] + d[a]);
        }
      }
      view({ ...o, target: mulv(add(lo, hi), 0.5), dist: (len(sub(hi, lo)) / 2 || 1) * 2.6 }, o);
    },
    get refreshMs() {
      return refresh;
    }, // this screen's frame interval as measured (cheap: for a page's own budget)
    // what it costs here: setup, the trees and the crease shading (ms from mounting), the resolution it settled on
    stats() {
      let gpu;
      try {
        const e = gl && gl.getExtension('WEBGL_debug_renderer_info');
        gpu = e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : gl ? gl.getParameter(gl.RENDERER) : '';
      } catch (e) {
        gpu = '';
      }
      return {
        ...stats,
        textures: R.pending || 0,
        backend: R.kind,
        hifi: R.hifi,
        shadows: R.shadows,
        parallelCompile: !!R.parallel,
        triangles: Math.round(S.parts.reduce((a, p) => a + p.tris, 0)),
        scale,
        dpr,
        gpu,
      };
    },
    destroy() {
      dead = true;
      awake.delete(woke);
      cancelAnimationFrame(raf);
      raf = 0;
      clearTimeout(idleTimer);
      anim.clear();
      unhook();
      io.disconnect();
      ro.disconnect();
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('visibilitychange', onVis);
      if (dprQuery) dprQuery.removeEventListener('change', onDpr);
      if (darkQuery) darkQuery.removeEventListener('change', onScheme);
      if (R) R.dispose();
      el.innerHTML = '';
      el.classList.remove('lk3d');
      delete el.dataset.renderer;
      if (el.lk3d === api) delete el.lk3d;
      if (opts.info) opts.info.innerHTML = '';
      if (done) done(); // (a page awaiting `ready` goes on)
      done = null;
    },
  };
  el.lk3d = api;
  // ---- the built-in controls (controls.js), unless the page makes its own
  if (opts.controls !== false) {
    Object.assign(
      hooks,
      controls({
        el,
        fig: api,
        st,
        T,
        btnClass,
        tweenExplode,
        explodable: S.parts.some((p) => p.explode.some((v) => v !== 0)),
        motions: motions.filter((mo) => mo.name),
        cuttable: spec.section !== false && R && R.kind !== '2d',
        seeThrough: S.parts.some((p) => p.xray),
      }),
    );
  }
  // each handle also as a range input, visually hidden: Tab reaches it, the arrow keys move it, screen readers read it
  for (const hd of handles) {
    const h = hd.h,
      r = document.createElement('input');
    r.type = 'range';
    r.className = 'lk3d-sr';
    const step = h.snap || (h.along ? 0.01 : h.turn ? 1 : ((h.max ?? 1) - (h.min ?? 0)) / 100);
    r.min = String(h.min ?? 0);
    r.max = String(h.max ?? (h.turn ? 360 : 1));
    r.step = String(step);
    hd.dp = Math.max(0, Math.ceil(-Math.log10(step) - 1e-9)); // the value read out to the step's last digit
    r.value = String(hd.v);
    r.setAttribute('aria-label', h.label || plainText(hd.p.name) || hd.p.id);
    r.setAttribute('aria-valuetext', valueText(hd));
    r.addEventListener('input', () =>
      setHandle(hd, HD.hold(h, hd.round ? hd.v + HD.unwrap(+r.value - mod360(hd.v)) : +r.value), true),
    );
    // (a range input stops at its ends: a handle that goes round and round is turned by its own keys instead)
    if (hd.round)
      r.addEventListener('keydown', (e) => {
        const d = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1, PageDown: -10, PageUp: 10 }[e.key];
        if (!d) return;
        e.preventDefault();
        setHandle(hd, HD.hold(h, hd.v + d * step), true);
      });
    r.addEventListener('focus', () => {
      if (hd.p.hidden) return;
      st.selected = hd.p.id;
      stage.classList.add('lk3d-kbd');
      info('pick');
      kick();
    }); // the part lights up
    r.addEventListener('blur', () => {
      stage.classList.remove('lk3d-kbd');
    });
    hd.input = r;
    el.append(r);
  }
  // a hidden part's handle is out of reach of the keyboard too: out of the Tab order and of what screen readers read
  function reach() {
    for (const { p, input: r } of handles) {
      if (p.hidden) r.blur();
      r.disabled = r.hidden = !!p.hidden;
    }
  }
  reach();
  const ro = new ResizeObserver(resize);
  ro.observe(stage);
  const wake = () => {
    const was = visible;
    visible = onScreen && pageShown;
    if (visible && !was) {
      measureRefresh();
      kick();
    }
  };
  const io = new IntersectionObserver(
    (es) => {
      onScreen = es[es.length - 1].isIntersecting;
      wake();
    },
    { rootMargin: '100px' },
  );
  io.observe(stage);
  const onVis = () => {
    pageShown = !document.hidden;
    wake();
  };
  document.addEventListener('visibilitychange', onVis);
  // (woken by the clock stepped or set: liquids and gases move on from where it was, if they had not been moving)
  const woke = (was) => {
    if (pNow == null && !clock.speed) pNow = was;
    kick();
  };
  awake.add(woke);
  watchDpr();
  resize();
  info();
  stats.setupMs = performance.now() - t0;
  return api;
}

const LK3D = {
  mount,
  clock,
  format: FORMAT,
  locales: { en, vi },
  themes: THEMES,
  // settings for every figure on the page (a site sets them once): locale, strings, buttonClass
  defaults: { locale: 'en', strings: {}, buttonClass: '' },
  reduce: typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches,
  // for tests and tools: the geometry a scene makes, without a page (each part also as one plain geometry, g)
  build(spec, q = 1) {
    const S = buildScene(spec, q);
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
if (typeof window !== 'undefined') window.LK3D = LK3D;
export default LK3D;
export const { build, reduce, version, locales, defaults, themes, format } = LK3D; // (the same objects: setting defaults here sets them for LK3D; reduce is read once, at load)
export { mount, M, refreshFrom, clock, safeHTML };
