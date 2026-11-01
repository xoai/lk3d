// lk3d v2: a small 3D engine for lesson figures (global LK3D). A scene is data (spec.yaml figures:, figure: scene3d):
// parts made of shapes, each with a name and a note, a group, a material, how it moves apart, whether it spins.
//
//   const s = LK3D.mount(el, FIG.generator, { info: $('#info') });
//   s.set({ spin: angle, glow: { lamp: 0.8 }, move: { piston: [0, -0.2, 0] } });  s.particles({ path, count, color }).speed = v;
//   const gas = s.particles({ count, radius, colors }); write gas.pos4 (x, y, z, colour 0..1) and call s.redraw()
//   a part with a handle (turn, slide, along) is moved by the reader's pointer or keys: opts.onHandle(id, value);
//   s.handle(id).set(v);  const rays = s.lines({ count, radius, color, glow }); rays.set(k, [x, y, z], [x, y, z])
//
// Backends, best first: WebGL 2 (physically based materials lit by a generated studio environment, soft shadows,
// creases shaded by ambient occlusion, glow), WebGL 1 (the same scene, simpler light), Canvas 2D (flat shading).
// It draws only when something changes, pauses off screen, lowers its resolution while frames are slow and moving,
// and never reads from the page layout or the GPU while drawing: labels are measured once, picking casts rays on the CPU.
import { D2R, M, sub, add, mulv, len, norm, cross, rgb } from './math.js';
import { buildScene, flatten, buildShape, outlineNormals } from './geometry.js';
import { buildBVH, intersect, aoJob } from './bvh.js';
import { glRenderer } from './renderer-gl.js';
import { canvasRenderer } from './renderer-2d.js';
import { css } from './style.js';
import textWidth from './text.js';
import * as HD from './handles.js';
const mod360 = (v) => ((v % 360) + 360) % 360;

const LOOKS = {
  ink: { bg: 'transparent', ink: [0.114, 0.102, 0.118], cap: [0.95, 0.86, 0.62], light: [0.45, 0.8, 0.55], label: 'ink' },
  studio: { bg: 'radial-gradient(ellipse at 50% 35%, #2a3240 0%, #12161d 70%, #0b0e13 100%)', ink: [0, 0, 0], cap: [0.93, 0.55, 0.25], light: [0.4, 0.75, 0.6], label: 'studio' },
};
for (const l of Object.values(LOOKS)) { const n = Math.hypot(...l.light); l.light = l.light.map((v) => v / n); }
// the studio look's other environments (env: warm | night), behind the model
const BGS = { warm: 'radial-gradient(ellipse at 50% 35%, #3b3128 0%, #1a1511 70%, #0e0b09 100%)', night: 'radial-gradient(ellipse at 50% 30%, #18213a 0%, #0a0e1a 70%, #05070d 100%)' };

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

function context(cv, opts) {
  const attrs = { antialias: true, alpha: true, premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: 'default' }  // these scenes do not need to wake a laptop's second GPU;
  if (opts.force2d) return null;
  try {
    if (!opts.webgl1) { const g = cv.getContext('webgl2', attrs); if (g) return g; }
    return cv.getContext('webgl', attrs) || cv.getContext('experimental-webgl', attrs);
  } catch (e) { return null; }
}

function mount(el, spec, opts = {}) {
  css();
  const t0 = performance.now(), stats = { setupMs: 0, firstFrameMs: null, treesMs: null, aoMs: null, refreshMs: null };
  const st = {
    style: opts.style || spec.style || 'ink', explode: 0, spin: 0, cut: false, labels: opts.labels || 'auto', xray: false,
    yaw: (spec.view?.yaw ?? -35) * D2R, pitch: (spec.view?.pitch ?? 18) * D2R, dist: 1, target: [0, 0, 0], hover: null, selected: null,
  };
  const small = Math.min(screen.width, screen.height) < 700;
  const cv = document.createElement('canvas');
  const gl = context(cv, opts);
  // without WebGL the 2D fallback sorts every triangle on the CPU, so it gets coarser shapes
  const q = (opts.quality ?? (small ? 0.6 : 1)) * (gl ? 1 : 0.5);
  const S = buildScene(spec, q);
  // handles: parts the reader moves directly (and the parts each one carries with it)
  const handles = [];
  for (const p of S.parts) if (p.handle) {
    const h = p.handle, parts = [p, ...S.parts.filter((q) => q !== p && (h.moves || []).some((k) => k === q.id || k === q.group))];
    const hd = { p, h, v: h.value ?? HD.hold(h, 0), parts, m: h.along ? HD.measure(h.along.path, h.along.closed) : null, input: null,
      round: !!h.turn && h.min == null && h.max == null };  // a turn with no stops (a rotor): it goes round and round
    handles.push(hd); for (const q of parts) q.handleOf = hd;
  }
  const baseDist = spec.view?.dist ?? S.radius * 2.6;
  st.dist = baseDist; st.target = spec.view?.target || S.center.slice();
  const home = { yaw: st.yaw, pitch: st.pitch, dist: st.dist, target: st.target.slice() };

  // ---- the elements: a canvas, an overlay for labels and their leader lines, optional controls
  el.classList.add('lk3d'); el.innerHTML = '';
  const stage = document.createElement('div'); stage.className = 'lk3d-stage';
  cv.className = 'lk3d-canvas'; cv.tabIndex = 0;
  cv.setAttribute('role', 'img'); cv.setAttribute('aria-label', spec.alt || spec.title || 'Mô hình 3D');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('class', 'lk3d-lines');
  const tags = document.createElement('div'); tags.className = 'lk3d-tags';
  const hint = document.createElement('div'); hint.className = 'lk3d-hint';
  hint.textContent = (matchMedia('(pointer: coarse)').matches ? 'Kéo để xoay · chụm hai ngón để phóng to' : 'Kéo để xoay · Shift + kéo để dời · Ctrl + cuộn để phóng to');
  // the scale, honestly: a bar that keeps its true length as the view zooms, and/or a note ("not to scale")
  const scaleEl = spec.scale ? document.createElement('div') : null;
  if (scaleEl) {
    scaleEl.className = 'lk3d-scale';
    scaleEl.innerHTML = (spec.scale.bar ? '<span class="lk3d-bar-line"></span><span class="lk3d-bar-label"></span>' : '') + (spec.scale.note ? '<span class="lk3d-note"></span>' : '');
    if (spec.scale.bar) scaleEl.querySelector('.lk3d-bar-label').textContent = spec.scale.bar.label;
    if (spec.scale.note) scaleEl.querySelector('.lk3d-note').textContent = spec.scale.note;
  }
  stage.append(cv, svg, tags, hint, ...(scaleEl ? [scaleEl] : [])); el.append(stage);
  // models made by others: their authors and licences, under the figure (CC BY asks for it; the build requires them)
  const credits = Object.entries(spec.models || {});
  if (credits.length) {
    const c = document.createElement('p'); c.className = 'lk3d-credit'; c.append('Mô hình 3D: ');
    credits.forEach(([name, m], k) => {
      if (k) c.append('; ');
      const a = document.createElement(m.url ? 'a' : 'span'); a.textContent = m.title || name; if (m.url) { a.href = m.url; a.target = '_blank'; a.rel = 'noopener'; }
      c.append(a, `, ${m.author}, ${m.license}` + (m.source === 'ai' ? ' (hình minh họa do AI tạo, không phải mẫu thật)' : ''));
    });
    el.append(c);
  }

  // the renderer; if WebGL fails here (a shader that does not link, a mesh this GPU cannot index), the 2D fallback
  // draws on a second canvas under this one, which keeps receiving the pointer
  const rOpts = { shadowSize: small ? 1024 : 2048, env: spec.env, small, onTexture: () => kick() };
  let R, out = cv;
  const fallback2d = (err, size = true) => {
    if (typeof console !== 'undefined') console.warn('lk3d: drawing in 2D instead of WebGL:', err && err.message);
    out = document.createElement('canvas'); out.className = 'lk3d-canvas lk3d-under'; out.setAttribute('aria-hidden', 'true');
    cv.style.opacity = '0'; cv.before(out);
    R = canvasRenderer(out, S); el.dataset.renderer = R.kind; if (size) sizeCanvas();
  };
  try { R = gl ? glRenderer(gl, S, rOpts) : canvasRenderer(cv, S); el.dataset.renderer = R.kind; } catch (e) { fallback2d(e, false); }
  cv.addEventListener('webglcontextlost', (e) => { e.preventDefault(); lost = true; });
  cv.addEventListener('webglcontextrestored', () => { lost = false; R = glRenderer(gl, S, rOpts); for (const p of S.parts) for (const b of p.batches) if (b.ao) R.setAO(b); for (const L of lines) { R.upload(L.part.batches[0]); L.dirty = true; } kick(); });
  let lost = false, dead = false;

  // ---- camera
  let VP = M.id(), eye = [0, 0, 1], W = 1, H = 1, dpr = 1, scale = 1;
  const shift = () => mulv(spec.view?.explodeShift || [0, 0, 0], st.explode);
  function camera() {
    // on a stage squarer than the scene's own proportions (a phone), step back so the model's width still fits
    const fitW = Math.max(1, ((spec.w || 16) / (spec.h || 10)) / (W / H));
    const cp = Math.cos(st.pitch), d = st.dist * fitW * (1 + (spec.view?.explodeZoom ?? 0.5) * st.explode), tgt = add(st.target, shift());
    eye = add(tgt, [d * cp * Math.sin(st.yaw), d * Math.sin(st.pitch), d * cp * Math.cos(st.yaw)]);
    VP = M.mul(M.persp((spec.view?.fov ?? 35) * D2R, W / H, Math.max(0.01, d / 50), d * 10), M.look(eye, tgt, [0, 1, 0]));
  }
  function model(p) {
    let m = M.trans(add(mulv(p.explode, st.explode), p.offset));
    if (p.handleOf) m = M.mul(m, HD.matrix(p.handleOf.h, p.handleOf.v, p.handleOf.m));
    if (p.spin) {
      const a = st.spin * (p.spin.ratio ?? 1), c = p.spin.center || [0, 0, 0];
      const r = p.spin.axis === 'y' ? M.rotY(a) : p.spin.axis === 'z' ? M.rotZ(a) : M.rotX(a);
      m = M.mul(m, M.mul(M.trans(c), M.mul(r, M.trans(mulv(c, -1)))));
    }
    return m;
  }
  const plane = () => { const n = spec.section?.normal || [0, 0, 1]; return [n[0], n[1], n[2], -(spec.section?.offset ?? 0)]; };
  // what is on screen now (for the shadow's reach) and the floor under the assembled model
  function nowBounds() {
    const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
    for (const p of S.parts) { if (p.drawAlpha < 0.01) continue; const o = add(mulv(p.explode, st.explode), p.offset); for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], p.lo[a] + o[a]); hi[a] = Math.max(hi[a], p.hi[a] + o[a]); } }
    return { center: mulv(add(lo, hi), 0.5), radius: len(sub(hi, lo)) / 2 || 1, lo, hi };
  }

  // ---- drawing, only when something changed. Resolution drops while frames come late and comes back once they are on
  // time again. "Late" is measured against this screen's own refresh, measured at start: browsers may run animation at
  // 30 Hz (Chrome on iOS does, measured), and there a 33 ms frame is on time, not slow.
  // drawn while on screen (the IntersectionObserver says) and while the page is shown (the tab is in front): two
  // separate facts, so coming back to the tab does not wake a figure that is scrolled away
  let dirty = true, onScreen = true, pageShown = typeof document === 'undefined' || !document.hidden, visible = pageShown;
  let raf = 0, lastT = 0, slow = 0, good = 0, idleTimer = 0, refresh = 16.7;
  function measureRefresh() {  // twenty frame intervals; see refreshFrom
    const ts = [];
    const f = (t) => { ts.push(t); if (ts.length < 21) requestAnimationFrame(f); else { refresh = refreshFrom(ts.slice(1).map((x, i) => x - ts[i])); stats.refreshMs = +refresh.toFixed(1); } };
    requestAnimationFrame(f);
  }
  measureRefresh();
  const kick = () => { dirty = true; if (!raf && visible && !dead) raf = requestAnimationFrame(frame); };
  function resize() {
    const narrow = el.clientWidth < 560, ar = narrow ? (spec.narrow || '1 / 0.9') : `${spec.w || 16} / ${spec.h || 10}`;
    if (stage.style.aspectRatio !== ar) stage.style.aspectRatio = ar;
    dpr = Math.min(opts.maxDpr || 2, window.devicePixelRatio || 1);
    const r = stage.getBoundingClientRect(); W = Math.max(1, r.width); H = Math.max(1, r.height);
    widths = {};  // labels change size with the layout (smaller on a phone)
    if (sizeCanvas() && visible && !dead && stats.firstFrameMs != null) { cancelAnimationFrame(raf); raf = 0; dirty = true; frame(performance.now()); }
    else kick();
  }
  function sizeCanvas() {  // true if the size changed (which clears the canvas: the caller draws again at once)
    const w = Math.round(W * dpr * scale), h = Math.round(H * dpr * scale);
    if (cv.width === w && cv.height === h && out.width === w) return false;
    cv.width = w; cv.height = h;
    if (out !== cv) { out.width = w; out.height = h; }
    return true;
  }
  let dprQuery = null;  // a move to a screen of another density changes devicePixelRatio but not the layout
  const watchDpr = () => {
    if (typeof matchMedia === 'undefined') return;
    if (dprQuery) dprQuery.removeEventListener('change', onDpr);
    dprQuery = matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`); dprQuery.addEventListener('change', onDpr);
  };
  const onDpr = () => { watchDpr(); resize(); };
  const anim = new Set();
  let pNow = 0;
  function frame(now) {
    raf = 0;
    if (dead) return;
    let moving = false;
    for (const a of anim) { if (a(now)) moving = true; else anim.delete(a); }  // a tick runs while it returns true
    // particles along paths run at the speed the page gave them
    const pdt = pNow ? Math.min(0.05, (now - pNow) / 1000) : 0; let flowing = false;
    for (const h of particles) if (h.step && h.speed && h.visible) { h.step(pdt); flowing = true; }
    pNow = flowing ? now : 0; moving = moving || flowing;
    if ((dirty || moving) && !lost) {
      // adaptive resolution: if moving frames keep coming late, draw fewer pixels until things are still again
      // (not before the first picture has been up for a second: compiling and the first slices of background work are
      // not a sign that this device draws too slowly)
      if (lastT && moving && opts.adaptive !== false && stats.firstFrameMs != null && now - t0 > stats.firstFrameMs + 1000) {
        const late = now - lastT > refresh * 1.5 + 1;
        slow = late ? slow + 1 : Math.max(0, slow - 1); good = late ? 0 : good + 1;
        if (slow > 8 && scale > 0.55) { scale = Math.max(0.55, scale - 0.15); slow = 0; good = 0; sizeCanvas(); }
        else if (good > 120 && scale < 1) { scale = Math.min(1, scale + 0.15); good = 0; sizeCanvas(); }  // on time for a while: try more pixels
      }
      lastT = moving ? now : 0;
      if (scale < 1) { clearTimeout(idleTimer); idleTimer = setTimeout(() => { if (!anim.size) { scale = 1; sizeCanvas(); kick(); } }, 350); }
      camera();
      const look = LOOKS[st.style];
      if (stage.dataset.look !== st.style) { stage.style.background = st.style === 'studio' && BGS[spec.env] || look.bg; stage.dataset.look = st.style; }
      for (const p of S.parts) { p.m = model(p); p.drawAlpha = p.hidden ? 0 : (st.xray && p.xray) ? 0.18 : p.alpha; }
      for (const L of lines) if (L.dirty) { L.place(); L.dirty = false; }
      const shown = lines.length ? S.parts.concat(lines.filter((L) => L.visible && L.part.batches[0].mats.length).map((L) => L.part)) : S.parts;
      const b = nowBounds();
      let drawn;
      try { drawn = R.draw({ VP, eye, look, style: st.style, parts: shown, cut: st.cut, plane: plane(), hover: st.hover, selected: st.selected, dpr: dpr * scale,
        pxPerUnit: cv.height / (2 * Math.tan((spec.view?.fov ?? 35) * D2R / 2)),
        particles, ao: aoDone, shadows: true, bounds: b,
        ground: spec.ground === false ? null : { center: [b.center[0], 0, b.center[2]], radius: b.radius * 1.6, y: S.lo[1] - 0.004, contact: st.explode < 0.3 ? 1 - st.explode / 0.3 : 0 } });
      } catch (e) { if (R.kind === '2d') throw e; fallback2d(e); drawn = false; }
      if (drawn === false) moving = true;  // shaders still compiling in the background: try again next frame
      else {
        labels(); dirty = false;
        if (stats.firstFrameMs == null) { stats.firstFrameMs = performance.now() - t0; if (R.prewarm) setTimeout(() => { if (!dead) R.prewarm(); }, 200); }
      }
    }
    if (moving && visible && !raf) raf = requestAnimationFrame(frame);  // one frame pending at most
  }

  // ---- labels: HTML, so they are crisp, in the page's lettering and readable by screen readers; measured once
  // (no layout reads while drawing), moved with transforms only when they actually move
  const tagEls = [];
  for (const p of S.parts) {
    if (!p.name || p.label === false) continue;
    const t = document.createElement('div'); t.className = 'lk3d-tag'; t.textContent = p.name; t.dataset.id = p.id;
    t.style.display = 'none'; tags.append(t); tagEls.push({ p, t, x: -1, y: -1, shown: false, on: false });  // shown once placed
  }
  let widths = {};
  const unhook = textWidth.onFontsChanged(() => { widths = {}; for (const i of tagEls) i.x = -1; kick(); });
  // a tag's width: its text measured once in the tag's own font, plus its padding and border, read once per look and
  // layout (they differ on a phone); never a layout read while drawing
  let tagBox = {};
  function tagWidth(i) {
    const k = st.style + i.p.id;
    if (widths[k] == null) {
      if (!tagBox[st.style] || !widths.__box) {
        const cs = getComputedStyle(i.t), px = (v) => parseFloat(v) || 0;
        tagBox[st.style] = { font: `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`, pad: px(cs.paddingLeft) + px(cs.paddingRight) + px(cs.borderLeftWidth) + px(cs.borderRightWidth) + 1, ls: px(cs.letterSpacing) };
        widths.__box = true;
      }
      const t = tagBox[st.style];
      widths[k] = textWidth(i.p.name, t.font) + t.ls * i.p.name.length + t.pad;
    }
    return widths[k];
  }
  function scaleBar() {  // the bar's on-screen length: its scene length, projected at the point the camera looks at
    if (!scaleEl || !spec.scale.bar) return;
    const t = add(st.target, shift()), r = [Math.cos(st.yaw), 0, -Math.sin(st.yaw)];
    const a = M.project(VP, t, W, H), b = M.project(VP, add(t, mulv(r, spec.scale.bar.length)), W, H);
    const px = a && b ? Math.hypot(b[0] - a[0], b[1] - a[1]) : 0;
    scaleEl.firstChild.style.transform = `scaleX(${(px / 100).toFixed(3)})`;
  }
  function labels() {
    scaleBar();
    const vis = (p) => !p.hidden && p.drawAlpha > 0.05 && (st.labels === 'all' || p.id === st.hover || p.id === st.selected || (st.labels === 'auto' && st.explode > 0.45));
    const c = M.project(VP, add(S.center, shift()), W, H) || [W / 2, H / 2];
    const items = [];
    for (const i of tagEls) {
      let on = st.labels !== 'none' && vis(i.p), a = null;
      if (on) { a = M.project(VP, M.pt(i.p.spin || i.p.handleOf?.round ? M.trans(add(mulv(i.p.explode, st.explode), i.p.offset)) : i.p.m, i.p.anchor), W, H); if (!a) on = false; }  // a spinning part's label stays put
      if (on !== i.shown) { i.t.style.display = on ? '' : 'none'; i.shown = on; }
      if (!on) continue;
      let d = [a[0] - c[0], a[1] - c[1]]; const l = Math.hypot(d[0], d[1]); d = l < 4 ? [0, -1] : [d[0] / l, d[1] / l];
      items.push({ i, a, x: a[0] + d[0] * 46, y: a[1] + d[1] * 34 - 8, right: d[0] >= 0 });
    }
    for (const side of [true, false]) {  // keep labels from overlapping: on each side, push them apart vertically
      const col = items.filter((it) => it.right === side).sort((u, v) => u.y - v.y);
      for (let k = 1; k < col.length; k++) if (col[k].y - col[k - 1].y < 22) col[k].y = col[k - 1].y + 22;
    }
    let lines = '';
    for (const it of items) {
      const w = tagWidth(it.i), x = Math.round(Math.max(2, Math.min(W - w - 2, it.right ? it.x : it.x - w))), y = Math.round(Math.max(2, Math.min(H - 22, it.y)));
      if (x !== it.i.x || y !== it.i.y) { it.i.t.style.transform = `translate(${x}px, ${y}px)`; it.i.x = x; it.i.y = y; }
      const on = it.i.p.id === st.hover || it.i.p.id === st.selected;
      if (on !== it.i.on) { it.i.t.classList.toggle('on', on); it.i.on = on; }
      const ex = it.right ? x : x + w, ey = y + 11;
      lines += `<line x1="${it.a[0].toFixed(1)}" y1="${it.a[1].toFixed(1)}" x2="${ex}" y2="${ey}"/><circle cx="${it.a[0].toFixed(1)}" cy="${it.a[1].toFixed(1)}" r="2.2"/>`;
    }
    if (lines !== svg.__last) { svg.innerHTML = lines; svg.__last = lines; }
  }

  // ---- picking: a ray from the eye through the pointer, against each part's shapes (bounding-volume trees, built
  // lazily); the nearest hit on a part that is drawn and not cut away
  function bvhOf(b) { return b.bvh || (b.bvh = buildBVH(b.geo)); }
  function rayAt(px, py) {  // the ray from the eye through a point of the stage
    camera();
    const inv = M.invert(VP), nx = px / W * 2 - 1, ny = 1 - py / H * 2;
    const p0 = M.pt(inv, [nx, ny, -1]), w0 = inv[3] * nx + inv[7] * ny - inv[11] + inv[15], p1 = M.pt(inv, [nx, ny, 1]), w1 = inv[3] * nx + inv[7] * ny + inv[11] + inv[15];
    const A = mulv(p0, 1 / w0), B = mulv(p1, 1 / w1), dir = sub(B, A);
    return { A, D: mulv(dir, 1 / len(dir)) };
  }
  function pickAt(px, py, see = 0.3) {  // parts fainter than `see` let the ray through
    const { A, D } = rayAt(px, py), pl = plane();
    let best = Infinity, id = null;
    for (const p of S.parts) {
      if (p.drawAlpha < see) continue;
      for (const b of p.batches) for (const im of b.mats) {
        const Wm = M.mul(p.m, im), Iv = M.invert(Wm), o = M.pt(Iv, A), d = M.dir(Iv, D);
        const accept = st.cut ? (t) => { const w = add(A, mulv(D, t)); return pl[0] * w[0] + pl[1] * w[1] + pl[2] * w[2] + pl[3] <= 0; } : null;
        const h = intersect(b.geo, bvhOf(b), o, d, best, false, accept);
        if (h && h.t < best) { best = h.t; id = p.id; }
      }
    }
    return id;
  }

  // ---- ambient occlusion: creases and the insides of hollow parts darkened, computed a slice at a time after the
  // first picture (a few milliseconds per frame), then drawn
  let aoDone = false;
  const batchesAll = [];
  for (const p of S.parts) for (const b of p.batches) batchesAll.push(b);
  {  // the intersection trees first, in idle time just after the first picture, so pointing never waits for one
    const todo = batchesAll.slice();
    const build = () => { if (dead) return; const end = performance.now() + 6; while (todo.length && performance.now() < end) bvhOf(todo.shift()); if (todo.length) setTimeout(build, 16); else stats.treesMs = performance.now() - t0; };
    setTimeout(build, 30);
  }
  if (R.kind !== '2d' && opts.ao !== false) {
    const queue = batchesAll.slice();
    let cur = null;
    const work = () => {
      if (dead) return;
      const end = performance.now() + 6;
      while (performance.now() < end) {
        if (!cur) {
          const b = queue.shift();
          if (!b) { aoDone = true; stats.aoMs = performance.now() - t0; kick(); return; }
          if (b.geo.count > 40000) continue;  // a very detailed shape: its own folds already read; spare the phone the rays
          const g = b.geo; let lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
          for (let k = 0; k < g.count; k++) for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], g.p[3 * k + a]); hi[a] = Math.max(hi[a], g.p[3 * k + a]); }
          cur = { b, job: aoJob(g, bvhOf(b), Math.max(0.02, Math.min(len(sub(hi, lo)) * 0.25, S.radius * 0.12))) };
        }
        if (cur.job.step(Math.max(1, end - performance.now()))) { cur.b.ao = cur.job.out; R.setAO(cur.b); cur = null; }
      }
      setTimeout(work, 16);
    };
    setTimeout(work, 60);
  }

  // ---- pointer: orbit, pan, pinch, wheel (only with Ctrl, or once the figure has been clicked), hover and pick
  const pts = new Map();
  let drag = null, active = false, lastPick = 0, moved = 0, pinch = 0, vel = [0, 0, 0];
  const local = (e) => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  let glideFn = null, grab = null;
  // the handle under a point: the part hit, or (for small handles, on touch) one whose middle is within reach
  function handleAt(x, y) {
    if (!handles.length) return null;
    const id = pickAt(x, y, 0.6), hit = id && S.parts.find((p) => p.id === id);  // a handle is grabbed through glass
    if (hit && hit.handleOf) return hit.handleOf;
    // a small handle (a planet, a focal point) is also caught close by, whatever is in front of it: fingers are wide
    let best = null, bd = 1e9;
    for (const hd of handles) {
      const p = hd.p, c = M.pt(p.m, p.center), s = M.project(VP, c, W, H), e = M.project(VP, add(c, [len(sub(p.hi, p.lo)) / 2, 0, 0]), W, H);
      if (!s) continue;
      const r = e ? Math.hypot(e[0] - s[0], e[1] - s[1]) : 0, d = Math.hypot(x - s[0], y - s[1]);
      if (r < 40 && d < r + 16 && d < bd) { bd = d; best = hd; }
    }
    return best;
  }
  // a handle's frame in the scene now (it moves with taking apart and with offsets, not with its own value)
  const handleBase = (hd) => M.trans(add(mulv(hd.p.explode, st.explode), hd.p.offset));
  function dragHandle(x, y) {
    const hd = grab.hd, h = hd.h, { A, D } = rayAt(x, y), base = handleBase(hd);
    let v = hd.v;
    if (h.turn) {
      const ang = HD.turnAngle(A, D, { turn: { axis: h.turn.axis, center: M.pt(base, h.turn.center || [0, 0, 0]) } });
      if (grab.last == null) grab.last = ang;
      grab.acc += HD.unwrap(ang - grab.last); grab.last = ang;
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
    if (hd.input) { hd.input.value = String(hd.round ? mod360(v) : v); hd.input.setAttribute('aria-valuetext', valueText(hd)); }
    kick();
    if (byReader && opts.onHandle) opts.onHandle(hd.p.id, v);
  }
  // what a screen reader says for a handle: the page's words (opts.handleText(id, value), e.g. "d = 45 cm"), or the value
  const valueText = (hd) => (opts.handleText && opts.handleText(hd.p.id, hd.v)) || `${+(hd.round ? mod360(hd.v) : hd.v).toFixed(hd.dp)}${hd.h.unit || (hd.h.turn ? '°' : '')}`.replace('.', ',');
  cv.addEventListener('pointerdown', (e) => {
    if (glideFn) { anim.delete(glideFn); glideFn = null; }  // a grab stops the model
    if (!pts.size) {
      const [x, y] = local(e), hd = handleAt(x, y);
      if (hd) {  // the reader takes hold of a handle: it moves, the view does not
        grab = { hd, id: e.pointerId, start: hd.v, acc: 0, last: null, s0: null, moved: 0 };
        cv.setPointerCapture?.(e.pointerId); cv.style.cursor = 'grabbing'; hint.classList.add('gone'); active = true;
        dragHandle(x, y); e.preventDefault();
        return;
      }
    }
    cv.setPointerCapture?.(e.pointerId); pts.set(e.pointerId, [e.clientX, e.clientY]); moved = 0; active = true;
    drag = { pan: e.shiftKey || e.button === 2 }; hint.classList.add('gone');
  });
  cv.addEventListener('pointermove', (e) => {
    if (grab && e.pointerId === grab.id) { const [x, y] = local(e); grab.moved += Math.abs(e.movementX || 0) + Math.abs(e.movementY || 0); dragHandle(x, y); return; }
    if (pts.has(e.pointerId)) {
      const prev = pts.get(e.pointerId); pts.set(e.pointerId, [e.clientX, e.clientY]);
      const dx = e.clientX - prev[0], dy = e.clientY - prev[1]; moved += Math.abs(dx) + Math.abs(dy);
      if (pts.size === 2) {
        const [p1, p2] = [...pts.values()], now = Math.hypot(p1[0] - p2[0], p1[1] - p2[1]);
        if (pinch > 0 && now > 0) st.dist = Math.max(baseDist * 0.3, Math.min(baseDist * 3, st.dist * pinch / now));
        pinch = now;
      } else if (drag && drag.pan) {
        const k = st.dist / H * 1.2, right = [Math.cos(st.yaw), 0, -Math.sin(st.yaw)], up = [-Math.sin(st.pitch) * Math.sin(st.yaw), Math.cos(st.pitch), -Math.sin(st.pitch) * Math.cos(st.yaw)];
        st.target = add(st.target, add(mulv(right, -dx * k), mulv(up, dy * k)));
      } else {
        st.yaw -= dx * 0.008; st.pitch = Math.max(-1.45, Math.min(1.45, st.pitch + dy * 0.008));
        const now = performance.now(), dt = Math.max(4, now - (vel[2] || now - 16.7));
        vel = [dx * 16.7 / dt, dy * 16.7 / dt, now];
      }
      kick();
    } else if (performance.now() - lastPick > 40) {
      lastPick = performance.now();
      const [x, y] = local(e), id = pickAt(x, y);
      const onHandle = id ? !!S.parts.find((p) => p.id === id)?.handleOf : !!handleAt(x, y);
      if (id !== st.hover || onHandle !== cv._onHandle) { st.hover = id; cv._onHandle = onHandle; cv.style.cursor = onHandle ? 'grab' : id ? 'pointer' : 'grab'; info(); kick(); }
    }
  });
  const end = (e) => {
    if (grab && e.pointerId === grab.id) {  // let go of a handle; a tap without moving selects the part, as elsewhere
      if (grab.moved < 4 && e.type === 'pointerup') { st.selected = grab.hd.p.id === st.selected ? null : grab.hd.p.id; info(); }
      grab = null; cv.style.cursor = 'grab'; kick(); return;
    }
    if (!pts.has(e.pointerId)) return;
    pts.delete(e.pointerId); pinch = 0;
    if (moved < 6 && e.type === 'pointerup') { const [x, y] = local(e), id = pickAt(x, y); st.selected = id && id !== st.selected ? id : null; info(); kick(); }
    else if (!pts.size && Math.hypot(vel[0], vel[1]) > 2 && performance.now() - vel[2] < 80 && !LK3D.reduce) {  // only if still moving when let go
      let v = vel.slice(0, 2).map((x) => Math.max(-30, Math.min(30, x))), prev = 0;
      const glide = (now) => {
        const dt = prev ? Math.min(50, now - prev) : 16.7; prev = now;
        const k = Math.pow(0.9, dt / 16.7), f = dt / 16.7;
        v = [v[0] * k, v[1] * k]; st.yaw -= v[0] * 0.008 * f; st.pitch = Math.max(-1.45, Math.min(1.45, st.pitch + v[1] * 0.008 * f)); dirty = true;
        if (Math.hypot(v[0], v[1]) < 0.3) { glideFn = null; return false; } return true;
      };
      glideFn = glide; anim.add(glide); kick();
    }
    vel = [0, 0, 0]; drag = null;
  };
  cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
  cv.addEventListener('pointerleave', () => { if (!pts.size && st.hover) { st.hover = null; info(); kick(); } });
  cv.addEventListener('contextmenu', (e) => e.preventDefault());
  cv.addEventListener('wheel', (e) => {
    if (!(e.ctrlKey || active)) return;  // never hijack the page's scrolling
    e.preventDefault(); st.dist = Math.max(baseDist * 0.3, Math.min(baseDist * 3, st.dist * Math.exp(e.deltaY * 0.0015))); kick();
  }, { passive: false });
  const outside = (e) => { if (!el.contains(e.target)) active = false; };
  document.addEventListener('pointerdown', outside);
  cv.addEventListener('keydown', (e) => {
    const k = { ArrowLeft: [0.12, 0], ArrowRight: [-0.12, 0], ArrowUp: [0, 0.1], ArrowDown: [0, -0.1] }[e.key];
    if (k) { st.yaw += k[0]; st.pitch = Math.max(-1.45, Math.min(1.45, st.pitch + k[1])); kick(); e.preventDefault(); }
    const zoom = { '+': 0.9, '=': 0.9, '-': 1.1 }[e.key];
    if (zoom) { st.dist = Math.max(baseDist * 0.3, Math.min(baseDist * 3, st.dist * zoom)); kick(); }
  });
  function info() {
    const id = st.selected || st.hover, p = S.parts.find((x) => x.id === id);
    if (opts.info) opts.info.innerHTML = p ? `<b>${p.name}</b>${p.note ? ' ' + p.note : ''}` : (opts.infoIdle || '');
    if (opts.onPick) opts.onPick(p || null);
  }

  // ---- particles: points moving along paths (air, current, blood), whose speed the page sets; or, without a path,
  // points the page places itself (molecules of a gas: solid balls of a radius in scene units, in one of the three
  // `colors` by the fourth number of each point: below 0.35, up to 0.65, above)
  const particles = [];
  function addParticles({ path, count = 30, color = '#ffd25a', size = 7, part = null, closed = false, radius = 0, colors = null }) {
    if (!path) {
      const h = { solid: true, radius, ramp: (colors || [color, color, color]).map(rgb), count, pos4: new Float32Array(count * 4), visible: true, update() {},
        resize(n) { if (n * 4 > h.pos4.length) h.pos4 = new Float32Array(n * 4); h.count = n; },
        remove() { const k = particles.indexOf(h); if (k >= 0) particles.splice(k, 1); kick(); } };
      particles.push(h); kick();
      return h;
    }
    const segs = [], P = path.length > 1 ? path : [path[0], path[0]]; let total = 0;
    for (let k = 0; k + 1 < P.length + (closed ? 1 : 0); k++) { const a = P[k], b = P[(k + 1) % P.length], l = len(sub(b, a)); segs.push([a, b, l, total]); total += l; }
    const h = { color: rgb(color), size, speed: 0, offset: 0, count, part, pos4: new Float32Array(count * 4), visible: true,
      remove() { const k = particles.indexOf(h); if (k >= 0) particles.splice(k, 1); kick(); } };
    const owner = part ? S.parts.find((x) => x.id === part) : null;
    h.update = () => {
      const m = owner ? owner.m : null;
      for (let i = 0; i < h.count; i++) {
        const s = ((i / h.count + h.offset) % 1 + 1) % 1 * total; let k = 0;
        while (k < segs.length - 1 && s > segs[k][3] + segs[k][2]) k++;
        const [a, b, l, s0] = segs[k], t = l ? (s - s0) / l : 0, p = add(a, mulv(sub(b, a), Math.max(0, Math.min(1, t)))), w = m ? M.pt(m, p) : p;
        h.pos4[4 * i] = w[0]; h.pos4[4 * i + 1] = w[1]; h.pos4[4 * i + 2] = w[2]; h.pos4[4 * i + 3] = 1;
      }
    };
    h.step = (dt) => { if (total) h.offset += h.speed * dt / total; };
    particles.push(h); kick();
    return h;
  }

  // ---- lines: rods between points the page sets (rays of light, field lines, forces), drawn by instancing one
  // cylinder, so a hundred rays cost one draw; they are shaded, outlined and can glow like any part
  const lines = [];
  function addLines({ count = 8, radius = 0.01, color = '#ffcc55', studioColor, glow = null } = {}) {
    const unit = buildShape({ cylinder: { r: 1, x0: 0, x1: 1 } }, 0.5).geo, b = { geo: unit, mats: [], out: outlineNormals(unit), dynamic: true };
    const part = { id: '__lines' + lines.length, name: '', note: '', label: false, batches: [b], color: rgb(color), studioColor: rgb(studioColor || color),
      mat: [0.1, 0.4, 0], material: 'paint', surf: [0, 0, 0], refract: 0, alpha: 1, drawAlpha: 1, emit: [0, 0, 0], glowColor: rgb(glow || color), explode: [0, 0, 0], offset: [0, 0, 0],
      lo: [0, 0, 0], hi: [0, 0, 0], center: [0, 0, 0], m: M.id(), hidden: false, tris: 0 };
    const segs = new Array(count).fill(null);
    const L = { part, visible: true, dirty: true, radius,
      set(k, a, c) { if (k >= 0 && k < segs.length) { segs[k] = a && c ? [a, c] : null; L.dirty = true; kick(); } },
      clear() { segs.fill(null); L.dirty = true; kick(); },
      glow(v) { part.emit = mulv(part.glowColor, v); kick(); },
      remove() { const k = lines.indexOf(L); if (k >= 0) lines.splice(k, 1); kick(); },
      place() {  // each segment: the unit cylinder along x, stretched to the segment and thinned to the radius
        b.mats = segs.filter(Boolean).filter(([a, c]) => len(sub(c, a)) > 1e-9).map(([a, c]) => {
          const d = sub(c, a), l = len(d), x = mulv(d, 1 / l), up = Math.abs(x[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
          const z = norm(cross(x, up)), y = cross(z, x), r = L.radius;
          return [x[0] * l, x[1] * l, x[2] * l, 0, y[0] * r, y[1] * r, y[2] * r, 0, z[0] * r, z[1] * r, z[2] * r, 0, a[0], a[1], a[2], 1];
        });
        if (R.instances) R.instances(b);
      } };
    if (R.upload) R.upload(b);
    lines.push(L); kick();
    return L;
  }

  // ---- tweening the camera to a view, and taking apart
  // a named view, [yaw, pitch] (degrees), or {yaw, pitch, dist, target}: any of them, the rest kept
  function view(name) {
    const obj = name && typeof name === 'object' && !Array.isArray(name);
    const V = obj ? [name.yaw ?? st.yaw / D2R, name.pitch ?? st.pitch / D2R]
      : { front: [0, 0], side: [-90, 0], top: [0, 83], iso: [-35, 25], home: [home.yaw / D2R, home.pitch / D2R] }[name] || name;  // 83°: the most a drag reaches
    const from = { yaw: st.yaw, pitch: st.pitch, dist: st.dist, target: st.target.slice() };
    const to = { yaw: V[0] * D2R, pitch: V[1] * D2R, dist: obj ? (name.dist ?? st.dist) : name === 'home' ? home.dist : st.dist, target: obj ? (name.target || st.target) : name === 'home' ? home.target : st.target };
    while (to.yaw - from.yaw > Math.PI) to.yaw -= 2 * Math.PI; while (from.yaw - to.yaw > Math.PI) to.yaw += 2 * Math.PI;
    const t0 = performance.now(), T = LK3D.reduce ? 1 : 600;
    const tw = (now) => {
      const u = Math.min(1, (now - t0) / T), e = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
      st.yaw = from.yaw + (to.yaw - from.yaw) * e; st.pitch = from.pitch + (to.pitch - from.pitch) * e; st.dist = from.dist + (to.dist - from.dist) * e;
      st.target = add(from.target, mulv(sub(to.target, from.target), e)); dirty = true;
      if (u >= 1) { anim.delete(tw); return false; } return true;
    };
    if (viewTw) anim.delete(viewTw);
    viewTw = tw; anim.add(tw); kick();
  }
  let viewTw = null, explodeTw = null;
  function tweenExplode(to) {
    const from = st.explode, t0 = performance.now(), T = LK3D.reduce ? 1 : 900;
    const tw = (now) => { const u = Math.min(1, (now - t0) / T), e = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2; api.set({ explode: from + (to - from) * e }); if (u >= 1) { anim.delete(tw); return false; } return true; };
    if (explodeTw) anim.delete(explodeTw);
    explodeTw = tw; anim.add(tw); kick();
  }

  // ---- the built-in controls
  const hooks = {};
  if (opts.controls !== false) {
    const bar = document.createElement('div'); bar.className = 'lk3d-bar';
    const btn = (label, title, fn) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn sm'; b.textContent = label; b.title = title; b.addEventListener('click', fn); bar.append(b); return b; };
    const parts = S.parts.some((p) => p.explode.some((v) => v !== 0));
    const ex = document.createElement('label'); ex.className = 'lk3d-range';
    ex.innerHTML = '<span>Tách rời</span><input type="range" min="0" max="1" step="0.01" value="0" aria-label="Tách rời các bộ phận">';
    const exIn = ex.querySelector('input'); exIn.addEventListener('input', () => api.set({ explode: +exIn.value }));
    if (parts) bar.append(ex);
    const asm = parts ? btn('Tách ra', 'Tách rời / lắp lại', () => tweenExplode(st.explode > 0.5 ? 0 : 1)) : null;
    if (spec.section !== false && R && R.kind !== '2d') { const c = btn('Cắt dọc', 'Cắt đôi mô hình để xem bên trong', () => { api.set({ cut: !st.cut }); c.classList.toggle('on', st.cut); }); }
    if (S.parts.some((p) => p.xray)) { const x = btn('Nhìn xuyên', 'Làm vỏ trong suốt', () => { api.set({ xray: !st.xray }); x.classList.toggle('on', st.xray); }); }
    const lb = btn('Nhãn', 'Hiện tất cả nhãn', () => { api.set({ labels: st.labels === 'all' ? 'auto' : 'all' }); lb.classList.toggle('on', st.labels === 'all'); });
    const sty = btn(st.style === 'ink' ? 'Kiểu ảnh thật' : 'Kiểu vẽ tay', 'Đổi kiểu vẽ', () => { api.set({ style: st.style === 'ink' ? 'studio' : 'ink' }); sty.textContent = st.style === 'ink' ? 'Kiểu ảnh thật' : 'Kiểu vẽ tay'; });
    const views = document.createElement('span'); views.className = 'lk3d-views';
    for (const [n, l] of [['front', 'Trước'], ['side', 'Bên'], ['top', 'Trên'], ['home', 'Ban đầu']]) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'btn sm'; b.textContent = l; b.addEventListener('click', () => view(n)); views.append(b);
    }
    bar.append(views); el.append(bar);
    hooks.explode = (v) => { exIn.value = v; if (asm) asm.textContent = v > 0.5 ? 'Lắp lại' : 'Tách ra'; };
  }

  // ---- the page's handle
  const api = {
    get renderer() { return R.kind; }, get backend() { return R.kind; }, get hifi() { return R.hifi; }, parts: S.parts, state: st, view, explode: tweenExplode,
    set(o) {
      if ('explode' in o) { st.explode = Math.max(0, Math.min(1, o.explode)); hooks.explode && hooks.explode(st.explode); }
      for (const k of ['spin', 'cut', 'labels', 'xray', 'style']) if (k in o) st[k] = o[k];
      if (o.move) for (const [id, v] of Object.entries(o.move)) { const p = S.parts.find((x) => x.id === id); if (p) p.offset = v; }
      if (o.glow) for (const [id, v] of Object.entries(o.glow)) { const p = S.parts.find((x) => x.id === id); if (p) p.emit = mulv(p.glowColor, v); }
      if (o.hide) for (const p of S.parts) p.hidden = o.hide.includes(p.id) || o.hide.includes(p.group);
      kick();
    },
    particles: addParticles, lines: addLines,
    tick(fn) { anim.add(fn); kick(); return () => anim.delete(fn); },  // fn(now) returns true while it keeps moving
    pick: pickAt, redraw: kick,
    // a handle's value, read or set by the page (setting it does not call onHandle)
    handle(id) { const hd = handles.find((x) => x.p.id === id); return hd && { get value() { return hd.v; }, set(v) { setHandle(hd, HD.hold(hd.h, v), false); } }; },
    // frame some parts (ids or groups): the camera looks at their middle, from far enough to see them all
    focus(ids, o = {}) {
      const ps = S.parts.filter((p) => ids.includes(p.id) || ids.includes(p.group));
      if (!ps.length) return;
      const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
      for (const p of ps) { const d = add(mulv(p.explode, st.explode), p.offset); for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], p.lo[a] + d[a]); hi[a] = Math.max(hi[a], p.hi[a] + d[a]); } }
      view({ ...o, target: mulv(add(lo, hi), 0.5), dist: (len(sub(hi, lo)) / 2 || 1) * 2.6 });
    },
    get refreshMs() { return refresh; },  // this screen's frame interval as measured (cheap: for a page's own budget)
    // what it costs here: setup, the trees and the crease shading (ms from mounting), the resolution it settled on
    stats() {
      let gpu = '';
      try { const e = gl && gl.getExtension('WEBGL_debug_renderer_info'); gpu = e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : (gl ? gl.getParameter(gl.RENDERER) : ''); } catch (e) { gpu = ''; }
      return { ...stats, backend: R.kind, hifi: R.hifi, shadows: R.shadows, parallelCompile: !!R.parallel, triangles: Math.round(S.parts.reduce((a, p) => a + p.tris, 0)), scale, dpr, gpu };
    },
    destroy() {
      dead = true; cancelAnimationFrame(raf); raf = 0; clearTimeout(idleTimer); anim.clear();
      unhook(); io.disconnect(); ro.disconnect(); document.removeEventListener('pointerdown', outside); document.removeEventListener('visibilitychange', onVis);
      if (dprQuery) dprQuery.removeEventListener('change', onDpr);
      if (R) R.dispose(); el.innerHTML = '';
    },
  };
  // each handle also as a range input, visually hidden: Tab reaches it, the arrow keys move it, screen readers read it
  for (const hd of handles) {
    const h = hd.h, r = document.createElement('input');
    r.type = 'range'; r.className = 'lk3d-sr';
    const step = h.snap || (h.along ? 0.01 : h.turn ? 1 : ((h.max ?? 1) - (h.min ?? 0)) / 100);
    r.min = String(h.min ?? 0); r.max = String(h.max ?? (h.turn ? 360 : 1)); r.step = String(step);
    hd.dp = Math.max(0, Math.ceil(-Math.log10(step) - 1e-9));  // the value read out to the step's last digit
    r.value = String(hd.v); r.setAttribute('aria-label', h.label || hd.p.name || hd.p.id); r.setAttribute('aria-valuetext', valueText(hd));
    r.addEventListener('input', () => setHandle(hd, HD.hold(h, hd.round ? hd.v + HD.unwrap(+r.value - mod360(hd.v)) : +r.value), true));
    r.addEventListener('focus', () => { st.selected = hd.p.id; stage.classList.add('lk3d-kbd'); info(); kick(); });  // the part lights up
    r.addEventListener('blur', () => { stage.classList.remove('lk3d-kbd'); });
    hd.input = r; el.append(r);
  }
  const ro = new ResizeObserver(resize); ro.observe(stage);
  const wake = () => { const was = visible; visible = onScreen && pageShown; if (visible && !was) { measureRefresh(); kick(); } };
  const io = new IntersectionObserver((es) => { onScreen = es[es.length - 1].isIntersecting; wake(); }, { rootMargin: '100px' }); io.observe(stage);
  const onVis = () => { pageShown = !document.hidden; wake(); };
  document.addEventListener('visibilitychange', onVis);
  watchDpr(); resize(); info();
  stats.setupMs = performance.now() - t0;
  return api;
}

const LK3D = {
  mount,
  reduce: typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches,
  // for tests and tools: the geometry a scene makes, without a page (each part also as one plain geometry, g)
  build(spec, q = 1) { const S = buildScene(spec, q); for (const p of S.parts) Object.defineProperty(p, 'g', { get() { return this._g || (this._g = flatten(this)); } }); return S; },
  M, version: 2, refreshFrom,
};
if (typeof window !== 'undefined') window.LK3D = LK3D;
export default LK3D;
export const { build, reduce, version } = LK3D;
export { mount, M, refreshFrom };
